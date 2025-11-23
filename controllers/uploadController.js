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

export const createAndUpload = async (req, res) => {
  let tmpDir = '';
  try {
    // For development, use a default user ID if not authenticated
    const uid = req.cookies?.uid || 'dev-user-' + Date.now();

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
    const baseTmpDir = process.env.VERCEL ? '/tmp' : path.join(path.dirname(import.meta.url.replace('file://', '')), '../temp');
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

                  // Process TikTok
                  if (platforms.tiktok) {
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