import ffmpeg from 'fluent-ffmpeg';
import * as imageHash from 'image-hash';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import sharp from 'sharp';

const generateImageHash = promisify(imageHash.imageHash);

export class VideoMatcher {
    constructor(db) {
        this.db = db; // MongoDB connection
        this.collection = db.collection('frameHashes');
    }

    async extractFrames(videoPath, interval = 5) {
        const framesDir = path.join(path.dirname(videoPath), 'frames');
        await fs.mkdir(framesDir, { recursive: true });
        
        return new Promise((resolve, reject) => {
            const frames = [];
            
            ffmpeg(videoPath)
                .on('filenames', filenames => {
                    frames.push(...filenames.map(f => path.join(framesDir, f)));
                })
                .on('end', () => resolve(frames))
                .on('error', reject)
                .screenshots({
                    folder: framesDir,
                    filename: 'frame-%i.png',
                    timemarks: ['00:00:00'].concat([...Array(12)].map((_, i) => `00:00:${(i + 1) * interval}`))
                });
        });
    }

    async generateFrameSignature(frame) {
        try {
            // Check if file exists
            try {
                await fs.access(frame);
            } catch (error) {
                console.error(`Frame file not found: ${frame}`);
                return null;
            }

            // Generate perceptual hash
            const hash = await generateImageHash(frame, 16, true);
            
            // Generate color histogram using sharp
            const metadata = await sharp(frame).metadata();
            const rawBuffer = await sharp(frame)
                .removeAlpha()  // Ensure we only have RGB channels
                .raw()
                .toBuffer();
            const histogram = await this.generateColorHistogram(rawBuffer);

            return {
                hash,
                histogram
            };
        } catch (error) {
            console.error(`Error generating frame signature for ${frame}:`, error);
            return null;
        }
    }

    async generateColorHistogram(buffer) {
        const histogram = new Array(64).fill(0); // 4x4x4 color bins
        
        // Since buffer contains raw RGB data sequentially
        for (let i = 0; i < buffer.length; i += 3) {
            const r = Math.floor(buffer[i] / 64);     // Red channel
            const g = Math.floor(buffer[i + 1] / 64); // Green channel
            const b = Math.floor(buffer[i + 2] / 64); // Blue channel
            
            const bin = (r * 16) + (g * 4) + b;
            histogram[bin]++;
        }

        // Normalize histogram
        const sum = histogram.reduce((a, b) => a + b, 0);
        return histogram.map(bin => bin / sum);
    }

    calculateHashDistance(hash1, hash2) {
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
            if (hash1[i] !== hash2[i]) distance++;
        }
        return distance;
    }

    calculateHistogramDistance(hist1, hist2) {
        return hist1.reduce((distance, bin, i) => {
            const diff = bin - hist2[i];
            const sum = bin + hist2[i];
            return distance + (sum === 0 ? 0 : (diff * diff) / sum);
        }, 0) / 2;
    }

    async findMatches(frameSignatures, threshold = 10) {
        if (!frameSignatures || !Array.isArray(frameSignatures) || frameSignatures.length === 0) {
            console.warn('No valid frame signatures provided for matching');
            return [];
        }

        const matches = [];
        
        for (const signature of frameSignatures) {
            if (!signature || !signature.hash) {
                console.warn('Skipping invalid frame signature');
                continue;
            }
            // Find potential matches using hash prefix for faster lookup
            const potentialMatches = await this.collection.find({
                'hash': { $regex: `^${signature.hash.substring(0, 8)}` }
            }).toArray();

            for (const match of potentialMatches) {
                const hashDistance = this.calculateHashDistance(signature.hash, match.hash);
                const histogramDistance = this.calculateHistogramDistance(signature.histogram, match.histogram);
                
                // Combined distance with weights
                const distance = (hashDistance * 0.7) + (histogramDistance * 100 * 0.3);
                
                if (distance < threshold) {
                    matches.push({
                        videoId: match.videoId,
                        distance,
                        frameTime: match.frameTime
                    });
                }
            }
        }

        return this.aggregateMatches(matches);
    }

    aggregateMatches(matches) {
        // Group matches by video
        const videoMatches = new Map();
        
        for (const match of matches) {
            if (!videoMatches.has(match.videoId)) {
                videoMatches.set(match.videoId, {
                    videoId: match.videoId,
                    matchCount: 0,
                    avgDistance: 0,
                    frames: []
                });
            }
            
            const video = videoMatches.get(match.videoId);
            video.matchCount++;
            video.avgDistance = (video.avgDistance * (video.matchCount - 1) + match.distance) / video.matchCount;
            video.frames.push(match.frameTime);
        }

        return Array.from(videoMatches.values())
            .map(match => ({
                ...match,
                confidence: 1 - (match.avgDistance / 64), // Normalize confidence
                matchPercentage: (match.matchCount / 12) * 100 // We extract 12 frames
            }))
            .filter(match => match.matchCount >= 3); // At least 3 matching frames
    }

    async saveFrameSignatures(videoId, frameSignatures) {
        const ops = frameSignatures.map((sig, index) => ({
            videoId,
            frameTime: index,
            ...sig
        }));

        await this.collection.insertMany(ops);
    }

    async analyzeVideo(videoPath, videoId) {
        try {
            const frames = await this.extractFrames(videoPath);
            const signatures = await Promise.all(frames.map(frame => this.generateFrameSignature(frame)));
            
            // Filter out null signatures
            const validSignatures = signatures.filter(sig => sig !== null);
            
            if (validSignatures.length === 0) {
                console.warn('No valid frame signatures could be generated');
                return {
                    isReused: false,
                    confidence: 0,
                    matchPercentage: 0,
                    error: 'Failed to analyze video frames'
                };
            }

            // Save valid signatures for future comparison
            if (videoId) {
                await this.saveFrameSignatures(videoId, validSignatures);
            }

            // Find matches with existing videos
            const matches = await this.findMatches(validSignatures);

            // Cleanup frames
            await Promise.all(frames.map(frame => fs.unlink(frame).catch(() => {})));

            const isReused = matches.length > 0;
            const bestMatch = matches[0] || { confidence: 0, matchPercentage: 0 };

            return {
                isReused,
                confidence: bestMatch.confidence,
                matchPercentage: bestMatch.matchPercentage,
                matches: matches.map(m => ({
                    videoId: m.videoId,
                    confidence: m.confidence,
                    matchPercentage: m.matchPercentage,
                    matchingFrames: m.frames
                }))
            };
        } catch (error) {
            console.error('Video analysis failed:', error);
            return {
                isReused: false,
                confidence: 0,
                matchPercentage: 0,
                matches: [],
                error: error.message
            };
        }
    }
}
