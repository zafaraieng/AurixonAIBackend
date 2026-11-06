import InstagramService from '../services/instagramService.js';
import User from '../models/User.js';
import VideoSchedule from '../models/VideoSchedule.js';
import { log, err } from '../utils/logger.js';

// Create and schedule Instagram post
export const createAndSchedulePost = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { caption, scheduledAt, mediaType = 'VIDEO', videoUrl, imageUrl } = req.body;

    if (!caption) {
      return res.status(400).json({ error: 'Caption is required' });
    }

    if (mediaType === 'VIDEO' && !videoUrl) {
      return res.status(400).json({ error: 'Video URL is required for video posts' });
    }

    if (mediaType === 'IMAGE' && !imageUrl) {
      return res.status(400).json({ error: 'Image URL is required for image posts' });
    }

    // Get user's Instagram credentials
    const user = await User.findById(uid).select('instagram');
    
    if (!user?.instagram?.accountId || !user?.instagram?.accessToken) {
      return res.status(400).json({ error: 'Instagram account not connected' });
    }

    // Check if token is expired
    const now = new Date();
    if (user.instagram.tokenExpiresAt < now) {
      return res.status(400).json({ error: 'Instagram token expired. Please reconnect your account.' });
    }

    // Create media container
    const mediaData = {
      mediaType,
      caption,
      ...(mediaType === 'VIDEO' ? { videoUrl } : { imageUrl })
    };

    const container = await InstagramService.createMediaContainer(
      user.instagram.accountId,
      user.instagram.accessToken,
      mediaData
    );

    // Save to database for scheduling
    const schedule = new VideoSchedule({
      userId: uid,
      platform: 'instagram',
      mediaType,
      caption,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date(),
      status: 'scheduled',
      instagramData: {
        creationId: container.creationId,
        accountId: user.instagram.accountId,
        accessToken: user.instagram.accessToken
      },
      mediaUrl: mediaType === 'VIDEO' ? videoUrl : imageUrl
    });

    await schedule.save();

    log(`Instagram post scheduled for user ${uid}, creation ID: ${container.creationId}`);

    res.json({
      success: true,
      scheduleId: schedule._id,
      creationId: container.creationId,
      status: container.status,
      scheduledAt: schedule.scheduledAt
    });

  } catch (error) {
    err('Create and schedule post error:', error);
    res.status(500).json({ error: 'Failed to schedule post', details: error.message });
  }
};

// Publish post immediately (for testing or immediate posting)
export const publishNow = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { scheduleId } = req.params;

    // Get the scheduled post
    const schedule = await VideoSchedule.findOne({ _id: scheduleId, userId: uid });
    
    if (!schedule) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    if (schedule.status !== 'scheduled') {
      return res.status(400).json({ error: 'Post is not in scheduled status' });
    }

    // Get user's Instagram credentials
    const user = await User.findById(uid).select('instagram');
    
    if (!user?.instagram?.accessToken) {
      return res.status(400).json({ error: 'Instagram account not connected' });
    }

    // Publish the post
    const result = await InstagramService.publishMediaWithStatusCheck(
      user.instagram.accountId,
      user.instagram.accessToken,
      {
        mediaType: schedule.mediaType,
        caption: schedule.caption,
        ...(schedule.mediaType === 'VIDEO' ? { videoUrl: schedule.mediaUrl } : { imageUrl: schedule.mediaUrl })
      }
    );

    // Update schedule status
    schedule.status = 'published';
    schedule.publishedAt = new Date();
    schedule.instagramData.mediaId = result.mediaId;
    await schedule.save();

    log(`Instagram post published for user ${uid}, media ID: ${result.mediaId}`);

    res.json({
      success: true,
      mediaId: result.mediaId,
      status: 'published'
    });

  } catch (error) {
    err('Publish now error:', error);
    res.status(500).json({ error: 'Failed to publish post', details: error.message });
  }
};

// Get scheduled posts
export const getScheduledPosts = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const posts = await VideoSchedule.find({ 
      userId: uid, 
      platform: 'instagram' 
    }).sort({ scheduledAt: 1 });

    res.json(posts);
  } catch (error) {
    err('Get scheduled posts error:', error);
    res.status(500).json({ error: 'Failed to get scheduled posts' });
  }
};

// Delete scheduled post
export const deleteScheduledPost = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { scheduleId } = req.params;

    const result = await VideoSchedule.findOneAndDelete({ 
      _id: scheduleId, 
      userId: uid,
      status: 'scheduled' // Only allow deletion of scheduled posts
    });

    if (!result) {
      return res.status(404).json({ error: 'Scheduled post not found or cannot be deleted' });
    }

    log(`Scheduled Instagram post deleted for user ${uid}, ID: ${scheduleId}`);

    res.json({ success: true });
  } catch (error) {
    err('Delete scheduled post error:', error);
    res.status(500).json({ error: 'Failed to delete scheduled post' });
  }
};

// Update scheduled post
export const updateScheduledPost = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { scheduleId } = req.params;
    const { caption, scheduledAt } = req.body;

    const schedule = await VideoSchedule.findOne({ 
      _id: scheduleId, 
      userId: uid,
      status: 'scheduled' // Only allow updates of scheduled posts
    });

    if (!schedule) {
      return res.status(404).json({ error: 'Scheduled post not found or cannot be updated' });
    }

    // Update fields
    if (caption !== undefined) schedule.caption = caption;
    if (scheduledAt !== undefined) schedule.scheduledAt = new Date(scheduledAt);

    await schedule.save();

    log(`Scheduled Instagram post updated for user ${uid}, ID: ${scheduleId}`);

    res.json({ success: true, schedule });
  } catch (error) {
    err('Update scheduled post error:', error);
    res.status(500).json({ error: 'Failed to update scheduled post' });
  }
};
