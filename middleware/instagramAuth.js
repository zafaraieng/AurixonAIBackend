import InstagramService from '../services/instagramService.js';
import { log } from '../utils/logger.js';

// This middleware validates Instagram auth and attaches result to request
export const validateInstagramAuth = async (req, res, next) => {
  try {
    const uid = req.cookies?.uid;
    
    if (!uid) {
      req.instagramAuth = { connected: false, error: 'Not authenticated' };
      return next();
    }

    // Use singleton InstagramService to check connection
    const authStatus = await InstagramService.checkConnection(uid);
    
    // Attach to request so other handlers don't need to recheck
    req.instagramAuth = authStatus;
    
    // Log connection status for debugging
    if (!authStatus.connected) {
      log('Instagram not connected:', authStatus.error || 'No valid Instagram authentication');
    }

    next();
  } catch (error) {
    log('Error in Instagram auth middleware:', error);
    req.instagramAuth = { connected: false, error: error.message };
    next();
  }
};
