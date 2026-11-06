import VideoSchedule from '../models/VideoSchedule.js';
import { getYouTubeClient } from './youtubeService.js';
import User from '../models/User.js';
import { log, err } from '../utils/logger.js';

// Poll YouTube for video status and update the DB record
export async function pollYouTubeStatuses() {
  try {
    // Find schedules that have a YouTube video id (either top-level or in platformStatus)
    // and which are not yet final (published/failed)
    const items = await VideoSchedule.find({
      $and: [
        { $or: [ { youtubeVideoId: { $exists: true, $ne: null } }, { 'platformStatus.youtube.videoId': { $exists: true, $ne: null } } ] },
        { $or: [ { 'platformStatus.youtube.status': { $exists: false } }, { 'platformStatus.youtube.status': { $in: ['pending', 'processing', 'uploaded'] } } ] }
      ]
    });
    if (!items || items.length === 0) return;

    for (const item of items) {
      try {
        const videoId = item.youtubeVideoId || item.platformStatus?.youtube?.videoId;
        if (!videoId) continue;

        const user = await User.findById(item.userId);
        if (!user?.refreshToken) continue;

        const youtube = await getYouTubeClient(user.refreshToken);
        const res = await youtube.videos.list({ part: ['status'], id: videoId });
        const yt = res.data.items && res.data.items[0];
        if (!yt) continue;

        const uploadStatus = (yt.status?.uploadStatus || yt.status?.privacyStatus || '').toString().toLowerCase();
        // Map YouTube uploadStatus to our platformStatus
        const mapped = {};
        if (uploadStatus.includes('processing') || uploadStatus === 'uploaded') mapped.status = 'processing';
        if (uploadStatus === 'processed' || uploadStatus === 'public' || uploadStatus === 'private') mapped.status = 'published';
        if (uploadStatus === 'failed') mapped.status = 'failed';
        mapped.uploadStatus = uploadStatus;

        item.platformStatus = item.platformStatus || {};
        item.platformStatus.youtube = item.platformStatus.youtube || {};
        item.platformStatus.youtube.videoId = videoId;
        item.platformStatus.youtube.uploadStatus = mapped.uploadStatus;
        item.platformStatus.youtube.status = mapped.status || item.platformStatus.youtube.status || 'processing';

        // Update publishedAt when published
        if (mapped.status === 'published' && !item.publishedAt) item.publishedAt = new Date();

        await item.save();
        log(`Polled YouTube status for ${videoId}: ${mapped.uploadStatus}`);
      } catch (e) {
        const id = item?._id || '(unknown)';
        err('Error polling YouTube status for item', id, e);
      }
    }
  } catch (e) {
    err('pollYouTubeStatuses error', e);
  }
}

// Simple runner for manual invocation
export async function runOnce() {
  await pollYouTubeStatuses();
}
