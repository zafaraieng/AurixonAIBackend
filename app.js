import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/authRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import instagramRoutes from './routes/instagramRoutes.js';
import tiktokRoutes from './routes/tiktokRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import optimizeRoutes from './routes/optimizeRoutes.js';

// Configure CORS. Prefer explicit CLIENT_URL env var in production; fallback to localhost for dev.
const clientOrigin = process.env.CLIENT_URL || 'https://aurixon.vercel.app';
const corsOptions = {
  origin: (origin, callback) => {
    // Allow no-origin (e.g., server-to-server) or matching client origin
    if (!origin || origin === clientOrigin) return callback(null, true);
    // In dev, allow localhost origins
    if (process.env.NODE_ENV !== 'production' && /localhost/.test(origin)) return callback(null, true);
    // Otherwise block
    return callback(new Error('CORS policy: This origin is not allowed'), false);
  },
  credentials: true,
  optionsSuccessStatus: 200
};
import { tiktokCallback } from './controllers/tiktokController.js';
import { log } from './utils/logger.js';
// Remove direct import of tiktokCallback as it's now handled through routes
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create uploads directory in /tmp for Vercel or local directory otherwise
const uploadsDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const app = express();

// Verify required environment variables
if (!process.env.PUBLIC_VIDEO_URL) {
  console.warn('WARNING: PUBLIC_VIDEO_URL is not set. Some endpoints (like /api/check-video) will return file paths only. Set PUBLIC_VIDEO_URL in production to serve public video URLs.');
}

// Middleware
app.use(cors(corsOptions));

// Cookie parser middleware with proper secret
app.use(cookieParser(process.env.SESSION_SECRET || 'your-secret-key'));

// Import and use session middleware
import { sessionMiddleware } from './middleware/session.js';
app.use(sessionMiddleware);

app.use(express.json());
app.use(morgan('dev'));

// Serve uploaded files (videos and thumbnails) publicly
app.use('/uploads', express.static(uploadsDir));
app.use('/public/videos', express.static(uploadsDir));

// Serve TikTok verification file at the exact path
app.get('/tiktokXNLgk404t6KoVIaJymBadBUOtlaJSHIV.txt', (req, res) => {
  res.type('text/plain');
  res.send('tiktokXNLgk404t6KoVIaJymBadBUOtlaJSHIV');
});

// Helper endpoint to check video file availability
app.get('/api/check-video/:filename', (req, res) => {
  const { filename } = req.params;
  const videoPath = path.join(uploadsDir, filename);
  const publicUrl = `${process.env.PUBLIC_VIDEO_URL}/public/videos/${filename}`;
  
  if (fs.existsSync(videoPath)) {
    const stats = fs.statSync(videoPath);
    res.json({ 
      exists: true,
      filename,
      publicUrl,
      fileSize: stats.size,
      lastModified: stats.mtime
    });
  } else {
    res.status(404).json({ 
      exists: false,
      filename,
      searchedPath: videoPath,
      error: 'Video file not found'
    });
  }
});

// Removed test endpoint

// Routes
app.use('/auth', authRoutes);
app.use('/api', uploadRoutes);
app.use('/instagram', instagramRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/optimize', optimizeRoutes);

// Mount TikTok routes for normal operations
app.use('/tiktok', tiktokRoutes);

// Mount dedicated TikTok callback route
app.get('/callback/tiktok', async (req, res, next) => {
  log('TikTok callback received:', {
    path: req.path,
    query: req.query,
    cookies: req.cookies,
    headers: req.headers
  });
  
  // Set a temporary cookie to maintain session through the callback
  if (!req.cookies?.uid && req.query.state) {
    res.cookie('uid', req.query.state.split('_')[0], {
      maxAge: 300000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    });
  }

  if (req.query.error) {
    // Handle TikTok-provided error
    const error = req.query.error_description || req.query.error;
    log('TikTok auth error:', error);
  return res.redirect(`${process.env.CLIENT_URL || 'https://aurixon.vercel.app'}/dashboard?error=${encodeURIComponent(error)}`);
  }

  next();
}, tiktokCallback);

app.get('/', (req, res) => {
  res.send('YouTube Scheduler API is running');
});

app.get('/health', (_req, res) => res.json({ ok: true }));

export default app;

// Optional status poller startup
if (process.env.ENABLE_STATUS_POLLER === 'true') {
  import('./services/statusPoller.js').then(mod => {
    const { pollYouTubeStatuses } = mod;
    // Run immediately then every 3 minutes
    pollYouTubeStatuses().catch(e => console.error('Initial poll error', e));
    setInterval(() => {
      pollYouTubeStatuses().catch(e => console.error('Scheduled poll error', e));
    }, 3 * 60 * 1000);
    console.log('YouTube status poller started (every 3 minutes)');
  }).catch(e => console.error('Failed to start status poller', e));
}
