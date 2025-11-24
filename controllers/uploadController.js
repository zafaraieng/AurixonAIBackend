import { uploadToYouTube, getYouTubeClient } from '../services/youtubeService.js';
import { uploadToFacebook } from '../services/facebookService.js';
import InstagramService from '../services/instagramService.js';
import { uploadToTikTok } from '../services/tiktokService.js';
import VideoSchedule from '../models/VideoSchedule.js';
import ContentFingerprint from '../models/ContentFingerprint.js';
import User from '../models/User.js';
import { log, err } from '../utils/logger.js';
import { convertToShorts } from '../utils/videoConverter.js';
import fs from 'fs';
import path from 'path';
import { downloadFile } from '../utils/fileDownloader.js';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { PassThrough } from 'stream';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// New function to save metadata only (Step 1 of Client-Side Orchestration)
export const saveVideoMetadata = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });
    const {
      cloudinaryUrl,
      title = '',
      description = '',
      publishTime,
      platforms: platformsJson,
      privacyStatus = 'private',
      videoType = 'long'
    } = req.body;

    if (!cloudinaryUrl) {
      return res.status(400).json({ error: 'Cloudinary URL is required' });
    }

    const platforms = JSON.parse(platformsJson || '{}');
    const selectedPlatforms = Object.entries(platforms)
      .filter(([_, isSelected]) => isSelected)
      .map(([platform]) => platform);

    if (selectedPlatforms.length === 0) {
      return res.status(400).json({ error: 'No platforms selected' });
    }

    // Initialize platform statuses
    const platformStatus = {
      youtube: { connected: false, status: 'not_selected', error: null },
      instagram: { connected: false, status: 'not_selected', error: null },
      facebook: { connected: false, status: 'not_selected', error: null },
      tiktok: { connected: false, status: 'not_selected', error: null }
    };

    // Check connections (fast checks only)
    for (const [platform, isSelected] of Object.entries(platforms)) {
      if (isSelected) {
        platformStatus[platform].status = 'pending';
        // Basic connection check logic (reused)
        switch (platform) {
          case 'youtube':
            const ytUser = await User.findOne({ _id: uid, refreshToken: { $exists: true } });
            platformStatus.youtube.connected = !!ytUser;
            break;
          case 'instagram':
            const igUser = await User.findById(uid).select('instagram');
            platformStatus.instagram.connected = !!(igUser?.instagram?.accountId && igUser?.instagram?.accessToken);
            break;
          case 'facebook':
            const fbUser = await User.findById(uid).select('instagram');
            platformStatus.facebook.connected = !!(fbUser?.instagram?.accessToken && fbUser?.instagram?.pageId);
            break;
          case 'tiktok':
            const ttUser = await User.findById(uid).select('tiktok');
            platformStatus.tiktok.connected = !!(ttUser?.tiktok?.accessToken);
            break;
        }
      }
    }

    const video = new VideoSchedule({
      userId: uid,
      platform: selectedPlatforms.length > 1 ? 'multi' : selectedPlatforms[0],
      title: title || 'Untitled',
      description: description || '',
      scheduledAt: publishTime ? new Date(publishTime) : new Date(),
      status: 'processing',
      mediaUrl: cloudinaryUrl, // Store Cloudinary URL
      platformStatus
    });

    await video.save();

    res.json({
      success: true,
      video: {
        _id: video._id,
        platformStatus: video.platformStatus,
        selectedPlatforms
      }
    });

  } catch (error) {
    console.error('Error saving video metadata:', error);
    res.status(500).json({ error: error.message });
  }
};

