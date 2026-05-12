const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseCookies,
  buildSessionCookieValue,
  buildClearSessionCookieValue,
  hashPassword,
  verifyPassword,
} = require('../server/components/auth');

test('parseCookies parses and decodes cookie header', () => {
  const req = { headers: { cookie: 'a=1; b=two%20words; c=3' } };
  assert.deepEqual(parseCookies(req), { a: '1', b: 'two words', c: '3' });
});

test('parseCookies handles empty and malformed entries', () => {
  const req = { headers: { cookie: 'foo;=bar; valid=value' } };
  assert.deepEqual(parseCookies(req), { valid: 'value' });
});

test('buildSessionCookieValue includes secure attributes and encoded token', () => {
  const value = buildSessionCookieValue('sess', 'tok en', '2026-01-01T00:00:00.000Z');
  assert.match(value, /^sess=tok%20en; Path=\//);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
  assert.match(value, /Expires=/);
});

test('buildClearSessionCookieValue expires cookie immediately', () => {
  const value = buildClearSessionCookieValue('sess');
  assert.equal(value, 'sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
});

test('hashPassword + verifyPassword success and failure cases', () => {
  const { salt, hash } = hashPassword('Password123!');
  assert.equal(verifyPassword('Password123!', salt, hash), true);
  assert.equal(verifyPassword('WrongPass', salt, hash), false);
  assert.equal(verifyPassword('Password123!', salt, 'nothex'), false);
});

test('hashPassword with custom salt uses provided salt', () => {
  const customSalt = 'a'.repeat(32);
  const result = hashPassword('test', customSalt);
  assert.equal(result.salt, customSalt);
  assert.ok(result.hash);
});

test('verifyPassword handles null/empty inputs safely', () => {
  assert.equal(verifyPassword(null, 'salt', 'hash'), false);
  assert.equal(verifyPassword('', '', ''), false);
  assert.equal(verifyPassword('pwd', null, 'hash'), false);
  assert.equal(verifyPassword('pwd', 'salt', null), false);
});

test('parseCookies handles special characters and edge cases', () => {
  const req1 = { headers: { cookie: 'name=; empty=value' } };
  assert.deepEqual(parseCookies(req1), { name: '', empty: 'value' });
  
  const req2 = { headers: { cookie: 'a=%2F%2F; b=%3D%3D' } };
  assert.deepEqual(parseCookies(req2), { a: '//', b: '==' });
  
  const req3 = { headers: { cookie: 'x=1;y=2;z=3' } };
  assert.deepEqual(parseCookies(req3), { x: '1', y: '2', z: '3' });
});

test('buildSessionCookieValue creates valid HTTP cookie string', () => {
  const value = buildSessionCookieValue('sid', 'abc123', '2026-12-31T23:59:59Z');
  assert.match(value, /^sid=abc123/);
  assert.match(value, /Path=\//);
  assert.match(value, /HttpOnly/);
  assert.match(value, /Expires=.*31 Dec 2026/);
});
