import sharp from 'sharp';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * Converts an image file to JPEG format
 * @param {string} inputPath - Path to the input image file
 * @returns {Promise<string>} - Path to the converted JPEG file
 */
export async function convertToJpeg(inputPath) {
  try {
    const outputPath = path.join(
      path.dirname(inputPath),
      `${path.basename(inputPath, path.extname(inputPath))}.jpg`
    );

    await sharp(inputPath)
      .jpeg({
        quality: 90,
        chromaSubsampling: '4:4:4'
      })
      .toFile(outputPath);

    // Delete the original file to save space
    try {
      await fs.unlink(inputPath);
    } catch (error) {
      console.warn('Could not delete original image file:', error.message);
    }

    return outputPath;
  } catch (error) {
    throw new Error(`Failed to convert image to JPEG: ${error.message}`);
  }
}
