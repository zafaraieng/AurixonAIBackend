import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const STATE_TTL_MS = 5 * 60 * 1000;

const getSecret = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters for OAuth state signing');
  }
  return secret;
};

// Stateless signed state works across serverless instances and deployments.
export const generateOAuthState = (userId) => {
  if (!/^[a-f\d]{24}$/i.test(String(userId))) {
    throw new Error('A valid user ID is required for OAuth state');
  }
  const payload = Buffer.from(JSON.stringify({
    userId: String(userId),
    expiresAt: Date.now() + STATE_TTL_MS,
    nonce: randomBytes(16).toString('hex')
  })).toString('base64url');
  const signature = createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
};

export const verifyOAuthState = (state) => {
  if (typeof state !== 'string') return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;

  const [payload, signature] = parts;
  const expected = createHmac('sha256', getSecret()).update(payload).digest();
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || !/^[a-f\d]{24}$/i.test(data.userId) || !Number.isFinite(data.expiresAt) || data.expiresAt < Date.now()) {
      return null;
    }
    return data.userId;
  } catch {
    return null;
  }
};
