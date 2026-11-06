import { log, err } from "../utils/logger.js";
import ContentValidationService from "../services/contentValidationService.js";
import fs from "fs/promises";

const validator = new ContentValidationService();

export const validateUpload = async (req, res) => {
    try {
        if (!req.files?.file) {
            return res.status(400).json({ message: "No file provided" });
        }

        const file = Array.isArray(req.files.file) ? req.files.file[0] : req.files.file;
        if (!file) {
            return res.status(400).json({ message: "No file provided" });
        }

        const filePath = file.path;
        log("Starting advanced validation for:", filePath);

        // Check if file exists
        try {
            await fs.access(filePath);
        } catch (error) {
            log("File access error:", error);
            return res.status(400).json({ message: "File not accessible" });
        }

        // Run advanced content validation
        const validationResult = await validator.validateContent(filePath);
        
        if (!validationResult) {
            return res.status(400).json({ message: "Validation failed to produce results" });
        }
        
        log("Raw validation result:", JSON.stringify(validationResult, null, 2));

        // Process platform-specific results and enhance copyright detection
        const { platformSpecific, technicalAnalysis, copyrightStatus } = validationResult;

        // Get the calculated quality score from technical analysis
        const qualityScore = technicalAnalysis.video.quality.score || 0;
        
        // Add quality score to the root of validationResult for easier access
        validationResult.qualityScore = qualityScore;

        // Enhance copyright match information only when we have meaningful metadata
        if (copyrightStatus?.matches?.video || copyrightStatus?.matches?.audio) {
            const matchSource = copyrightStatus.matches.video || copyrightStatus.matches.audio;
            const title = matchSource?.title || matchSource?.originalContent?.title || null;
            const owner = matchSource?.owner || matchSource?.originalContent?.owner || null;
            const url = matchSource?.url || matchSource?.originalContent?.url || null;

            const hasMeaningfulMetadata = !!(title || owner || url);

            if (hasMeaningfulMetadata) {
                validationResult.copyrightMatch = {
                    found: true,
                    matchType: copyrightStatus.matches.video ? 'video' : 'audio',
                    originalContent: {
                        title: title || 'Unknown Content',
                        owner: owner || 'Unknown Owner',
                        url: url || null,
                        registrationDate: matchSource?.publishedAt || new Date(),
                        matchConfidence: matchSource?.confidence || 0
                    }
                };
            } else {
                validationResult.recommendations = [
                    'Potential fingerprint match found but no original metadata is available; manual verification is required before flagging copyright.',
                    ...validationResult.recommendations || []
                ];
            }
        }

        // Sort and enhance platform-specific warnings
        Object.keys(platformSpecific).forEach(platform => {
            if (!platformSpecific[platform].warnings) {
                platformSpecific[platform].warnings = [];
            }
            
            // Add quality-based warnings
            if (qualityScore < 70) {
                platformSpecific[platform].warnings.push(
                    `Quality Warning: Content quality score (${qualityScore}%) is below recommended levels`
                );
            }

            // Sort warnings by severity
            platformSpecific[platform].warnings.sort((a, b) => {
                const isContentRiskA = a.includes('Content Warning') || a.includes('Content Risk');
                const isContentRiskB = b.includes('Content Warning') || b.includes('Content Risk');
                return isContentRiskB - isContentRiskA;
            });
        });

        // Calculate overall risk score and quality metrics
        const riskFactors = {
            copyrightMatch: validationResult.copyrightMatch?.found ? 40 : 0,
            qualityIssues: 100 - qualityScore,
            contentWarnings: Object.values(platformSpecific).reduce((count, p) => 
                count + (p.warnings?.length || 0), 0) * 5
        };

        const totalRiskScore = Math.min(100, 
            riskFactors.copyrightMatch + 
            riskFactors.qualityIssues * 0.3 + 
            riskFactors.contentWarnings
        );

        validationResult.riskAssessment = {
            score: Math.round(totalRiskScore),
            level: totalRiskScore > 70 ? 'High' : totalRiskScore > 40 ? 'Medium' : 'Low',
            factors: riskFactors
        };

        // Enhanced recommendations based on detected issues
        const globalRecommendations = [];
        
        if (validationResult.copyrightMatch?.found) {
            globalRecommendations.push(
                `Copyright Alert: This content matches existing material titled "${validationResult.copyrightMatch.originalContent.title}"`,
                'You must have proper rights or permissions before uploading this content',
                'Consider creating original content to avoid copyright issues'
            );
        }

        if (qualityScore < 70) {
            globalRecommendations.push(
                `Quality Alert: Content quality score is ${qualityScore}%`,
                'Consider improving video resolution and bitrate',
                'Ensure stable frame rate and good audio quality'
            );
        }

        // Add existing recommendations and update
        validationResult.recommendations = [
            ...globalRecommendations,
            ...validationResult.recommendations || []
        ];

        // Enhanced platform-specific analysis
        Object.keys(platformSpecific).forEach(platform => {
            const platformInfo = platformSpecific[platform];
            
            // Add detailed eligibility info
            platformInfo.analysisDetails = {
                technicalRequirements: {
                    resolution: videoStream ? `${videoStream.width}x${videoStream.height}` : 'unknown',
                    bitrate: bitrate ? `${Math.round(bitrate / 1000000)}Mbps` : 'unknown',
                    frameRate: videoStream?.r_frame_rate ? videoStream.r_frame_rate : 'unknown',
                    duration: duration ? `${Math.round(duration)}s` : 'unknown'
                },
                contentRequirements: {
                    copyrightClear: !validationResult.copyrightMatch?.found,
                    qualityScore: qualityScore,
                    contentRiskLevel: validationResult.riskAssessment.level
                }
            };

            // Update eligibility based on comprehensive analysis
            platformInfo.eligible = (
                platformInfo.eligible && 
                !validationResult.copyrightMatch?.found &&
                qualityScore >= 50
            );

            // Add monetization status for YouTube
            if (platform === 'youtube') {
                platformInfo.monetizable = (
                    platformInfo.eligible &&
                    qualityScore >= 70 &&
                    !validationResult.copyrightMatch?.found
                );
            }
        });

        // Add disclaimer based on detected issues
        const hasContentRisks = Object.values(platformSpecific).some(p => 
            p.warnings?.some(w => w.includes('Content Warning') || w.includes('Content Risk'))
        );

        validationResult.disclaimer = hasContentRisks
            ? "Warning: Content analysis indicates potential copyright or reuse concerns. Review carefully before publishing."
            : "This validation uses automated analysis but may not catch all issues. Review your content carefully before publishing.";

        // Add severe content flags that would make content ineligible
        validationResult.flags
            .filter(f => f.severity === "high")
            .forEach(flag => {
                if (flag.type === "copyright_risk") {
                    platformSpecific.youtube.eligible = false;
                    platformSpecific.youtube.restrictions.push(`Content Risk: ${flag.details || "Potential copyright violation detected"}`);
                    platformSpecific.youtube.monetizable = false;
                    
                    // Add copyright warnings to all platforms
                    Object.keys(platformSpecific).forEach(platform => {
                        platformSpecific[platform].warnings.push(
                            `Copyright Risk: ${flag.details || "This content may contain copyrighted material"}`
                        );
                    });
                } else if (flag.type === "inappropriate_content") {
                    // Add detailed inappropriate content warning
                    const warningMessage = flag.details || "Content may violate platform guidelines";
                    Object.keys(platformSpecific).forEach(platform => {
                        platformSpecific[platform].eligible = false;
                        platformSpecific[platform].restrictions.push(`Content Risk: ${warningMessage}`);
                        platformSpecific[platform].recommendations.push(
                            "Review content guidelines for appropriate content"
                        );
                    });
                } else if (flag.type === "quality") {
                    // Add quality warnings with specific details
                    Object.keys(platformSpecific).forEach(platform => {
                        platformSpecific[platform].warnings.push(
                            `Quality Issue: ${flag.details}`
                        );
                    });
                }
            });

        // Add platform-specific analysis
        validationResult.platformSpecific = platformSpecific;
        
        // Add disclaimer
        validationResult.disclaimer = "This validation uses advanced content analysis but may not catch all issues. Review your content carefully before publishing.";

        log("Final validation result:", JSON.stringify(validationResult, null, 2));

        res.json(validationResult);
    } catch (error) {
        err("Error in validateUpload:", error);
        res.status(500).json({ 
            message: "Error during validation",
            details: error.message 
        });
    }
};
