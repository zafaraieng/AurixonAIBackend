import { Router } from 'express';
import {
  facebookLogin,
  facebookCallback,
  getInstagramStatus,
  refreshInstagramToken,
  disconnectInstagram
} from '../controllers/instagramController.js';

import {
  createAndSchedulePost,
  publishNow,
  getScheduledPosts,
  deleteScheduledPost,
  updateScheduledPost
} from '../controllers/publishController.js';

const router = Router();

// Instagram OAuth routes
router.get('/facebook/login', facebookLogin);
router.get('/facebook/callback', facebookCallback);

// Instagram account management
router.get('/status', getInstagramStatus);
router.post('/refresh-token', refreshInstagramToken);
router.post('/disconnect', disconnectInstagram);

// Content publishing and scheduling
router.post('/schedule', createAndSchedulePost);
router.post('/publish/:scheduleId', publishNow);
router.get('/scheduled', getScheduledPosts);
router.delete('/scheduled/:scheduleId', deleteScheduledPost);
router.put('/scheduled/:scheduleId', updateScheduledPost);

export default router;
