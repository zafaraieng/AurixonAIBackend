import { log } from '../utils/logger.js';

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

export const sessionMiddleware = (req, res, next) => {
  // Only accept the uid cookie after cookie-parser has verified its signature.
  // Discard legacy unsigned uid cookies instead of treating them as authentication.
  const verifiedUid = req.signedCookies?.uid;
  if (req.cookies) {
    delete req.cookies.uid;
    if (typeof verifiedUid === 'string' && OBJECT_ID_PATTERN.test(verifiedUid)) {
      req.cookies.uid = verifiedUid;
    }
  }

  const userId = typeof verifiedUid === 'string' && OBJECT_ID_PATTERN.test(verifiedUid)
    ? verifiedUid
    : undefined;

  req.session = { userId, isAuthenticated: Boolean(userId) };
  req.userId = userId;

  // Never log identifiers, authorization headers, cookies, or tokens.
  log('Session checked', { authenticated: Boolean(userId), path: req.path, method: req.method });
  next();
};
