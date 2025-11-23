import fetch from 'node-fetch';
import User from '../models/User.js';
import { log, err } from '../utils/logger.js';
import fs from 'fs';
import FormData from 'form-data';

export const uploadToFacebook = async (userId, filePath, options) => {
  try {
    const { title, description, publishTime } = options;

    // Get user's Facebook page access token
    const user = await User.findById(userId).select('instagram');
    if (!user?.instagram?.accessToken) {
      throw new Error('Facebook not connected. Please connect your Facebook page first.');
    }

    const pageAccessToken = user.instagram.accessToken;
    const pageId = user.instagram.pageId;

    // Try to upload video first
    let videoId = null;
    let uploadSuccess = false;

    try {
      log('Attempting Facebook video upload...');

      const isUrl = typeof filePath === 'string' && filePath.startsWith('http');
      let uploadResponse;

      if (isUrl) {
        // Direct URL Upload
        log('Using direct video URL for Facebook:', filePath);
        const params = new URLSearchParams({
          access_token: pageAccessToken,
          file_url: filePath,
          title: title,
          description: description
        });

        uploadResponse = await fetch(`https://graph.facebook.com/v16.0/${pageId}/videos?${params}`, {
          method: 'POST'
        });

      } else {
        // Local File Upload
        log('Processing local file for Facebook...');
        const { VideoProcessor } = await import('../utils/videoProcessor.js');
        const validationResult = await VideoProcessor.validateVideo(filePath, 'facebook');

        if (!validationResult.isValid) {
          throw new Error(`Video validation failed: ${validationResult.errors.join(', ')}`);
        }

        const convertedPath = await VideoProcessor.convertForFacebook(filePath);

        const formData = new FormData();
        const fileStream = fs.createReadStream(convertedPath);
        formData.append('source', fileStream);
        formData.append('access_token', pageAccessToken);
        formData.append('title', title);
        formData.append('description', description);

        uploadResponse = await fetch(`https://graph.facebook.com/v16.0/${pageId}/videos`, {
          method: 'POST',
          body: formData
        });
      }

      const uploadData = await uploadResponse.json();

      if (uploadData.error) {
        const errorMessage = uploadData.error.message || 'Unknown error';
        log('Facebook video upload failed:', errorMessage);

        if (uploadData.error.code === 190) {
          throw new Error('Facebook access token expired or invalid. Please reconnect your Facebook account.');
        } else {
          throw new Error(`Facebook upload failed: ${errorMessage}`);
        }
      }

      videoId = uploadData.id;
      uploadSuccess = true;
      log('Facebook video uploaded successfully:', videoId);

      // If video upload succeeded, create the post (if not auto-created by video upload)
      // Facebook video upload usually creates a post automatically, but we can ensure it

      return {
        success: true,
        id: videoId,
        type: publishTime && new Date(publishTime) > new Date() ? 'scheduled' : 'published',
        url: `https://facebook.com/${videoId}`,
        note: 'Video uploaded successfully'
      };

    } catch (uploadError) {
      log('Facebook video upload error:', uploadError.message);
      throw uploadError;
    }
  } catch (error) {
    log('Facebook upload failed:', error);
    err('Facebook upload error:', error);
    throw error;
  }
};
