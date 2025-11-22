import { google } from 'googleapis';
import fs from 'fs';
import User from '../models/User.js';
import { getOAuth2Client } from '../config/googleAuth.js';
import { log, err } from '../utils/logger.js';
import { getVideoMetadata } from '../utils/videoAnalyzer.js';

/**
 * Returns an authorized YouTube client using a stored refresh token.
 */
async function getYouTubeClient(refreshToken) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  return youtube;
}

/**
 * Uploads a video to YouTube.
 * @param {string} userId - The user's ID
 * @param {string} filePath - Path to the video file
 * @param {Object} meta - Video metadata and options
 */
export async function uploadToYouTube(userId, filePath, meta = {}) {
  try {
    // Get user from database
    const user = await User.findById(userId);
    if (!user || !user.refreshToken) {
      throw new Error('User not found or not authenticated with YouTube');
    }

    log('Starting YouTube upload process for user:', userId);
    log('Found user:', { id: user._id, hasRefreshToken: !!user.refreshToken });

    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    log('OAuth client configured with refresh token');

    // Check channel status first
    const youtube = await getYouTubeClient(user.refreshToken);
    const channelResponse = await youtube.channels.list({
      part: ['status'],
      mine: true
    });
    
    const channel = channelResponse.data.items[0];
    if (!channel) {
      throw new Error('No channel found for this user');
    }

    log('Channel status:', channel.status);

    // Log initial config for debugging
    log('Preparing YouTube upload with config:', {
      title: meta.title || 'Untitled',
      hasDescription: !!meta.description,
      privacyStatus: meta.privacyStatus || 'private',
      videoType: meta.videoType || 'long',
      hasThumbnail: !!meta.thumbnailPath
    });

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      throw new Error('Video file not found: ' + filePath);
    }

    // Get video info for metadata
    let videoInfo;
    try {
      videoInfo = await getVideoMetadata(filePath);
      log('Video info:', videoInfo);
    } catch (error) {
      log('Warning: Could not get video metadata:', error);
    }

    const isShort = meta.videoType === 'short';
    
    // Validate video for Shorts requirements
    if (isShort) {
      if (!videoInfo) {
        throw new Error('Could not get video metadata for Shorts validation');
      }
      
      if (videoInfo.duration > 60) {
        throw new Error('Video duration exceeds 60 seconds limit for YouTube Shorts');
      }
      
      if (videoInfo.width >= videoInfo.height) {
        throw new Error('Video must be in vertical format (height > width) for YouTube Shorts');
      }
      
      log('Video validated for YouTube Shorts format');
      log('Shorts metadata:', {
        duration: videoInfo.duration,
        dimensions: `${videoInfo.width}x${videoInfo.height}`,
        aspectRatio: (videoInfo.height / videoInfo.width).toFixed(2)
      });
    }

    // Prepare the request body for upload
    const requestBody = {
      snippet: {
        title: isShort ? `${meta.title || 'Untitled'} #Shorts` : (meta.title || 'Untitled'),
        description: isShort 
          ? `${meta.description || ''}\n\n#Shorts #YouTubeShorts` 
          : (meta.description || ''),
        tags: isShort ? ['Shorts', '#Shorts', ...(meta.tags || [])] : (meta.tags || []),
        categoryId: '22' // Entertainment category
      },
      status: {
        privacyStatus: meta.privacyStatus || 'private',
        selfDeclaredMadeForKids: false,
        publishAt: meta.publishAt ? new Date(meta.publishAt).toISOString() : undefined,
      }
    };

    // Add Shorts-specific metadata
    if (isShort) {
      Object.assign(requestBody, {
        status: {
          ...requestBody.status,
          madeForKids: false,
          license: 'youtube',
          embeddable: true,
          selfDeclaredMadeForKids: false
        },
        recordingDetails: {
          recordingFormat: 'vertical'
        }
      });
    }

    // Prepare upload parameters
    const uploadParams = {
      part: isShort ? ['snippet', 'status', 'recordingDetails'] : ['snippet', 'status'],
      requestBody,
      media: {
        body: fs.createReadStream(filePath)
      }
    };

    log('Uploading with params:', JSON.stringify(uploadParams, null, 2));
    const res = await youtube.videos.insert(uploadParams);

    if (!res.data || !res.data.id) {
      log('Upload response:', JSON.stringify(res.data, null, 2));
      throw new Error('Upload failed: No video ID in response');
    }

    const videoId = res.data.id;
    log('Video uploaded successfully with ID:', videoId);

    // For Shorts, update video with additional metadata
    if (isShort) {
      try {
        await youtube.videos.update({
          part: ['status'],
          requestBody: {
            id: videoId,
            status: {
              ...requestBody.status,
              embeddable: true,
              license: 'youtube',
              madeForKids: false,
              privacyStatus: meta.privacyStatus || 'private',
              selfDeclaredMadeForKids: false
            }
          }
        });
        log('Updated Shorts metadata successfully');
      } catch (updateErr) {
        log('Warning: Failed to update Shorts metadata:', updateErr);
      }
    }

    // Get or set thumbnail
    let thumbnailUrl = null;
    const thumbnails = res.data.snippet?.thumbnails || {};
    thumbnailUrl = thumbnails.maxres?.url || 
                  thumbnails.standard?.url ||
                  thumbnails.high?.url ||
                  thumbnails.default?.url;

    if (meta.thumbnailPath && fs.existsSync(meta.thumbnailPath)) {
      try {
        log('Setting custom thumbnail for video:', videoId);
        await youtube.thumbnails.set({
          videoId: videoId,
          media: {
            body: fs.createReadStream(meta.thumbnailPath)
          }
        });

        const videoDetails = await youtube.videos.list({
          part: ['snippet'],
          id: videoId
        });
        
        const updatedThumbnails = videoDetails.data.items[0]?.snippet?.thumbnails || {};
        thumbnailUrl = updatedThumbnails.maxres?.url || 
                      updatedThumbnails.standard?.url ||
                      updatedThumbnails.high?.url ||
                      updatedThumbnails.default?.url;
        
        log('Custom thumbnail set successfully');
      } catch (thumbErr) {
        log('Error setting custom thumbnail:', thumbErr);
        thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        log('Falling back to default thumbnail URL:', thumbnailUrl);
      }
    }

    return {
      id: videoId,
      thumbnailUrl: thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      status: res.data.status?.privacyStatus,
      publishAt: res.data.status?.publishAt
    };

  } catch (error) {
    err('YouTube upload error:', error);
    throw error;
  }
}
