import { spawn } from 'child_process';
import { log, err } from './logger.js';

export async function validateVideoForInstagram(filePath) {
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
                    const info = JSON.parse(output);
                    const videoStream = info.streams.find(s => s.codec_type === 'video');
                    if (!videoStream) {
                        reject(new Error('No video stream found'));
                        return;
                    }

                    // Validate dimensions and other requirements
                    const width = parseInt(videoStream.width);
                    const height = parseInt(videoStream.height);
                    const duration = parseFloat(info.format.duration);

                    const validationResult = {
                        isValid: true,
                        errors: [],
                        info: {
                            width,
                            height,
                            duration,
                            codec: videoStream.codec_name,
                            bitrate: parseInt(info.format.bit_rate)
                        }
                    };

                    // Check duration (max 60 seconds for Reels)
                    if (duration > 60) {
                        validationResult.isValid = false;
                        validationResult.errors.push('Video duration exceeds 60 seconds');
                    }

                    // Check codec (must be h264)
                    if (videoStream.codec_name !== 'h264') {
                        validationResult.isValid = false;
                        validationResult.errors.push('Video codec must be H.264');
                    }

                    resolve(validationResult);
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
