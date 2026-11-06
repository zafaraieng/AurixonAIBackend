import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { log, err } from './logger.js';
import { getVideoMetadata } from './videoAnalyzer.js';

export async function convertToLandscape(inputPath) {
    try {
        const outputPath = `${inputPath}_landscape.mp4`;
        
        // Check if converted file already exists
        try {
            await fs.access(outputPath);
            log('Using existing converted landscape video:', outputPath);
            return outputPath;
        } catch {
            // File doesn't exist, proceed with conversion
        }

        return new Promise((resolve, reject) => {
            // FFmpeg command for landscape format (16:9 aspect ratio)
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-c:v', 'libx264',         // H.264 video codec
                '-c:a', 'aac',             // AAC audio codec
                '-b:a', '128k',            // Audio bitrate
                '-vf', 'scale=w=1920:h=1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
                '-b:v', '5M',              // Video bitrate
                '-maxrate', '6M',          // Maximum bitrate
                '-bufsize', '6M',          // VBV buffer size
                '-r', '30',                // Frame rate
                '-pix_fmt', 'yuv420p',     // Required pixel format
                '-movflags', '+faststart',  // Enable fast start for web playback
                '-y',                       // Overwrite output file
                outputPath
            ]);

            ffmpeg.stderr.on('data', (data) => {
                log('FFmpeg landscape conversion:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    log('Video conversion to landscape completed');
                    resolve(outputPath);
                } else {
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });

            ffmpeg.on('error', (error) => {
                reject(error);
            });
        });
    } catch (error) {
        err('Error converting video to landscape:', error);
        throw error;
    }
}

export async function convertToShorts(inputPath) {
    try {
        const outputPath = `${inputPath}_shorts.mp4`;
        
        // Check if converted file already exists
        try {
            await fs.access(outputPath);
            log('Using existing converted Shorts video:', outputPath);
            return outputPath;
        } catch {
            // File doesn't exist, proceed with conversion
        }

        return new Promise((resolve, reject) => {
            // FFmpeg command for YouTube Shorts format - same as Instagram for consistency
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-c:v', 'libx264',         // H.264 video codec
                '-c:a', 'aac',             // AAC audio codec
                '-b:a', '128k',            // Audio bitrate
                '-vf', 'scale=w=1080:h=1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
                '-b:v', '5M',              // Video bitrate
                '-maxrate', '6M',          // Maximum bitrate
                '-bufsize', '6M',          // VBV buffer size
                '-r', '30',                // Frame rate
                '-pix_fmt', 'yuv420p',     // Required pixel format
                '-movflags', '+faststart',  // Enable fast start for web playback
                '-y',                       // Overwrite output file
                outputPath
            ]);

            ffmpeg.stderr.on('data', (data) => {
                log('FFmpeg Shorts conversion:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    log('Video conversion for Shorts completed');
                    resolve(outputPath);
                } else {
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });

            ffmpeg.on('error', (err) => {
                reject(new Error(`FFmpeg process error: ${err.message}`));
            });
        });
    } catch (error) {
        err('Error converting video to Shorts:', error);
        throw error;
    }
}

export async function convertVideoForTikTok(inputPath, suffix = '') {
    try {
        const outputPath = `${inputPath}${suffix}_converted.mp4`;
        
        // Check if converted file already exists
        try {
            await fs.access(outputPath);
            log('Using existing converted video:', outputPath);
            return outputPath;
        } catch {
            // File doesn't exist, proceed with conversion
        }

        return new Promise((resolve, reject) => {
            // FFmpeg command for TikTok-compatible video
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-c:v', 'libx264',         // H.264 video codec
                '-c:a', 'aac',             // AAC audio codec
                '-b:a', '128k',            // Audio bitrate
                '-vf', 'scale=w=1080:h=1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2', // Scale and pad to 9:16
                '-b:v', '5M',              // Video bitrate
                '-maxrate', '6M',          // Maximum bitrate
                '-bufsize', '6M',          // VBV buffer size
                '-r', '30',                // Frame rate
                '-pix_fmt', 'yuv420p',     // Required pixel format
                '-movflags', '+faststart',  // Enable fast start for web playback
                '-y',                       // Overwrite output file
                outputPath
            ]);

            ffmpeg.stderr.on('data', (data) => {
                log('FFmpeg TikTok conversion:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    log('Video conversion for TikTok completed');
                    resolve(outputPath);
                } else {
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });

            ffmpeg.on('error', (err) => {
                reject(new Error(`FFmpeg process error: ${err.message}`));
            });
        });
    } catch (error) {
        err('Error converting video for TikTok:', error);
        throw error;
    }
}

export async function convertVideoForInstagram(inputPath, options = {}) {
    try {
        const suffix = '_converted';
        const outputPath = `${inputPath}${suffix}.mp4`;
        
        // Check if converted file already exists
        try {
            await fs.access(outputPath);
            log('Using existing converted video:', outputPath);
            return outputPath;
        } catch {
            // File doesn't exist, proceed with conversion
        }

        return new Promise((resolve, reject) => {
            // Use ffmpeg to convert the video to Instagram-compatible format
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-c:v', 'libx264',         // Use H.264 codec
                '-profile:v', 'main',      // Main profile as required by Instagram
                '-level', '4.0',           // Level 4.0 for HD support
                '-preset', 'slow',         // Higher quality encoding
                '-vf', 'scale=1080:1920:force_original_aspect_ratio=1,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p',  // Strict 9:16 format with black padding
                '-c:a', 'aac',             // Audio codec
                '-b:a', '128k',            // Audio bitrate
                '-ar', '44100',            // Audio sample rate
                '-ac', '2',                // Stereo audio
                '-b:v', '4000k',           // Higher video bitrate for quality
                '-maxrate', '4500k',       // Maximum bitrate
                '-bufsize', '8000k',       // Larger buffer for quality
                '-r', '30',                // Frame rate
                '-g', '30',                // Keyframe interval matching framerate
                '-pix_fmt', 'yuv420p',     // Required pixel format
                '-movflags', '+faststart',  // Enable streaming
                '-metadata:s:v:0', 'rotate=0',  // Ensure correct orientation
                '-max_muxing_queue_size', '9999',  // Prevent muxing errors
                '-y',                       // Overwrite output file
                '-keyint_min', '30',       // Minimum keyframe interval
                '-sc_threshold', '0',      // Disable scene change detection
                '-metadata', 'title=',      // Clear metadata
                '-metadata', 'comment=',
                '-metadata', 'artist=',     
                '-shortest',                // Trim to shortest stream
                '-t', '60',                // Limit to 60 seconds
                '-f', 'mp4',               // Force MP4 format
                '-y',                       // Overwrite output
                outputPath
            ]);

            ffmpeg.stderr.on('data', (data) => {
                log('FFmpeg output:', data.toString());
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    log('Video conversion completed successfully');
                    resolve(outputPath);
                } else {
                    reject(new Error(`FFmpeg process exited with code ${code}`));
                }
            });

            ffmpeg.on('error', (err) => {
                reject(new Error(`Failed to start FFmpeg process: ${err.message}`));
            });
        });
    } catch (error) {
        err('Error converting video:', error);
        throw error;
    }
}
