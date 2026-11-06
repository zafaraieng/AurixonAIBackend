import { HfInference } from '@huggingface/inference';

export class TextSimilarityAnalyzer {
    constructor(config) {
        this.hf = new HfInference(config.huggingfaceApiKey);
        this.model = 'sentence-transformers/all-MiniLM-L6-v2';
    }

    async getEmbedding(text) {
        try {
            return await this.hf.featureExtraction({
                model: this.model,
                inputs: text
            });
        } catch (error) {
            console.error('Error getting text embedding:', error);
            throw error;
        }
    }

    cosineSimilarity(vec1, vec2) {
        const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
        const norm1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
        const norm2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
        return dotProduct / (norm1 * norm2);
    }

    async findSimilarContent(text, existingContent, threshold = 0.8) {
        try {
            const textEmbedding = await this.getEmbedding(text);
            const matches = [];

            for (const content of existingContent) {
                const similarity = this.cosineSimilarity(textEmbedding, content.embedding);
                if (similarity > threshold) {
                    matches.push({
                        id: content.id,
                        similarity,
                        text: content.text
                    });
                }
            }

            return {
                isReused: matches.length > 0,
                confidence: matches.length > 0 ? Math.max(...matches.map(m => m.similarity)) : 0,
                matches: matches.sort((a, b) => b.similarity - a.similarity)
            };
        } catch (error) {
            console.error('Text similarity analysis failed:', error);
            return {
                isReused: false,
                confidence: 0,
                matches: [],
                error: error.message
            };
        }
    }

    async analyzeText(text, existingContent) {
        const results = await this.findSimilarContent(text, existingContent);
        
        return {
            isReused: results.isReused,
            confidence: results.confidence,
            evidence: results.matches.map(match => ({
                originalText: match.text,
                similarity: match.similarity,
                id: match.id
            }))
        };
    }
}
