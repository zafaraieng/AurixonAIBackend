import InstagramService from '../services/instagramService.js';
import User from '../models/User.js';
import { log, err } from '../utils/logger.js';

// Redirect user to Facebook OAuth
export const facebookLogin = async (req, res) => {
  try {
    const authorizeUrl = InstagramService.buildAuthorizeUrl();
    res.redirect(authorizeUrl);
  } catch (error) {
    err('Facebook login error:', error);
    res.status(500).json({ error: 'Failed to initiate Facebook login' });
  }
};

// Handle Facebook OAuth callback
export const facebookCallback = async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    // Exchange code for short-lived access token
    const shortLivedToken = await InstagramService.exchangeCodeForToken(code);
    
    // Get user's Facebook pages
    const pages = await InstagramService.getUserPages(shortLivedToken);
    
    if (!pages || pages.length === 0) {
      return res.status(400).json({ error: 'No Facebook pages found. User must have a Facebook page.' });
    }

    // For now, use the first page (you could let user choose later)
    const selectedPage = pages[0];
    const pageId = selectedPage.id;
    const pageAccessToken = selectedPage.access_token;

    // Get Instagram business account ID
    const igAccountId = await InstagramService.getInstagramAccountId(pageId, pageAccessToken);
    
    if (!igAccountId) {
      return res.status(400).json({ error: 'No Instagram business account linked to this Facebook page.' });
    }

    // For Instagram operations, we use the page access token directly
    // No need to exchange for Instagram token - the page access token works for Instagram API calls
    const longLivedToken = {
      accessToken: pageAccessToken,
      expiresIn: 0, // Page tokens don't expire unless revoked
      expiresAt: new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)) // Set to 1 year from now
    };

    // Get user ID from session/cookie
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // Update user with Instagram credentials
    const user = await User.findByIdAndUpdate(uid, {
      'instagram.accountId': igAccountId,
      'instagram.pageId': pageId,
      'instagram.pageName': selectedPage.name,
      'instagram.accessToken': longLivedToken.accessToken,
      'instagram.tokenExpiresAt': longLivedToken.expiresAt,
      'instagram.connectedAt': new Date()
    }, { new: true });

    log(`Instagram account ${igAccountId} connected for user ${uid}`);

  // Redirect to client dashboard and signal successful Instagram connection
  // Include a query param so the frontend can show a success message
  const clientUrl = process.env.CLIENT_URL || 'https://aurixon.vercel.app';
  res.redirect(`${clientUrl.replace(/\/$/, '')}/dashboard?instagram=connected`);
  } catch (error) {
    err('Facebook callback error:', error);
    res.status(500).json({ error: 'Instagram connection failed', details: error.message });
  }
};

// Get Instagram account status
export const getInstagramStatus = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(uid).select('instagram');
    
    if (!user?.instagram?.accountId) {
      return res.json({ connected: false });
    }

    // Check if token is expired or will expire soon (within 7 days)
    const now = new Date();
    const expiresAt = new Date(user.instagram.tokenExpiresAt);
    const daysUntilExpiry = (expiresAt - now) / (1000 * 60 * 60 * 24);

    return res.json({
      connected: true,
      accountId: user.instagram.accountId,
      pageName: user.instagram.pageName,
      connectedAt: user.instagram.connectedAt,
      tokenExpiresAt: user.instagram.tokenExpiresAt,
      daysUntilExpiry: Math.round(daysUntilExpiry),
      needsRefresh: daysUntilExpiry < 7
    });
  } catch (error) {
    err('Get Instagram status error:', error);
    res.status(500).json({ error: 'Failed to get Instagram status' });
  }
};

// Refresh Instagram access token
export const refreshInstagramToken = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(uid).select('instagram');
    
    if (!user?.instagram?.accessToken) {
      return res.status(400).json({ error: 'No Instagram token to refresh' });
    }

    // Refresh the token
    const refreshedToken = await InstagramService.refreshLongLivedToken(user.instagram.accessToken);

    // Update user with new token
    await User.findByIdAndUpdate(uid, {
      'instagram.accessToken': refreshedToken.accessToken,
      'instagram.tokenExpiresAt': refreshedToken.expiresAt,
      'instagram.lastRefreshed': new Date()
    });

    log(`Instagram token refreshed for user ${uid}`);

    res.json({ 
      success: true, 
      expiresAt: refreshedToken.expiresAt,
      daysUntilExpiry: Math.round((refreshedToken.expiresAt - new Date()) / (1000 * 60 * 60 * 24))
    });
  } catch (error) {
    err('Refresh Instagram token error:', error);
    res.status(500).json({ error: 'Failed to refresh token', details: error.message });
  }
};

// Disconnect Instagram account
export const disconnectInstagram = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    await User.findByIdAndUpdate(uid, {
      $unset: { instagram: 1 }
    });

    log(`Instagram account disconnected for user ${uid}`);

    res.json({ success: true });
  } catch (error) {
    err('Disconnect Instagram error:', error);
    res.status(500).json({ error: 'Failed to disconnect Instagram' });
  }
};
