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
      
      // Convert video for Facebook
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

      const uploadResponse = await fetch(`https://graph.facebook.com/v16.0/${pageId}/videos`, {
        method: 'POST',
        body: formData
      });

      const uploadData = await uploadResponse.json();
      
      if (uploadData.error) {
        const errorMessage = uploadData.error.message || 'Unknown error';
        log('Facebook video upload failed:', errorMessage);
        
        // Handle specific error codes
        if (uploadData.error.code === 190) {
          throw new Error('Facebook access token expired or invalid. Please reconnect your Facebook account.');
        } else if (uploadData.error.code === 100) {
          throw new Error('Facebook API error: Invalid video format or access denied. Please check video specifications and permissions.');
        } else if (uploadData.error.code === 10) {
          // Permission error - continue with video upload but log warning
          log('Note: Post creation had an issue but video uploaded:', errorMessage);
          uploadSuccess = true;
          return { videoId, success: true, note: 'Video uploaded but post creation requires additional permissions' };
        } else {
          throw new Error(`Facebook upload failed: ${errorMessage}`);
        }
      }
      
      videoId = uploadData.id;
      uploadSuccess = true;
      log('Facebook video uploaded successfully:', videoId);

      // If video upload succeeded, create the post
      try {
        const postData = {
          message: `${title}\n\n${description}`,
          published: true,
          attached_media: [{ media_fbid: videoId }]
        };

        // Handle scheduling if requested
        if (publishTime) {
          const scheduleTime = new Date(publishTime);
          const now = new Date();
          const minScheduleTime = new Date(now.getTime() + (5 * 60 * 1000));
          const maxScheduleTime = new Date(now.getTime() + (6 * 30 * 24 * 60 * 60 * 1000));

          if (scheduleTime > minScheduleTime && scheduleTime < maxScheduleTime) {
            postData.published = false;
            postData.scheduled_publish_time = Math.floor(scheduleTime.getTime() / 1000);
          }
        }

        const postResponse = await fetch(`https://graph.facebook.com/v16.0/${pageId}/feed`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...postData,
            access_token: pageAccessToken
          })
        });

        const postResult = await postResponse.json();
        if (postResult.error) {
          log(`Note: Post creation had an issue but video uploaded: ${postResult.error.message}`);
        }
      } catch (postError) {
        log(`Note: Post creation had an issue but video uploaded: ${postError.message}`);
      }

      return { 
        success: true,
        id: videoId,
        type: publishTime && new Date(publishTime) > new Date() ? 'scheduled' : 'published',
        url: `https://facebook.com/${videoId}`,
        note: 'Video uploaded successfully'
      };

    } catch (uploadError) {
      log('Facebook video upload error:', uploadError.message);
      
      // If video upload failed, create text-only post
      const textPostData = {
        message: `${title}\n\n${description}\n\n📹 [Video upload failed - format not supported by Facebook]`,
        published: true
      };

      const postResponse = await fetch(`https://graph.facebook.com/v16.0/${pageId}/feed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...textPostData,
          access_token: pageAccessToken
        })
      });

      const postResult = await postResponse.json();
      if (postResult.error) {
        throw new Error(`Facebook post creation error: ${postResult.error.message}`);
      }

      return { 
        success: true,
        id: postResult.id,
        type: 'published',
        note: 'Video format not supported by Facebook, created text post instead'
      };
    }
  } catch (error) {
    log('Facebook upload failed:', error);
    throw error;
  } {
    err('Facebook upload error:', error);
    throw error;
  }
};
