import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';
import { validateInstagramAuth } from '../middleware/instagramAuth.js';
import ContentAnalysisService from '../services/contentAnalysisService.js';
import { AudioFingerprinter } from '../services/audioFingerprinter.js';
import { VideoMatcher } from '../services/videoMatcher.js';
import { TextSimilarityAnalyzer } from '../services/textSimilarityAnalyzer.js';
import YoutubeContentMatcher from '../services/youtubeContentMatch.js';
import { PlatformDetector } from '../services/platformDetector.js';
import ContentFingerprint from '../models/ContentFingerprint.js';
import VideoSchedule from '../models/VideoSchedule.js';
import User from '../models/User.js';
import { keys } from '../config/keys.js';
import {
  createAndUpload,
  listUploads,
  deleteUpload,
  editUpload,
  saveVideoMetadata,
  processPlatformUpload
} from '../controllers/uploadController.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();

// Initialize content analysis service
console.log('Initializing ContentAnalysisService with config:', {
  acoustidApiKey: keys.acoustidApiKey ? '***' : undefined,
  huggingfaceApiKey: keys.huggingfaceApiKey ? '***' : undefined,
  fpcalcPath: keys.fpcalcPath
});

const contentAnalysis = new ContentAnalysisService({
  acoustidApiKey: keys.acoustidApiKey,
  huggingfaceApiKey: keys.huggingfaceApiKey,
  fpcalcPath: keys.fpcalcPath
});

// YouTube matcher for corroborating audio matches
const youtubeMatcher = new YoutubeContentMatcher(keys.youtube?.apiKey);

// Configure multer for video and thumbnail uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadsDir = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '../uploads');
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto
      .createHash('md5')
      .update(file.originalname + Date.now())
      .digest('hex');
    cb(null, uniqueName);
  }
});

// Configure multer upload with file type validation
const fileFilter = (req, file, cb) => {
  const allowedVideoTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-ms-wmv'];
  const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/avif', 'image/webp'];

  if (file.fieldname === 'file' && allowedVideoTypes.includes(file.mimetype)) {
    cb(null, true);
  } else if (file.fieldname === 'thumbnail' && allowedImageTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(null, false);
    console.log(`Rejected file: ${file.fieldname} ${file.mimetype}`);
  }
};

// Initialize multer upload middleware
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 1024 * 1024 * 100 // 100MB limit
  }
});

