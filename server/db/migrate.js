#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrateFromJson() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Read existing JSON files
    const privateDataPath = path.join(__dirname, '../../private/app-data.enc');
    let existingUsers = {};

    if (fs.existsSync(privateDataPath)) {
      try {
        console.log('[migrate] Reading private/app-data.enc...');
        const data = JSON.parse(fs.readFileSync(privateDataPath, 'utf-8'));
        existingUsers = data.users || {};
      } catch (err) {
        console.warn('[migrate] Could not read existing data:', err.message);
      }
    }

    // Migrate users, sessions, resumes, bookmarks
    let migratedCount = 0;

    for (const [userId, userData] of Object.entries(existingUsers)) {
      try {
        // Insert user (if password exists)
        if (userData.password && userData.salt) {
          const email = userData.email || `${userId}@job-finder.local`;
          await client.query(
            `INSERT INTO users (user_id, email, password_hash, password_salt)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId, email, userData.password, userData.salt],
          );
        }

        // Migrate resumes
        const resumes = userData.resumes || [];
        for (const resume of resumes) {
          await client.query(
            `INSERT INTO resumes (user_id, resume_id, name, text, profile_label, source_name, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (resume_id) DO NOTHING`,
            [
              userId,
              resume.id || `resume-${Date.now()}`,
              resume.name || null,
              resume.text || '',
              resume.profileLabel || null,
              resume.sourceName || null,
              resume.createdAt || new Date().toISOString(),
              resume.updatedAt || new Date().toISOString(),
            ],
          );
        }

        // Migrate bookmarks
        const bookmarks = userData.bookmarks || {};
        const bookmarked = bookmarks.bookmarked || [];
        const hidden = bookmarks.hidden || [];
        const hiddenCompanies = bookmarks.hiddenCompanies || [];

        for (const jobId of bookmarked) {
          await client.query(
            `INSERT INTO user_jobs (user_id, job_id, is_bookmarked)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, job_id) DO UPDATE SET is_bookmarked = TRUE`,
            [userId, jobId, true],
          );
        }

        for (const jobId of hidden) {
          await client.query(
            `INSERT INTO user_jobs (user_id, job_id, is_hidden)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, job_id) DO UPDATE SET is_hidden = TRUE`,
            [userId, jobId, true],
          );
        }

        for (const company of hiddenCompanies) {
          // Create placeholder entries for hidden companies
          await client.query(
            `INSERT INTO user_jobs (user_id, job_id, hidden_company, is_hidden)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, job_id) DO NOTHING`,
            [userId, `company-${company}`, company, true],
          );
        }

        migratedCount += 1;
      } catch (err) {
        console.warn(`[migrate] Error migrating user ${userId}:`, err.message);
      }
    }

    await client.query('COMMIT');
    console.log(`[migrate] ✓ Migrated ${migratedCount} users from JSON files`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] Error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Only run migration if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
  console.error('[migrate] DATABASE_URL environment variable not set');
  process.exit(1);
}

migrateFromJson();
