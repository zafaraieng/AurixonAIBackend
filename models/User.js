import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    email: String,
    name: String,
    googleId: String,
    refreshToken: String,
    instagram: {
      accountId: String,
      pageId: String,
      pageName: String,
      accessToken: String,
      tokenExpiresAt: Date,
      connectedAt: Date,
      lastRefreshed: Date
    },
    tiktok: {
      userId: String,
      username: String,
      accessToken: String,
      refreshToken: String,
      expiresIn: Number,
      refreshExpiresIn: Number,
      tokenType: String,
      scope: String,
      connectedAt: Date
    }
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
