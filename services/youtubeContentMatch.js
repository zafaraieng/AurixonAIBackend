import { google } from 'googleapis';
import { log, err } from '../utils/logger.js';

class YoutubeContentMatcher {
    constructor(apiKey) {
        if (!apiKey) {
            log('Warning: No YouTube API key provided');
            this.youtube = null;
            return;
        }
        this.youtube = google.youtube({
            version: 'v3',
            auth: apiKey
        });
    }

    async searchVideo(title) {
        if (!this.youtube) {
            err('YouTube API not initialized - missing API key');
            return [];
        }
        try {
            const response = await this.youtube.search.list({
                part: 'snippet',
                q: title,
                type: 'video',
                maxResults: 5
            });

            return response.data.items.map(item => ({
                id: item.id.videoId,
                title: item.snippet.title,
                channelTitle: item.snippet.channelTitle,
                publishedAt: item.snippet.publishedAt,
                thumbnails: item.snippet.thumbnails,
                description: item.snippet.description
            }));
        } catch (error) {
            err('YouTube API search error:', error);
            return [];
        }
    }

    async getVideoDetails(videoId) {
        try {
            const response = await this.youtube.videos.list({
                part: 'snippet,contentDetails,statistics',
                id: videoId
            });

            if (response.data.items.length === 0) {
                return null;
            }

            const video = response.data.items[0];
            return {
                id: video.id,
                title: video.snippet.title,
                owner: video.snippet.channelTitle,
                publishedAt: video.snippet.publishedAt,
                description: video.snippet.description,
                duration: video.contentDetails.duration,
                viewCount: video.statistics.viewCount,
                thumbnails: video.snippet.thumbnails
            };
        } catch (error) {
            err('YouTube API video details error:', error);
            return null;
        }
    }

    calculateSimilarity(title1, title2) {
        // Convert titles to lowercase and remove special characters
        const cleanTitle1 = title1.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        const cleanTitle2 = title2.toLowerCase().replace(/[^a-z0-9\s]/g, '');

        // Split into words
        const words1 = cleanTitle1.split(/\s+/);
        const words2 = cleanTitle2.split(/\s+/);

        // Count matching words
        const commonWords = words1.filter(word => words2.includes(word));
        const similarity = (2 * commonWords.length) / (words1.length + words2.length);

        return similarity;
    }

    async findMatchingVideo(title) {
        const searchResults = await this.searchVideo(title);
        if (!searchResults.length) return null;

        // Find best match based on title similarity
        let bestMatch = null;
        let highestSimilarity = 0;

        for (const video of searchResults) {
            const similarity = this.calculateSimilarity(title, video.title);
            if (similarity > highestSimilarity && similarity > 0.6) {  // 60% similarity threshold
                highestSimilarity = similarity;
                bestMatch = video;
            }
        }

        if (bestMatch) {
            const details = await this.getVideoDetails(bestMatch.id);
            return {
                ...details,
                similarity: highestSimilarity,
                originalUrl: `https://www.youtube.com/watch?v=${bestMatch.id}`
            };
        }

        return null;
    }
}

export default YoutubeContentMatcher;
