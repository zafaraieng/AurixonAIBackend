import express from 'express';
import optimizeTitle from '../services/aiService.js';

const router = express.Router();

// POST /api/optimize/title
router.post('/title', async (req, res) => {
    try {
        const { title } = req.body;
        
        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const result = await optimizeTitle(title);
        res.json(result);
    } catch (error) {
        console.error('Optimization error:', error);
        res.status(500).json({
            error: 'Optimization failed',
            message: error.message
        });
    }
});

export default router;