// Content validation endpoint
router.post('/validate', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('Validating file:', req.file);
    const absolutePath = req.file.path;

    // Perform comprehensive content analysis
    const analysisResults = await contentAnalysis.analyzeContent(absolutePath);

    // Check for copyright matches in database
    const fingerprint = await ContentFingerprint.findOne({
      $or: [
        { audioFingerprint: analysisResults.audioFingerprint },
        { videoFingerprint: analysisResults.videoFingerprint }
      ]
    });

    // Build copyright match info preferring DB fingerprint, then analyzer results
    let copyrightMatch = { found: false };
    if (fingerprint) {
      const analysisAudioMatch = analysisResults?.technicalAnalysis?.audio?.matches?.[0];
      const title = fingerprint.title || analysisAudioMatch?.title || analysisAudioMatch?.recordings?.[0]?.title || 'Unknown Content';
      const owner = fingerprint.owner || analysisAudioMatch?.owner || analysisAudioMatch?.recordings?.[0]?.artist || 'Unknown Owner';
      copyrightMatch = {
        found: true,
        matchType: fingerprint.audioFingerprint === analysisResults.audioFingerprint ? 'audio' : 'video',
        originalContent: {
          title,
          owner,
          registrationDate: fingerprint.createdAt || new Date()
        }
      };
    } else if (analysisResults?.technicalAnalysis?.audio?.matches?.length) {
      // We have an audio fingerprint match from acoustid; try to corroborate via YouTube
      const am = analysisResults.technicalAnalysis.audio.matches[0];
      const evidenceTitle = am?.title || am?.recordings?.[0]?.title;
      const evidenceArtist = am?.artist || am?.recordings?.[0]?.artist;

      let ytMatch = null;
      if (youtubeMatcher && (evidenceTitle || evidenceArtist)) {
        // Prefer searching by title then fall back to artist
        const query = evidenceTitle || evidenceArtist;
        try {
          ytMatch = await youtubeMatcher.findMatchingVideo(query);
        } catch (err) {
          console.error('YouTube corroboration failed:', err);
          ytMatch = null;
        }
      }

      if (ytMatch) {
        // Use YouTube metadata as the authoritative source
        copyrightMatch = {
          found: true,
          matchType: 'audio',
          originalContent: {
            title: ytMatch.title || (evidenceTitle || 'Unknown Content'),
            owner: ytMatch.owner || (evidenceArtist || 'Unknown Owner'),
            url: ytMatch.originalUrl || null,
            registrationDate: ytMatch.publishedAt ? new Date(ytMatch.publishedAt) : new Date(),
            matchConfidence: ytMatch.similarity || 0
          }
        };
      } else {
        // No corroboration found on YouTube — treat as unconfirmed
        copyrightMatch = { found: false };
        analysisResults.recommendations = analysisResults.recommendations || [];
        analysisResults.recommendations.unshift('Potential audio fingerprint match could not be corroborated on YouTube; manual verification required.');
      }
    }

    const results = {
      ...analysisResults,
      copyrightMatch,
      platform: 'unknown', // TODO: Implement platform detection
      platformSpecific: {
        youtube: { eligible: !copyrightMatch.found },
        instagram: { eligible: !copyrightMatch.found },
        facebook: { eligible: !copyrightMatch.found },
        tiktok: { eligible: !copyrightMatch.found }
      }
    };

    // If a match was detected but original content metadata is not available,
    // do not surface it as a confirmed copyright match to the user. Instead,
    // add a recommendation for manual verification and keep platforms eligible.
    if (results.copyrightMatch?.found) {
      const oc = results.copyrightMatch.originalContent || {};
      const hasMeaningfulMetadata = (
        (oc.title && oc.title !== 'Unknown Content') ||
        (oc.owner && oc.owner !== 'Unknown Owner') ||
        !!oc.url
      );

      if (!hasMeaningfulMetadata) {
        results.recommendations = results.recommendations || [];
        results.recommendations.unshift('Potential fingerprint match found but no original metadata is available; manual verification is required before flagging copyright.');
        // Clear the flagged match so frontend won't display copyright card
        results.copyrightMatch.found = false;
        // Keep platforms eligible until a confirmed match with metadata is present
        results.platformSpecific = {
          youtube: { eligible: true },
          instagram: { eligible: true },
          facebook: { eligible: true },
          tiktok: { eligible: true }
        };
      }
    }

    // Store new fingerprint if no match found
    if (!fingerprint) {
      // Find or create system user
      let userId = req.user?.id;
      if (!userId) {
        // Try to find existing system user
        let systemUser = await User.findOne({ email: 'system@aurixon.ai' });
        if (!systemUser) {
          // Create system user if it doesn't exist
          systemUser = new User({
            email: 'system@aurixon.ai',
            name: 'System',
            role: 'system'
          });
          await systemUser.save();
        }
        userId = systemUser._id;
      }

      // Create a VideoSchedule first
      const videoSchedule = new VideoSchedule({
        userId: userId,
        platform: 'multi', // Default platform
        title: req.body.title || 'Unknown',
        status: 'pending',
        scheduledAt: new Date(), // Default to now, can be updated later
        mediaType: 'VIDEO'
      });
      await videoSchedule.save();

      const newFingerprint = new ContentFingerprint({
        audioFingerprint: analysisResults.audioFingerprint,
        videoFingerprint: analysisResults.videoFingerprint,
        videoId: videoSchedule._id,
        title: req.body.title || 'Unknown',
        owner: req.user ? req.user.id : 'system'
      });
      await newFingerprint.save();
    }

    console.log('Analysis completed successfully:', results);
    res.json(results);
  } catch (error) {
    console.error('Error during content validation:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    res.status(500).json({
      error: 'Error validating content',
      details: error.message,
      type: error.name
    });
  }
}); // file upload with optional thumbnail

// Handle both video and thumbnail upload
const uploadFields = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]);

// New routes for Client-Side Orchestration
router.post('/save-metadata', validateInstagramAuth, saveVideoMetadata);
router.post('/process-platform', validateInstagramAuth, processPlatformUpload);

// Route for Cloudinary URL submission (JSON only, no Multer)
router.post('/save-video', validateInstagramAuth, async (req, res) => {
  try {
    if (!req.body.cloudinaryUrl) {
      return res.status(400).json({ error: 'Cloudinary URL is required' });
    }

    // 1. Send immediate success response to prevent timeout
    res.status(202).json({
      success: true,
      message: 'Video processing started in background',
      status: 'processing'
    });

    // 2. Create a mock response object for the controller
    const mockRes = {
      status: (code) => ({
        json: (data) => console.log(`[Background] Status ${code}:`, data),
        send: (data) => console.log(`[Background] Status ${code}:`, data)
      }),
      json: (data) => console.log('[Background] JSON:', data),
      headersSent: false
    };

    // 3. Run the heavy lifting in the background
    // We don't await this, so the main request finishes immediately
    createAndUpload(req, mockRes).catch(err => {
      console.error('Background processing error:', err);
    });

  } catch (error) {
    console.error('Error in save-video route:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

router.post('/uploads', validateInstagramAuth, uploadFields, async (req, res) => {
  try {
    // Allow if file is uploaded OR if cloudinaryUrl is provided
    if (!req.files?.file?.[0] && !req.body.cloudinaryUrl) {
      return res.status(400).json({ error: 'No video file uploaded or Cloudinary URL provided' });
    }

    // Pass control to createAndUpload with the uploaded files
    await createAndUpload(req, res);
  } catch (error) {
    console.error('Error in upload route:', {
      error,
      message: error.message,
      stack: error.stack,
      files: req.files
    });
    res.status(500).json({
      error: error.message || 'Internal Server Error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// management endpoints used by frontend
router.get('/uploads', listUploads);
router.delete('/uploads/:id', deleteUpload);
router.put('/uploads/:id', editUpload);

export default router;
