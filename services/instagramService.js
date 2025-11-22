import fetch from 'node-fetch';
import { keys } from '../config/keys.js';
import { log, err } from '../utils/logger.js';
import { VideoProcessor } from '../utils/videoProcessor.js';

class InstagramService {
  constructor() {
    this.appId = keys.facebook.appId;
    this.appSecret = keys.facebook.appSecret;
    this.redirectUri = keys.facebook.redirectUri;
  }

  // Check if user is connected to Instagram and verify access token still works
  async checkConnection(userId) {
    try {
      const User = (await import('../models/User.js')).default;
      const user = await User.findById(userId).select('instagram');
      
      if (!user?.instagram?.accountId || !user?.instagram?.accessToken) {
        log('No Instagram credentials found for user', { userId });
        return { connected: false };
      }

      // Quick validation of access token against Graph API
      try {
        const response = await fetch(
          `https://graph.facebook.com/v17.0/me?access_token=${user.instagram.accessToken}`
        );
        const data = await response.json();
        if (data.error) {
          log('Instagram access token invalid:', data.error);
          return { connected: false, error: 'Access token invalid' };
        }
        return { connected: true, accountId: user.instagram.accountId };
      } catch (apiError) {
        log('Error validating Instagram access token:', apiError);
        return { connected: false, error: 'API validation failed' };
      }
    } catch (error) {
      log('Error checking Instagram connection:', error);
      return { connected: false, error: error.message };
    }
  }

