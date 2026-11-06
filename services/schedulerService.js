import cron from 'node-cron';
import VideoSchedule from '../models/VideoSchedule.js';
import InstagramService from './instagramService.js';
import { log, err } from '../utils/logger.js';

class SchedulerService {
  constructor() {
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) {
      log('Scheduler already running');
      return;
    }

    // Run every minute to check for scheduled posts
    cron.schedule('* * * * *', () => {
      this.processScheduledPosts();
    });

    this.isRunning = true;
    log('Instagram scheduler started');
  }

  stop() {
    this.isRunning = false;
    log('Instagram scheduler stopped');
  }

  async processScheduledPosts() {
    try {
      const now = new Date();
      
      // Find posts that are scheduled and due for publishing
      const duePosts = await VideoSchedule.find({
        platform: 'instagram',
        status: 'scheduled',
        scheduledAt: { $lte: now }
      });

      if (duePosts.length === 0) {
        return;
      }

      log(`Found ${duePosts.length} Instagram posts due for publishing`);

      for (const post of duePosts) {
        try {
          await this.publishPost(post);
        } catch (error) {
          err(`Failed to publish post ${post._id}:`, error);
          await this.markPostAsFailed(post, error.message);
        }
      }
    } catch (error) {
      err('Error processing scheduled posts:', error);
    }
  }

  async publishPost(post) {
    try {
      // Update status to processing
      post.status = 'processing';
      await post.save();

      // Check if we need to refresh the token
      const user = await post.populate('userId');
      if (!user.instagram?.accessToken) {
        throw new Error('No Instagram access token available');
      }

      // Check if token is expired
      if (user.instagram.tokenExpiresAt < new Date()) {
        throw new Error('Instagram access token expired');
      }

      // Publish the post
      const result = await InstagramService.publishMediaWithStatusCheck(
        user.instagram.accountId,
        user.instagram.accessToken,
        {
          mediaType: post.mediaType,
          caption: post.caption,
          ...(post.mediaType === 'VIDEO' ? { videoUrl: post.mediaUrl } : { imageUrl: post.mediaUrl })
        }
      );

      // Update post status to published
      post.status = 'published';
      post.publishedAt = new Date();
      post.instagramData.mediaId = result.mediaId;
      await post.save();

      log(`Successfully published Instagram post ${post._id} with media ID ${result.mediaId}`);

    } catch (error) {
      err(`Error publishing post ${post._id}:`, error);
      
      // Increment retry count
      post.retryCount = (post.retryCount || 0) + 1;
      
      if (post.retryCount >= post.maxRetries) {
        await this.markPostAsFailed(post, error.message);
      } else {
        // Reschedule for later (5 minutes from now)
        post.scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
        post.status = 'scheduled';
        await post.save();
        log(`Rescheduled post ${post._id} for retry ${post.retryCount}/${post.maxRetries}`);
      }
    }
  }

  async markPostAsFailed(post, errorMessage) {
    post.status = 'failed';
    post.errorMessage = errorMessage;
    await post.save();
    log(`Marked post ${post._id} as failed: ${errorMessage}`);
  }

  // Manual trigger for testing
  async triggerNow() {
    log('Manually triggering scheduled posts processing');
    await this.processScheduledPosts();
  }
}

export default new SchedulerService();
