import { Router } from 'express';
import * as aiController from '../controllers/aiController.js';

const router = Router();

// Error handling middleware
const asyncHandler = fn => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// Route to optimize title, generate description and tags
router.post('/optimize', asyncHandler(aiController.optimizeContent));

export default router;
