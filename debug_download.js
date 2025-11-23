import { downloadFile } from './utils/fileDownloader.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const run = async () => {
    console.log('Starting download test...');
    console.log('VERCEL env:', process.env.VERCEL);

    const baseTmpDir = process.env.VERCEL ? '/tmp' : path.join(__dirname, 'temp');
    console.log('Base temp dir:', baseTmpDir);

    if (!fs.existsSync(baseTmpDir)) {
        console.log('Creating temp dir...');
        fs.mkdirSync(baseTmpDir, { recursive: true });
    }

    const tmpDir = path.join(baseTmpDir, 'debug_' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    console.log('Temp dir created:', tmpDir);

    const sampleUrl = 'http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4';
    const destPath = path.join(tmpDir, 'video.mp4');

    try {
        await downloadFile(sampleUrl, destPath);
        console.log('Download successful!');
        const stats = fs.statSync(destPath);
        console.log('File size:', stats.size);
    } catch (error) {
        console.error('Download failed:', error);
    } finally {
        // Cleanup
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            console.log('Cleanup successful');
        } catch (e) {
            console.error('Cleanup failed:', e);
        }
    }
};

run();