  // Build Facebook OAuth authorize URL
  buildAuthorizeUrl() {
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: 'pages_show_list,pages_read_engagement,instagram_basic,instagram_content_publish,instagram_manage_comments,instagram_manage_insights,business_management',
      response_type: 'code',
      state: Math.random().toString(36).substring(7)
    }).toString();
    return `https://www.facebook.com/v18.0/dialog/oauth?${params}`;
  }

  // Exchange short-lived token for long-lived token
  async getLongLivedToken(shortLivedToken) {
    try {
      const params = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: this.appId,
        client_secret: this.appSecret,
        fb_exchange_token: shortLivedToken
      }).toString();
      const response = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params}`);
      const data = await response.json();
      if (data.error) {
        throw new Error(`Error getting long-lived token: ${data.error.message}`);
      }
      return data.access_token;
    } catch (error) {
      err('Error getting long-lived token:', error);
      throw error;
    }
  }

  async exchangeCodeForToken(code) {
    try {
      const params = new URLSearchParams({
        client_id: this.appId,
        client_secret: this.appSecret,
        redirect_uri: this.redirectUri,
        code: code,
        grant_type: 'authorization_code'
      }).toString();
      const response = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?${params}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(`Facebook token exchange error: ${data.error.message}`);
      }
      // Get long-lived token
      const longLivedToken = await this.getLongLivedToken(data.access_token);
      return longLivedToken;
    } catch (error) {
      err('Error exchanging code for token:', error);
      throw error;
    }
  }

  // Get user's Facebook pages
  async getUserPages(userAccessToken) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v18.0/me/accounts?access_token=${userAccessToken}`
      );
      const data = await response.json();
      if (data.error) {
        throw new Error(`Error getting user pages: ${data.error.message}`);
      }
      return data.data;
    } catch (error) {
      err('Error getting user pages:', error);
      throw error;
    }
  }

  // Get Instagram business account ID from Facebook page
  async getInstagramAccountId(pageId, pageAccessToken) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v17.0/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`
      );
      const data = await response.json();
      if (data.error) {
        throw new Error(`Error getting Instagram account: ${data.error.message}`);
      }
      return data.instagram_business_account?.id;
    } catch (error) {
      err('Error getting Instagram account ID:', error);
      throw error;
    }
  }

  // Exchange short-lived token for long-lived Instagram token
  // NOTE: This method is not used anymore - we use page access tokens directly
  // Keeping for reference but it's not called
  async exchangeForLongLivedToken(shortLivedToken) {
    try {
      const params = new URLSearchParams({
        grant_type: 'ig_exchange_token',
        client_secret: this.appSecret,
        access_token: shortLivedToken
      });
      const response = await fetch(`https://graph.instagram.com/access_token?${params}`);
      const data = await response.json();
      if (data.error) {
        throw new Error(`Error exchanging for long-lived token: ${data.error.message}`);
      }
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        expiresAt: new Date(Date.now() + (data.expires_in * 1000))
      };
    } catch (error) {
      err('Error exchanging for long-lived token:', error);
      throw error;
    }
  }

  // Refresh long-lived Instagram token
  async refreshLongLivedToken(longLivedToken) {
    try {
      const params = new URLSearchParams({
        grant_type: 'ig_refresh_token',
        access_token: longLivedToken
      });
      const response = await fetch(`https://graph.instagram.com/refresh_access_token?${params}`);
      const data = await response.json();
      if (data.error) {
        throw new Error(`Error refreshing token: ${data.error.message}`);
      }
      return {
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        expiresAt: new Date(Date.now() + (data.expires_in * 1000))
      };
    } catch (error) {
      err('Error refreshing long-lived token:', error);
      throw error;
    }
  }

  // Create media container (step 1 of publishing)
  async createMediaContainer(igUserId, igAccessToken, mediaData) {
    try {
      const { videoUrl, caption } = mediaData;
      log('Creating Instagram media container with params:', { igUserId, videoUrl, caption });
      
      const body = {
        access_token: igAccessToken,
        caption: caption || '',
        media_type: 'REELS',
        video_url: videoUrl,
        share_to_feed: 'true'
      };
      
      log('Instagram media create body (no token):', { ...body, access_token: '***' });

      const response = await fetch(
        `https://graph.facebook.com/v20.0/${igUserId}/media`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      const data = await response.json();
      if (data.error) {
        err('Instagram media container creation failed:', data.error);
        throw new Error(`Failed to create media container: ${data.error.message}`);
      }
      log('Instagram media container created successfully:', data);
      return { creationId: data.id, status: 'PENDING' };
    } catch (error) {
      err('Error creating media container:', error);
      throw error;
    }
  }

  // Get status of media container
  // Validate video specifications for Instagram
  async validateVideoSpecs(videoUrl) {
    try {
      // Basic URL validation - accept any .mp4 URL but log details for debugging
      if (!videoUrl) {
        throw new Error('Invalid video URL format: empty url');
      }
      const urlLower = String(videoUrl).toLowerCase();
      if (!(urlLower.endsWith('.mp4') || urlLower.includes('.mp4?'))) {
        err('validateVideoSpecs: videoUrl does not look like an mp4:', videoUrl);
        throw new Error('Invalid video URL format: expected .mp4');
      }

      // Add video format validation logic here if needed
      // You can check file size, duration, and other specs
      
      return true;
    } catch (error) {
      err('Video validation error:', error);
      throw error;
    }
  }

  async checkMediaStatus(creationId, igAccessToken) {
    try {
      const response = await fetch(
        `https://graph.facebook.com/v20.0/${creationId}?fields=status_code,status&access_token=${igAccessToken}`
      );
      const data = await response.json();
      
      if (data.error) {
        const errorDetails = data.error.error_user_msg || data.error.message;
        throw new Error(`Error checking media status: ${errorDetails}`);
      }

      log('Media status response:', data);
      
      // Get the status code, falling back to status if status_code is not available
      const status_code = data.status_code || data.status || 'UNKNOWN';
      
      // Map status codes to standardized statuses
      if (['FINISHED', 'PUBLISHED'].includes(status_code)) {
        return { status_code: 'FINISHED', raw_response: data };
      } else if (['IN_PROGRESS', 'PENDING', 'PROCESSING'].includes(status_code)) {
        return { status_code: 'IN_PROGRESS', raw_response: data };
      } else if (['ERROR', 'EXPIRED', 'FINISHED_WITH_ERROR'].includes(status_code)) {
        let error_message;
        switch (data.error_code) {
          case '2207052':
            error_message = 'Video format not supported. The video must be in vertical format (9:16).';
            break;
          case '2207053':
            error_message = 'Video duration exceeds maximum limit (60 seconds).';
            break;
          case '2207054':
            error_message = 'Video resolution or aspect ratio not supported.';
            break;
          case '2207055':
            error_message = 'Video file size too large (max 100MB).';
            break;
          default:
            error_message = `Upload failed (Status: ${status_code})`;
        }
        return { 
          status_code: 'ERROR', 
          error_message,
          raw_response: data 
        };
      }
      
      // Default case - treat as in progress
      return { status_code: 'IN_PROGRESS', raw_response: data };
    } catch (error) {
      log.error('Error checking media status:', error);
      throw error;
    }
  }

  // Publish media container (step 2 of publishing)
  async publishMedia(igUserId, creationId, igAccessToken) {
    try {
      const body = new URLSearchParams({ creation_id: creationId, access_token: igAccessToken });
      const response = await fetch(`https://graph.facebook.com/v17.0/${igUserId}/media_publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const data = await response.json();
      if (data.error) {
        throw new Error(`Error publishing media: ${data.error.message}`);
      }
      return { mediaId: data.id, success: true };
    } catch (error) {
      err('Error publishing media:', error);
      throw error;
    }
  }

  // Complete publishing workflow with status checking
  async publishMediaWithStatusCheck(igUserId, igAccessToken, mediaData, maxWaitTime = 900000) {
    try {
      // Step 1: Create media container
      log('Step 1: Creating media container');
      
      // Add retry mechanism for container creation
      let container;
      let retryAttempts = 0;
      const maxRetries = 3;
      
      while (retryAttempts < maxRetries) {
        try {
          container = await this.createMediaContainer(igUserId, igAccessToken, mediaData);
          break;
        } catch (error) {
          retryAttempts++;
          if (retryAttempts === maxRetries) throw error;
          log(`Container creation attempt ${retryAttempts} failed, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }
      
      // Step 2: Wait for processing to complete
      log('Step 2: Waiting for media processing...');
      let startTime = Date.now();
      let status = container.status;
      let publishAttempts = 0;
      let maxPublishAttempts = 5;

      while (status !== 'FINISHED' && (Date.now() - startTime) < maxWaitTime && publishAttempts < maxPublishAttempts) {
        publishAttempts++;
        let waitMs = Math.min(15000 * Math.pow(2, publishAttempts - 1), 90000);
        log('Waiting ' + (waitMs/1000) + ' seconds before checking status again...');
        await new Promise(resolve => setTimeout(resolve, waitMs));

        try {
          let statusResponse = await this.checkMediaStatus(container.creationId, igAccessToken);
          log('Media status response:', statusResponse);
          
          if (statusResponse.status_code === 'FINISHED') {
            status = 'FINISHED';
            log('Media processing finished successfully');
            
            // Step 3: Publish the media once processing is complete
            log('Step 3: Publishing media');
            let publishResult = await this.publishMedia(igUserId, container.creationId, igAccessToken);
            
            if (publishResult && publishResult.mediaId) {
              return { 
                success: true, 
                mediaId: publishResult.mediaId,
                status: 'PUBLISHED'
              };
            }
          } else if (statusResponse.status_code === 'IN_PROGRESS') {
            status = 'IN_PROGRESS';
            log('Media still processing...');
          } else if (statusResponse.status_code === 'ERROR') {
            if (statusResponse.error_message) {
              throw new Error(statusResponse.error_message);
            } else {
              throw new Error('Media processing failed with unknown error');
            }
          }
        } catch (error) {
          log('Error checking media status:', error);
          throw error;
        }
      }

      if (status !== 'FINISHED') {
        throw new Error('Media processing timed out or failed after ' + publishAttempts + ' attempts');
      }

      return { success: false, error: 'Failed to publish media' };
    } catch (error) {
      log('Error in publishMediaWithStatusCheck:', error);
      throw error;
    }
  }

  // Verify Instagram session is valid
  async verifySession(userId) {
    try {
      const User = (await import('../models/User.js')).default;
      const user = await User.findById(userId).select('instagram');
      if (!user?.instagram?.accountId || !user?.instagram?.accessToken) {
        log('No valid Instagram session found for user', { userId });
        return false;
      }
      return true;
    } catch (error) {
      log('Error verifying Instagram session', { error, userId });
      return false;
    }
  }

  // Upload video to Instagram (for the upload controller)
  async uploadToInstagram(userId, filePath, options) {
    try {
      const { title, description, publishTime, userId: verifiedUserId, multiPlatform } = options;

      // Validate user ID match
      if (verifiedUserId !== userId) {
        throw new Error('User ID mismatch in Instagram upload request');
      }

      // Get user's Instagram credentials
      const User = (await import('../models/User.js')).default;
      const user = await User.findById(userId).select('instagram');
      if (!user?.instagram?.accountId || !user?.instagram?.accessToken) {
        throw new Error('Instagram not connected. Please connect your Instagram account first.');
      }

      // Prefer the Instagram business user id (instagram.accountId) for API calls
      const igUserId = user.instagram?.accountId || user.instagram?.pageId;
      if (!igUserId) {
        throw new Error('No Instagram account ID available for publishing (instagram.accountId missing)');
      }
      log('Using Instagram account id for publish:', { igUserId });

      // For multi-platform uploads, wait longer to ensure resources are available
      if (multiPlatform) {
        log('Multi-platform upload detected, ensuring resource availability...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Instagram doesn't support custom thumbnails, so we ignore them completely
      log('Instagram API does not support custom thumbnails - proceeding with video upload only');

      // Validate and convert the video
      const { VideoProcessor } = await import('../utils/videoProcessor.js');
      
      // If multiple platforms are selected, use more conservative encoding settings
      const isMultiPlatform = options.multiPlatform === true;
      
      // Validate for Instagram with specific requirements for Reels
      const validationResult = await VideoProcessor.validateVideo(filePath, isMultiPlatform ? 'instagram_reels_multi' : 'instagram');
      if (!validationResult.isValid) {
        log('Video requires conversion for Instagram Reels format');
      }
      
      log('Starting Instagram Reels upload process...', { 
        instagramAccountId: igUserId,
        multiPlatform: isMultiPlatform 
      });
      
      const igAccessToken = user.instagram.accessToken;
      
      // Wait for any existing ffmpeg processes to complete if multiple platforms
      if (isMultiPlatform) {
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // Convert video to Instagram format with enhanced settings for multi-platform
      const convertedPath = await VideoProcessor.convertForInstagram(filePath, {
        // Use more conservative settings when multiple platforms are involved
        preset: isMultiPlatform ? 'veryslow' : 'medium',
        crf: isMultiPlatform ? 28 : 23,
        strict: true
      });
      const fileName = convertedPath.split(/[/\\]/).pop(); // Handle both forward and backward slashes
      // Use PUBLIC_VIDEO_URL if provided; otherwise default to Vercel backend URL.
      const publicUrl = process.env.PUBLIC_VIDEO_URL || 'https://aurixon-ai-backend.vercel.app';
      // Ensure URL ends with a trailing slash
      const baseUrl = publicUrl.endsWith('/') ? publicUrl : publicUrl + '/';
      const publicVideoUrl = `${baseUrl}public/videos/${fileName}`;
      log('Creating Instagram media container with public URL:', publicVideoUrl);
      const mediaData = {
        // Default to VIDEO but allow caller to override (uploadController passes 'REELS')
        mediaType: options.mediaType || 'VIDEO',
  videoUrl: publicVideoUrl,
  // Include the local converted file path to allow a retry re-encode if needed
  localFilePath: convertedPath,
        caption: `${title}\n\n${description}`
      };
      // Log what we'll send to the Graph API so we can verify media_type and URL
      log('Preparing to create Instagram media container with:', {
        mediaType: mediaData.mediaType,
        publicVideoUrl
      });
      // Verify access token is still valid
      try {
        const response = await fetch(
          `https://graph.facebook.com/v17.0/me?access_token=${igAccessToken}`
        );
        const data = await response.json();
        if (data.error) {
          throw new Error(`Invalid access token: ${data.error.message}`);
        }
      } catch (error) {
        err('Token validation error:', error);
        throw new Error('Failed to validate Instagram access token. Please reconnect your Instagram account.');
      }
      // Create media container with retries
      let container;
      let retryCount = 0;
      const maxRetries = 3;
      while (retryCount < maxRetries) {
        try {
          container = await this.createMediaContainer(igUserId, igAccessToken, mediaData);
          break;
        } catch (error) {
          retryCount++;
          if (retryCount === maxRetries) {
            throw error;
          }
          log(`Retry ${retryCount}/${maxRetries} for media container creation...`);
          await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between retries
        }
      }
      if (publishTime && new Date(publishTime) > new Date()) {
        return {
          id: container.creationId,
          type: 'scheduled',
          status: container.status,
          note: 'Video scheduled for Instagram, will be published at scheduled time'
        };
      } else {
        // Publish immediately
        const result = await this.publishMediaWithStatusCheck(igUserId, igAccessToken, mediaData);
        return {
          id: result.mediaId,
          type: 'published',
          creationId: result.creationId,
          note: 'Video published to Instagram successfully'
        };
      }
    } catch (error) {
      err('Instagram upload error:', error);
      throw error;
    }
  }
}

export default new InstagramService();