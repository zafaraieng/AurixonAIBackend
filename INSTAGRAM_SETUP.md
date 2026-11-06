# Instagram Integration Setup Guide

## Environment Variables

Add these to your `.env` file:

```bash
# Facebook/Instagram OAuth
FACEBOOK_APP_ID=1153319703497618
FACEBOOK_APP_SECRET=a9e525f307310271930ce759a4ff95a6
```

## Meta App Dashboard Setup

1. **Create Meta App** (if you haven't already)
   - Go to [Meta for Developers](https://developers.facebook.com/)
   - Create a new app or use existing one

2. **Add Products**
   - Add **Facebook Login** product
   - Add **Instagram** product (Instagram Graph API)

3. **Facebook Login Settings**
   - Go to Facebook Login → Settings
   - Add Valid OAuth Redirect URIs:
     - `http://localhost:4000/instagram/facebook/callback` (for development)
     - `https://yourdomain.com/instagram/facebook/callback` (for production)

4. **App Roles**
   - Go to Roles → Roles
   - Add yourself as Developer/Tester (so you can test while app is in Dev mode)

5. **Instagram Basic Display**
   - Go to Instagram → Basic Display
   - Add your redirect URI: `http://localhost:4000/instagram/facebook/callback`

## Testing the Integration

1. **Start the backend server**
   ```bash
   cd backend
   npm install
   npm run dev
   ```

2. **Connect Instagram Account**
   - Navigate to `/instagram/facebook/login` in your browser
   - Complete Facebook OAuth flow
   - You'll be redirected back with Instagram connected

3. **Schedule a Post**
   - Use the `/instagram/schedule` endpoint
   - Provide: `caption`, `scheduledAt`, `mediaType`, `videoUrl`/`imageUrl`

## API Endpoints

### Instagram OAuth
- `GET /instagram/facebook/login` - Start Facebook OAuth
- `GET /instagram/facebook/callback` - Handle OAuth callback

### Account Management
- `GET /instagram/status` - Get Instagram connection status
- `POST /instagram/refresh-token` - Refresh access token
- `POST /instagram/disconnect` - Disconnect Instagram account

### Content Publishing
- `POST /instagram/schedule` - Schedule a new post
- `POST /instagram/publish/:scheduleId` - Publish post immediately
- `GET /instagram/scheduled` - Get all scheduled posts
- `DELETE /instagram/scheduled/:scheduleId` - Delete scheduled post
- `PUT /instagram/scheduled/:scheduleId` - Update scheduled post

## Scheduling

The backend includes a scheduler service that runs every minute to check for posts due for publishing. Posts are automatically published when their scheduled time arrives.

## Important Notes

- **Token Expiry**: Instagram access tokens expire after 60 days. The system will warn you when tokens need refreshing.
- **Video Processing**: Instagram video uploads are asynchronous. The system waits for processing to complete before publishing.
- **Rate Limits**: Respect Instagram's API rate limits and daily posting caps.
- **Media URLs**: Videos/images must be publicly accessible URLs for Instagram to process them.

## Troubleshooting

- **Redirect URI Mismatch**: Ensure exact match in Meta Dashboard (including trailing slashes)
- **Permission Errors**: Make sure your app has the required permissions approved
- **Token Issues**: Check if tokens are expired and refresh them
- **Video Upload Failures**: Ensure video format is supported and URL is accessible
