const db = require('../db/queries');

async function getUserPrivateData(userId) {
  try {
    const [resumes, bookmarks, hiddenJobs, hiddenCompanies, preferences] = await Promise.all([
      db.getUserResumes(userId),
      db.getUserBookmarks(userId),
      db.getUserHiddenJobs(userId),
      db.getUserHiddenCompanies(userId),
      db.getUserPreferences(userId),
    ]);

    return {
      userId,
      resumes: resumes || [],
      bookmarks: {
        bookmarked: bookmarks || [],
        hidden: hiddenJobs || [],
        hiddenCompanies: hiddenCompanies || [],
      },
      preferences: {
        lastSearchState: preferences?.last_search_state || null,
        scoreWeights: preferences?.score_weights || {},
      },
    };
  } catch (err) {
    console.error('[db] Error reading user data for', userId, ':', err.message);
    return {
      userId,
      resumes: [],
      bookmarks: { bookmarked: [], hidden: [], hiddenCompanies: [] },
      preferences: { lastSearchState: null, scoreWeights: {} },
    };
  }
}

async function saveUserResumes(userId, resumes) {
  try {
    if (!Array.isArray(resumes)) return;
    for (const resume of resumes) {
      if (resume && resume.id) {
        await db.upsertResume(userId, resume.id, resume);
      }
    }
  } catch (err) {
    console.error('[db] Error saving resumes for', userId, ':', err.message);
  }
}

async function saveUserBookmarks(userId, bookmarks) {
  try {
    if (!bookmarks) return;

    // Save bookmarked jobs
    if (Array.isArray(bookmarks.bookmarked)) {
      for (const jobId of bookmarks.bookmarked) {
        await db.toggleBookmark(userId, jobId);
      }
    }

    // Save hidden jobs
    if (Array.isArray(bookmarks.hidden)) {
      for (const jobId of bookmarks.hidden) {
        await db.toggleHidden(userId, jobId);
      }
    }

    // Save hidden companies
    if (Array.isArray(bookmarks.hiddenCompanies)) {
      for (const company of bookmarks.hiddenCompanies) {
        await db.hideCompany(userId, company);
      }
    }
  } catch (err) {
    console.error('[db] Error saving bookmarks for', userId, ':', err.message);
  }
}

async function saveUserPreferences(userId, lastSearchState, scoreWeights) {
  try {
    await db.upsertUserPreferences(userId, lastSearchState, scoreWeights);
  } catch (err) {
    console.error('[db] Error saving preferences for', userId, ':', err.message);
  }
}

module.exports = {
  getUserPrivateData,
  saveUserResumes,
  saveUserBookmarks,
  saveUserPreferences,
};
