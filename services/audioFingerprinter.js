import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import fetch from 'node-fetch';

export class AudioFingerprinter {
    constructor(config) {
        this.acoustidApiKey = config.acoustidApiKey;
        this.fpcalcPath = config.fpcalcPath || 'fpcalc';
    }

    async generateFingerprint(audioPath) {
        return new Promise((resolve, reject) => {
            const fpcalc = spawn(this.fpcalcPath, ['-json', audioPath]);
            let output = '';
            let error = '';

            fpcalc.stdout.on('data', (data) => {
                output += data.toString();
            });

            fpcalc.stderr.on('data', (data) => {
                error += data.toString();
            });

            fpcalc.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error(`fpcalc failed with code ${code}: ${error}`));
                    return;
                }

                try {
                    const result = JSON.parse(output);
                    resolve({
                        duration: result.duration,
                        fingerprint: result.fingerprint
                    });
                } catch (err) {
                    reject(new Error(`Failed to parse fpcalc output: ${err.message}`));
                }
            });
        });
    }

    async lookupFingerprint(fingerprint, duration) {
        const params = new URLSearchParams({
            client: this.acoustidApiKey,
            meta: 'recordings',
            duration: Math.round(duration),
            fingerprint
        });

        const response = await fetch(`https://api.acoustid.org/v2/lookup?${params}`);
        if (!response.ok) {
            throw new Error(`AcoustID API error: ${response.statusText}`);
        }

        const data = await response.json();
        return this.parseAcoustIdResponse(data);
    }

    parseAcoustIdResponse(data) {
        if (data.status !== 'ok' || !data.results) {
            return { matches: [] };
        }

        return {
            matches: data.results.map(result => ({
                id: result.id,
                score: result.score,
                recordings: (result.recordings || []).map(recording => ({
                    id: recording.id,
                    title: recording.title,
                    artist: recording.artists?.[0]?.name,
                    releaseGroups: recording.releasegroups?.map(rg => ({
                        title: rg.title,
                        type: rg.type
                    }))
                }))
            }))
        };
    }

    async analyzeAudio(audioPath) {
        try {
            let duration, fingerprint;
            try {
                ({ duration, fingerprint } = await this.generateFingerprint(audioPath));
            } catch (error) {
                // If the error indicates no audio stream was found, return a safe default result
                if (error.message.includes('could not find any audio stream') || error.message.includes('Stream not found')) {
                    console.log('No audio stream found in file, skipping audio analysis');
                    return {
                        isCopyrighted: false,
                        confidence: 0,
                        matches: [],
                        evidence: [],
                        error: 'No audio stream found in file'
                    };
                }
                throw error; // Rethrow other errors
            }
            
            const matches = await this.lookupFingerprint(fingerprint, duration);

            // Consider it a match if score > 0.7
            const significantMatches = matches.matches.filter(m => m.score > 0.7);
            const isCopyrighted = significantMatches.length > 0;

            return {
                isCopyrighted,
                confidence: isCopyrighted ? 
                    Math.max(...significantMatches.map(m => m.score)) : 
                    0,
                matches: significantMatches,
                evidence: significantMatches.map(match => ({
                    title: match.recordings[0]?.title,
                    artist: match.recordings[0]?.artist,
                    score: match.score
                }))
            };
        } catch (error) {
            console.error('Audio fingerprinting failed:', error);
            return {
                isCopyrighted: false,
                confidence: 0,
                matches: [],
                evidence: [],
                error: error.message
            };
        }
    }
}
