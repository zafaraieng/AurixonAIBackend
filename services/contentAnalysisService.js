import { AudioFingerprinter } from './audioFingerprinter.js';
import { VideoMatcher } from './videoMatcher.js';
import { TextSimilarityAnalyzer } from './textSimilarityAnalyzer.js';
import mongoose from 'mongoose';
import ContentFingerprint from '../models/ContentFingerprint.js';
import * as mm from 'music-metadata';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';

const execFileAsync = promisify(execFile);

class ContentAnalysisService {
    constructor(config) {
        if (!config) {
            throw new Error('ContentAnalysisService requires configuration');
        }

        this.config = config;

        // Validate required config
        if (!config.acoustidApiKey) {
            throw new Error('acoustidApiKey is required');
        }
        if (!config.huggingfaceApiKey) {
            throw new Error('huggingfaceApiKey is required');
        }
        if (!config.fpcalcPath) {
            console.warn('⚠️ fpcalcPath is missing. Audio fingerprinting features will be disabled.');
            this.audioAnalyzer = null;
        } else {
            this.audioAnalyzer = new AudioFingerprinter(config);
        }
        this.videoMatcher = new VideoMatcher(mongoose.connection);
        this.textAnalyzer = new TextSimilarityAnalyzer(config);
        this.similarityThresholds = {
            audio: 0.8,    // 80% similarity threshold for audio
            video: 10,     // Hamming distance threshold for video frames
            text: 0.8      // Text similarity threshold
        };
    }

    async generateAudioFingerprint(audioPath) {
        try {
            // Extract audio features using music-metadata
            const metadata = await mm.parseFile(audioPath);
            
            // Generate Chromaprint fingerprint using fpcalc
            const { stdout } = await execFileAsync(this.fpcalcPath, [audioPath]);
            const fingerprint = stdout.split('\\n')
                .find(line => line.startsWith('FINGERPRINT='))
                ?.split('=')[1];

            if (!fingerprint) {
                throw new Error('Failed to generate audio fingerprint');
            }

            return {
                fingerprint,
                duration: metadata.format.duration,
                bitrate: metadata.format.bitrate,
                codec: metadata.format.codec,
                sampleRate: metadata.format.sampleRate,
                channels: metadata.format.numberOfChannels
            };
        } catch (error) {
            console.error('Error generating audio fingerprint:', error);
            throw error;
        }
    }

    async analyzeContent(filePath) {
        try {
            console.log('Starting content analysis for:', filePath);
            
            // Verify file exists
            try {
                await fs.access(filePath);
            } catch (error) {
                throw new Error(`File not accessible: ${error.message}`);
            }

            // Extract metadata and generate fingerprints
            console.log('Generating fingerprints...');
            
            // Analyze audio
            let audioFingerprint = null;
            if (this.audioAnalyzer) {
                try {
                    audioFingerprint = await this.audioAnalyzer.analyzeAudio(filePath);
                    console.log('Audio fingerprint generated');
                } catch (error) {
                    console.error('Audio analysis failed:', error);
                }
            } else {
                console.log('Audio analysis skipped: audioAnalyzer not initialized.');
            }
            
            // Analyze video
            let videoSignatures = null;
            let videoQuality = null;
                try {
                    // Get video signatures
                    videoSignatures = await this.videoMatcher.analyzeVideo(filePath);
                    // Dynamically import the analyzer to avoid static import issues at startup
                    try {
                        const mod = await import('./videoQualityAnalyzer.js');
                        const vqa = mod.videoQualityAnalyzer || mod.default || mod;
                        videoQuality = await vqa.analyzeVideo(filePath);
                    } catch (impErr) {
                        console.error('Failed to load videoQualityAnalyzer dynamically:', impErr);
                    }
                    console.log('Video analysis completed');
                        } catch (error) {
                                console.error('Video analysis failed:', error);
                        }

            // Search for matches in database
            console.log('Searching for matches...');
            const matches = await Promise.all([
                audioFingerprint ? ContentFingerprint.findOne({ audioFingerprint: audioFingerprint.fingerprint }) : null,
                videoSignatures ? this.videoMatcher.findMatches(videoSignatures) : []
            ]);

            const [audioMatch, videoMatches] = matches;

            // Prepare results
            const results = {
                copyrightStatus: {
                    isCopyrighted: !!(audioMatch || (videoMatches && videoMatches.length > 0)),
                    matches: {
                        audio: audioMatch && audioFingerprint ? {
                            matchScore: audioFingerprint.score,
                            originalContent: {
                                title: audioMatch.title,
                                owner: audioMatch.owner,
                                registrationDate: audioMatch.createdAt
                            }
                        } : null,
                        video: videoMatches && videoMatches.length > 0 ? {
                            matchCount: videoMatches.length,
                            matchDetails: videoMatches.map(m => ({
                                similarity: m.similarity,
                                originalContent: {
                                    title: m.title,
                                    owner: m.owner,
                                    registrationDate: m.createdAt
                                }
                            }))
                        } : null
                    }
                },
                technicalAnalysis: {
                    audio: audioFingerprint ? {
                        isCopyrighted: !!audioMatch,
                        confidence: audioMatch ? (audioMatch.confidence || 1) : 0,
                        matches: audioMatch ? [{
                            title: audioMatch.title,
                            owner: audioMatch.owner,
                            createdAt: audioMatch.createdAt
                        }] : [],
                        evidence: audioFingerprint.evidence || []
                    } : null,
                    video: videoSignatures ? {
                        signatures: videoSignatures,
                        quality: videoQuality || {
                            resolution: videoSignatures.resolution,
                            frameRate: videoSignatures.frameRate,
                            bitrate: videoSignatures.bitrate
                        }
                    } : null
                },
                recommendations: []
            };

            // Add recommendations based on analysis
            if (results.copyrightStatus.isCopyrighted) {
                results.recommendations.push(
                    'This content appears to match existing copyrighted material.',
                    'Please ensure you have proper rights or permissions before uploading.'
                );
            }

            // Technical quality recommendations
            if (videoSignatures && videoSignatures.quality && videoSignatures.quality.bitrate < 2000000) {
                results.recommendations.push('Consider using a higher bitrate for better video quality.');
            }

            // Add analysis status information
            if (!audioFingerprint) {
                results.recommendations.push('Audio analysis could not be completed. Some features may be limited.');
            }
            if (!videoSignatures) {
                results.recommendations.push('Video analysis could not be completed. Some features may be limited.');
            }

            console.log('Analysis completed successfully');
            return results;

        } catch (error) {
            console.error('Content analysis failed:', error);
            throw new Error(`Content analysis failed: ${error.message}`);
        }
    }

