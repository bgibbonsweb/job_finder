const pool = require('./pool');

// Users
async function findUserByEmail(email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email],
  );
  return result.rows[0] || null;
}

async function findUserByUserId(userId) {
  const result = await pool.query(
    'SELECT * FROM users WHERE user_id = $1',
    [userId],
  );
  return result.rows[0] || null;
}

async function createUser(userId, email, passwordHash, passwordSalt) {
  const result = await pool.query(
    `INSERT INTO users (user_id, email, password_hash, password_salt)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO NOTHING
     RETURNING *`,
    [userId, email, passwordHash, passwordSalt],
  );
  return result.rows[0] || null;
}

// Sessions
async function createSession(userId, sessionToken, expiresAt) {
  const result = await pool.query(
    `INSERT INTO sessions (user_id, session_token, expires_at)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [userId, sessionToken, expiresAt],
  );
  return result.rows[0] || null;
}

async function findSessionByToken(sessionToken) {
  const result = await pool.query(
    `SELECT s.*, u.user_id FROM sessions s
     JOIN users u ON s.user_id = u.user_id
     WHERE s.session_token = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
    [sessionToken],
  );
  return result.rows[0] || null;
}

async function deleteExpiredSessions() {
  await pool.query(
    'DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP',
  );
}

async function deleteSession(sessionToken) {
  await pool.query(
    'DELETE FROM sessions WHERE session_token = $1',
    [sessionToken],
  );
}

// Resumes
async function getUserResumes(userId) {
  const result = await pool.query(
    `SELECT * FROM resumes WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return result.rows || [];
}

async function upsertResume(userId, resumeId, resumeData) {
  const result = await pool.query(
    `INSERT INTO resumes (user_id, resume_id, name, text, profile_label, source_name, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (resume_id) DO UPDATE SET
       name = $3, text = $4, profile_label = $5, source_name = $6, updated_at = $8
     RETURNING *`,
    [
      userId,
      resumeId,
      resumeData.name || null,
      resumeData.text || '',
      resumeData.profileLabel || null,
      resumeData.sourceName || null,
      resumeData.createdAt || new Date().toISOString(),
      new Date().toISOString(),
    ],
  );
  return result.rows[0] || null;
}

async function deleteResume(resumeId) {
  await pool.query(
    'DELETE FROM resumes WHERE resume_id = $1',
    [resumeId],
  );
}

// Bookmarks
async function getUserBookmarks(userId) {
  const result = await pool.query(
    `SELECT job_id FROM user_jobs WHERE user_id = $1 AND is_bookmarked = TRUE`,
    [userId],
  );
  return result.rows.map(r => r.job_id) || [];
}

async function getUserHiddenJobs(userId) {
  const result = await pool.query(
    `SELECT job_id FROM user_jobs WHERE user_id = $1 AND is_hidden = TRUE`,
    [userId],
  );
  return result.rows.map(r => r.job_id) || [];
}

async function getUserHiddenCompanies(userId) {
  const result = await pool.query(
    `SELECT DISTINCT hidden_company FROM user_jobs WHERE user_id = $1 AND hidden_company IS NOT NULL`,
    [userId],
  );
  return result.rows.map(r => r.hidden_company).filter(Boolean) || [];
}

async function toggleBookmark(userId, jobId) {
  const result = await pool.query(
    `INSERT INTO user_jobs (user_id, job_id, is_bookmarked)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (user_id, job_id) DO UPDATE SET is_bookmarked = NOT user_jobs.is_bookmarked
     RETURNING *`,
    [userId, jobId],
  );
  return result.rows[0] || null;
}

async function toggleHidden(userId, jobId) {
  const result = await pool.query(
    `INSERT INTO user_jobs (user_id, job_id, is_hidden)
     VALUES ($1, $2, TRUE)
     ON CONFLICT (user_id, job_id) DO UPDATE SET is_hidden = NOT user_jobs.is_hidden
     RETURNING *`,
    [userId, jobId],
  );
  return result.rows[0] || null;
}

async function hideCompany(userId, company) {
  const jobId = `company-${company}`;
  await pool.query(
    `INSERT INTO user_jobs (user_id, job_id, hidden_company, is_hidden)
     VALUES ($1, $2, $3, TRUE)
     ON CONFLICT (user_id, job_id) DO NOTHING`,
    [userId, jobId, company],
  );
}

// Company Audits
async function getCompanyAudit(companyName, maxAgeDays = 7) {
  const result = await pool.query(
    `SELECT * FROM company_audits
     WHERE company_name = $1
     AND updated_at > CURRENT_TIMESTAMP - INTERVAL '${maxAgeDays} days'`,
    [companyName],
  );
  return result.rows[0] || null;
}

async function upsertCompanyAudit(companyName, auditData) {
  const result = await pool.query(
    `INSERT INTO company_audits (company_name, audit_data)
     VALUES ($1, $2)
     ON CONFLICT (company_name) DO UPDATE SET audit_data = $2, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [companyName, JSON.stringify(auditData)],
  );
  return result.rows[0] || null;
}

// User Preferences
async function getUserPreferences(userId) {
  const result = await pool.query(
    'SELECT * FROM user_preferences WHERE user_id = $1',
    [userId],
  );
  return result.rows[0] || null;
}

async function upsertUserPreferences(userId, lastSearchState, scoreWeights) {
  const result = await pool.query(
    `INSERT INTO user_preferences (user_id, last_search_state, score_weights)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE SET last_search_state = $2, score_weights = $3, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [userId, JSON.stringify(lastSearchState || {}), JSON.stringify(scoreWeights || {})],
  );
  return result.rows[0] || null;
}

module.exports = {
  // Users
  findUserByEmail,
  findUserByUserId,
  createUser,

  // Sessions
  createSession,
  findSessionByToken,
  deleteExpiredSessions,
  deleteSession,

  // Resumes
  getUserResumes,
  upsertResume,
  deleteResume,

  // Bookmarks
  getUserBookmarks,
  getUserHiddenJobs,
  getUserHiddenCompanies,
  toggleBookmark,
  toggleHidden,
  hideCompany,

  // Company Audits
  getCompanyAudit,
  upsertCompanyAudit,

  // User Preferences
  getUserPreferences,
  upsertUserPreferences,

  // Pool for direct queries if needed
  pool,
};
