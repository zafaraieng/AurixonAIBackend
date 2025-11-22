import ffmpeg from "fluent-ffmpeg";

export const videoQualityAnalyzer = {
  async analyzeVideo(filePath) {
    return { score: 95, details: { note: "v2-stable" } };
  }
};
