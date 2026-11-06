export const keys = {
  acoustidApiKey: process.env.ACOUSTID_API_KEY || null,
  huggingfaceApiKey: process.env.HUGGINGFACE_API_KEY || null,
  // fpcalc path should be provided via environment in production (VERCEL/Windows path not reliable)
  fpcalcPath: process.env.FPCCALC_PATH || null,
  youtube: {
    apiKey: process.env.YOUTUBE_API_KEY || null
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || null,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'https://aurixon-ai-backend.vercel.app/auth/google/callback'
  },
  facebook: {
    appId: process.env.FACEBOOK_APP_ID || null,
    appSecret: process.env.FACEBOOK_APP_SECRET || null,
    redirectUri: process.env.FACEBOOK_REDIRECT_URI || 'https://aurixon-ai-backend.vercel.app/instagram/facebook/callback'
  },
  // Default frontend URL (Vercel). Override in environment for local development.
  clientUrl: process.env.CLIENT_URL || 'https://aurixon.vercel.app'
};
