import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

/**
 * Gets video information using ffprobe
 * @param {string} filePath - Path to the video file
 * @returns {Promise<{duration: number, width: number, height: number}>}
 */
export async function getVideoMetadata(filePath) {
  try {
    // Use ffprobe to get video metadata
    const ffprobePath = path.join(process.cwd(), 'node_modules', 'ffprobe-static', 'bin', 'win32', 'x64', 'ffprobe.exe');
    const { stdout } = await execAsync(`"${ffprobePath}" -v quiet -print_format json -show_streams -select_streams v:0 "${filePath}"`);
    
    const info = JSON.parse(stdout);
    const videoStream = info.streams[0];

    return {
      duration: parseFloat(videoStream.duration || 0),
      width: parseInt(videoStream.width || 0),
      height: parseInt(videoStream.height || 0)
    };
  } catch (error) {
    console.error('Video info error:', error);
    throw new Error(`Failed to get video info: ${error.message}`);
  }
}
