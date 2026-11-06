import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import { path as ffmpegPath } from '@ffmpeg-installer/ffmpeg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import fs from 'fs/promises';

// ES Module path configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Set the FFmpeg path and increase event listeners limit
ffmpeg.setFfmpegPath(ffmpegPath);
if (ffmpeg.EventEmitter) {
    ffmpeg.EventEmitter.defaultMaxListeners = 20;
}

export class PlatformDetector {
    constructor() {
        this.platforms = ["youtube", "tiktok", "instagram"];
        this.apiEndpoints = {
            youtube: process.env.YOUTUBE_API_ENDPOINT,
            tiktok: process.env.TIKTOK_API_ENDPOINT,
            instagram: process.env.INSTAGRAM_API_ENDPOINT
        };
    }

    async extractKeyFrames(videoPath) {
        const framesDir = path.join(__dirname, "../temp/frames");
        await fs.mkdir(framesDir, { recursive: true });
        
        return new Promise((resolve, reject) => {
            const frames = [];
            ffmpeg(videoPath)
                .on("error", (err) => {
                    console.error("Error extracting frames:", err);
                    reject(err);
                })
                .on("end", () => resolve(frames))
                .on("frame", (frameNumber) => {
                    const framePath = path.join(framesDir, `frame-${frameNumber}.jpg`);
                    frames.push(framePath);
                })
                .screenshots({
                    count: 10,
                    folder: framesDir,
                    filename: "frame-%i.jpg",
                    size: "320x240"
                });
        });
    }

    async generateVideoFingerprint(videoPath) {
        try {
            // Extract key frames and generate perceptual hashes
            const frames = await this.extractKeyFrames(videoPath);
            const fingerprints = [];
            
            for (const frame of frames) {
                const hash = await this.computePerceptualHash(frame);
                fingerprints.push(hash);
            }

            // Generate audio fingerprint
            const audioFingerprint = await this.generateAudioFingerprint(videoPath);
            
            return {
                visualFingerprints: fingerprints,
                audioFingerprint,
                metadata: await this.extractMetadata(videoPath)
            };
        } catch (error) {
            console.error("Error generating video fingerprint:", error);
            throw error;
        }
    }

    async checkPlatformContent(fingerprint, platform) {
        try {
            // Query platform-specific APIs for matches
            const matches = await this.queryPlatformAPI(fingerprint, platform);
            
            if (matches.length > 0) {
                return {
                    found: true,
                    matches: matches.map(match => ({
                        url: match.url,
                        timestamp: match.timestamp,
                        similarity: match.similarity,
                        title: match.title,
                        channel: match.channel,
                        uploadDate: match.uploadDate
                    })),
                    confidence: this.calculateConfidence(matches),
                    urls: matches.map(m => m.url)
                };
            }

            return { found: false, matches: [], confidence: 0, urls: [] };
        } catch (error) {
            console.error(`Error checking ${platform}:`, error);
            return { found: false, matches: [], confidence: 0, urls: [] };
        }
    }

    async detectPlatformArtifacts(videoPath) {
        const artifacts = {
            found: false,
            platforms: [],
            confidence: 0,
            evidence: []
        };

        // Extract frames for analysis
        const frames = await this.extractKeyFrames(videoPath);

        // Check for platform-specific UI elements and watermarks
        for (const frame of frames) {
            const uiElements = await this.detectUIElements(frame);
            if (uiElements.found) {
                artifacts.found = true;
                artifacts.platforms.push(...uiElements.platforms);
                artifacts.evidence.push(
                    `Found ${uiElements.platforms.join(", ")} UI elements at ${uiElements.timestamp}`
                );
            }

            const watermarks = await this.detectWatermarks(frame);
            if (watermarks.found) {
                artifacts.found = true;
                artifacts.platforms.push(...watermarks.platforms);
                artifacts.evidence.push(
                    `Detected ${watermarks.platforms.join(", ")} watermarks at ${watermarks.timestamp}`
                );
            }
        }

        // Remove duplicates from platforms
        artifacts.platforms = [...new Set(artifacts.platforms)];
        
        // Calculate confidence based on number and consistency of detections
        artifacts.confidence = this.calculateArtifactConfidence(artifacts);

        return artifacts;
    }

