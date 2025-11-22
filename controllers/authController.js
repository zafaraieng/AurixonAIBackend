import { google } from 'googleapis';
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
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // ensures refresh_token on first time
    scope: scopes
  });
  res.redirect(url);
};

export const googleCallback = async (req, res) => {
  try {
    const code = req.query.code;
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
    res.cookie('uid', String(user._id));
    
    // Log successful auth
    log('User authenticated:', { id: user._id, email: user.email });

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

export const setInstagramCredentials = async (req, res) => {
  try {
    const uid = req.cookies?.uid;
    if (!uid) return res.status(401).json({ error: 'Not authenticated' });

    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const user = await User.findByIdAndUpdate(uid, {
      'instagramCredentials.username': username,
      'instagramCredentials.password': password,
      'instagramCredentials.lastLogin': new Date()
    }, { new: true });

    res.json({ ok: true });
  } catch (e) {
    console.error('setInstagramCredentials error:', e);
    res.status(500).json({ error: 'Failed to save Instagram credentials' });
  }
};
