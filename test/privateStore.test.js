const test = require('node:test');
const assert = require('node:assert/strict');
const {
  defaultPrivateUserData,
  normalizePrivateUserData,
  normalizePrivateStore,
} = require('../server/components/privateStore');

test('defaultPrivateUserData returns empty user data shape', () => {
  assert.deepEqual(defaultPrivateUserData(), {
    bookmarks: { bookmarked: [], hidden: [], hiddenCompanies: [] },
    resumes: [],
  });
});

test('normalizePrivateUserData normalizes bookmarks and resumes', () => {
  const data = normalizePrivateUserData({
    bookmarks: { bookmarked: ['a', 'a', ' b '] },
    resumes: [{ id: 'r1', text: 'hello\nworld' }],
  });

  assert.deepEqual(data.bookmarks.bookmarked, ['a', 'b']);
  assert.equal(data.resumes.length, 1);
  assert.equal(data.resumes[0].id, 'r1');
  assert.equal(data.resumes[0].text, 'hello world');
});

test('normalizePrivateStore normalizes users/sessions and builds user data map', () => {
  const now = Date.now();
  const store = normalizePrivateStore(
    {
      users: [
        { id: 'u1', email: 'A@EXAMPLE.COM', passwordHash: 'h', passwordSalt: 's' },
        { id: '', email: 'bad@example.com', passwordHash: 'h', passwordSalt: 's' },
      ],
      sessions: [
        { id: 'sess1', userId: 'u1', expiresAt: new Date(now + 60_000).toISOString() },
        { id: 'sess2', userId: 'missing', expiresAt: new Date(now + 60_000).toISOString() },
      ],
      dataByUser: {
        u1: { bookmarks: { bookmarked: ['x', 'x'] }, resumes: [] },
      },
    },
    { sessionTtlMs: 60_000 },
  );

  assert.equal(store.users.length, 2);
  assert.equal(store.users[0].email, 'a@example.com');
  assert.equal(store.sessions.length, 1);
  assert.deepEqual(store.dataByUser.u1.bookmarks.bookmarked, ['x']);
});

test('normalizePrivateStore filters expired sessions', () => {
  const now = Date.now();
  const store = normalizePrivateStore({
    users: [{ id: 'u1', email: 'u1@example.com', passwordHash: 'h', passwordSalt: 's' }],
    sessions: [
      { id: 'expired', userId: 'u1', expiresAt: new Date(now - 1_000).toISOString() },
      { id: 'active', userId: 'u1', expiresAt: new Date(now + 60_000).toISOString() },
    ],
  });
  assert.deepEqual(store.sessions.map((s) => s.id), ['active']);
});

test('normalizePrivateUserData returns defaults for invalid value', () => {
  const data = normalizePrivateUserData(undefined);
  assert.deepEqual(data, defaultPrivateUserData());
});

test('normalizePrivateStore handles missing users and orphaned sessions', () => {
  const store = normalizePrivateStore({
    users: [{ id: 'u1', email: 'test@example.com', passwordHash: 'h', passwordSalt: 's' }],
    sessions: [
      { id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 60_000).toISOString() },
      { id: 's2', userId: 'orphaned', expiresAt: new Date(Date.now() + 60_000).toISOString() },
    ],
  });
  assert.equal(store.sessions.filter((s) => s.userId === 'u1').length, 1);
  assert.equal(store.sessions.filter((s) => s.userId === 'orphaned').length, 0);
});

test('normalizePrivateStore handles empty input gracefully', () => {
  const store = normalizePrivateStore({});
  assert.deepEqual(store.users, []);
  assert.deepEqual(store.sessions, []);
  assert.deepEqual(store.dataByUser, {});
});
