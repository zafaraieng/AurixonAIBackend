import { google } from 'googleapis';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import User from '../models/User.js';
import { getOAuth2Client } from '../config/googleAuth.js';
import { keys } from '../config/keys.js';
import { log, err } from '../utils/logger.js';

const scopes = [
  'https://www.googleapis.com/auth/youtube',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/youtubepartner',
  'https://www.googleapis.com/auth/youtube.channel-memberships.creator',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'openid'
];

export const googleLogin = async (req, res) => {
  const oauth2Client = getOAuth2Client();
  const state = randomBytes(32).toString('hex');
  res.cookie('google_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/auth/google/callback',
    maxAge: 10 * 60 * 1000,
    signed: true
  });
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ensures refresh_token on first time
    scope: scopes,
    state
  });
  res.redirect(url);
};

export const googleCallback = async (req, res) => {
  try {
    const code = req.query.code;
    const receivedState = typeof req.query.state === 'string' ? req.query.state : '';
    const expectedState = req.signedCookies?.google_oauth_state;
    res.clearCookie('google_oauth_state', { path: '/auth/google/callback' });
    if (!code || typeof expectedState !== 'string' || receivedState.length !== expectedState.length || !timingSafeEqual(Buffer.from(receivedState), Buffer.from(expectedState))) {
      return res.status(400).send('Invalid OAuth state. Please restart sign-in.');
    }
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // get user info
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const me = await oauth2.userinfo.get();

    const email = me?.data?.email;
    const googleId = me?.data?.id;
    const name = me?.data?.name;
    const refreshToken = tokens.refresh_token; // IMPORTANT: store this

    if (!refreshToken) {
      // If no refresh token (because user already consented before), you must have stored it earlier.
      // In dev, force prompt=consent and remove test app from https://myaccount.google.com/permissions to get it again.
      const existing = await User.findOne({ googleId });
      if (!existing?.refreshToken) {
        return res.status(400).send('No refresh_token returned. Remove app permission & try again.');
      }
    }

    const user = await User.findOneAndUpdate(
      { googleId },
      { email, name, refreshToken: refreshToken || undefined },
      { upsert: true, new: true }
    );

    // Set secure cookie session with userId (using enhanced cookie setter from middleware)
    res.cookie('uid', String(user._id), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      signed: true
    });
    
    // Log successful auth
    log('User authenticated');

  // Redirect to client dashboard and indicate successful Google connection
  const clientUrl = (keys.clientUrl || process.env.CLIENT_URL || 'https://aurixon.vercel.app').replace(/\/$/, '');
  res.redirect(`${clientUrl}/dashboard?google=connected`);
  } catch (e) {
    err('googleCallback error', e);
    res.status(500).send('Auth failed');
  }
};

export const me = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) return res.json({ authenticated: false });
    const user = await User.findById(uid).select('email name');
    if (!user) return res.json({ authenticated: false });
    res.json({ authenticated: true, user });
  } catch (e) {
    res.status(500).json({ authenticated: false });
  }
};

export const logout = async (req, res) => {
  res.clearCookie('uid');
  res.json({ ok: true });
};


// Password-based Instagram credential collection is intentionally disabled.
export const setInstagramCredentials = async (_req, res) => {
  res.status(410).json({ error: 'Password-based Instagram login is disabled. Connect through the official Facebook OAuth flow.' });
};
