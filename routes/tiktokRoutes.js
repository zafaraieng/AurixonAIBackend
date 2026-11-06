import { Router } from 'express';
import { tiktokLogin, tiktokCallback, getTikTokStatus, disconnectTikTok } from '../controllers/tiktokController.js';

const router = Router();

// TikTok OAuth routes
router.get('/login', tiktokLogin);
router.get('/status', getTikTokStatus);
router.post('/disconnect', disconnectTikTok);

// Handle both /tiktok/callback and /callback/tiktok paths
router.get('/callback', tiktokCallback);
router.get('/', tiktokCallback); // Root path for when mounted at /callback/tiktok

export default router;
