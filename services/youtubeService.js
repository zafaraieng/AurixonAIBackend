import { google } from 'googleapis';
import fs from 'fs';
import User from '../models/User.js';
import { log, err } from '../utils/logger.js';
import { getOAuth2Client } from '../config/googleAuth.js';

/**
 * Returns an authorized YouTube client using a stored refresh token.
 */
export async function getYouTubeClient(refreshToken) {
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
  return youtube;
}

/**
 * Uploads a video to YouTube.
 */
export async function uploadToYouTube(userId, filePath, meta = {}) {
  try {
    // Validate file path
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`Video file not found at path: ${filePath}`);
    }

    // Get user from database
    const user = await User.findById(userId);
    if (!user || !user.refreshToken) {
      throw new Error('User not found or not authenticated with YouTube');
    }

    log('Starting YouTube upload process for user:', userId);
    log('File path:', filePath);

    // Create authorized client
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: user.refreshToken });
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const {
      title = 'Untitled',
      description = '',
      privacyStatus = 'public',
      publishAt,
      thumbnailPath
    } = meta;

    // Upload the video first
    const videoUploadResponse = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title,
          description
        },
        status: {
          privacyStatus,
          ...(publishAt && { publishAt })
        }
      },
      media: {
        body: meta.videoStream || fs.createReadStream(filePath)
      }
    });

    const videoId = videoUploadResponse.data.id;
    log('Video uploaded successfully with ID:', videoId);

    // If we have a thumbnail, try to set it with retries
    if (thumbnailPath) {
      const maxRetries = 3;
      let retryCount = 0;
      let thumbnailSet = false;

      while (retryCount < maxRetries && !thumbnailSet) {
        try {
          // Wait a bit before retrying (exponential backoff)
          if (retryCount > 0) {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, retryCount)));
          }

          // Verify video is ready for thumbnail
          const videoDetails = await youtube.videos.list({
            part: ['status', 'processingDetails'],
            id: videoId
          });

          const processingStatus = videoDetails.data.items[0]?.processingDetails?.processingStatus;
          if (processingStatus === 'processing') {
            log('Video still processing, waiting before setting thumbnail...');
            continue;
          }

          await youtube.thumbnails.set({
            videoId,
            media: {
              body: fs.createReadStream(thumbnailPath)
            }
          });

          log('Custom thumbnail set successfully');
          thumbnailSet = true;
        } catch (thumbnailError) {
          log(`Thumbnail upload attempt ${retryCount + 1} failed:`, thumbnailError.message);
          retryCount++;

          if (retryCount === maxRetries) {
            log('Note: Custom thumbnail could not be set after all retries, using default');
            log(`Default thumbnail URL: https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
          }
        }
      }
    }

    return {
      success: true,
      videoId,
      url: `https://youtube.com/watch?v=${videoId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };

  } catch (error) {
    err('YouTube upload error:', error);
    throw error;
  }
}
