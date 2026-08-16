const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_PATH = path.join(__dirname, '..', 'data', 'users.json');
const COOKIE_NAME = 'vistec_admin_session';

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); }
  catch { return []; }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const check = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return check.length === stored.length && crypto.timingSafeEqual(check, stored);
}

function findUser(username) {
  return readUsers().find(u => u.username.toLowerCase() === String(username).toLowerCase());
}

function createUser(username, password) {
  const users = readUsers();
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error('That username is already taken.');
  }
  const { salt, hash } = hashPassword(password);
  const user = { username, salt, hash, createdAt: new Date().toISOString() };
  users.push(user);
  writeUsers(users);
  return user;
}

// ── Stateless, HMAC-signed session tokens ────────────────────────────
function sign(secret, payloadB64) {
  return crypto.createHmac('sha256', secret).update(payloadB64).digest('hex');
}

function createSessionToken(secret, username, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  const payload = { u: username, exp: Date.now() + maxAgeMs };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(secret, payloadB64)}`;
}

function verifySessionToken(secret, token) {
  if (!token) return null;
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;

  const expectedSig = sign(secret, payloadB64);
  const sigBuf = Buffer.from(sig, 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try { payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')); }
  catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload.u;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}

function requireAuth(secret) {
  return (req, res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const username = verifySessionToken(secret, cookies[COOKIE_NAME]);
    if (!username || !findUser(username)) {
      if (req.method === 'GET' && req.accepts('html')) {
        return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
      }
      return res.status(401).json({ success: false, error: 'Not authenticated. Please log in.' });
    }
    req.adminUser = username;
    next();
  };
}

module.exports = {
  COOKIE_NAME,
  findUser,
  createUser,
  verifyPassword,
  createSessionToken,
  verifySessionToken,
  requireAuth,
};
