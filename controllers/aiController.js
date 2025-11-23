import optimizeTitle from '../services/aiService.js';

export const optimizeContent = async (req, res) => {
    try {
        const { title } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        // Get optimizations directly from Gemini AI with timeout
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('AI optimization timed out')), 9000)
        );

        const optimizedContent = await Promise.race([
            optimizeTitle(title),
            timeoutPromise
        ]);

        // Return the optimized content
        res.json(optimizedContent);
    } catch (error) {
        console.error('Error in content optimization:', error);

        // More detailed error response
        const errorResponse = {
            error: 'Failed to optimize content',
            details: error.message,
            code: error.code || 'UNKNOWN_ERROR'
        };

        // Add API-specific error details if available
        if (error.response?.data) {
            errorResponse.apiError = error.response.data;
        }

        res.status(500).json(errorResponse);
    }
};
