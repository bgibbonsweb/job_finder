const crypto = require('crypto');

function parseCookies(req) {
  const header = String(req?.headers?.cookie || '');
  if (!header) return {};
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const separatorIndex = part.indexOf('=');
      if (separatorIndex === -1) return acc;
      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (key) acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

function buildSessionCookieValue(sessionCookieName, token, expiresAt) {
  const expires = new Date(expiresAt).toUTCString();
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

function buildClearSessionCookieValue(sessionCookieName) {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password || ''), salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
  try {
    const computed = crypto.scryptSync(String(password || ''), String(salt || ''), 64);
    const expected = Buffer.from(String(expectedHash || ''), 'hex');
    return expected.length > 0 && computed.length === expected.length && crypto.timingSafeEqual(computed, expected);
  } catch {
    return false;
  }
}

module.exports = {
  parseCookies,
  buildSessionCookieValue,
  buildClearSessionCookieValue,
  hashPassword,
  verifyPassword,
};
