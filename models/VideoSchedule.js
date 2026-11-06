import mongoose from 'mongoose';

const videoScheduleSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    platform: { type: String, enum: ['youtube', 'instagram', 'facebook', 'tiktok', 'multi'], required: true },
    mediaType: { type: String, enum: ['VIDEO', 'IMAGE'], default: 'VIDEO' },
    title: { type: String },
    description: { type: String },
    caption: { type: String }, // For Instagram
    status: { type: String, enum: ['pending', 'scheduled', 'processing', 'published', 'failed'], default: 'pending' },
    scheduledAt: { type: Date, required: true },
    publishedAt: { type: Date },
    
    // Platform connection and status tracking
    platformStatus: {
      youtube: {
        connected: { type: Boolean, default: false },
        status: { type: String, enum: ['not_selected', 'pending', 'processing', 'published', 'failed'], default: 'not_selected' },
        videoId: { type: String },
        thumbnailUrl: { type: String }
      },
      instagram: {
        connected: { type: Boolean, default: false },
        status: { type: String, enum: ['not_selected', 'pending', 'processing', 'published', 'failed'], default: 'not_selected' },
        mediaId: { type: String }
      },
      facebook: {
        connected: { type: Boolean, default: false },
        status: { type: String, enum: ['not_selected', 'pending', 'processing', 'published', 'failed'], default: 'not_selected' },
        postId: { type: String }
      },
      tiktok: {
        connected: { type: Boolean, default: false },
        status: { type: String, enum: ['not_selected', 'pending', 'processing', 'published', 'failed'], default: 'not_selected' },
        videoId: { type: String }
      }
    },
    
    // YouTube specific fields
    youtubeVideoId: { type: String },
    youtubeThumbnailUrl: { type: String },
    
    // Facebook specific fields
    facebookPostId: { type: String },
    
    // Instagram specific fields
    instagramData: {
      creationId: String,
      accountId: String,
      accessToken: String,
      mediaId: String
    },
    instagramMediaId: { type: String },

    // TikTok specific fields
    tiktokData: {
      videoId: String,
      postId: String,
      accessToken: String,
      uploadId: String
    },
    
    // Media files
    mediaUrl: { type: String }, // URL to video/image
    filePath: { type: String }, // Local file path if uploaded
    thumbnailUrl: { type: String }, // URL to thumbnail
    thumbnailPath: { type: String }, // Local thumbnail file path
    
    // Error handling
    errorMessage: { type: String },
    retryCount: { type: Number, default: 0 },
    maxRetries: { type: Number, default: 3 }
  },
  { timestamps: true }
);

export default mongoose.model('VideoSchedule', videoScheduleSchema);
