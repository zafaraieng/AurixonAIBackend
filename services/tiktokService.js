import { log, err } from '../utils/logger.js';
import User from '../models/User.js';
import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';

const TIKTOK_API_URL = 'https://open.tiktokapis.com/v2';

/**
 * Uploads a video to TikTok as a draft in sandbox mode
 */
export const uploadToTikTok = async (userId, filePath, options) => {
  try {
    const { title, description } = options;

    // Check if user has TikTok connected
    const user = await User.findById(userId).select('tiktok');
    if (!user?.tiktok?.accessToken) {
      throw new Error('TikTok account not connected. Please connect your TikTok account first.');
    }

    // Check for required scopes
    const requiredScopes = ['user.info.basic', 'video.upload', 'video.publish'];
    const missingScopes = requiredScopes.filter(scope => !user.tiktok.scope?.includes(scope));

    if (missingScopes.length > 0) {
      throw new Error(`Missing required TikTok permissions: ${missingScopes.join(', ')}. Please reconnect your TikTok account with the required permissions.`);
    }

    // Ensure the connected user has upload permission
    const accessToken = user.tiktok.accessToken;
    const userScopes = (user.tiktok.scope || '').split(/[,\s]+/).filter(Boolean);
    if (!userScopes.includes('video.upload')) {
      throw new Error('TikTok account is connected but missing the video.upload scope. Uploads require the video.upload permission (your app may need Content Posting API access or review).');
    }
    log('Starting TikTok upload process...');

    // Get video file size
    const stats = fs.statSync(filePath);
    const fileSize = stats.size;
    // const video = fs.readFileSync(filePath); // Removed to use stream

    // Step 1: Initialize video upload
    const initResponse = await fetch(`${TIKTOK_API_URL}/post/publish/video/init/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        post_info: {
          title: title || 'Video Title',
          description: description || '',
          privacy_level: 'SELF_ONLY', // Required for unaudited apps
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 0,
          schedule_time: null // Can be used for scheduled publishing once app is approved
        },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: fileSize,
          total_chunk_count: 1
        },
        auto_publish: true // Still enable direct upload, but as private
      })
    });

    const initData = await initResponse.json();
    log('Upload initialization response:', initData);

    if (!initData.data?.upload_url) {
      throw new Error('Failed to initialize video upload: ' + JSON.stringify(initData.error || initData));
    }

    // Step 2: Upload the video
    // Use stream for better memory management
    const fileStream = fs.createReadStream(filePath);

    const uploadResponse = await fetch(initData.data.upload_url, {
      method: 'PUT',
      headers: {
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
        'Content-Length': fileSize.toString(),
        'Content-Type': 'video/mp4'
      },
      body: fileStream
    });

    if (!uploadResponse.ok) {
      throw new Error('Video upload failed: ' + uploadResponse.statusText);
    }

    log('Video upload completed, checking status...');

    // Step 3: Check upload status
    const statusResponse = await fetch(`${TIKTOK_API_URL}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        publish_id: initData.data.publish_id
      })
    });

    const statusData = await statusResponse.json();
    log('Upload status response:', statusData);

    return {
      status: 'success',
      publishId: initData.data.publish_id,
      uploadStatus: statusData.data?.status || 'processing',
      message: 'Video uploaded successfully to TikTok as private. You can make it public from your TikTok account.'
    };

  } catch (error) {
    err('TikTok service error:', error);
    throw error;
  }
};
