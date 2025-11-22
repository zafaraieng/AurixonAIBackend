import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
} else {
    console.error('Environment file not found:', envPath);
}

if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not found in environment variables');
    throw new Error('GEMINI_API_KEY is not configured');
}

// Initialize Gemini with proper configuration
const apiKey = process.env.GEMINI_API_KEY;
console.log('Using Gemini API key:', apiKey ? `${apiKey.substring(0, 8)}...` : 'Missing key');

if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable must be set');
}

console.log('Initializing Gemini AI...');
let genAI;
try {
    genAI = new GoogleGenerativeAI(apiKey);
    console.log('Successfully initialized Gemini AI');
} catch (error) {
    console.error('Failed to initialize Gemini AI:', error);
    throw error;
}

/**
 * Detects the language/script of the input text
 * @param {string} text Input text to analyze
 * @returns {'en'|'ur'|'hi'} Language code
 */
function detectLanguage(text) {
    // Check for Devanagari script (Hindi)
    if (/[\u0900-\u097F]/.test(text)) {
        return 'hi';
    }
    // Check for common Roman Urdu patterns
    if (/\b(hai|ko|ki|ka|main|aur|kya|ap|nahi|yeh)\b/i.test(text)) {
        return 'ur';
    }
    // Default to English
    return 'en';
}

/**
 * @typedef {Object} OptimizationResult
 * @property {boolean} success - Whether the optimization was successful
 * @property {string} optimized_title - The optimized title with emojis
 * @property {string} description - Generated description
 * @property {string[]} hashtags - Array of hashtags
 * @property {string} keywords - Comma-separated keywords
 */

/**
 * Optimizes YouTube content using Gemini AI
 * @param {string} title The video title to optimize
 * @returns {Promise<OptimizationResult>} Optimized content
 */
async function optimizeTitle(title, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second

    try {
        console.log('Creating Gemini model...');
        
        const model = genAI.getGenerativeModel({ 
            model: 'gemini-2.0-flash',
            // Add configuration for better creative responses
            generationConfig: {
                temperature: 0.9,  // More creative responses
                topP: 0.8,        // Diverse outputs
                maxOutputTokens: 2048  // Allow longer responses
            }
        });
        console.log('Gemini model created successfully');

        const prompt = `Create viral, trending-style social media content for this video while maintaining the original context and topic. Optimize this content but keep its core meaning:

Title: "${title}"

Important: 
- MUST keep the main topic/subject of the original title
- If the original title mentions a specific duration (e.g., 30 seconds, half minute), preserve it
- If it mentions specific people or places, keep those references

Follow these guidelines while preserving the original context:

1. Title Enhancement:
   - Keep the core subject/topic from the original title
   - Make it more attention-grabbing while staying true to the content
   - Add 2-3 relevant emojis that match the topic
   - Include emotional triggers or curiosity gaps related to the actual content
   - Keep it under 100 characters
   - Focus on the original subject matter

2. Description:
   - Write an engaging story-style description (at least 3-4 paragraphs)
   - Include strong calls-to-action ("SMASH that like button!", "Drop a 🔥 in comments!")
   - Add relevant timestamps if applicable
   - Use psychology triggers (curiosity, emotion, urgency)
   - Make strategic use of line breaks and emojis

3. Hashtags:
   - Include 10-15 trending and relevant hashtags
   - Mix viral hashtags with niche-specific ones
   - Add platform-specific trending tags
   - Include challenges or trends when relevant

4. Keywords:
   - Extensive list of SEO-optimized keywords
   - Include trending search terms
   - Add long-tail variations
   - Consider user search intent

Return as JSON:
{
    "optimized_title": "viral-style title with strategic emojis",
    "description": "engaging multi-paragraph description with CTAs",
    "hashtags": ["many", "trending", "and", "relevant", "hashtags"],
    "keywords": "extensive, comma-separated list of trending SEO keywords"
}`;

        try {
            console.log('Generating content...');
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }]
            });
            console.log('Content generated successfully');

            if (!result || !result.response) {
                throw new Error('Empty response from Gemini API');
            }

            const text = result.response.text();
            if (!text) {
                throw new Error('Empty text in Gemini response');
            }

            try {
                console.log('Parsing response:', text);
                
                // Clean up markdown code blocks and sanitize the text
                let cleanText = text.replace(/```json\n|\n```/g, '').trim();
                
                // Normalize line endings and remove extra whitespace
                cleanText = cleanText.replace(/\r\n/g, '\n')
                                   .replace(/^\s+/gm, '')  // Remove leading whitespace from each line
                                   .replace(/\n\s*\n/g, '\n\n');  // Normalize multiple blank lines
                
                // Handle any control characters
                cleanText = cleanText.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
                
                console.log('Cleaned text:', cleanText);
                
                const json = JSON.parse(cleanText);
                
                // Clean up the description text
                if (json.description) {
                    json.description = json.description.replace(/\s+/g, ' ')  // Normalize whitespace
                                                     .replace(/\n\s*/g, '\n')  // Clean up line breaks
                                                     .trim();
                }
                
                // Format description with keywords at the bottom
                // Extract key topic from original title
                const originalTopic = title.toLowerCase();

                // Validate the optimized title maintains context
                if (!json.optimized_title.toLowerCase().includes(originalTopic.split(' ')[0])) {
                    // If context is lost, create a more relevant title
                    const duration = title.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/i);
                    const timeframe = duration ? `${duration[1]} ${duration[2]}` : '';
                    
                    json.optimized_title = `${timeframe ? `${timeframe} ` : ''}${title} 🎥 You Won't Believe What Happened! 🤯`;
                }

                // Format description and add keywords at the bottom
                const formattedDescription = `${json.description}\n\n� Relevant Tags & Keywords:\n${json.keywords}`;
                
                // Filter and format hashtags to be more relevant to the content
                const relevantHashtags = (json.hashtags || [])
                    .filter(tag => {
                        const tagText = tag.replace('#', '').toLowerCase();
                        return !tagText.includes('food') && !tagText.includes('eat');  // Remove irrelevant hashtags
                    })
                    .map(tag => tag.startsWith('#') ? tag : `#${tag}`)
                    .join(' ');
                
                return {
                    success: true,
                    title: json.optimized_title,
                    description: formattedDescription,
                    tags: relevantHashtags,
                    originalDescription: json.description,
                    hashtags: json.hashtags
                };
            } catch (parseError) {
                console.error('Failed to parse AI response:', parseError);
                console.error('Raw response:', text);
                throw new Error('Invalid AI response format');
            }
        } catch (error) {
            console.error('Error in content generation:', {
                name: error.name,
                message: error.message,
                status: error.status,
                statusText: error.statusText,
                details: error.errorDetails,
                stack: error.stack
            });

            if (error.message.includes('API key not valid')) {
                throw new Error('Invalid API key. Please check your configuration.');
            }

            if (error.status === 404 || error.message.includes('not found')) {
                throw new Error('Model not found. Please ensure you are using gemini-pro for text generation.');
            }

            if (retryCount < MAX_RETRIES) {
                console.log(`Retrying... Attempt ${retryCount + 1} of ${MAX_RETRIES}`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
                return optimizeTitle(title, retryCount + 1);
            }

            throw error;
        }
    } catch (error) {
        console.error('Error optimizing title:', error);
        throw error;
    }
}

export default optimizeTitle;
