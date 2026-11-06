import { uploadToTikTok } from '../services/tiktokService.js';
import User from '../models/User.js';
import { log, err } from '../utils/logger.js';
import fetch from 'node-fetch';
import { generateOAuthState, verifyOAuthState } from '../utils/oauthState.js';

// Redirect user to TikTok OAuth
export const tiktokLogin = async (req, res) => {
  try {
    if (!req.session?.isAuthenticated) {
      throw new Error('User not authenticated');
    }

    const userId = req.session.userId;
    const state = generateOAuthState(userId);
    const authorizeUrl = buildTikTokAuthorizeUrl(state);
    
    log('TikTok login initiated:', { userId, state });
    res.redirect(authorizeUrl);
  } catch (error) {
    err('TikTok login error:', error);
  res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=${encodeURIComponent(error.message)}`);
  }
};

// Handle TikTok OAuth callback
export const tiktokCallback = async (req, res) => {
  try {
    const { code, state, error, error_description, error_summary } = req.query;
    
    if (error) {
      const errorMsg = error_description || error_summary || error;
      log('TikTok auth error:', { error, error_description, error_summary });
  return res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=${encodeURIComponent(errorMsg)}`);
    }
    
    if (!code || !state) {
      log('Missing code or state');
  return res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=Invalid OAuth response`);
    }

    // Verify the state and get the original user ID
    const originalUserId = verifyOAuthState(state);
    if (!originalUserId) {
      log('Invalid or expired OAuth state');
  return res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=OAuth state expired or invalid`);
    }

    log('Verified OAuth state:', { originalUserId, state });

    // Use the verified user ID from state instead of session
    const userId = originalUserId;
    log('TikTok callback - Using verified user ID:', userId);

    // Find existing user
    const existingUser = await User.findById(userId).select('email tiktok');
    if (!existingUser) {
      log('User not found in database:', userId);
  return res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=User not found`);
    }

    log('Found user for TikTok callback:', { id: existingUser._id, email: existingUser.email });
    
    // Set the session to this user's ID to maintain consistency
    res.cookie('uid', userId);

    log('Found existing user, proceeding with TikTok connection');

    log('Received TikTok callback with code:', code);

    // Exchange code for access token and update user
    let tokenResponse;
    try {
      tokenResponse = await exchangeCodeForToken(code);
      log('Token response:', tokenResponse);
      
      if (!tokenResponse.access_token) {
        if (tokenResponse.error) {
          throw new Error(`TikTok OAuth failed: ${tokenResponse.error_description || tokenResponse.error}`);
        }
        throw new Error('Failed to get access token');
      }

      // Get user profile info
      const userProfile = await fetchTikTokUserProfile(tokenResponse.access_token);
      log('User profile:', userProfile);
      log('Updating existing user:', userId);
      
      // Update existing user with TikTok credentials
      await User.findByIdAndUpdate(userId, {
        $set: {
          'tiktok.accessToken': tokenResponse.access_token,
          'tiktok.refreshToken': tokenResponse.refresh_token,
          'tiktok.expiresIn': tokenResponse.expires_in,
          'tiktok.username': userProfile.username,
          'tiktok.userId': userProfile.open_id,
          'tiktok.scope': tokenResponse.scope,
          'tiktok.tokenType': tokenResponse.token_type,
          'tiktok.refreshExpiresIn': tokenResponse.refresh_expires_in,
          'tiktok.connectedAt': new Date()
        }
      }, { new: true });

      // Verify the update
      const updatedUser = await User.findById(userId).select('tiktok');
      log('Verification - Updated user TikTok data:', updatedUser?.tiktok);

      // Redirect back to frontend with success state
  res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?tiktok=connected`);
    } catch (error) {
      err('TikTok callback error:', error);
  res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=tiktok_auth_failed`);
    }
  } catch (error) {
    err('TikTok callback error:', error);
  res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=tiktok_auth_failed`);
  }
};

// Get TikTok connection status
export const getTikTokStatus = async (req, res) => {
  try {
    if (!req.session?.isAuthenticated) {
      log('User not authenticated');
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = req.session.userId;
    log('Checking TikTok status for user:', userId);

    const user = await User.findById(userId).select('tiktok email');
    if (!user) {
      log('User not found:', userId);
      // Clear invalid session
      res.clearCookie('uid');
      return res.status(404).json({ error: 'User not found' });
    }

    log('Found user:', { id: user._id, email: user.email });

    // Check all required TikTok fields
    const connected = !!(
      user.tiktok?.accessToken &&
      user.tiktok?.userId &&
      user.tiktok?.username &&
      user.tiktok?.connectedAt &&
      new Date(user.tiktok.connectedAt).getTime() > 0
    );

    // Check if all required scopes are authorized
    // For connection we only require basic user info to allow login to succeed.
    const requiredScopes = ['user.info.basic'];
    
    // Split the stored scope string and check each required scope
    const userScopes = user.tiktok?.scope?.split(',').map(s => s.trim()) || [];
    const hasRequiredScopes = connected && 
      requiredScopes.every(scope => userScopes.includes(scope));

    log('TikTok connection status:', {
      connected,
      username: user.tiktok?.username,
      userId: user.tiktok?.userId,
      connectedAt: user.tiktok?.connectedAt,
      scope: user.tiktok?.scope,
      hasRequiredScopes
    });

    if (connected && !hasRequiredScopes) {
      // Connected but missing required scopes
      return res.json({
        connected: true,
        needsReconnect: true,
        reason: 'missing_scope',
        username: user.tiktok.username,
        userId: user.tiktok.userId,
        connectedAt: user.tiktok.connectedAt,
        currentScope: user.tiktok.scope,
        requiredScopes: ['user.info.basic', 'video.upload', 'video.publish']
      });
    }
    
    res.json({
      connected,
      username: user.tiktok?.username || '',
      userId: user.tiktok?.userId,
      hasVideoUpload: hasRequiredScopes,
      connectedAt: user.tiktok?.connectedAt
    });
  } catch (error) {
    err('Get TikTok status error:', error);
    res.status(500).json({ error: 'Failed to get TikTok connection status' });
  }
};

// Disconnect TikTok account
export const disconnectTikTok = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });

    await User.findByIdAndUpdate(uid, {
      $unset: { tiktok: 1 }
    });

    res.json({ success: true });
  } catch (error) {
    err('Disconnect TikTok error:', error);
    res.status(500).json({ error: 'Failed to disconnect TikTok account' });
  }
};

