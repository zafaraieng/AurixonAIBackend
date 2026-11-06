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

// Configure CORS. Allow the deployed frontend explicitly
const allowedOrigins = [
  'https://aurixon.vercel.app',
  process.env.CLIENT_URL,
  'http://localhost:5173',
  'http://localhost:3000'
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow no-origin (e.g., server-to-server, Postman, etc.)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) return callback(null, true);

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

if (!process.env.SESSION_SECRET) {
  console.error('FATAL: SESSION_SECRET environment variable is required. Refusing to start with a default secret.');
  process.exit(1);
}

// Middleware
app.use(cors(corsOptions));

// Handle preflight OPTIONS requests explicitly
app.options('*', cors(corsOptions));

// Cookie parser — SESSION_SECRET is mandatory (checked above)
app.use(cookieParser(process.env.SESSION_SECRET));

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

// Routes
app.use('/auth', authRoutes);
app.use('/api', uploadRoutes);
app.use('/instagram', instagramRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/optimize', optimizeRoutes);

// Mount TikTok routes for normal operations
app.use('/tiktok', tiktokRoutes);

// Mount dedicated TikTok callback route
app.get('/callback/tiktok', tiktokCallback);

app.get('/', (req, res) => {
  res.send('Aurixon API is running');
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
