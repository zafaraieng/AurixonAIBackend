import { Router } from 'express';
import { googleLogin, googleCallback, me, logout, setInstagramCredentials } from '../controllers/authController.js';

const router = Router();

router.get('/google', googleLogin);
router.get('/google/callback', googleCallback);
router.get('/me', me);
router.post('/logout', logout);
router.post('/instagram/credentials', setInstagramCredentials);

export default router;