    async extractVideoFrames(videoPath, interval = 5) {
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

    async generateFrameHashes(frames) {
        const hashes = await Promise.all(frames.map(async frame => {
            // Generate perceptual hash using image-hash
            const hash = await generateImageHash(frame, 16, true);
            
            // Generate color histogram using jimp for additional comparison
            const image = await Jimp.read(frame);
            const histogram = await this.generateColorHistogram(image);

            return {
                path: frame,
                hash,
                histogram
            };
        }));

        // Cleanup frames
        await Promise.all(frames.map(frame => fs.unlink(frame)));
        
        return hashes;
    }

    async generateColorHistogram(image) {
        const histogram = new Array(64).fill(0); // 4x4x4 color bins
        
        image.scan(0, 0, image.bitmap.width, image.bitmap.height, (x, y, idx) => {
            const r = Math.floor(image.bitmap.data[idx] / 64);     // Red channel
            const g = Math.floor(image.bitmap.data[idx + 1] / 64); // Green channel
            const b = Math.floor(image.bitmap.data[idx + 2] / 64); // Blue channel
            
            const bin = (r * 16) + (g * 4) + b;
            histogram[bin]++;
        });

        // Normalize histogram
        const sum = histogram.reduce((a, b) => a + b, 0);
        return histogram.map(bin => bin / sum);
    }

    async analyzeTextSimilarity(text1, text2) {
        try {
            // Use HuggingFace's sentence-transformers model for text similarity
            const [embedding1, embedding2] = await Promise.all([
                this.hf.featureExtraction({
                    model: 'sentence-transformers/all-MiniLM-L6-v2',
                    inputs: text1
                }),
                this.hf.featureExtraction({
                    model: 'sentence-transformers/all-MiniLM-L6-v2',
                    inputs: text2
                })
            ]);

            // Calculate cosine similarity between embeddings
            return this.cosineSimilarity(embedding1, embedding2);
        } catch (error) {
            console.error('Error analyzing text similarity:', error);
            return 0;
        }
    }

    cosineSimilarity(vec1, vec2) {
        const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
        const norm1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
        const norm2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (norm1 * norm2);
    }

    calculateHashDistance(hash1, hash2) {
        // Calculate Hamming distance between two hashes
        let distance = 0;
        for (let i = 0; i < hash1.length; i++) {
            if (hash1[i] !== hash2[i]) distance++;
        }
        return distance;
    }

    async analyzeCopyrightStatus(videoPath, metadata) {
        // Get existing content from database
        const existingContent = await ContentFingerprint.find().lean();
        
        // Run all analyses in parallel
        const [audioResults, videoResults, textResults] = await Promise.all([
            this.audioAnalyzer.analyzeAudio(videoPath),
            this.videoMatcher.analyzeVideo(videoPath, metadata.videoId),
            this.textAnalyzer.analyzeText(
                metadata.title + ' ' + metadata.description,
                existingContent.map(content => ({
                    id: content._id,
                    text: content.metadata.text,
                    embedding: content.metadata.embedding
                }))
            )
        ]);

        // Store results for future comparison
        const contentFingerprint = new ContentFingerprint({
            videoId: metadata.videoId,
            audioFingerprint: audioResults.fingerprint,
            frameHashes: videoResults.frameSignatures,
            metadata: {
                text: metadata.title + ' ' + metadata.description,
                embedding: await this.textAnalyzer.getEmbedding(metadata.title + ' ' + metadata.description)
            },
            analysisResults: {
                audio: audioResults,
                video: videoResults,
                text: textResults
            }
        });

        await contentFingerprint.save();

        // Make overall decision
        const decision = {
            status: 'safe',
            confidence: 0,
            evidence: []
        };

        // Collect evidence and calculate overall confidence
        if (audioResults.isCopyrighted) {
            decision.evidence.push('Copyrighted audio track detected');
            decision.evidence.push(...audioResults.evidence.map(e => 
                `Audio match: "${e.title}" by ${e.artist} (${(e.score * 100).toFixed(2)}% confidence)`
            ));
        }

        if (videoResults.isReused) {
            decision.evidence.push('Reused video content detected');
            decision.evidence.push(...videoResults.matches.map(m =>
                `Video match: ID ${m.videoId} (${m.matchPercentage.toFixed(2)}% frames match)`
            ));
        }

        if (textResults.isReused) {
            decision.evidence.push('Reused metadata detected');
            decision.evidence.push(...textResults.evidence.map(e =>
                `Similar content: "${e.originalText}" (${(e.similarity * 100).toFixed(2)}% similar)`
            ));
        }

        // Calculate weighted confidence
        const weights = { audio: 0.5, video: 0.3, text: 0.2 };
        decision.confidence = 
            (audioResults.confidence * weights.audio) +
            (videoResults.confidence * weights.video) +
            (textResults.confidence * weights.text);

        // Determine final status
        if (audioResults.isCopyrighted && audioResults.confidence > 0.8) {
            decision.status = 'copyrighted';
        } else if (videoResults.isReused && videoResults.matchPercentage > 70) {
            decision.status = 'copyrighted';
        } else if ((audioResults.isCopyrighted && audioResults.confidence > 0.6) ||
                   (videoResults.isReused && videoResults.matchPercentage > 50) ||
                   (textResults.isReused && textResults.confidence > 0.9)) {
            decision.status = 'warning';
        }

        return {
            audio: audioResults,
            video: videoResults,
            text: textResults,
            overall: decision
        };
    }

    async compareAudioFingerprints(fp1, fp2) {
        // Use AcoustID API to compare fingerprints
        // This is a simplified version - you'll need to implement the actual API call
        // Return similarity score between 0 and 1
        return 0.5; // Placeholder
    }

    async compareFrameHashes(hashes1, hashes2) {
        let totalDistance = 0;
        let matchingScenes = 0;
        const comparisons = hashes1.length * hashes2.length;

        for (const hash1 of hashes1) {
            let minDistance = Infinity;
            
            for (const hash2 of hashes2) {
                const hashDistance = this.calculateHashDistance(hash1.hash, hash2.hash);
                const histogramDistance = this.calculateHistogramDistance(hash1.histogram, hash2.histogram);
                
                // Combine both distances with weights
                const distance = (hashDistance * 0.7) + (histogramDistance * 0.3);
                minDistance = Math.min(minDistance, distance);
                
                if (distance < this.similarityThresholds.video) {
                    matchingScenes++;
                }
            }
            
            totalDistance += minDistance;
        }

        return {
            averageDistance: totalDistance / hashes1.length,
            matchingScenes
        };
    }

    calculateHistogramDistance(hist1, hist2) {
        // Calculate chi-square distance between color histograms
        return hist1.reduce((distance, bin, i) => {
            const diff = bin - hist2[i];
            const sum = bin + hist2[i];
            return distance + (sum === 0 ? 0 : (diff * diff) / sum);
        }, 0) / 2;
    }

    makeOverallDecision(results) {
        const decision = {
            status: 'safe',
            confidence: 0,
            evidence: []
        };

        // Collect all evidence
        if (results.audio.isCopyrighted) {
            decision.evidence.push('Copyrighted audio detected');
        }
        if (results.video.isReused) {
            decision.evidence.push('Reused video content detected');
        }
        if (results.text.isReused) {
            decision.evidence.push('Reused metadata detected');
        }

        // Calculate overall confidence
        const weights = { audio: 0.5, video: 0.3, text: 0.2 };
        decision.confidence = 
            (results.audio.confidence * weights.audio) +
            (results.video.confidence * weights.video) +
            (results.text.confidence * weights.text);

        // Make final decision
        if (results.audio.isCopyrighted) {
            decision.status = 'copyrighted';
        } else if (results.video.isReused || results.text.isReused) {
            decision.status = 'warning';
        }

        return decision;
    }
}

export default ContentAnalysisService;