// New function to process a SINGLE platform (Step 2 of Client-Side Orchestration)
export const processPlatformUpload = async (req, res) => {
  const { videoId, platform, privacyStatus = 'private', videoType = 'long' } = req.body;
  const uid = req.cookies?.uid;
  if (!uid) return res.status(401).json({ error: 'Not authenticated' });

  if (!videoId || !platform) {
    return res.status(400).json({ error: 'Video ID and platform are required' });
  }

  try {
    const video = await VideoSchedule.findOne({ _id: videoId, userId: uid });
    if (!video) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Initialize/Update status to processing
    if (!video.platformStatus) video.platformStatus = {};
    if (!video.platformStatus[platform]) video.platformStatus[platform] = {};
    video.platformStatus[platform].status = 'processing';
    await video.save();

    // AWAIT the upload to ensure process isn't killed
    // With maxDuration: 60s, this should complete for most short videos
    await processUploadAsync(videoId, platform, privacyStatus, videoType, uid);

    // Fetch updated video to return final status
    const updatedVideo = await VideoSchedule.findOne({ _id: videoId });
    const status = updatedVideo.platformStatus[platform];

    if (status.status === 'failed') {
      throw new Error(status.error || 'Upload failed');
    }

    res.json({
      success: true,
      platform,
      result: status
    });

  } catch (error) {
    console.error(`Process platform ${platform} error:`, error);
    res.status(500).json({
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Async background processing function
async function processUploadAsync(videoId, platform, privacyStatus, videoType, uid) {
  let stage = 'init';
  let tmpDir = '';
  try {
    const video = await VideoSchedule.findOne({ _id: videoId, userId: uid });
    if (!video) {
      throw new Error('Video not found');
    }

    const videoUrl = video.mediaUrl;
    if (!videoUrl) {
      throw new Error('No media URL found for video');
    }

    const needsDownload = ['youtube', 'tiktok'].includes(platform);
    let tempFilePath = '';

    stage = 'download';
    if (needsDownload) {
      // Create temp directory
      const baseTmpDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../temp');
      if (!fs.existsSync(baseTmpDir)) {
        try { fs.mkdirSync(baseTmpDir, { recursive: true }); } catch (e) { /* ignore */ }
      }
      tmpDir = path.join(baseTmpDir, 'tmp_proc_' + Date.now());
      if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
      }

      const originalName = 'video.mp4';
      tempFilePath = path.join(tmpDir, originalName);
      log(`Downloading video from ${videoUrl} to ${tempFilePath}`);

      // Use the robust downloadFile utility
      await downloadFile(videoUrl, tempFilePath);

      const stats = fs.statSync(tempFilePath);
      log(`Downloaded file size: ${stats.size} bytes`);
      if (stats.size === 0) {
        throw new Error('Downloaded video file is empty');
      }
    }

    stage = 'upload_' + platform;
    let result = null;

    switch (platform) {
      case 'youtube':
        log('Starting YouTube upload...');
        // Pass filePath instead of stream
        result = await uploadToYouTube(uid, tempFilePath, {
          title: video.title,
          description: video.description,
          privacyStatus,
          publishAt: video.scheduledAt,
          videoType
        });
        video.platformStatus.youtube = {
          connected: true,
          status: 'published',
          videoId: result.videoId,
          thumbnailUrl: result.thumbnailUrl
        };
        video.youtubeVideoId = result.videoId;
        break;

      case 'instagram':
        const igResult = await InstagramService.uploadToInstagram(uid, videoUrl, {
          title: video.title,
          description: video.description,
          userId: uid,
          mediaType: 'REELS'
        });
        video.platformStatus.instagram = {
          connected: true,
          status: 'published',
          mediaId: igResult.id
        };
        video.instagramMediaId = igResult.id;
        break;

      case 'facebook':
        const fbResult = await uploadToFacebook(uid, videoUrl, {
          title: video.title,
          description: video.description
        });
        video.platformStatus.facebook = {
          connected: true,
          status: 'published',
          postId: fbResult.id
        };
        video.facebookPostId = fbResult.id;
        break;

      case 'tiktok':
        log('Starting TikTok upload...');
        // Pass filePath instead of stream
        const ttResult = await uploadToTikTok(uid, tempFilePath, {
          title: video.title,
          description: video.description
        });
        video.platformStatus.tiktok = {
          connected: true,
          status: ttResult.status,
          uploadStatus: ttResult.uploadStatus
        };
        break;

      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }

    await video.save();
    log(`Background upload completed for ${platform}`);
  } catch (error) {
    console.error(`Background ${platform} upload error at ${stage}:`, error);
    try {
      const video = await VideoSchedule.findOne({ _id: videoId });
      if (video && video.platformStatus && video.platformStatus[platform]) {
        video.platformStatus[platform].status = 'failed';
        video.platformStatus[platform].error = error.message;
        await video.save();
      }
    } catch (dbError) {
      console.error('Error updating video status:', dbError);
    }
  } finally {
    // Clean up
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (e) { console.error('Cleanup error:', e); }
  }
}

export const createAndUpload = async (req, res) => {
  // Legacy function - keeping for reference or fallback, but logic is largely duplicated.
  // ... (existing code) ...

  let tmpDir = '';
  try {
    // For development, use a default user ID if not authenticated
    const uid = req.cookies?.uid;
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });

    // Check for file OR cloudinaryUrl
    if (!req.files?.file && !req.body.cloudinaryUrl) {
      return res.status(400).json({ error: 'No video file uploaded' });
    }

    // Handle thumbnail if provided
    const thumbnailPath = req.files?.thumbnail ? req.files.thumbnail[0].path : null;

    const {
      title = '',
      description = '',
      publishTime,
      platforms: platformsJson,
      privacyStatus = 'private',
      videoType = 'long'
    } = req.body;

    const platforms = JSON.parse(platformsJson || '{}');
    const results = { youtube: null, facebook: null, instagram: null, tiktok: null, errors: [] };

    // Determine selected platforms and their order
    const selectedPlatforms = Object.entries(platforms)
      .filter(([_, isSelected]) => isSelected)
      .map(([platform]) => platform);

    if (selectedPlatforms.length === 0) {
      throw new Error('No platforms selected for upload');
    }

    // Create temp directory for platform-specific conversions
    // Use a consistent temp dir base
    const baseTmpDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, '../temp');
    // Ensure base temp dir exists
    if (!fs.existsSync(baseTmpDir)) {
      try { fs.mkdirSync(baseTmpDir, { recursive: true }); } catch (e) { /* ignore */ }
    }

    tmpDir = path.join(baseTmpDir, 'tmp_' + Date.now());
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    // Handle Cloudinary Download if applicable
    if (req.body.cloudinaryUrl) {
      log('Downloading from Cloudinary:', req.body.cloudinaryUrl);
      const originalName = req.body.originalFilename || 'downloaded_video.mp4';
      const tempFilePath = path.join(tmpDir, originalName);

      await downloadFile(req.body.cloudinaryUrl, tempFilePath);

      // Mock the req.files.file structure so the rest of the code works as is
      if (!req.files) req.files = {};
      req.files.file = [{
        path: tempFilePath,
        originalname: originalName,
        mimetype: 'video/mp4', // Assumption, but usually safe for this flow
        size: fs.statSync(tempFilePath).size
      }];
    }

    // Initialize platform statuses with proper status tracking
    const platformStatus = {
      youtube: { connected: false, status: 'not_selected', error: null },
      instagram: { connected: false, status: 'not_selected', error: null },
      facebook: { connected: false, status: 'not_selected', error: null },
      tiktok: { connected: false, status: 'not_selected', error: null }
    };

    // Set status for selected platforms and check connections
    for (const [platform, isSelected] of Object.entries(platforms)) {
      if (isSelected) {
        platformStatus[platform].status = 'pending';
        platformStatus[platform].error = null;
        // Check platform connections
        switch (platform) {
          case 'youtube':
            try {
              const user = await User.findOne({ _id: uid, refreshToken: { $exists: true } });
              platformStatus.youtube.connected = !!user;
              log('YouTube connection status:', platformStatus.youtube.connected);
            } catch (error) {
              log('Error checking YouTube connection:', error);
              platformStatus.youtube.connected = false;
            }
            break;
          case 'instagram':
            try {
              const { connected, error } = await InstagramService.checkConnection(uid);
              platformStatus.instagram.connected = connected;
              if (!connected) {
                log('Instagram not connected:', error || 'No valid Instagram authentication');
              }
            } catch (error) {
              log('Error checking Instagram connection:', error);
              platformStatus.instagram.connected = false;
            }
            break;
          case 'facebook':
            try {
              // Facebook uses the same token as Instagram (it's a page token)
              const user = await User.findById(uid).select('instagram');
              if (user?.instagram?.accessToken && user?.instagram?.pageId) {
                platformStatus.facebook.connected = true;
              } else {
                platformStatus.facebook.connected = false;
                log('Facebook not connected: Missing access token or page ID');
              }
            } catch (error) {
              log('Error checking Facebook connection:', error);
              platformStatus.facebook.connected = false;
            }
            break;
          case 'tiktok':
            try {
              const user = await User.findById(uid).select('tiktok');
              if (user?.tiktok?.accessToken) {
                // Check for required scopes
                const requiredScopes = ['video.upload'];
                const userScopes = (user.tiktok.scope || '').split(/[,\s]+/).filter(Boolean);
                const hasScope = requiredScopes.every(scope => userScopes.includes(scope));

                if (hasScope) {
                  platformStatus.tiktok.connected = true;
                } else {
                  platformStatus.tiktok.connected = false;
                  log('TikTok connected but missing required scopes:', requiredScopes);
                }
              } else {
                platformStatus.tiktok.connected = false;
                log('TikTok not connected: Missing access token');
              }
            } catch (error) {
              log('Error checking TikTok connection:', error);
              platformStatus.tiktok.connected = false;
            }
            break;
        }
      }
    }

    const video = new VideoSchedule({
      userId: uid,
      platform: selectedPlatforms.length > 1 ? 'multi' : selectedPlatforms[0],
      title: title || 'Untitled',
      description: description || '',
      scheduledAt: publishTime ? new Date(publishTime) : new Date(),
      status: 'processing',
      thumbnail: thumbnailPath ? {
        path: thumbnailPath,
        url: `/uploads/${path.basename(thumbnailPath)}`
      } : null,
      filePath: req.files.file[0].path,
      platformStatus // Use the new platform status structure
    });
    await video.save();

    try {
      // Upload to YouTube first if selected (it handles thumbnails)
      if (platforms.youtube) {
        try {
          // Get video file and thumbnail
          const videoFile = req.files.file[0];
          const videoPath = videoFile.path;

          const result = await uploadToYouTube(uid, videoPath, {
            title,
            description,
            privacyStatus: privacyStatus || 'public',
            publishAt: publishTime,
            videoType: 'long',
            tags: [],
            thumbnailPath: thumbnailPath,
            multiPlatform: Object.values(platforms).filter(Boolean).length > 1
          });

          if (result && result.videoId) {
            results.youtube = {
              id: result.videoId,
              thumbnailUrl: result.thumbnailUrl || `https://i.ytimg.com/vi/${result.videoId}/maxresdefault.jpg`,
              status: result.status
            };

            video.platformStatus.youtube = {
              connected: true,
              status: 'published',
              videoId: result.videoId,
              thumbnailUrl: result.thumbnailUrl || `https://i.ytimg.com/vi/${result.videoId}/maxresdefault.jpg`
            };

            // Verify the upload
            try {
              const user = await User.findById(uid);
              if (user?.refreshToken) {
                const youtube = await getYouTubeClient(user.refreshToken);
                const videoDetails = await youtube.videos.list({
                  part: ['status', 'snippet'],
                  id: result.videoId
                });

                if (videoDetails.data.items?.[0]) {
                  const latestThumbnails = videoDetails.data.items[0].snippet.thumbnails;
                  const bestThumbnail = latestThumbnails.maxres ||
                    latestThumbnails.standard ||
                    latestThumbnails.high ||
                    latestThumbnails.default;

                  video.platformStatus.youtube.thumbnailUrl = bestThumbnail?.url ||
                    `https://i.ytimg.com/vi/${result.videoId}/maxresdefault.jpg`;
                }
              }
            } catch (verifyError) {
              log('Error verifying video upload:', verifyError);
            }

            video.publishedAt = new Date();
            await video.save();
            log('YouTube upload verified and complete. Video ID:', result.videoId);
          } else {
            throw new Error('Upload failed: Invalid response from YouTube');
          }
        } catch (e) {
          video.platformStatus.youtube = {
            ...video.platformStatus.youtube,
            status: 'failed'
          };
          video.errorMessage = `YouTube: ${e.message}`;

          if (selectedPlatforms.length === 1) {
            video.status = 'failed';
          }
          await video.save();

          results.errors.push(`YouTube: ${e.message}`);
          err('YouTube upload error:', e);
        }
      }

      // Process Instagram next
      if (platforms.instagram) {
        if (!platformStatus.instagram.connected) {
          log('Skipping Instagram upload: Not connected');
          video.platformStatus.instagram = {
            status: 'failed',
            error: 'Account not connected'
          };
          results.errors.push('Instagram: Account not connected');
        } else {
          try {
            log('Uploading to Instagram...');
            const igSession = await InstagramService.verifySession(uid);
            if (!igSession) {
              throw new Error('Instagram session not found or expired');
            }

            // For multi-platform uploads, wait for previous operations
            if (Object.values(platforms).filter(Boolean).length > 1) {
              log('Multiple platforms selected, waiting for previous operations...');
              await new Promise(resolve => setTimeout(resolve, 5000));
            }

            const igResult = await InstagramService.uploadToInstagram(uid, req.files.file[0].path, {
              title,
              description,
              publishTime,
              convertedSuffix: '_ig',
              userId: uid,
              mediaType: 'REELS',
              ignoreThumbnail: true,
              multiPlatform: Object.values(platforms).filter(Boolean).length > 1
            });

            if (igResult?.id) {
              results.instagram = igResult.id;
              video.instagramMediaId = igResult.id;
              video.instagramStatus = 'published';
              video.platformStatus.instagram = {
                ...video.platformStatus.instagram,
                status: 'published',
                mediaId: igResult.id
              };

              if (selectedPlatforms.length === 1) {
                video.status = 'published';
              }
              await video.save();

              if (igResult.note) {
                log('Instagram upload note:', igResult.note);
              }
              log('Instagram upload complete. Media ID:', igResult.id);
            } else {
              throw new Error('Instagram upload failed: No media ID returned');
            }
          } catch (e) {
            video.platformStatus.instagram = {
              ...video.platformStatus.instagram,
              status: 'failed',
              error: e.message
            };
            await video.save();
            results.errors.push(`Instagram: ${e.message}`);
            err('Instagram upload error:', e);
          }
        }
      }

      // Process Facebook last
      if (platforms.facebook) {
        if (!platformStatus.facebook.connected) {
          log('Skipping Facebook upload: Not connected');
          video.platformStatus.facebook = {
            status: 'failed',
            error: 'Account not connected'
          };
          results.errors.push('Facebook: Account not connected');
        } else {
          try {
            log('Uploading to Facebook...');
            const fbResult = await uploadToFacebook(uid, req.files.file[0].path, {
              title,
              description,
              publishTime,
              convertedSuffix: '_fb'
            });
            results.facebook = fbResult.id;
            if (fbResult.note) {
              log('Facebook upload note:', fbResult.note);
            }
            log('Facebook upload complete. Post ID:', fbResult.id);
          } catch (e) {
            results.errors.push(`Facebook: ${e.message}`);
            err('Facebook upload error:', e);
            video.platformStatus.facebook = {
              status: 'failed',
              error: e.message
            };
            await video.save();
          }
        }
      }

      // Process TikTok
      if (platforms.tiktok) {
        if (!platformStatus.tiktok.connected) {
          log('Skipping TikTok upload: Not connected');
          video.platformStatus.tiktok = {
            status: 'failed',
            error: 'Account not connected'
          };
          results.errors.push('TikTok: Account not connected');
        } else {
          try {
            log('Starting TikTok upload process...');
            const tiktokResult = await uploadToTikTok(uid, req.files.file[0].path, {
              title,
              description
            });

            results.tiktok = {
              status: tiktokResult.status,
              publishId: tiktokResult.publishId,
              uploadStatus: tiktokResult.uploadStatus,
              message: tiktokResult.message
            };

            log('TikTok upload completed:', tiktokResult);
          } catch (e) {
            results.errors.push(`TikTok: ${e.message}`);
            err('TikTok upload error:', e);
            video.platformStatus.tiktok = {
              status: 'failed',
              error: e.message
            };
            await video.save();
          }
        }
      }

      // Update final statuses
      const successfulUploads = selectedPlatforms.filter(platform => results[platform] !== null);
      video.status = successfulUploads.length === 0 ? 'failed' : 'published';

      video.errorMessage = results.errors
        .filter(error => selectedPlatforms.some(platform => error.startsWith(platform)))
        .join('; ');

      if (results.youtube) {
        video.youtubeVideoId = results.youtube.id;
        video.youtubeThumbnailUrl = results.youtube.thumbnailUrl;
      }
      video.facebookPostId = results.facebook;
      video.instagramMediaId = results.instagram;

      if (results.tiktok) {
        video.tiktokData = {
          status: 'redirect',
          url: results.tiktok.url,
          message: results.tiktok.message
        };
      }

      video.platform = selectedPlatforms.length > 1 ? 'multi' : selectedPlatforms[0];
      await video.save();

      res.json({
        video,
        tiktok: results.tiktok
      });
    } finally {
      // Clean up temp directory
      try {
        if (tmpDir && fs.existsSync(tmpDir)) {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        log('Error cleaning up temp directory:', cleanupError);
      }
    }
  } catch (e) {
    // Clean up temp directory on error
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupError) {
      log('Error cleaning up temp directory:', cleanupError);
    }

    console.error('Upload controller error:', {
      error: e,
      message: e.message,
      stack: e.stack,
      files: req.files
    });
    err('Upload controller error:', e);
    res.status(500).json({
      error: 'Upload failed',
      details: e.message,
      technical: process.env.NODE_ENV === 'development' ? e.stack : undefined
    });
  }
};

