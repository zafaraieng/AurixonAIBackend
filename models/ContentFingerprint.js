import mongoose from 'mongoose';

const ContentFingerprintSchema = new mongoose.Schema({
    videoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'VideoSchedule',
        required: true
    },
    audioFingerprint: {
        fingerprint: String,
        duration: Number,
        bitrate: Number,
        codec: String,
        sampleRate: Number,
        channels: Number
    },
    frameHashes: [{
        hash: String,
        histogram: [Number]
    }],
    metadata: {
        text: String
    },
    title: { type: String },
    owner: { type: String },
    analysisResults: {
        audio: {
            isCopyrighted: Boolean,
            confidence: Number,
            evidence: [String]
        },
        video: {
            isReused: Boolean,
            confidence: Number,
            evidence: [String]
        },
        text: {
            isReused: Boolean,
            confidence: Number,
            evidence: [String]
        },
        overall: {
            status: {
                type: String,
                enum: ['safe', 'warning', 'copyrighted']
            },
            confidence: Number,
            evidence: [String]
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Indexes for faster querying
ContentFingerprintSchema.index({ 'audioFingerprint.fingerprint': 1 });
ContentFingerprintSchema.index({ 'frameHashes.hash': 1 });
ContentFingerprintSchema.index({ 'metadata.text': 'text' });

export default mongoose.model('ContentFingerprint', ContentFingerprintSchema);
