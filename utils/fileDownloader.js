import fetch from 'node-fetch';
import fs from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const streamPipeline = promisify(pipeline);

/**
 * Downloads a file from a URL to a local destination path.
 * @param {string} url - The URL to download from.
 * @param {string} destPath - The local path to save the file to.
 * @returns {Promise<void>}
 */
export const downloadFile = async (url, destPath) => {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Unexpected response ${response.statusText}`);
        }
        await streamPipeline(response.body, fs.createWriteStream(destPath));
        console.log(`File downloaded successfully to ${destPath}`);
    } catch (error) {
        console.error('Error downloading file:', error);
        throw new Error(`Failed to download file from ${url}: ${error.message}`);
    }
};