export const listUploads = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });

    const items = await VideoSchedule.find({ userId: uid })
      .sort({ createdAt: -1 })
      .lean();

    const transformedItems = items.map(item => ({
      ...item,
      platformStatus: {
        youtube: {
          status: item.platformStatus?.youtube?.status || (item.youtubeVideoId ? 'published' : (item.platform === 'youtube' ? item.status : 'not_selected')),
          uploadStatus: item.platformStatus?.youtube?.uploadStatus || (item.youtubeVideoId ? 'processed' : undefined),
          videoId: item.youtubeVideoId || item.platformStatus?.youtube?.videoId || undefined,
          thumbnailUrl: item.youtubeThumbnailUrl || item.platformStatus?.youtube?.thumbnailUrl || undefined,
          error: item.platformStatus?.youtube?.error || null,
          connected: item.platformStatus?.youtube?.connected ?? Boolean(item.youtubeVideoId)
        },
        facebook: {
          status: item.platformStatus?.facebook?.status || (item.facebookPostId ? 'published' : (item.platform === 'facebook' ? item.status : 'not_selected')),
          postId: item.facebookPostId || item.platformStatus?.facebook?.postId || undefined,
          error: item.platformStatus?.facebook?.error || null,
          connected: item.platformStatus?.facebook?.connected ?? Boolean(item.facebookPostId)
        },
        instagram: {
          status: item.platformStatus?.instagram?.status || (item.instagramMediaId ? 'published' : (item.platform === 'instagram' ? item.status : 'not_selected')),
          mediaId: item.instagramMediaId || item.platformStatus?.instagram?.mediaId || undefined,
          error: item.platformStatus?.instagram?.error || null,
          connected: item.platformStatus?.instagram?.connected ?? Boolean(item.instagramMediaId)
        },
        tiktok: {
          status: item.platformStatus?.tiktok?.status || (item.tiktokData ? 'draft' : (item.platform === 'tiktok' ? item.status : 'not_selected')),
          videoId: item.platformStatus?.tiktok?.videoId || undefined,
          error: item.platformStatus?.tiktok?.error || null,
          connected: item.platformStatus?.tiktok?.connected ?? Boolean(item.tiktokData)
        }
      },
      tiktokDraftUrl: item.tiktokData?.draftUrl
    }));

    res.json(transformedItems);
  } catch (e) {
    err('listUploads error', e);
    res.status(500).json({ error: 'Failed to fetch uploads', details: e.message });
  }
};

export const deleteUpload = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });
    const { id } = req.params;
    const deleted = await VideoSchedule.findOneAndDelete({ _id: id, userId: uid });
    if (!deleted) return res.status(404).json({ error: 'Upload not found' });

    if (deleted.filePath) {
      try { fs.unlinkSync(deleted.filePath); } catch (_) { /* ignore */ }
    }

    res.json({ ok: true });
  } catch (e) {
    err('deleteUpload error', e);
    res.status(500).json({ error: 'Failed to delete upload', details: e.message });
  }
};

export const editUpload = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });
    const { id } = req.params;
    const { title, description, scheduledTime } = req.body;
    const updated = await VideoSchedule.findOneAndUpdate(
      { _id: id, user: uid },
      { title, description, scheduledTime },
      { new: true }
    ).lean();
    if (!updated) return res.status(404).json({ error: 'Upload not found' });
    res.json(updated);
  } catch (e) {
    err('editUpload error', e);
    res.status(500).json({ error: 'Failed to edit upload', details: e.message });
  }
};