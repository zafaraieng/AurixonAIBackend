import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { log, err } from '../utils/logger.js';
import ffmpeg from '@ffmpeg-installer/ffmpeg';
import fetch from 'node-fetch';
import * as tf from '@tensorflow/tfjs-node';

// Initialize OpenAI for content moderation
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

class ContentValidationService {
    constructor() {
        this.riskScoreThresholds = {
            LOW: 80,
            MEDIUM: 60,
            HIGH: 0
        };

        // Advanced validation weights
        this.riskWeights = {
            audio: 0.3,
            video: 0.3,
            quality: 0.2,
            reuse: 0.2
        };

        this.TEMP_DIR = path.join(process.cwd(), 'temp');
    }

    async validateContent(filePath, options = {}) {
        try {
            const videoInfo = await this.extractVideoInfo(filePath);
            const audioPath = await this.extractAudio(filePath);
            const framesPath = await this.extractFrames(filePath);

            // Run parallel validations
            const [
                audioFingerprint,
                nsfw,
                speechToText,
                visualDuplicates
            ] = await Promise.all([
                this.checkAudioFingerprint(audioPath),
                this.checkNSFW(framesPath),
                this.performSpeechToText(audioPath),
                this.checkVisualDuplicates(framesPath)
            ]);

            // Run content moderation on transcript
            const moderationResult = await this.moderateContent(speechToText.transcript);

            // Calculate risk score
            const riskScore = this.calculateRiskScore({
                audioFingerprint,
                nsfw,
                moderationResult,
                visualDuplicates
            });

            // Clean up temporary files
            await this.cleanup([audioPath, framesPath]);

            return {
                riskScore,
                flags: this.generateFlags({
                    audioFingerprint,
                    nsfw,
                    moderationResult,
                    visualDuplicates
                }),
                recommendations: this.generateRecommendations({
                    audioFingerprint,
                    nsfw,
                    moderationResult,
                    visualDuplicates
                }),
                details: {
                    audioFingerprint,
                    nsfw,
                    speechToText,
                    moderationResult,
                    visualDuplicates,
                    videoInfo
                }
            };
        } catch (error) {
            err('Error in content validation:', error);
            throw error;
        }
    }

    async extractVideoInfo(filePath) {
        return new Promise((resolve, reject) => {
            const ffprobe = spawn('ffprobe', [
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                filePath
            ]);

            let output = '';
            ffprobe.stdout.on('data', (data) => {
                output += data;
            });

            ffprobe.on('close', (code) => {
                if (code === 0) {
                    try {
                        resolve(JSON.parse(output));
                    } catch (e) {
                        reject(new Error('Failed to parse video info'));
                    }
                } else {
                    reject(new Error(`ffprobe failed with code ${code}`));
                }
            });

            ffprobe.on('error', reject);
        });
    }

    async extractAudio(filePath) {
        const audioPath = path.join(path.dirname(filePath), `${path.basename(filePath)}_audio.wav`);
        
        return new Promise((resolve, reject) => {
            const ffmpegProcess = spawn(ffmpeg.path, [
                '-i', filePath,
                '-ac', '1',
                '-ar', '16000',
                '-vn',
                '-f', 'wav',
                audioPath
            ]);

            ffmpeg.stderr.on('data', (data) => {
                log('FFmpeg audio extraction:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve(audioPath);
                } else {
                    reject(new Error(`FFmpeg audio extraction failed with code ${code}`));
                }
            });

            ffmpeg.on('error', reject);
        });
    }

