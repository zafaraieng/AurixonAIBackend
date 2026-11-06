import { google } from 'googleapis';
import { keys } from './keys.js';

export function getOAuth2Client() {
  return new google.auth.OAuth2(
    keys.google.clientId,
    keys.google.clientSecret,
    keys.google.redirectUri
  );
}
