const { normalizeBookmarksData } = require('./bookmarks');
const { normalizeResumeRecord } = require('./resumeRecords');

function defaultPrivateUserData() {
  return {
    bookmarks: { bookmarked: [], hidden: [], hiddenCompanies: [] },
    resumes: [],
  };
}

function normalizePrivateUserData(data) {
  const value = data && typeof data === 'object' ? data : {};
  return {
    bookmarks: normalizeBookmarksData(value.bookmarks || {}),
    resumes: Array.isArray(value.resumes) ? value.resumes.map((item, index) => normalizeResumeRecord(item, index)) : [],
  };
}

function normalizePrivateStore(data, options = {}) {
  const value = data && typeof data === 'object' ? data : {};
  const now = Date.now();
  const sessionTtlMs = Number(options.sessionTtlMs) || 30 * 24 * 60 * 60 * 1000;

  const users = Array.isArray(value.users)
    ? value.users
      .map((user, index) => {
        const id = String(user?.id || `user-${index + 1}`).trim();
        const email = String(user?.email || '').trim().toLowerCase();
        const passwordHash = String(user?.passwordHash || '').trim();
        const passwordSalt = String(user?.passwordSalt || '').trim();
        if (!id || !email || !passwordHash || !passwordSalt) return null;
        return {
          id,
          email,
          name: String(user?.name || email.split('@')[0] || 'User').trim() || 'User',
          passwordHash,
          passwordSalt,
          createdAt: user?.createdAt || new Date().toISOString(),
          updatedAt: user?.updatedAt || user?.createdAt || new Date().toISOString(),
          lastLoginAt: user?.lastLoginAt || null,
        };
      })
      .filter(Boolean)
    : [];

  const validUserIds = new Set(users.map((user) => user.id));
  const sessions = Array.isArray(value.sessions)
    ? value.sessions
      .map((session) => ({
        id: String(session?.id || '').trim(),
        userId: String(session?.userId || '').trim(),
        createdAt: session?.createdAt || new Date().toISOString(),
        expiresAt: session?.expiresAt || new Date(now + sessionTtlMs).toISOString(),
      }))
      .filter((session) => session.id && validUserIds.has(session.userId) && Date.parse(session.expiresAt) > now)
    : [];

  const dataByUser = {};
  const rawByUser = value.dataByUser && typeof value.dataByUser === 'object' ? value.dataByUser : {};
  for (const user of users) {
    dataByUser[user.id] = normalizePrivateUserData(rawByUser[user.id] || defaultPrivateUserData());
  }

  return {
    version: 1,
    users,
    sessions,
    dataByUser,
    legacy: normalizePrivateUserData(value.legacy || defaultPrivateUserData()),
  };
}

module.exports = {
  defaultPrivateUserData,
  normalizePrivateUserData,
  normalizePrivateStore,
};