    async extractFrames(filePath) {
        const framesDir = path.join(path.dirname(filePath), `${path.basename(filePath)}_frames`);
        await fs.mkdir(framesDir, { recursive: true });

        return new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', filePath,
                '-vf', 'fps=1/2',  // Extract frame every 2 seconds
                path.join(framesDir, 'frame_%04d.jpg')
            ]);

            ffmpeg.stderr.on('data', (data) => {
                log('FFmpeg frame extraction:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve(framesDir);
                } else {
                    reject(new Error(`FFmpeg frame extraction failed with code ${code}`));
                }
            });

            ffmpeg.on('error', reject);
        });
    }

    async checkAudioFingerprint(audioPath) {
        try {
            // For now, we'll implement a basic check using audio duration and properties
            // This should be replaced with proper ACRCloud or AudD integration
            
            // Get audio file info using ffprobe
            const audioInfo = await new Promise((resolve, reject) => {
                const ffprobe = spawn(ffmpeg.path, [
                    '-v', 'quiet',
                    '-print_format', 'json',
                    '-show_format',
                    '-show_streams',
                    audioPath
                ]);

                let output = '';
                ffprobe.stdout.on('data', (data) => {
                    output += data;
                });

                ffprobe.on('close', (code) => {
                    if (code === 0) {
                        try {
                            resolve(JSON.parse(output));
                        } catch (e) {
                            reject(new Error('Failed to parse audio info'));
                        }
                    } else {
                        reject(new Error(`ffprobe failed with code ${code}`));
                    }
                });

                ffprobe.on('error', reject);
            });

            // Basic analysis of audio properties
            // This is a placeholder and should be replaced with actual fingerprinting
            const hasAudio = audioInfo.streams.some(s => s.codec_type === 'audio');
            const duration = parseFloat(audioInfo.format.duration || '0');
            
            return {
                matches: [],
                confidence: 0,
                hasMatch: false,
                audioInfo: {
                    hasAudio,
                    duration,
                    format: audioInfo.format.format_name,
                    bitrate: audioInfo.format.bit_rate
                }
            };
        } catch (error) {
            err('Error in audio fingerprinting:', error);
            return {
                matches: [],
                confidence: 0,
                hasMatch: false
            };
        }
    }

    async checkNSFW(framesPath) {
        try {
            // Get list of frame files
            const frames = await fs.readdir(framesPath);
            const frameResults = [];
            let maxScore = 0;

            // Analyze key frames using OpenAI's Vision model
            for (const frame of frames.slice(0, 10)) { // Analyze up to 10 frames
                const framePath = path.join(framesPath, frame);
                const imageBase64 = await fs.readFile(framePath, 'base64');

                const response = await openai.chat.completions.create({
                    model: "gpt-4-vision-preview",
                    messages: [
                        {
                            role: "user",
                            content: [
                                {
                                    type: "text",
                                    text: "Analyze this image for inappropriate content (violence, explicit content, hate symbols, etc). Return a JSON with format {score: number, reason: string or null}"
                                },
                                {
                                    type: "image_url",
                                    image_url: {
                                        url: `data:image/jpeg;base64,${imageBase64}`
                                    }
                                }
                            ]
                        }
                    ]
                });

                const analysis = JSON.parse(response.choices[0].message.content);
                
                frameResults.push({
                    frame,
                    score: analysis.score,
                    reason: analysis.reason
                });

                maxScore = Math.max(maxScore, analysis.score);
            }

            return {
                frames: frameResults,
                maxScore,
                hasNSFW: maxScore > 0.7 // Threshold for flagging content
            };
        } catch (error) {
            err('Error in NSFW detection:', error);
            return {
                frames: [],
                maxScore: 0,
                hasNSFW: false
            };
        }
    }

    async performSpeechToText(audioPath) {
        try {
            // OpenAI's Whisper API requires an audio file
            const response = await openai.audio.transcriptions.create({
                file: await fs.readFile(audioPath),
                model: 'whisper-1',
                language: 'en' // Default to English, can be made configurable
            });

            if (!response.ok) {
                throw new Error(`Whisper API error: ${response.statusText}`);
            }

            const result = await response.json();
            
            return {
                transcript: result.text,
                confidence: 0.8, // Whisper API doesn't provide confidence scores
                segments: [] // Segments not provided in basic response
            };
        } catch (error) {
            err('Error in speech-to-text:', error);
            return {
                transcript: '',
                confidence: 0,
                segments: []
            };
        }
    }

    async checkVisualDuplicates(framesPath) {
        // TODO: Implement visual duplicate detection using pHash
        // For now, return placeholder result
        return {
            duplicateFrames: [],
            duplicateFraction: 0,
            hasDuplicates: false
        };
    }

    async moderateContent(transcript) {
        try {
            if (!transcript) {
                return {
                    flags: [],
                    toxic: false,
                    hate: false,
                    sexual: false,
                    violence: false,
                    overall: 0
                };
            }

            const response = await openai.moderations.create({
                input: transcript
            });

            const result = response.results[0];
            
            // Map OpenAI's categories to our format
            return {
                flags: Object.entries(result.categories)
                    .filter(([_, value]) => value)
                    .map(([key]) => key),
                toxic: result.categories.hate || result.categories.harassment,
                hate: result.categories.hate,
                sexual: result.categories.sexual,
                violence: result.categories.violence,
                overall: Math.max(...Object.values(result.category_scores))
            };
        } catch (error) {
            err('Error in content moderation:', error);
            // Return safe values on error
            return {
                flags: [],
                toxic: false,
                hate: false,
                sexual: false,
                violence: false,
                overall: 0
            };
        }
    }

    calculateRiskScore(results) {
        const {
            audioFingerprint,
            nsfw,
            moderationResult,
            visualDuplicates
        } = results;

        // Weights for different factors
        const weights = {
            audio: 40,
            visual: 30,
            moderation: 20,
            duplicates: 10
        };

        // Calculate individual scores (0-100, higher is riskier)
        const audioScore = audioFingerprint.hasMatch ? 100 : 0;
        const nsfwScore = nsfw.maxScore * 100;
        const moderationScore = moderationResult.overall * 100;
        const duplicateScore = visualDuplicates.duplicateFraction * 100;

        // Calculate weighted average
        const totalRisk = (
            (audioScore * weights.audio) +
            (nsfwScore * weights.visual) +
            (moderationScore * weights.moderation) +
            (duplicateScore * weights.duplicates)
        ) / 100;

        // Return inverted score (100 - risk) so higher is better
        return Math.max(0, Math.min(100, 100 - totalRisk));
    }

    generateFlags(results) {
        const flags = [];
        const { audioFingerprint, nsfw, moderationResult, visualDuplicates } = results;

        if (audioFingerprint.hasMatch) {
            flags.push({
                type: 'audio_match',
                severity: 'high',
                details: audioFingerprint.matches
            });
        }

        if (nsfw.hasNSFW) {
            flags.push({
                type: 'nsfw_content',
                severity: 'high',
                details: {
                    score: nsfw.maxScore,
                    frames: nsfw.frames
                }
            });
        }

        if (moderationResult.toxic || moderationResult.hate || moderationResult.violence) {
            flags.push({
                type: 'content_policy',
                severity: 'high',
                details: moderationResult
            });
        }

        if (visualDuplicates.hasDuplicates) {
            flags.push({
                type: 'duplicate_content',
                severity: 'medium',
                details: {
                    fraction: visualDuplicates.duplicateFraction,
                    frames: visualDuplicates.duplicateFrames
                }
            });
        }

        return flags;
    }

    generateRecommendations(results) {
        const recommendations = [];
        const { audioFingerprint, nsfw, moderationResult, visualDuplicates } = results;

        if (audioFingerprint.hasMatch) {
            recommendations.push(
                'Replace copyrighted music with royalty-free tracks',
                'Consider adding commentary or transformative content'
            );
        }

        if (nsfw.hasNSFW) {
            recommendations.push(
                'Remove or blur NSFW content',
                'Consider changing thumbnail if it contains flagged content'
            );
        }

        if (moderationResult.toxic || moderationResult.hate || moderationResult.violence) {
            recommendations.push(
                'Review and revise content that may violate community guidelines',
                'Consider adding content warnings if appropriate'
            );
        }

        if (visualDuplicates.hasDuplicates) {
            recommendations.push(
                'Add original content to reduce duplicate footage',
                'Include proper attribution for reused content'
            );
        }

        return recommendations;
    }

    async cleanup(paths) {
        for (const path of paths) {
            try {
                await fs.rm(path, { recursive: true, force: true });
            } catch (error) {
                err('Error cleaning up path:', path, error);
            }
        }
    }

    calculateQualityScore(videoStream, audioStream) {
        if (!videoStream) return 0;

        const resolutionScore = (() => {
            const pixels = (videoStream.width || 0) * (videoStream.height || 0);
            if (pixels >= 1920 * 1080) return 100;
            if (pixels >= 1280 * 720) return 80;
            if (pixels >= 854 * 480) return 60;
            return Math.min(40, (pixels / (854 * 480)) * 60);
        })();

        const bitrateScore = (() => {
            const bitrate = parseInt(videoStream.bit_rate || 0);
            if (bitrate >= 8000000) return 100;
            if (bitrate >= 4000000) return 80;
            if (bitrate >= 2000000) return 60;
            return Math.min(40, (bitrate / 2000000) * 60);
        })();

        const framerateScore = (() => {
            const fps = parseFloat(videoStream.r_frame_rate || '0');
            if (fps >= 60) return 100;
            if (fps >= 30) return 80;
            if (fps >= 24) return 60;
            return Math.min(40, (fps / 24) * 60);
        })();

        const audioScore = audioStream ? (() => {
            const sampleRate = parseInt(audioStream.sample_rate || 0);
            const bitrate = parseInt(audioStream.bit_rate || 0);
            const sampleRateScore = sampleRate >= 44100 ? 100 : (sampleRate / 44100) * 100;
            const bitrateScore = bitrate >= 128000 ? 100 : (bitrate / 128000) * 100;
            return (sampleRateScore + bitrateScore) / 2;
        })() : 0;

        return (
            resolutionScore * 0.4 +
            bitrateScore * 0.3 +
            framerateScore * 0.2 +
            audioScore * 0.1
        );
    }

    async getVideoMetadata(filePath) {
        try {
            const absoluteInputPath = path.resolve(filePath);
            const absoluteFfprobePath = path.resolve(ffprobe.path);

            await fs.access(absoluteFfprobePath);
            await fs.access(absoluteInputPath);

            const { stdout } = await execFileAsync(absoluteFfprobePath, [
                '-v', 'error',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                absoluteInputPath
            ]);

            return JSON.parse(stdout);
        } catch (error) {
            err('FFprobe error:', error);
            throw new Error('Failed to extract video metadata: ' + error.message);
        }
    }
}

export default new ContentValidationService();