// Helper function to build TikTok authorization URL
function buildTikTokAuthorizeUrl(state) {
  if (!process.env.TIKTOK_CLIENT_KEY) {
    throw new Error('TIKTOK_CLIENT_KEY is not configured');
  }

  if (!state) {
    throw new Error('OAuth state is required');
  }

  // For development/testing unapproved TikTok apps, request only the minimal scope
  // (`user.info.basic`). To request full video upload/publish scopes, set
  // environment variable `TIKTOK_REQUEST_FULL_SCOPES=true` in Vercel (or `.env`).
  const requestFullScopes = String(process.env.TIKTOK_REQUEST_FULL_SCOPES || '').toLowerCase() === 'true';

  const fullScopes = [
    'video.publish',
    'video.upload',
    'user.info.basic'
  ];

  const minimalScopes = [ 'user.info.basic' ];

  const scopes = requestFullScopes ? fullScopes : minimalScopes;

  // Build the query string manually to ensure proper encoding
  const redirectUri = 'https://aurixon-ai-backend.vercel.app/callback/tiktok';

  // TikTok expects scopes as a comma-separated list in v2
  const scopeString = scopes.join(',');

  log('Building TikTok authorize URL with params:', {
    clientKey: process.env.TIKTOK_CLIENT_KEY,
    redirectUri,
    scopes,
    scopeString,
    state
  });

  const queryParts = [
    `client_key=${encodeURIComponent(process.env.TIKTOK_CLIENT_KEY)}`,
    `redirect_uri=${encodeURIComponent(redirectUri)}`,
    `response_type=code`,
    `scope=${encodeURIComponent(scopeString)}`,
    `state=${encodeURIComponent(state)}`
  ];

  // Use TikTok public OAuth authorize endpoint for browser redirects
  return `https://www.tiktok.com/v2/auth/authorize?${queryParts.join('&')}`;
}

// Helper function to exchange authorization code for access token
async function exchangeCodeForToken(code) {
  // TikTok OAuth token endpoint (v2)
  const tokenEndpoint = 'https://open.tiktokapis.com/v2/oauth/token/';
  
  // Use the same redirect URI as in the authorization request
  const redirectUri = 'https://aurixon-ai-backend.vercel.app/callback/tiktok';
  
  // Build request body using URLSearchParams for form-urlencoded format
  const tokenBody = new URLSearchParams();
  tokenBody.append('client_key', process.env.TIKTOK_CLIENT_KEY);
  tokenBody.append('client_secret', process.env.TIKTOK_CLIENT_SECRET);
  tokenBody.append('code', code);
  tokenBody.append('grant_type', 'authorization_code');
  tokenBody.append('redirect_uri', redirectUri);

  // Log the request details for debugging (excluding sensitive data)
  log('Token exchange request:', {
    endpoint: tokenEndpoint,
    client_key: process.env.TIKTOK_CLIENT_KEY,
    code: code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    hasClientSecret: !!process.env.TIKTOK_CLIENT_SECRET
  });

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache'
    },
    body: tokenBody.toString()
  });

  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    log('Token exchange response (text):', text);
    throw new Error(`Failed to parse token response: ${text}`);
  }
  
  log('Token exchange response:', data);

  // TikTok v2 API returns errors in data.error object
  if (!response.ok || data.error || (data.data && data.data.error_code)) {
    const errorObj = data.error || data.data;
    const errorMessage = errorObj?.message || 
                        errorObj?.description || 
                        data.error_description || 
                        'Unknown error occurred during token exchange';
    
    if (errorMessage.includes('scope')) {
      // Even basic scope is failing, likely app configuration issue
      throw new Error(`TikTok OAuth failed: Invalid scope 'user.info.basic'. Please check your TikTok app settings:\n1. Verify app is approved/active\n2. Check redirect URI matches exactly\n3. Confirm user.info.basic is enabled in app permissions`);
    } else if (errorMessage.includes('redirect')) {
      throw new Error(`TikTok OAuth failed: Invalid redirect URI. Please check your app settings and ensure the callback URL matches exactly.`);
    } else {
      throw new Error(`TikTok OAuth failed: ${errorMessage}`);
    }
  }

  return data;
}

// Helper function to fetch TikTok user profile
async function fetchTikTokUserProfile(accessToken) {
  const response = await fetch('https://open-api.tiktok.com/v2/user/info/?fields=open_id,display_name', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  });

  const text = await response.text();
  log('Raw user profile response:', text);
  
  let data;
  try {
    data = JSON.parse(text);
    log('User profile response:', data);
  } catch (e) {
    throw new Error(`Failed to parse user profile response: ${text}`);
  }

  // Only throw if there's an actual error
  if (!response.ok || (data.error && data.error.code !== 'ok')) {
    throw new Error(`Failed to fetch user profile: ${data.error?.message || response.statusText}`);
  }

  if (!data.data?.user) {
    throw new Error('No user data received from TikTok');
  }

  return {
    username: data.data.user.display_name || 'TikTok User',
    open_id: data.data.user.open_id
  };
}
