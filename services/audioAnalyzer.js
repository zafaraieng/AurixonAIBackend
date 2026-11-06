import { log, err } from '../utils/logger.js';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import axios from 'axios';
import { AudioFingerprinter } from './audioFingerprinter.js';

class AudioAnalyzer {
    constructor() {
        this.audioFingerprinter = new AudioFingerprinter({
            acoustidApiKey: process.env.ACOUSTID_API_KEY,
            fpcalcPath: process.env.FPCALC_PATH
        });
    }

    async analyzeAudio(audioPath) {
        try {
            // Use AudioFingerprinter for copyright detection
            const fingerprintResult = await this.audioFingerprinter.analyzeAudio(audioPath);
            
            // Get additional audio characteristics
            const characteristics = await this.analyzeAudioCharacteristics(audioPath);

            return {
                copyright: {
                    detected: fingerprintResult.isCopyrighted,
                    details: fingerprintResult.isCopyrighted ? 
                        'Copyrighted content detected' : 
                        'No copyright issues detected',
                    evidence: [
                        ...fingerprintResult.evidence,
                        ...this.getAudioQualityEvidence(characteristics)
                    ],
                    errors: []
                },
                characteristics
            };
        } catch (error) {
            err('Error analyzing audio:', error);
            return {
                copyright: {
                    detected: false,
                    details: 'Analysis failed',
                    evidence: [],
                    errors: [error.message]
                },
                characteristics: null
            };
        }
    }

    async analyzeAudioCharacteristics(audioPath) {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(audioPath, (err, metadata) => {
                if (err) {
                    reject(err);
                    return;
                }

                const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
                if (!audioStream) {
                    reject(new Error('No audio stream found'));
                    return;
                }

                resolve({
                    duration: metadata.format.duration,
                    sampleRate: audioStream.sample_rate,
                    channels: audioStream.channels,
                    bitDepth: audioStream.bits_per_sample || '16',
                    format: audioStream.codec_name.toUpperCase(),
                    bitrate: audioStream.bit_rate
                });
            });
        });
    }

    getAudioQualityEvidence(characteristics) {
        const evidence = [];

        if (characteristics) {
            // Check for professional audio characteristics
            if (characteristics.sampleRate >= 44100) {
                evidence.push('High-quality audio encoding detected');
            }
            if (characteristics.channels >= 2) {
                evidence.push('Professional stereo audio detected');
            }
            if (characteristics.bitDepth >= 16) {
                evidence.push('Professional bit depth detected');
            }
        }

        return evidence;
    }

    async extractAudio(videoPath) {
        const audioPath = videoPath.replace('.mp4', '.wav');
        
        return new Promise((resolve, reject) => {
            ffmpeg(videoPath)
                .toFormat('wav')
                .on('error', error => {
                    console.error('Error extracting audio:', error);
                    reject(error);
                })
                .on('end', () => resolve(audioPath))
                .save(audioPath);
        });
    }
}

export default AudioAnalyzer;
