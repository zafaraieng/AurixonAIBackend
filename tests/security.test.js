import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-only-session-secret-with-at-least-32-characters';

const { generateOAuthState, verifyOAuthState } = await import('../utils/oauthState.js');
const { sessionMiddleware } = await import('../middleware/session.js');

test('OAuth state round-trips a valid user ID', () => {
  const userId = '507f1f77bcf86cd799439011';
  const state = generateOAuthState(userId);
  assert.equal(verifyOAuthState(state), userId);
});

test('OAuth state rejects tampering', () => {
  const state = generateOAuthState('507f1f77bcf86cd799439011');
  const [payload, signature] = state.split('.');
  const tampered = `${payload}.${signature.slice(0, -1)}x`;
  assert.equal(verifyOAuthState(tampered), null);
});

test('OAuth state rejects malformed values', () => {
  assert.equal(verifyOAuthState('not-a-state'), null);
  assert.equal(verifyOAuthState(null), null);
});

test('session middleware rejects an unsigned uid cookie', () => {
  const req = {
    cookies: { uid: '507f1f77bcf86cd799439011' },
    signedCookies: {},
    path: '/private',
    method: 'GET'
  };
  let called = false;
  sessionMiddleware(req, {}, () => { called = true; });
  assert.equal(called, true);
  assert.equal(req.session.isAuthenticated, false);
  assert.equal(req.userId, undefined);
});

test('session middleware accepts only a valid signed uid cookie', () => {
  const userId = '507f1f77bcf86cd799439011';
  const req = {
    cookies: {},
    signedCookies: { uid: userId },
    path: '/private',
    method: 'GET'
  };
  sessionMiddleware(req, {}, () => {});
  assert.equal(req.session.isAuthenticated, true);
  assert.equal(req.userId, userId);
});
