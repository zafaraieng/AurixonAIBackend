import { log } from '../utils/logger.js';

export const sessionMiddleware = async (req, res, next) => {
    const uid = req.cookies?.uid;
    const authHeader = req.headers.authorization;
    
    // Check both cookie and Authorization header
    let userId = uid;
    // Check for Bearer token in Authorization header
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const tokenUserId = authHeader.split(' ')[1];
        // Prefer token over cookie if available
        if (tokenUserId) {
            userId = tokenUserId;
        }
    }
    
    // Validate userId format (assuming it's a MongoDB ObjectId-like string)
    if (userId && (!userId.match(/^[a-f\d]{24}$/i) && !userId.match(/^\d+$/))) {
        userId = undefined;
    }
    
    // Add session info to req object
    req.session = {
        userId: userId,
        isAuthenticated: !!userId
    };

    // Attach userId to request for easy access
    req.userId = userId;

    // Debug logging with more context
    log('Session middleware - User ID:', userId, {
        hasAuthHeader: !!authHeader,
        hasCookie: !!uid,
        path: req.path,
        method: req.method
    });

    // Enhanced cookie setting
    const originalSetCookie = res.cookie;
    res.cookie = function(name, value, options = {}) {
        const defaultOptions = {
            httpOnly: true,
            secure: true,
            sameSite: 'none',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        };
        return originalSetCookie.call(this, name, value, { ...defaultOptions, ...options });
    };

    next();
};
