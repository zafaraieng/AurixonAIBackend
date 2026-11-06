import { log } from '../utils/logger.js';

class PolicyValidationService {
    constructor() {
        this.platformPolicies = {
            youtube: {
                forbidden: [
                    'sexually explicit content',
                    'excessive violence',
                    'hate speech',
                    'harassment',
                    'dangerous or harmful acts',
                    'spam',
                    'misleading metadata',
                    'scams'
                ],
                requirements: [
                    'must own rights or have permission',
                    'must comply with age restrictions',
                    'must follow community guidelines',
                    'must not violate copyright'
                ],
                monetization: [
                    'no reused content',
                    'must be advertiser-friendly',
                    'must comply with content ID',
                    'must not contain third-party content without rights'
                ]
            },
            instagram: {
                forbidden: [
                    'nudity',
                    'hate speech',
                    'violence',
                    'illegal activities',
                    'spam',
                    'intellectual property violations'
                ],
                requirements: [
                    'must own content rights',
                    'must comply with community guidelines',
                    'must be appropriate for diverse audience'
                ]
            },
            facebook: {
                forbidden: [
                    'hate speech',
                    'graphic violence',
                    'adult nudity',
                    'sexual activity',
                    'cruel and insensitive content',
                    'spam'
                ],
                requirements: [
                    'must comply with community standards',
                    'must have rights to shared content',
                    'must not misrepresent ownership'
                ]
            },
            tiktok: {
                forbidden: [
                    'dangerous acts',
                    'graphic content',
                    'hate speech',
                    'harassment',
                    'nudity',
                    'violent extremism'
                ],
                requirements: [
                    'must follow community guidelines',
                    'must own or have permission for content',
                    'must be age-appropriate'
                ]
            }
        };
    }

    async validatePolicies(platform, videoMetadata, analysisResults) {
        const policyIssues = {
            violations: [],
            warnings: [],
            recommendations: []
        };

        // Get platform-specific policies
        const policies = this.platformPolicies[platform];
        if (!policies) {
            return {
                passed: false,
                issues: ['Unsupported platform']
            };
        }

        // Check for copyright and reuse issues
        if (analysisResults.flags.some(flag => flag.type === 'copyright_risk' && flag.severity === 'high')) {
            policyIssues.violations.push({
                type: 'copyright',
                details: 'Content appears to violate copyright or reuse policies',
                impact: 'Video may be removed and account may be penalized'
            });
        }

        // Check quality thresholds that might affect policy compliance
        if (platform === 'youtube' && analysisResults.flags.some(flag => 
            flag.type === 'quality' && 
            flag.details.includes('resolution') && 
            !flag.details.includes('720p'))) {
            policyIssues.warnings.push({
                type: 'quality',
                details: 'Low resolution may affect monetization eligibility',
                impact: 'May not qualify for certain advertising programs'
            });
        }

        // Add platform-specific policy recommendations
        if (platform === 'youtube') {
            policyIssues.recommendations.push(
                'Ensure content is advertiser-friendly for monetization',
                'Add proper content disclaimers if needed',
                'Include accurate video metadata and descriptions'
            );
        }

        // Analyze metadata for policy compliance
        if (videoMetadata) {
            const potentialIssues = this.checkMetadataCompliance(videoMetadata, policies);
            policyIssues.warnings.push(...potentialIssues);
        }

        return {
            passed: policyIssues.violations.length === 0,
            requiresReview: policyIssues.warnings.length > 0,
            policyIssues,
            platformPolicies: policies
        };
    }

    checkMetadataCompliance(metadata, policies) {
        const issues = [];
        
        // Check for potential policy violations in metadata
        if (metadata.title || metadata.description) {
            const contentText = [metadata.title, metadata.description].join(' ').toLowerCase();
            
            // Check against forbidden content terms
            policies.forbidden.forEach(term => {
                if (contentText.includes(term.toLowerCase())) {
                    issues.push({
                        type: 'metadata',
                        details: `Content may violate policy regarding ${term}`,
                        impact: 'May need review before publishing'
                    });
                }
            });
        }

        return issues;
    }

    getPolicyRequirements(platform) {
        return this.platformPolicies[platform] || null;
    }
}

const policyValidator = new PolicyValidationService();
export { policyValidator as default };