    async detectCompilationSigns(videoPath) {
        const results = {
            found: false,
            confidence: 0,
            evidence: []
        };

        // Check for rapid scene changes
        const sceneChanges = await this.analyzeSceneChanges(videoPath);
        if (sceneChanges.frequent) {
            results.found = true;
            results.evidence.push(
                `Detected ${sceneChanges.count} rapid scene changes, typical of compilation content`
            );
        }

        // Check for varying aspect ratios
        const aspectRatios = await this.analyzeAspectRatios(videoPath);
        if (aspectRatios.varying) {
            results.found = true;
            results.evidence.push(
                `Found varying aspect ratios: ${aspectRatios.detected.join(", ")}`
            );
        }

        // Check for multiple different quality levels
        const qualityLevels = await this.analyzeQualityLevels(videoPath);
        if (qualityLevels.varying) {
            results.found = true;
            results.evidence.push(
                "Detected varying quality levels across video segments"
            );
        }

        // Calculate confidence based on number of indicators
        results.confidence = this.calculateCompilationConfidence(
            sceneChanges,
            aspectRatios,
            qualityLevels
        );

        return results;
    }

    async computePerceptualHash(frame) {
        try {
            const imageBuffer = await fs.readFile(frame);
            return createHash("md5").update(imageBuffer).digest("hex");
        } catch (error) {
            console.error("Error computing perceptual hash:", error);
            throw error;
        }
    }

    async generateAudioFingerprint(videoPath) {
        try {
            // Generate a unique identifier using timestamp and random number as fallback
            const timestamp = Date.now();
            const random = Math.floor(Math.random() * 10000);
            let uniqueId;
            try {
                uniqueId = randomBytes(16).toString("hex");
            } catch (err) {
                uniqueId = `${timestamp}-${random}`;
            }

            const audioPath = path.join(__dirname, "../temp", `audio-${uniqueId}.wav`);
            await fs.mkdir(path.dirname(audioPath), { recursive: true });

            return new Promise((resolve, reject) => {
                ffmpeg(videoPath)
                    .toFormat("wav")
                    .on("error", (err) => {
                        console.error("FFmpeg error:", err);
                        reject(err);
                    })
                    .on("end", async () => {
                        try {
                            const audioBuffer = await fs.readFile(audioPath);
                            const hash = createHash("md5").update(audioBuffer).digest("hex");
                            
                            // Use a timeout to ensure the file is fully released
                            setTimeout(async () => {
                                try {
                                    await fs.unlink(audioPath);
                                } catch (cleanupErr) {
                                    console.warn("Could not clean up audio file:", cleanupErr);
                                }
                            }, 1000);
                            resolve(hash);
                        } catch (err) {
                            console.error("Error processing audio file:", err);
                            reject(err);
                        }
                    })
                    .save(audioPath);
            });
        } catch (error) {
            console.error("Error generating audio fingerprint:", error);
            throw error;
        }
    }

    async extractMetadata(videoPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) {
                    console.error("Error extracting metadata:", err);
                    reject(err);
                    return;
                }
                resolve(metadata);
            });
        });
    }

    async queryPlatformAPI(fingerprint, platform) {
        // Implementation of platform API queries
        return [];
    }

    calculateConfidence(matches) {
        // Implementation of confidence calculation
        return 0;
    }

    async detectUIElements(frame) {
        // Implementation of UI element detection
        return { found: false, platforms: [], timestamp: "" };
    }

    async detectWatermarks(frame) {
        // Implementation of watermark detection
        return { found: false, platforms: [], timestamp: "" };
    }

    calculateArtifactConfidence(artifacts) {
        // Implementation of artifact confidence calculation
        return 0;
    }

    async analyzeSceneChanges(videoPath) {
        // Implementation of scene change analysis
        return { frequent: false, count: 0 };
    }

    async analyzeAspectRatios(videoPath) {
        // Implementation of aspect ratio analysis
        return { varying: false, detected: [] };
    }

    async analyzeQualityLevels(videoPath) {
        // Implementation of quality level analysis
        return { varying: false, levels: [] };
    }

    calculateCompilationConfidence(sceneChanges, aspectRatios, qualityLevels) {
        // Implementation of compilation confidence calculation
        return 0;
    }
}
