import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { log } from './logger.js';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import ffprobe from 'ffprobe-static';
import fluent from 'fluent-ffmpeg';

// Configure fluent-ffmpeg with the installed ffmpeg and ffprobe paths
fluent.setFfmpegPath(ffmpegPath.path);
fluent.setFfprobePath(ffprobe.path);

class VideoProcessor {
    static async getVideoInfo(filePath) {
        return new Promise((resolve, reject) => {
            fluent.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    reject(new Error(`Failed to analyze video: ${err.message}`));
                    return;
                }
                resolve(metadata);
            });
        });
    }

    static async validateVideo(filePath, platform) {
        try {
            const metadata = await this.getVideoInfo(filePath);
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
            const duration = parseFloat(metadata.format.duration || '0');

            const validationResult = {
                isValid: true,
                errors: [],
                info: {
                    duration,
                    width: videoStream?.width,
                    height: videoStream?.height,
                    videoCodec: videoStream?.codec_name,
                    audioCodec: audioStream?.codec_name,
                    size: parseInt(metadata.format.size || '0')
                }
            };

            if (!videoStream) {
                validationResult.isValid = false;
                validationResult.errors.push('No video stream found');
                return validationResult;
            }

            switch (platform) {
                case 'instagram':
                    // Instagram Reels specific validations
                    if (duration < 3) {
                        validationResult.isValid = false;
                        validationResult.errors.push('Video duration must be at least 3 seconds');
                    }
                    if (duration > 90) {
                        validationResult.isValid = false;
                        validationResult.errors.push('Video duration must not exceed 90 seconds for Reels');
                    }
                    
                    // More strict Instagram-specific validations
                    const maxSize = 650 * 1024 * 1024; // 650MB limit for Reels
                    if (parseInt(metadata.format.size) > maxSize) {
                        validationResult.isValid = false;
                        validationResult.errors.push('File size must not exceed 650MB for Reels');
                    }
                    
                    // Aspect ratio validation (9:16 preferred)
                    const aspectRatio = videoStream.width / videoStream.height;
                    if (Math.abs(aspectRatio - 9/16) > 0.1) {
                        validationResult.info.needsResize = true;
                        log('Video needs resize to match 9:16 aspect ratio');
                    }
                    break;
                case 'tiktok':
                    if (duration > 180) {
                        validationResult.isValid = false;
                        validationResult.errors.push('Video duration exceeds 3 minutes');
                    }
                    if (videoStream.codec_name !== 'h264') {
                        validationResult.isValid = false;
                        validationResult.errors.push('Video codec must be H.264');
                    }
                    break;
            }

            return validationResult;
        } catch (error) {
            throw new Error(`Failed to validate video: ${error.message}`);
        }
    }

    static async convertVideo(inputPath, outputPath, options = {}) {
        const {
            width = 1080,
            height = 1920,
            fps = 30,
            videoBitrate = '4000k',
            audioBitrate = '128k',
            videoFilters = []
        } = options;

        // Instagram Reels specific validations
        if (options.platform === 'instagram') {
            if (width !== 1080 || height !== 1920) {
                width = 1080;
                height = 1920;
            }
            videoBitrate = '2500k'; // Instagram recommended bitrate
            audioBitrate = '128k';
            fps = 30; // Instagram recommended fps
        }

        try {
            await fs.access(inputPath);
        } catch (error) {
            throw new Error(`Input file not found: ${inputPath}`);
        }

        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        return new Promise((resolve, reject) => {
            const command = fluent(inputPath)
                .outputOptions([
                    '-c:v', 'libx264',
                    '-preset', 'medium',
                    '-profile:v', 'high',
                    '-level', '4.0',
                    '-pix_fmt', 'yuv420p',
                    '-movflags', '+faststart',
                    '-b:v', videoBitrate,
                    '-maxrate', videoBitrate,
                    '-bufsize', '8000k',
                    '-c:a', 'aac',
                    '-b:a', audioBitrate,
                    '-ar', '44100',
                    '-ac', '2'
                ])
                .fps(fps);

            if (videoFilters.length > 0) {
                command.videoFilters(videoFilters);
            }

            command
                .on('start', cmdLine => log('Started ffmpeg with command:', cmdLine))
                .on('progress', progress => log('Processing:', progress.percent, '% done'))
                .on('end', () => resolve(outputPath))
                .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
                .save(outputPath);
        });
    }

    static async convertForInstagram(inputPath) {
        try {
            const metadata = await this.getVideoInfo(inputPath);
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            
            if (!videoStream) {
                throw new Error('No video stream found in the input file');
            }

            // Check minimum input requirements considering both landscape and portrait
            const minResolution = 360;  // Minimum resolution for either dimension
            const minPixels = 640 * 360;  // Minimum total pixels
            const actualPixels = videoStream.width * videoStream.height;
            
            if (Math.min(videoStream.width, videoStream.height) < minResolution || actualPixels < minPixels) {
                throw new Error(`Input video resolution too low. Minimum ${minResolution}p or ${minPixels} total pixels required.`);
            }

            // Validate video duration
            const duration = parseFloat(metadata.format.duration || '0');
            if (duration < 1 || duration > 60) {
                throw new Error('Video duration must be between 1 and 60 seconds for Reels');
            }

            const outputPath = path.format({
                dir: path.dirname(inputPath),
                name: `${path.basename(inputPath, path.extname(inputPath))}_instagram`,
                ext: '.mp4'
            });

            // Instagram-specific dimensions
            const targetWidth = 1080;
            const targetHeight = 1920;

            // Set up video filters for scaling and padding
            const filters = [];
            const rotation = parseInt(videoStream.tags?.rotate || videoStream.rotation || 0, 10) || 0;
            
            // Handle rotation if needed
            if (rotation === 90) filters.push('transpose=1');
            else if (rotation === 270 || rotation === -90) filters.push('transpose=2');
            else if (rotation === 180) filters.push('transpose=2,transpose=2');

            // Calculate target dimensions maintaining aspect ratio
            const inputAspect = videoStream.width / videoStream.height;
            const targetAspect = 9/16; // Instagram Reels aspect ratio
            const isPortrait = videoStream.height > videoStream.width;

            // First ensure clean color format
            filters.push('format=yuv420p');

            if (isPortrait) {
                // For portrait videos, scale to target height first
                filters.push(
                    // Scale to 1920 height while maintaining aspect ratio
                    'scale=-2:1920',
                    // Then pad or crop width to 1080
                    `pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black`
                );
            } else {
                // For landscape, scale to target width first
                filters.push(
                    // Scale to 1080 width while maintaining aspect ratio
                    'scale=1080:-2',
                    // Then pad height to 1920
                    `pad=1080:1920:(1080-iw)/2:(1920-ih)/2:black`
                );
            }

            // Ensure proper display ratios
            filters.push(
                'setsar=1:1',
                'setdar=9/16',
                // Force exact dimensions
                'scale=1080:1920'
            );

            return new Promise((resolve, reject) => {
                const command = fluent(inputPath)
                    .outputOptions([
                        // Video codec settings
                        '-c:v', 'libx264',
                        '-preset', 'medium',
                        '-profile:v', 'main',  // Changed from baseline to main
                        '-level', '4.0',
                        '-pix_fmt', 'yuv420p',
                        
                        // Bitrate control
                        '-b:v', '2M',
                        '-maxrate', '2.5M',
                        '-bufsize', '5M',
                        
                        // Frame rate and GOP
                        '-r', '30',
                        '-g', '30',
                        '-keyint_min', '30',
                        
                        // Prevent quality issues
                        '-crf', '23',
                        '-sc_threshold', '0',
                        '-flags', '+cgop',
                        
                        // Audio settings
                        '-c:a', 'aac',
                        '-b:a', '128k',
                        '-ar', '44100',
                        '-ac', '2',
                        
                        // Container settings
                        '-movflags', '+faststart',
                        '-brand', 'isom',  // Changed to isom
                        '-map_metadata', '-1',
                        '-metadata', 'encoding_tool=',
                        '-metadata', 'creation_time=',
                        
                        // Format
                        '-f', 'mp4',
                        '-y'
                    ])
                    .videoFilters(filters)
                    .on('start', cmdLine => log('Started ffmpeg with command:', cmdLine))
                    .on('progress', progress => log('Processing:', progress.percent, '% done'))
                    .on('end', async () => {
                        try {
                            log('Successfully converted video for Instagram; verifying output file');
                            await VideoProcessor.verifyInstagramFile(outputPath);
                            log('Verification passed for converted Instagram file');
                            resolve(outputPath);
                        } catch (verifyErr) {
                            log('Verification failed for converted file:', verifyErr.message || verifyErr);
                            reject(verifyErr);
                        }
                    })
                    .on('error', (err) => reject(new Error(`FFmpeg error: ${err.message}`)))
                    .save(outputPath);
            });
        } catch (error) {
            throw new Error(`Failed to convert video for Instagram: ${error.message}`);
        }
    }

    /**
     * Converts video for Facebook upload requirements
     * @param {string} inputPath Path to input video file
     * @returns {Promise<string>} Path to converted video file
     */
    static async convertForFacebook(inputPath) {
        const outputPath = inputPath + '_facebook.mp4';
        
        // Facebook video requirements:
        // - Container: MP4
        // - Codec: H.264
        // - Audio: AAC
        // - Max file size: 10GB
        // - Max duration: 240 minutes
        // - Recommended bitrate: 4000 Kbps
        const options = {
            outputFormat: 'mp4',
            videoCodec: 'libx264',
            videoProfile: 'main',
            videoBitrate: '4000k',
            audioCodec: 'aac',
            audioBitrate: '128k',
            audioChannels: 2,
            audioSampleRate: 44100,
            movflags: '+faststart',
            pixelFormat: 'yuv420p'
        };

        try {
            await this.convertVideo(inputPath, outputPath, options);
            log('Facebook video conversion complete');
            return outputPath;
        } catch (error) {
            err('Facebook video conversion failed:', error);
            throw new Error(`Failed to convert video for Facebook: ${error.message}`);
        }
    }

    static async extractFrames(filePath, options = { fps: 0.5 }) {
        const framesDir = options.outputDir || path.join(path.dirname(filePath), `${path.basename(filePath)}_frames`);
        await fs.mkdir(framesDir, { recursive: true });

        return new Promise((resolve, reject) => {
            fluent(filePath)
                .outputOptions(['-vf', `fps=${options.fps}`, '-frame_pts', '1'])
                .on('end', () => resolve(framesDir))
                .on('error', (err) => reject(new Error(`Frame extraction failed: ${err.message}`)))
                .output(path.join(framesDir, 'frame_%04d.jpg'))
                .run();
        });
    }

    // Verify converted file meets Instagram requirements
    static async verifyInstagramFile(filePath) {
        try {
            const metadata = await this.getVideoInfo(filePath);
            const formatName = (metadata.format.format_name || '').toLowerCase();
            const duration = parseFloat(metadata.format.duration || '0');
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

            // Container check - accept mp4/mov/isom variants
            if (!/mp4|mov|isom/.test(formatName)) {
                throw new Error(`Invalid container format: ${metadata.format.format_name}`);
            }

            if (!videoStream) throw new Error('No video stream found in converted file');

            // Codec checks
            if (!/h264|avc1/.test((videoStream.codec_name || '').toLowerCase())) {
                throw new Error(`Invalid video codec: ${videoStream.codec_name}`);
            }
            if (videoStream.pix_fmt && !videoStream.pix_fmt.startsWith('yuv420')) {
                throw new Error(`Invalid pixel format: ${videoStream.pix_fmt}`);
            }

            // Audio is optional; if present, ensure aac
            if (audioStream && !/aac/.test((audioStream.codec_name || '').toLowerCase())) {
                throw new Error(`Invalid audio codec: ${audioStream.codec_name}`);
            }

            // Dimension check (allow some tolerance if not exactly 1080x1920)
            const width = videoStream.width;
            const height = videoStream.height;
            const targetW = 1080;
            const targetH = 1920;
            const tolerance = 2; // allow small rounding diffs
            if (!(Math.abs(width - targetW) <= tolerance && Math.abs(height - targetH) <= tolerance)) {
                throw new Error(`Invalid dimensions: ${width}x${height}, expected ${targetW}x${targetH}`);
            }

            // Duration check for Reels (under 60s)
            if (duration > 60.0) {
                throw new Error(`Video duration too long: ${duration}s`);
            }

            // All checks passed
            return true;
        } catch (error) {
            throw new Error(`Instagram verification failed: ${error.message}`);
        }
    }

        // Conservative re-encode fallback used when Instagram rejects the initial file
        // Produces a highly compatible MP4 (baseline profile, lower level, conservative bitrate)
        static async reencodeForInstagramRetry(inputPath) {
            try {
                const metadata = await this.getVideoInfo(inputPath);
                const videoStream = metadata.streams.find(s => s.codec_type === 'video');
                if (!videoStream) throw new Error('No video stream found for re-encode');

                const outputPath = path.format({
                    dir: path.dirname(inputPath),
                    name: `${path.basename(inputPath, path.extname(inputPath))}_instagram_retry`,
                    ext: '.mp4'
                });

                // Target 1080x1920 with scale+pad approach to preserve content
                const targetWidth = 1080;
                const targetHeight = 1920;
                const filters = [];
                const rotation = parseInt(videoStream.tags?.rotate || videoStream.rotation || 0, 10) || 0;
                if (rotation === 90) filters.push('transpose=1');
                else if (rotation === 270 || rotation === -90) filters.push('transpose=2');
                else if (rotation === 180) filters.push('transpose=2,transpose=2');

                // Ensure clean scale and pad
                filters.push(
                    `scale=w=${targetWidth}:h=${targetHeight}:force_original_aspect_ratio=decrease`,
                    `pad=${targetWidth}:${targetHeight}:(${targetWidth}-iw)/2:(${targetHeight}-ih)/2:black`,
                    'setsar=1:1',
                    'format=yuv420p'
                );

                await fs.mkdir(path.dirname(outputPath), { recursive: true });

                // Temporary directory for pass logfiles
                const tmpDir = path.join(path.dirname(outputPath), '.ffmpeg_temp');
                await fs.mkdir(tmpDir, { recursive: true });
                const passLogFile = path.join(tmpDir, 'ffmpeg2pass');

                // Common encoding options
                const commonOptions = [
                    '-c:v', 'libx264',
                    '-preset', 'medium',
                    '-profile:v', 'baseline',
                    '-level', '3.0',
                    '-pix_fmt', 'yuv420p',
                    '-b:v', '1M',
                    '-maxrate', '1M',
                    '-bufsize', '2M',
                    '-r', '30',
                    '-g', '30',
                    '-keyint_min', '30',
                    '-sc_threshold', '0',
                    '-movflags', '+faststart',
                    '-metadata', 'title=""',
                    '-metadata', 'comment=""'
                ];

                // First pass
                await new Promise((resolve, reject) => {
                    fluent(inputPath)
                        .outputOptions([
                            ...commonOptions,
                            '-pass', '1',
                            '-passlogfile', passLogFile,
                            '-f', 'null'
                        ])
                        .videoFilters(filters)
                        .on('start', cmd => log('Started first pass ffmpeg with command:', cmd))
                        .on('error', err => reject(new Error(`First pass failed: ${err.message}`)))
                        .on('end', resolve)
                        .save('/dev/null'); // Will be NUL on Windows automatically
                });

                // Second pass with audio
                return new Promise((resolve, reject) => {
                    fluent(inputPath)
                        .outputOptions([
                            ...commonOptions,
                            '-pass', '2',
                            '-passlogfile', passLogFile,
                            '-c:a', 'aac',
                            '-b:a', '128k',
                            '-ar', '44100',
                            '-ac', '2',
                            '-shortest'
                        ])
                        .videoFilters(filters)
                        .on('start', cmd => log('Started second pass ffmpeg with command:', cmd))
                        .on('progress', p => log('Re-encode progress:', p.percent))
                        .on('end', async () => {
                            try {
                                // Clean up pass logfiles
                                await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
                                
                                await VideoProcessor.verifyInstagramFile(outputPath);
                                resolve(outputPath);
                            } catch (vErr) {
                                reject(vErr);
                            }
                        })
                        .on('error', e => reject(new Error(`Second pass failed: ${e.message}`)))
                        .save(outputPath);
                });
            } catch (error) {
                throw new Error(`Re-encode failed: ${error.message}`);
            }
        }

        // Remux input file into a canonical MP4 container (stream-copy) with faststart
        // This is a lightweight container rewrite that often fixes subtle container/ftyp/moov issues
        // without changing the encoded streams.
        static async remuxToMp4(inputPath) {
            try {
                const outputPath = path.format({
                    dir: path.dirname(inputPath),
                    name: `${path.basename(inputPath, path.extname(inputPath))}_instagram_remux`,
                    ext: '.mp4'
                });

                await fs.mkdir(path.dirname(outputPath), { recursive: true });

                return new Promise((resolve, reject) => {
                    const ff = fluent(inputPath)
                        .outputOptions([
                            '-c', 'copy',
                            '-movflags', '+faststart',
                            '-y'
                        ]);

                    ff.on('start', cmd => log('Started remux ffmpeg with command:', cmd))
                        .on('end', async () => {
                            try {
                                // Verify the remuxed file quickly
                                await VideoProcessor.verifyInstagramFile(outputPath);
                                resolve(outputPath);
                            } catch (vErr) {
                                reject(vErr);
                            }
                        })
                        .on('error', e => reject(new Error(`FFmpeg remux error: ${e.message}`)))
                        .save(outputPath);
                });
            } catch (err) {
                throw new Error(`Remux failed: ${err.message}`);
            }
        }

    static async cleanup(paths) {
        for (const filePath of paths) {
            try {
                const exists = await fs.access(filePath).then(() => true).catch(() => false);
                if (exists) {
                    const stats = await fs.stat(filePath);
                    if (stats.isDirectory()) {
                        await fs.rm(filePath, { recursive: true, force: true });
                    } else {
                        await fs.unlink(filePath);
                    }
                }
            } catch (error) {
                log('Cleanup error:', error);
            }
        }
    }
}

// Export the VideoProcessor class
export { VideoProcessor };
