const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { Document } = require('docx');
const Busboy = require('busboy');
const { normalizeBookmarksData: normalizeBookmarksDataComponent } = require('./server/components/bookmarks');
const {
  normalizeResumeText: normalizeResumeTextComponent,
  buildProfileLabelFromText: buildProfileLabelFromTextComponent,
  normalizeResumeRecord: normalizeResumeRecordComponent,
} = require('./server/components/resumeRecords');
const {
  defaultPrivateUserData: defaultPrivateUserDataComponent,
  normalizePrivateUserData: normalizePrivateUserDataComponent,
  normalizePrivateStore: normalizePrivateStoreComponent,
} = require('./server/components/privateStore');
const {
  readJsonFile: readJsonFileComponent,
  writeJsonFile: writeJsonFileComponent,
} = require('./server/components/jsonFile');
const {
  parseCookies: parseCookiesComponent,
  buildSessionCookieValue,
  buildClearSessionCookieValue,
  hashPassword: hashPasswordComponent,
  verifyPassword: verifyPasswordComponent,
} = require('./server/components/auth');

// Load environment variables
require('dotenv').config({ path: '.env' });

const HOST = '0.0.0.0';
const PORT = process.env.PORT || 3006;
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-default-secret-change-in-production';
const NODE_ENV = process.env.NODE_ENV || 'development';
const CLIMATEBASE_JOBS_URL = 'https://climatebase.org/jobs';
const JOBS_CACHE_FILE = path.join(__dirname, 'jobs.json');
const BOOKMARKS_FILE = path.join(__dirname, 'bookmarks.json');
const RESUMES_FILE = path.join(__dirname, 'resumes.json');
const COMPANY_AUDITS_FILE = path.join(__dirname, 'company_audits.json');
const PRIVATE_DATA_DIR = path.join(__dirname, 'private');
const AUTH_STORE_FILE = path.join(PRIVATE_DATA_DIR, 'app-data.enc');
const AUTH_SECRET_FILE = path.join(PRIVATE_DATA_DIR, 'server-secret.key');
const SESSION_COOKIE_NAME = 'job_finder_session';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const ANONYMOUS_COOKIE_NAME = 'job_finder_anon';
const ANONYMOUS_RESUME_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const ATS_FETCH_CONCURRENCY = 12;
const ATS_FETCH_TIMEOUT_MS = 8000;
const INGEST_VOLUME_MULTIPLIER = Math.max(1, Math.min(10, Number(process.env.INGEST_VOLUME_MULTIPLIER || 4)));
const INGEST_HEALTH_WARN_SLOW_MS = Number(process.env.INGEST_HEALTH_WARN_SLOW_MS || 20000);
const INGEST_HEALTH_VERBOSE = ['1', 'true', 'yes', 'on'].includes(String(process.env.INGEST_HEALTH_VERBOSE || '').trim().toLowerCase());
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h — load once per server session
const CACHE_OFFLINE_ONLY = ['1', 'true', 'yes', 'on'].includes(String(process.env.CACHE_OFFLINE_ONLY || '').trim().toLowerCase());
const COMPANY_AUDIT_TTL_MS = Number(process.env.COMPANY_AUDIT_TTL_MS || 7 * 24 * 60 * 60 * 1000);
const COMPANY_AUDIT_BATCH_MAX = 25;
const AUDIT_USER_AGENT = process.env.AUDIT_USER_AGENT || 'job-finder-audit/1.0 support@example.com';
const OPENCORPORATES_API_TOKEN = String(process.env.OPENCORPORATES_API_TOKEN || '').trim();
const FMP_API_KEY = String(process.env.FMP_API_KEY || '').trim();
const PERPLEXITY_API_KEY = String(process.env.PERPLEXITY_API_KEY || '').trim();
const SEC_TICKERS_CACHE_TTL_MS = Number(process.env.SEC_TICKERS_CACHE_TTL_MS || 24 * 60 * 60 * 1000);
const BUILTIN_FETCH_CONCURRENCY = Number(process.env.BUILTIN_FETCH_CONCURRENCY || 12);
const TERRA_BOARD_URL = 'https://www.terra.do/climate-jobs/job-board/';
const EIGHTYKHOURS_APP_ID = 'W6KM1UDIB3';
const EIGHTYKHOURS_API_KEY = 'd1d7f2c8696e7b36837d5ed337c4a319';
const EIGHTYKHOURS_INDEX = 'jobs_prod';

// Algolia credentials (public search-only key, read from Climatebase JS bundle)
const ALGOLIA_APP_ID = '8PSNFFQTXQ';
const ALGOLIA_API_KEY = 'd2ebe27d3cc3d35fea04da7b1b0718a8';
const ALGOLIA_INDEX = 'Job_production';
const ALGOLIA_HITS_PER_PAGE = Number(process.env.ALGOLIA_HITS_PER_PAGE || 100000);
const ALGOLIA_PAGE_CONCURRENCY = Number(process.env.ALGOLIA_PAGE_CONCURRENCY || 24);
const ALGOLIA_MIN_WINDOW_DAYS = Number(process.env.ALGOLIA_MIN_WINDOW_DAYS || 0);
const ALGOLIA_MAX_SPLIT_DEPTH = Number(process.env.ALGOLIA_MAX_SPLIT_DEPTH || 32);
// Extreme-volume default: start from year 2000; override with ALGOLIA_START_EPOCH env var
const ALGOLIA_START_EPOCH = Number(process.env.ALGOLIA_START_EPOCH || 946684800);
const ALGOLIA_CATEGORY_CONCURRENCY = Number(process.env.ALGOLIA_CATEGORY_CONCURRENCY || 6);
const ALGOLIA_FETCH_RETRIES = Number(process.env.ALGOLIA_FETCH_RETRIES || 3);

let jobsCache = [];
let cacheUpdatedAt = 0;
let cacheRefreshPromise = null;

const DERIVED_SCORE_CACHE_MAX = Number(process.env.DERIVED_SCORE_CACHE_MAX || 200000);
const JOB_SEARCH_CACHE_TTL_MS = Number(process.env.JOB_SEARCH_CACHE_TTL_MS || 5 * 60 * 1000);
const JOB_SEARCH_CACHE_MAX = Number(process.env.JOB_SEARCH_CACHE_MAX || 30000);
const JOB_SEARCH_HEALTH_SLOW_MS = Number(process.env.JOB_SEARCH_HEALTH_SLOW_MS || 1500);
const JOB_SEARCH_HEALTH_VERBOSE = ['1', 'true', 'yes', 'on'].includes(String(process.env.JOB_SEARCH_HEALTH_VERBOSE || '').trim().toLowerCase());
const REQUEST_PROGRESS_TTL_MS = Number(process.env.REQUEST_PROGRESS_TTL_MS || 2 * 60 * 1000);
const RESUME_PROFILE_CACHE_MAX = Number(process.env.RESUME_PROFILE_CACHE_MAX || 100000);
const RESUME_BREAKDOWN_CACHE_MAX = Number(process.env.RESUME_BREAKDOWN_CACHE_MAX || 100000);
const RESUME_SCORE_FALLBACK_MAX_RAW = Number(process.env.RESUME_SCORE_MAX_RAW || 30000);
const derivedScoreCache = {
  resume: new Map(),
  impact: new Map(),
  audit: new Map(),
};
const jobSearchCache = new Map();
const requestProgressCache = new Map();
const resumeProfileCache = new Map();
const resumeBreakdownCache = new Map();
const anonymousResumes = new Map(); // Maps anonUserId -> { text, uploadedAt, profile }
let derivedScoreCacheDatasetKey = '';
let companyEndProductCache = {
  datasetKey: '',
  jobs: [],
};
let jobLookupCache = {
  datasetKey: '',
  byId: new Map(),
};

function getJobsDatasetKey(jobs) {
  return `${cacheUpdatedAt}:${Array.isArray(jobs) ? jobs.length : 0}`;
}

function trimMapCache(map) {
  while (map.size > DERIVED_SCORE_CACHE_MAX) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

function trimJobSearchCache() {
  while (jobSearchCache.size > JOB_SEARCH_CACHE_MAX) {
    const firstKey = jobSearchCache.keys().next().value;
    if (firstKey === undefined) break;
    jobSearchCache.delete(firstKey);
  }
}

function cleanupExpiredJobSearchCache(now = Date.now()) {
  for (const [key, entry] of jobSearchCache.entries()) {
    if (!entry || !Number.isFinite(entry.createdAt) || now - entry.createdAt > JOB_SEARCH_CACHE_TTL_MS) {
      jobSearchCache.delete(key);
    }
  }
}

function summarizeTopCounts(counts, limit = 5) {
  if (!counts || typeof counts !== 'object') return [];
  return Object.entries(counts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, limit)
    .map(([key, value]) => `${key}:${Number(value || 0)}`);
}

function logJobSearchHealth(event, payload = {}) {
  const durationMs = Number(payload.durationMs || 0);
  const totalReturned = Number(payload.totalReturned || 0);
  const filteredAvailable = Number(payload.filteredAvailable || 0);
  const anomalies = [];

  if (durationMs >= JOB_SEARCH_HEALTH_SLOW_MS) anomalies.push('slow-search');
  if (filteredAvailable === 0) anomalies.push('empty-filtered-result');
  if (totalReturned === 0 && filteredAvailable > 0) anomalies.push('empty-page-window');

  const shouldLog = JOB_SEARCH_HEALTH_VERBOSE || anomalies.length > 0 || event === 'error';
  if (!shouldLog) return;

  const output = {
    event,
    durationMs,
    requestId: String(payload.requestId || ''),
    query: String(payload.query || ''),
    cachePath: String(payload.cachePath || 'unknown'),
    sortBy: String(payload.sortBy || ''),
    rankingMode: String(payload.rankingMode || ''),
    impactMode: String(payload.impactMode || ''),
    usOnly: Boolean(payload.usOnly),
    page: {
      offset: Number(payload.offset || 0),
      limit: Number(payload.limit || 0),
      returned: totalReturned,
      filteredAvailable,
      totalAvailable: Number(payload.totalAvailable || 0),
    },
    cache: {
      searchCacheHit: Boolean(payload.searchCacheHit),
      exactRequestCacheHit: Boolean(payload.exactRequestCacheHit),
      stale: Boolean(payload.stale),
    },
    topSources: summarizeTopCounts(payload.sourceCounts, 5),
    anomalies,
  };

  if (payload.timingsMs && typeof payload.timingsMs === 'object') {
    output.timingsMs = Object.fromEntries(
      Object.entries(payload.timingsMs)
        .filter(([, value]) => Number.isFinite(Number(value)))
        .map(([key, value]) => [key, Number(value)]),
    );
  }

  if (payload.errorMessage) {
    output.error = String(payload.errorMessage);
  }

  console.log(`[search-health] ${JSON.stringify(output)}`);
}

function stableCsv(value) {
  if (!Array.isArray(value)) return '';
  return [...value].map((item) => String(item || '').trim()).filter(Boolean).sort().join(',');
}

function buildBookmarksVersion(bookmarks) {
  const normalized = normalizeBookmarksData(bookmarks || {});
  return [
    stableCsv(normalized.bookmarked),
    stableCsv(normalized.hidden),
    stableCsv(normalized.hiddenCompanies),
  ].join('|');
}

function buildJobsSearchCacheKey({
  datasetKey,
  q,
  sortBy,
  rankingMode,
  impactMode,
  useLocalModel,
  usOnly,
  resumeKey,
  resumeSelection,
  scoreWeights,
  sourcesParam,
  jobTypesParam,
  jobFieldsParam,
  companySizesParam,
  endProductCategoryFilter,
  bookmarkFilter,
  targetLocation,
  targetLocationLabel,
  targetLocationCoordinates,
  bookmarksVersion,
}) {
  const weights = scoreWeights && scoreWeights.raw
    ? `${scoreWeights.raw.resume},${scoreWeights.raw.impact},${scoreWeights.raw.bay},${scoreWeights.raw.fresh},${scoreWeights.raw.audit}`
    : '';
  return [
    datasetKey,
    `q=${String(q || '').toLowerCase()}`,
    `sort=${sortBy}`,
    `rank=${rankingMode}`,
    `impact=${impactMode}`,
    `local=${useLocalModel ? '1' : '0'}`,
    `us=${usOnly ? '1' : '0'}`,
    `resume=${resumeKey}`,
    `sel=${JSON.stringify(resumeSelection || {})}`,
    `weights=${weights}`,
    `sources=${sourcesParam || ''}`,
    `types=${jobTypesParam || ''}`,
    `fields=${jobFieldsParam || ''}`,
    `sizes=${companySizesParam || ''}`,
    `end=${endProductCategoryFilter}`,
    `bookmarkFilter=${bookmarkFilter}`,
    `location=${targetLocation || 'bay-area'}`,
    `locationLabel=${String(targetLocationLabel || '').toLowerCase()}`,
    `locationCoords=${targetLocationCoordinates && Number.isFinite(targetLocationCoordinates.lat) && Number.isFinite(targetLocationCoordinates.lng)
      ? `${Number(targetLocationCoordinates.lat).toFixed(4)},${Number(targetLocationCoordinates.lng).toFixed(4)}`
      : ''}`,
    `bookmarkState=${bookmarksVersion}`,
  ].join('|');
}

function trimMapCacheToLimit(map, limit) {
  while (map.size > limit) {
    const firstKey = map.keys().next().value;
    if (firstKey === undefined) break;
    map.delete(firstKey);
  }
}

function clearResumeDerivedCaches() {
  resumeProfileCache.clear();
  resumeBreakdownCache.clear();
}

function buildResumeRecordRevisionKey(record) {
  if (!record) return 'resume:none';
  const id = String(record.id || '').trim();
  const updatedAt = String(record.updatedAt || record.createdAt || '').trim();
  const textLen = String(record.text || '').length;
  const name = String(record.name || '').trim();
  return `resume:${id}|updated:${updatedAt}|len:${textLen}|name:${name}`;
}

function buildBlendResumeRevisionKey(records, mode = 'average', label = '') {
  const parts = (Array.isArray(records) ? records : [])
    .map((record) => buildResumeRecordRevisionKey(record))
    .sort();
  return `blend:${mode}|label:${String(label || '').trim()}|parts:${parts.join('||')}`;
}

function buildResumeBreakdownPayload(record, profile) {
  const topKeywords = Object.entries(profile?.termWeights || {})
    .sort((a, b) => (Number(b[1]) || 0) - (Number(a[1]) || 0))
    .slice(0, 30)
    .map(([term, weight]) => ({ term, weight: Number(weight) }));

  const facetsList = Object.entries(profile?.matchFacets || {})
    .map(([facet, keywords]) => ({
      facet,
      keywords: Array.isArray(keywords) ? keywords.slice(0, 8) : [],
    }));

  const anchorPhrases = Array.isArray(profile?.anchors) ? profile.anchors.slice(0, 12) : [];
  const signals = Array.isArray(profile?.signalPhrases)
    ? profile.signalPhrases.slice(0, 12).map((s) => ({
      phrase: Array.isArray(s) ? s[0] : s,
      impact: Array.isArray(s) ? s[1] : 1,
    }))
    : [];

  const skills = profile?.resumeSkills
    ? Array.from(profile.resumeSkills).slice(0, 20)
    : [];

  const extractedText = String(profile?.profileText || '').substring(0, 400);

  return {
    resumeId: record.id,
    resumeName: record.name,
    resumeSource: record.sourceName,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    breakdown: {
      topKeywords,
      facets: facetsList,
      anchors: anchorPhrases,
      signalPhrases: signals,
      skills,
      extractedText,
      aiSummary: 'This breakdown is computed from extracted resume text, keyword weights, facets, and signal phrases. No generative AI is used to build the profile itself.',
      scoringMethod: 'Keyword-based profile matching with term weights and facet signals',
    },
  };
}

function cleanupExpiredRequestProgress(now = Date.now()) {
  for (const [key, entry] of requestProgressCache.entries()) {
    if (!entry || !Number.isFinite(entry.updatedAt) || now - entry.updatedAt > REQUEST_PROGRESS_TTL_MS) {
      requestProgressCache.delete(key);
    }
  }
}

function startRequestProgress(requestId, payload = {}) {
  if (!requestId) return;
  cleanupExpiredRequestProgress();
  requestProgressCache.set(requestId, {
    requestId,
    stepKey: 'starting',
    title: 'Starting search',
    detail: 'Initializing search request and validating filters.',
    processed: 0,
    total: 1,
    percent: 0,
    checklist: [],
    completed: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...payload,
  });
}

function updateRequestProgress(requestId, patch = {}) {
  if (!requestId) return;
  const existing = requestProgressCache.get(requestId);
  if (!existing) return;
  requestProgressCache.set(requestId, {
    ...existing,
    ...patch,
    updatedAt: Date.now(),
  });
}

function finishRequestProgress(requestId) {
  if (!requestId) return;
  updateRequestProgress(requestId, {
    stepKey: 'done',
    title: 'Jobs loaded',
    detail: 'Search response ready.',
    processed: 1,
    total: 1,
    percent: 100,
    completed: true,
  });
}

function resetDerivedCachesIfDatasetChanged(jobs) {
  const datasetKey = getJobsDatasetKey(jobs);
  if (datasetKey !== derivedScoreCacheDatasetKey) {
    derivedScoreCache.resume.clear();
    derivedScoreCache.impact.clear();
    derivedScoreCache.audit.clear();
    derivedScoreCacheDatasetKey = datasetKey;
  }
  return datasetKey;
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const DEFAULT_SCORE_WEIGHTS = {
  resume: 20,
  impact: 20,
  bay: 20,
  fresh: 20,
  audit: 20,
};

function parseScoreWeightValue(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return clampNumber(parsed, 0, 100);
}

function parseScoreWeightsFromParams(params) {
  const raw = {
    resume: parseScoreWeightValue(params.get('scoreResumeWeight'), DEFAULT_SCORE_WEIGHTS.resume),
    impact: parseScoreWeightValue(params.get('scoreImpactWeight'), DEFAULT_SCORE_WEIGHTS.impact),
    bay: parseScoreWeightValue(params.get('scoreBayWeight'), DEFAULT_SCORE_WEIGHTS.bay),
    fresh: parseScoreWeightValue(params.get('scoreFreshWeight'), DEFAULT_SCORE_WEIGHTS.fresh),
    audit: parseScoreWeightValue(params.get('scoreAuditWeight'), DEFAULT_SCORE_WEIGHTS.audit),
  };

  const total = raw.resume + raw.impact + raw.bay + raw.fresh + raw.audit;
  if (total <= 0) {
    return {
      raw: { ...DEFAULT_SCORE_WEIGHTS },
      normalized: {
        resume: 0.2,
        impact: 0.2,
        bay: 0.2,
        fresh: 0.2,
        audit: 0.2,
      },
    };
  }

  return {
    raw,
    normalized: {
      resume: raw.resume / total,
      impact: raw.impact / total,
      bay: raw.bay / total,
      fresh: raw.fresh / total,
      audit: raw.audit / total,
    },
  };
}

function computeWeightedTotalScore(values, normalizedWeights) {
  const total =
    (values.resumeScore * normalizedWeights.resume)
    + (values.impactScore * normalizedWeights.impact)
    + (values.bayScore * normalizedWeights.bay)
    + (values.freshnessScore * normalizedWeights.fresh)
    + (values.auditScore * normalizedWeights.audit);
  return Math.round(total);
}

function serializeJobPageItem(job) {
  if (!job) return job;
  return {
    id: job.id,
    title: job.title,
    company: job.company,
    locations: Array.isArray(job.locations) ? job.locations : [],
    remotePreferences: Array.isArray(job.remotePreferences) ? job.remotePreferences : [],
    jobTypes: Array.isArray(job.jobTypes) ? job.jobTypes : [],
    datePosted: job.datePosted || null,
    logo: job.logo || null,
    url: job.url,
    source: job.source,
    jobField: job.jobField,
    companySize: job.companySize,
    endProductCategory: job.endProductCategory,
    breakdown: job.breakdown || null,
    score: job.score,
    resumeScore: job.resumeScore,
    impactScore: job.impactScore,
    impactKeywordBreakdown: job.impactKeywordBreakdown || null,
    bayScore: job.bayScore,
    freshnessScore: job.freshnessScore,
    auditScore: job.auditScore,
    resumeKeywordBreakdown: job.resumeKeywordBreakdown || null,
    impactLabel: job.impactLabel,
    bayLabel: job.bayLabel,
    freshnessLabel: job.freshnessLabel,
    scoreComponents: job.scoreComponents || null,
  };
}

function getKeywordStrengthLabel(weight) {
  const numeric = Number(weight) || 0;
  if (numeric >= 12) return 'Strong';
  if (numeric >= 7) return 'Good';
  if (numeric >= 4) return 'Moderate';
  return 'Light';
}

function getImpactStrengthLabel(points) {
  const numeric = Number(points) || 0;
  if (numeric >= 10) return 'Strong';
  if (numeric >= 6) return 'Good';
  if (numeric >= 3) return 'Moderate';
  return 'Light';
}

function getMatchedImpactTerms(corpus, terms, signal, points) {
  const text = String(corpus || '').toLowerCase();
  const seen = new Set();
  const matches = [];
  for (const rawTerm of terms || []) {
    const term = String(rawTerm || '').trim().toLowerCase();
    if (!term || seen.has(term) || !text.includes(term)) continue;
    seen.add(term);
    matches.push({
      term,
      signal,
      points,
      strength: getImpactStrengthLabel(points),
    });
  }
  return matches;
}

function buildImpactKeywordBreakdown(mode, groups = [], meta = {}) {
  const byTerm = new Map();
  for (const group of groups) {
    for (const item of group) {
      const existing = byTerm.get(item.term);
      if (!existing || item.points > existing.points) {
        byTerm.set(item.term, item);
      }
    }
  }

  const keywords = [...byTerm.values()]
    .sort((a, b) => b.points - a.points || a.term.localeCompare(b.term))
    .slice(0, 12);

  return {
    mode,
    matchedCount: byTerm.size,
    keywords,
    ...meta,
  };
}

function buildResumeKeywordBreakdown(uniqueTerms, termWeights, matchFacets, job) {
  const matchedKeywords = [];
  const matchedByTerm = new Set();
  const titleLower = String(job?.title || '').toLowerCase();
  const companyLower = String(job?.company || '').toLowerCase();
  const metaLower = [
    ...(Array.isArray(job?.jobTypes) ? job.jobTypes : []),
    ...(Array.isArray(job?.remotePreferences) ? job.remotePreferences : []),
    ...(Array.isArray(job?.locations) ? job.locations : []),
    String(job?.jobField || ''),
  ]
    .join(' ')
    .toLowerCase();

  const getWhereMatched = (term) => {
    const where = [];
    if (titleLower.includes(term)) where.push('title');
    if (companyLower.includes(term)) where.push('company');
    if (metaLower.includes(term)) where.push('metadata');
    return where;
  };

  for (const term of uniqueTerms || []) {
    const weight = Number(termWeights?.[term] || 0);
    if (weight <= 0) continue;

    matchedKeywords.push({
      term,
      weight,
      strength: getKeywordStrengthLabel(weight),
      where: getWhereMatched(term),
      signal: 'term-weight',
    });
    matchedByTerm.add(term);
  }

  const facetWeightByKey = {
    ai: 6,
    engineering: 5,
    climate: 5,
    tech: 4,
  };

  for (const [facetKey, facetTerms] of Object.entries(matchFacets || {})) {
    if (!Array.isArray(facetTerms)) continue;
    const baseWeight = facetWeightByKey[facetKey] || 4;
    for (const term of facetTerms) {
      if (!term || !uniqueTerms?.has(term) || matchedByTerm.has(term)) continue;
      const boostedWeight = Math.max(baseWeight, Number(termWeights?.[term] || 0));
      matchedKeywords.push({
        term,
        weight: boostedWeight,
        strength: getKeywordStrengthLabel(boostedWeight),
        where: getWhereMatched(term),
        signal: `facet:${facetKey}`,
      });
      matchedByTerm.add(term);
    }
  }

  matchedKeywords.sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term));
  const topKeywords = matchedKeywords.slice(0, 12);
  const weightedMatchScore = topKeywords.reduce((sum, item) => sum + item.weight, 0);

  return {
    matchedCount: matchedKeywords.length,
    weightedMatchScore,
    keywords: topKeywords,
  };
}

function normalizeCompanyKey(company) {
  return String(company || '').trim().toLowerCase();
}

function normalizeCompanyForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|holdings?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

let secTickersCache = {
  loadedAt: 0,
  entries: [],
};

function loadCompanyAudits() {
  try {
    if (fs.existsSync(COMPANY_AUDITS_FILE)) {
      const data = fs.readFileSync(COMPANY_AUDITS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (err) {
    console.error('[company-audit] Error loading audit cache:', err.message);
  }
  return {};
}

function saveCompanyAudits() {
  try {
    fs.writeFileSync(COMPANY_AUDITS_FILE, JSON.stringify(companyAuditCache, null, 2), 'utf-8');
  } catch (err) {
    console.error('[company-audit] Error saving audit cache:', err.message);
  }
}

let companyAuditCache = loadCompanyAudits();

async function fetchJsonWithTimeout(url, timeoutMs = 8000, headers = {}) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers,
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function fetchPostJsonWithTimeout(url, body, timeoutMs = 15000, headers = {}) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

async function fetchClearbitSignal(company) {
  const query = encodeURIComponent(company);
  const data = await fetchJsonWithTimeout(
    `https://autocomplete.clearbit.com/v1/companies/suggest?query=${query}`,
    6000,
  );
  if (!Array.isArray(data) || data.length === 0) return null;

  const preferred = data.find((entry) =>
    String(entry?.name || '').toLowerCase() === String(company || '').toLowerCase(),
  ) || data[0];

  return {
    name: preferred?.name || null,
    domain: preferred?.domain || null,
    logo: preferred?.logo || null,
    type: preferred?.type || null,
  };
}

async function fetchWikipediaSignal(company) {
  const title = encodeURIComponent(String(company || '').replace(/\s+/g, '_'));
  const data = await fetchJsonWithTimeout(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${title}`,
    6000,
    { 'User-Agent': 'job-finder-audit/1.0' },
  );

  if (!data || !data.title || data.type === 'https://mediawiki.org/wiki/HyperSwitch/errors/not_found') {
    return null;
  }

  const extractLength = String(data.extract || '').length;
  return {
    title: data.title,
    description: data.description || null,
    extractLength,
    hasPage: true,
  };
}

async function fetchYahooFinanceSignal(company) {
  const query = encodeURIComponent(company);
  const search = await fetchJsonWithTimeout(`https://query1.finance.yahoo.com/v1/finance/search?q=${query}`, 7000);
  const quotes = Array.isArray(search?.quotes) ? search.quotes : [];
  if (quotes.length === 0) return null;

  const equity = quotes.find((q) => q.quoteType === 'EQUITY' && q.symbol) || quotes[0];
  if (!equity?.symbol) return null;

  const quoteData = await fetchJsonWithTimeout(
    `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(equity.symbol)}`,
    7000,
  );
  const row = Array.isArray(quoteData?.quoteResponse?.result) ? quoteData.quoteResponse.result[0] : null;
  if (!row) return null;

  return {
    symbol: row.symbol || equity.symbol,
    marketCap: Number.isFinite(row.marketCap) ? row.marketCap : null,
    changePercent: Number.isFinite(row.regularMarketChangePercent) ? row.regularMarketChangePercent : null,
    longName: row.longName || equity.longname || null,
  };
}

function toPaddedCik(cik) {
  const digits = String(cik || '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

async function getSecCompanyTickers() {
  if (Date.now() - secTickersCache.loadedAt < SEC_TICKERS_CACHE_TTL_MS && secTickersCache.entries.length > 0) {
    return secTickersCache.entries;
  }

  const data = await fetchJsonWithTimeout(
    'https://www.sec.gov/files/company_tickers.json',
    9000,
    {
      'User-Agent': AUDIT_USER_AGENT,
      Accept: 'application/json',
    },
  );
  if (!data || typeof data !== 'object') return secTickersCache.entries;

  const entries = Object.values(data)
    .map((row) => ({
      cik: toPaddedCik(row?.cik_str),
      ticker: String(row?.ticker || '').trim().toUpperCase(),
      title: String(row?.title || '').trim(),
      normalizedTitle: normalizeCompanyForMatch(row?.title || ''),
    }))
    .filter((row) => row.cik && row.ticker && row.title);

  secTickersCache = {
    loadedAt: Date.now(),
    entries,
  };

  return entries;
}

function pickBestSecTicker(company, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  const normalizedTarget = normalizeCompanyForMatch(company);
  if (!normalizedTarget) return entries[0] || null;

  const exact = entries.find((entry) => entry.normalizedTitle === normalizedTarget);
  if (exact) return exact;

  const startsWith = entries.find((entry) => entry.normalizedTitle.startsWith(normalizedTarget) || normalizedTarget.startsWith(entry.normalizedTitle));
  if (startsWith) return startsWith;

  const tokens = normalizedTarget.split(' ').filter(Boolean);
  let best = null;
  let bestScore = -1;
  for (const entry of entries) {
    let score = 0;
    for (const token of tokens) {
      if (entry.normalizedTitle.includes(token)) score += 1;
    }
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  return best;
}

function extractLatestSecFact(companyFacts, tag) {
  const units = companyFacts?.facts?.['us-gaap']?.[tag]?.units;
  if (!units || typeof units !== 'object') return null;
  const unitArrays = Object.values(units).filter((arr) => Array.isArray(arr));
  const allFacts = unitArrays.flat().filter((row) => Number.isFinite(row?.val));
  if (allFacts.length === 0) return null;

  allFacts.sort((a, b) => {
    const aDate = Date.parse(a?.end || a?.filed || '');
    const bDate = Date.parse(b?.end || b?.filed || '');
    return (Number.isFinite(bDate) ? bDate : 0) - (Number.isFinite(aDate) ? aDate : 0);
  });

  const latest = allFacts[0];
  return {
    value: latest.val,
    end: latest.end || null,
    filed: latest.filed || null,
    form: latest.form || null,
    unit: latest.unit || null,
  };
}

async function fetchSecSignal(company) {
  const tickers = await getSecCompanyTickers();
  const bestTicker = pickBestSecTicker(company, tickers);
  if (!bestTicker?.cik) return null;

  const submissions = await fetchJsonWithTimeout(
    `https://data.sec.gov/submissions/CIK${bestTicker.cik}.json`,
    9000,
    {
      'User-Agent': AUDIT_USER_AGENT,
      Accept: 'application/json',
    },
  );

  const recent = submissions?.filings?.recent || {};
  const forms = Array.isArray(recent.form) ? recent.form : [];
  const filedDates = Array.isArray(recent.filingDate) ? recent.filingDate : [];

  let last10KDate = null;
  let last10QDate = null;
  let recent8kCount = 0;
  const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;

  for (let i = 0; i < forms.length; i += 1) {
    const form = String(forms[i] || '').toUpperCase();
    const filingDateStr = filedDates[i] || null;
    const filingDateMs = filingDateStr ? Date.parse(filingDateStr) : NaN;

    if (form === '10-K' && !last10KDate && filingDateStr) last10KDate = filingDateStr;
    if (form === '10-Q' && !last10QDate && filingDateStr) last10QDate = filingDateStr;

    if ((form === '8-K' || form === '8-K/A') && Number.isFinite(filingDateMs) && filingDateMs >= oneYearAgo) {
      recent8kCount += 1;
    }
  }

  const companyFacts = await fetchJsonWithTimeout(
    `https://data.sec.gov/api/xbrl/companyfacts/CIK${bestTicker.cik}.json`,
    9000,
    {
      'User-Agent': AUDIT_USER_AGENT,
      Accept: 'application/json',
    },
  );

  const revenue = extractLatestSecFact(companyFacts, 'Revenues');
  const netIncome = extractLatestSecFact(companyFacts, 'NetIncomeLoss');
  const assets = extractLatestSecFact(companyFacts, 'Assets');
  const liabilities = extractLatestSecFact(companyFacts, 'Liabilities');

  return {
    matchedTicker: bestTicker.ticker,
    cik: bestTicker.cik,
    matchedEntityName: bestTicker.title,
    entityName: submissions?.name || bestTicker.title,
    sic: submissions?.sic || null,
    sicDescription: submissions?.sicDescription || null,
    fiscalYearEnd: submissions?.fiscalYearEnd || null,
    filings: {
      last10KDate,
      last10QDate,
      recent8kCount,
    },
    facts: {
      revenue,
      netIncome,
      assets,
      liabilities,
    },
  };
}

async function fetchOpenCorporatesSignal(company) {
  if (!OPENCORPORATES_API_TOKEN) {
    return {
      unavailable: true,
      reason: 'Missing OPENCORPORATES_API_TOKEN',
    };
  }

  const query = encodeURIComponent(company);
  const search = await fetchJsonWithTimeout(
    `https://api.opencorporates.com/v0.4/companies/search?q=${query}&order=score&per_page=1&api_token=${encodeURIComponent(OPENCORPORATES_API_TOKEN)}`,
    9000,
  );
  const first = Array.isArray(search?.results?.companies) ? search.results.companies[0]?.company : null;
  if (!first?.jurisdiction_code || !first?.company_number) return null;

  const details = await fetchJsonWithTimeout(
    `https://api.opencorporates.com/v0.4/companies/${encodeURIComponent(first.jurisdiction_code)}/${encodeURIComponent(first.company_number)}?sparse=true&api_token=${encodeURIComponent(OPENCORPORATES_API_TOKEN)}`,
    9000,
  );

  const companyData = details?.results?.company || first;
  return {
    matchedName: companyData?.name || first?.name || null,
    jurisdictionCode: companyData?.jurisdiction_code || first?.jurisdiction_code || null,
    companyNumber: companyData?.company_number || first?.company_number || null,
    currentStatus: companyData?.current_status || null,
    inactive: typeof companyData?.inactive === 'boolean' ? companyData.inactive : null,
    incorporationDate: companyData?.incorporation_date || null,
    dissolutionDate: companyData?.dissolution_date || null,
    opencorporatesUrl: companyData?.opencorporates_url || first?.opencorporates_url || null,
    registryUrl: companyData?.registry_url || first?.registry_url || null,
    source: companyData?.source || null,
  };
}

function choosePreferredSymbol(company, yahooSignal, fmpSearchRows) {
  if (yahooSignal?.symbol) return yahooSignal.symbol;
  if (!Array.isArray(fmpSearchRows) || fmpSearchRows.length === 0) return null;

  const target = normalizeCompanyForMatch(company);
  let bestRow = null;
  let bestScore = -1;
  for (const row of fmpSearchRows) {
    const rowName = normalizeCompanyForMatch(row?.name || row?.companyName || '');
    let score = 0;
    if (rowName === target) score += 10;
    if (rowName.startsWith(target) || target.startsWith(rowName)) score += 5;
    if (String(row?.exchangeShortName || '').toUpperCase() === 'NASDAQ') score += 1;
    if (String(row?.exchangeShortName || '').toUpperCase() === 'NYSE') score += 1;
    if (score > bestScore) {
      bestRow = row;
      bestScore = score;
    }
  }

  return String(bestRow?.symbol || '').trim().toUpperCase() || null;
}

async function fetchFmpSignal(company, yahooSignal) {
  if (!FMP_API_KEY) {
    return {
      unavailable: true,
      reason: 'Missing FMP_API_KEY',
    };
  }

  const query = encodeURIComponent(company);
  const searchRows = await fetchJsonWithTimeout(
    `https://financialmodelingprep.com/api/v3/search?query=${query}&limit=8&apikey=${encodeURIComponent(FMP_API_KEY)}`,
    9000,
  );

  const symbol = choosePreferredSymbol(company, yahooSignal, Array.isArray(searchRows) ? searchRows : []);
  if (!symbol) return null;

  const [profileRows, scoreRows, ratioRows] = await Promise.all([
    fetchJsonWithTimeout(
      `https://financialmodelingprep.com/api/v3/profile/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(FMP_API_KEY)}`,
      9000,
    ),
    fetchJsonWithTimeout(
      `https://financialmodelingprep.com/api/v4/score?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(FMP_API_KEY)}`,
      9000,
    ),
    fetchJsonWithTimeout(
      `https://financialmodelingprep.com/api/v3/ratios-ttm/${encodeURIComponent(symbol)}?apikey=${encodeURIComponent(FMP_API_KEY)}`,
      9000,
    ),
  ]);

  const profile = Array.isArray(profileRows) ? profileRows[0] : null;
  const score = Array.isArray(scoreRows) ? scoreRows[0] : null;
  const ratios = Array.isArray(ratioRows) ? ratioRows[0] : null;

  return {
    symbol,
    companyName: profile?.companyName || null,
    marketCap: Number.isFinite(profile?.mktCap) ? profile.mktCap : null,
    employeeCount: Number.isFinite(profile?.fullTimeEmployees) ? profile.fullTimeEmployees : null,
    sector: profile?.sector || null,
    industry: profile?.industry || null,
    country: profile?.country || null,
    altmanZScore: Number.isFinite(score?.altmanZScore) ? score.altmanZScore : null,
    piotroskiScore: Number.isFinite(score?.piotroskiScore) ? score.piotroskiScore : null,
    currentRatioTTM: Number.isFinite(ratios?.currentRatioTTM) ? ratios.currentRatioTTM : null,
    debtToEquityTTM: Number.isFinite(ratios?.debtEquityRatioTTM) ? ratios.debtEquityRatioTTM : null,
    netProfitMarginTTM: Number.isFinite(ratios?.netProfitMarginTTM) ? ratios.netProfitMarginTTM : null,
  };
}

async function fetchGitHubSignal(company, clearbitSignal) {
  const candidates = [];
  const primarySlug = slugify(company);
  if (primarySlug) candidates.push(primarySlug);
  const domainName = String(clearbitSignal?.domain || '').split('.')[0];
  if (domainName) candidates.push(slugify(domainName));

  const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
  for (const candidate of uniqueCandidates) {
    const org = await fetchJsonWithTimeout(
      `https://api.github.com/orgs/${encodeURIComponent(candidate)}`,
      7000,
      {
        'User-Agent': 'job-finder-audit/1.0',
        Accept: 'application/vnd.github+json',
      },
    );
    if (!org || !org.login) continue;

    const repos = await fetchJsonWithTimeout(
      `https://api.github.com/orgs/${encodeURIComponent(candidate)}/repos?per_page=30&sort=updated`,
      7000,
      {
        'User-Agent': 'job-finder-audit/1.0',
        Accept: 'application/vnd.github+json',
      },
    );
    const totalStars = Array.isArray(repos)
      ? repos.reduce((sum, repo) => sum + (Number.isFinite(repo?.stargazers_count) ? repo.stargazers_count : 0), 0)
      : 0;

    return {
      org: org.login,
      followers: Number.isFinite(org.followers) ? org.followers : 0,
      publicRepos: Number.isFinite(org.public_repos) ? org.public_repos : 0,
      totalStars,
    };
  }

  return null;
}

async function fetchHackerNewsSignal(company) {
  const twoYearsAgo = Math.floor((Date.now() - 2 * 365 * 24 * 60 * 60 * 1000) / 1000);
  const query = encodeURIComponent(company);
  const data = await fetchJsonWithTimeout(
    `https://hn.algolia.com/api/v1/search?query=${query}&tags=story&numericFilters=created_at_i>${twoYearsAgo}&hitsPerPage=1`,
    6000,
  );
  const hits = Number.isFinite(data?.nbHits) ? data.nbHits : 0;
  return { mentions2y: hits };
}

async function fetchRedditSignal(company) {
  const query = encodeURIComponent(`"${company}"`);
  const data = await fetchJsonWithTimeout(
    `https://www.reddit.com/search.json?q=${query}&sort=relevance&t=year&limit=25&type=link`,
    8000,
    { 'User-Agent': AUDIT_USER_AGENT },
  );

  const posts = (Array.isArray(data?.data?.children) ? data.data.children : [])
    .map((c) => c?.data)
    .filter(Boolean);
  const totalEstimated = Number.isFinite(data?.data?.dist) ? data.data.dist : posts.length;

  const NEGATIVE_WORDS = ['layoff', 'layoffs', 'toxic', 'lawsuit', 'fraud', 'scam', 'avoid', 'warning', 'fired', 'hostile', 'terrible', 'worst', 'abusive', 'misleading'];
  const POSITIVE_WORDS = ['hiring', 'great culture', 'great place', 'love working', 'amazing team', 'benefits', 'good company', 'remote friendly', 'diverse'];

  let negativeMentions = 0;
  let positiveMentions = 0;
  const subredditSet = new Set();

  for (const post of posts) {
    const combined = `${post.title || ''} ${post.selftext || ''}`.toLowerCase();
    if (NEGATIVE_WORDS.some((w) => combined.includes(w))) negativeMentions += 1;
    if (POSITIVE_WORDS.some((w) => combined.includes(w))) positiveMentions += 1;
    if (post.subreddit) subredditSet.add(post.subreddit);
  }

  return {
    postsFound: totalEstimated,
    recentPosts: posts.length,
    topSubreddits: [...subredditSet].slice(0, 6),
    negativeMentions,
    positiveMentions,
    searchUrl: `https://www.reddit.com/search/?q=${encodeURIComponent(company)}&sort=relevance&t=year`,
  };
}

async function fetchPerplexitySignal(company) {
  if (!PERPLEXITY_API_KEY) {
    return { unavailable: true, reason: 'Missing PERPLEXITY_API_KEY' };
  }

  const data = await fetchPostJsonWithTimeout(
    'https://api.perplexity.ai/chat/completions',
    {
      model: 'llama-3.1-sonar-small-128k-online',
      messages: [
        {
          role: 'system',
          content: 'You are a company reputation research tool. Respond ONLY with valid JSON, no markdown or prose.',
        },
        {
          role: 'user',
          content: `Research "${company}" company reputation from online sources including Glassdoor, Reddit, and news. Return JSON with exactly these fields: reputationScore (integer 0-100), glassdoorRating (number or null), glassdoorReviews (integer or null), keyPositives (array of up to 3 brief strings), keyConcerns (array of up to 3 brief strings), employeeReviewSummary (string max 100 chars or null).`,
        },
      ],
      max_tokens: 500,
      temperature: 0.1,
    },
    20000,
    { Authorization: `Bearer ${PERPLEXITY_API_KEY}` },
  );

  const raw = String(data?.choices?.[0]?.message?.content || '');
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      reputationScore: Number.isFinite(Number(parsed?.reputationScore)) ? Math.round(Number(parsed.reputationScore)) : null,
      glassdoorRating: Number.isFinite(Number(parsed?.glassdoorRating)) ? Math.round(Number(parsed.glassdoorRating) * 10) / 10 : null,
      glassdoorReviews: Number.isFinite(Number(parsed?.glassdoorReviews)) ? Math.round(Number(parsed.glassdoorReviews)) : null,
      keyPositives: Array.isArray(parsed?.keyPositives) ? parsed.keyPositives.slice(0, 3).map(String) : [],
      keyConcerns: Array.isArray(parsed?.keyConcerns) ? parsed.keyConcerns.slice(0, 3).map(String) : [],
      employeeReviewSummary: typeof parsed?.employeeReviewSummary === 'string' ? parsed.employeeReviewSummary.slice(0, 150) : null,
    };
  } catch {
    return null;
  }
}

async function fetchWaybackMachineSignal(company) {
  // Website stability signal: check archive.org for website snapshots over time
  try {
    const domain = company.toLowerCase().replace(/\s+/g, '');
    const guessedDomain = `${domain}.com`;

    const archiveData = await fetchJsonWithTimeout(
      `https://archive.org/advancedsearch.php?output=json&q=url:${guessedDomain}&rows=100&fl=timestamp`,
      3000,
    ).catch(() => null);

    if (!archiveData?.response?.docs) {
      return null;
    }

    const snapshots = archiveData.response.docs || [];
    if (snapshots.length === 0) {
      return null;
    }

    const oldestSnapshot = snapshots[snapshots.length - 1]?.timestamp;
    const newestSnapshot = snapshots[0]?.timestamp;
    
    if (!oldestSnapshot) {
      return null;
    }

    const oldestDate = new Date(oldestSnapshot.slice(0, 4) + '-' + oldestSnapshot.slice(4, 6) + '-' + oldestSnapshot.slice(6, 8));
    const yearsSinceFirstArchive = (Date.now() - oldestDate.getTime()) / (365 * 24 * 60 * 60 * 1000);

    return {
      snapshotCount: snapshots.length,
      oldestSnapshotDate: oldestDate.toISOString().split('T')[0],
      newestSnapshotDate: newestSnapshot ? new Date(newestSnapshot.slice(0, 4) + '-' + newestSnapshot.slice(4, 6) + '-' + newestSnapshot.slice(6, 8)).toISOString().split('T')[0] : null,
      yearsSinceFirstArchive: Math.round(yearsSinceFirstArchive * 10) / 10,
      archiveUrl: `https://web.archive.org/web/*/${guessedDomain}`,
    };
  } catch {
    return null;
  }
}

async function fetchPatentSignal(company) {
  // Innovation signal: count patents filed by company
  try {
    const patentSearch = await fetchJsonWithTimeout(
      `https://api.patentsview.org/patents/select?q=assignee_name:"${encodeURIComponent(company)}"&f=["patent_number"]&rows=1&format=json`,
      3000,
    ).catch(() => null);

    const patentCount = patentSearch?.response?.numFound || 0;

    if (patentCount === 0) {
      return null;
    }

    return {
      patentsCount: patentCount,
      patentSearchUrl: `https://patents.google.com/?q=${encodeURIComponent(company)}`,
      patentsViewUrl: `https://www.patentsview.org/assignee/${encodeURIComponent(company)}`,
    };
  } catch {
    return null;
  }
}

async function fetchStackOverflowSignal(company) {
  // Tech adoption signal: Stack Overflow tag mentions
  try {
    const searchTerm = encodeURIComponent(company);

    const soData = await fetchJsonWithTimeout(
      `https://api.stackexchange.com/2.3/tags?inname=${searchTerm}&site=stackoverflow`,
      3000,
    ).catch(() => null);

    if (!soData?.items || soData.items.length === 0) {
      return null;
    }

    const mainTag = soData.items.find((tag) => tag.name.toLowerCase().includes(company.toLowerCase()));
    if (!mainTag) {
      return null;
    }

    return {
      tagName: mainTag.name,
      questionCount: mainTag.count,
      isModeratorTagOnly: mainTag.is_moderator_only || false,
      hasWiki: mainTag.has_synonyms === true,
      stackOverflowUrl: `https://stackoverflow.com/questions/tagged/${encodeURIComponent(mainTag.name)}`,
    };
  } catch {
    return null;
  }
}

async function fetchDomainReputationSignal(company) {
  // Domain legitimacy: domain age and DNS records
  try {
    const domain = company.toLowerCase().replace(/\s+/g, '') + '.com';

    // Try to get basic domain info from whois-api free endpoint
    const whoisData = await fetchJsonWithTimeout(
      `https://www.whoisxmlapi.com/api/gateway?apikey=at_liveApiDemo&domainName=${domain}&outputFormat=json`,
      3000,
    ).catch(() => null);

    if (!whoisData?.WhoisRecord) {
      return null;
    }

    const createdDate = whoisData.WhoisRecord.createdDate ? new Date(whoisData.WhoisRecord.createdDate) : null;
    const domainAgeYears = createdDate ? (Date.now() - createdDate.getTime()) / (365 * 24 * 60 * 60 * 1000) : null;

    return {
      domain,
      domainAgeYears: domainAgeYears ? Math.round(domainAgeYears * 10) / 10 : null,
      registrar: whoisData.WhoisRecord.registrar || null,
      hasPrivacyProtection: whoisData.WhoisRecord.privacy?.privacyProtected || false,
    };
  } catch {
    return null;
  }
}

async function fetchGoogleTrendsSignal(company) {
  // Search interest signal: simplified trends
  try {
    const searchTerm = encodeURIComponent(company);
    // Google Trends API is not public; using simplified approach
    return {
      trendUrl: `https://trends.google.com/trends/explore?q=${searchTerm}`,
      note: 'Google Trends search link provided; real-time data requires authentication',
    };
  } catch {
    return null;
  }
}

function buildAuditSourceLinks(company, signals) {
  const safeCompany = encodeURIComponent(String(company || '').trim());
  const links = [];

  links.push({
    key: 'clearbit',
    label: 'Clearbit Company Suggest',
    url: `https://autocomplete.clearbit.com/v1/companies/suggest?query=${safeCompany}`,
    available: Boolean(signals?.clearbit),
  });

  links.push({
    key: 'wikipedia',
    label: 'Wikipedia Summary',
    url: signals?.wikipedia?.title
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(String(signals.wikipedia.title || '').replace(/\s+/g, '_'))}`
      : `https://en.wikipedia.org/wiki/Special:Search?search=${safeCompany}`,
    available: Boolean(signals?.wikipedia),
  });

  links.push({
    key: 'yahooFinance',
    label: 'Yahoo Finance',
    url: signals?.yahooFinance?.symbol
      ? `https://finance.yahoo.com/quote/${encodeURIComponent(signals.yahooFinance.symbol)}`
      : `https://finance.yahoo.com/lookup?s=${safeCompany}`,
    available: Boolean(signals?.yahooFinance),
  });

  links.push({
    key: 'sec',
    label: 'SEC EDGAR',
    url: signals?.sec?.cik
      ? `https://data.sec.gov/submissions/CIK${encodeURIComponent(String(signals.sec.cik))}.json`
      : 'https://www.sec.gov/search-filings',
    available: Boolean(signals?.sec && !signals?.sec?.unavailable),
  });

  links.push({
    key: 'fmp',
    label: 'FinancialModelingPrep',
    url: signals?.fmp?.symbol
      ? `https://financialmodelingprep.com/financial-summary/${encodeURIComponent(signals.fmp.symbol)}`
      : 'https://site.financialmodelingprep.com/developer/docs',
    available: Boolean(signals?.fmp && !signals?.fmp?.unavailable),
  });

  links.push({
    key: 'openCorporates',
    label: 'OpenCorporates',
    url: signals?.openCorporates?.opencorporatesUrl || `https://opencorporates.com/companies?q=${safeCompany}`,
    available: Boolean(signals?.openCorporates && !signals?.openCorporates?.unavailable),
  });

  links.push({
    key: 'github',
    label: 'GitHub Org',
    url: signals?.github?.org
      ? `https://github.com/${encodeURIComponent(signals.github.org)}`
      : `https://github.com/search?q=${safeCompany}&type=organizations`,
    available: Boolean(signals?.github),
  });

  links.push({
    key: 'hackerNews',
    label: 'Hacker News (Algolia)',
    url: `https://hn.algolia.com/?q=${safeCompany}`,
    available: Boolean(signals?.hackerNews),
  });

  links.push({
    key: 'reddit',
    label: 'Reddit Search',
    url: signals?.reddit?.searchUrl || `https://www.reddit.com/search/?q=${safeCompany}&sort=relevance&t=year`,
    available: Boolean(signals?.reddit && !signals.reddit.unavailable),
  });

  links.push({
    key: 'glassdoor',
    label: 'Glassdoor',
    url: `https://www.glassdoor.com/Search/results.htm?keyword=${safeCompany}`,
    available: Boolean(signals?.perplexity?.glassdoorRating),
  });

  links.push({
    key: 'trustpilot',
    label: 'Trustpilot Business Search',
    url: `https://www.trustpilot.com/search?query=${safeCompany}`,
    available: true,
  });

  links.push({
    key: 'waybackMachine',
    label: 'Wayback Machine Archives',
    url: signals?.waybackMachine?.archiveUrl || `https://web.archive.org/web/*/${safeCompany.toLowerCase().replace(/\s+/g, '')}.com`,
    available: Boolean(signals?.waybackMachine && signals.waybackMachine.snapshotCount > 0),
  });

  links.push({
    key: 'patents',
    label: 'Google Patents',
    url: signals?.patent?.patentSearchUrl || `https://patents.google.com/?q=${safeCompany}`,
    available: Boolean(signals?.patent && signals.patent.patentsCount > 0),
  });

  links.push({
    key: 'stackOverflow',
    label: 'Stack Overflow Tag',
    url: signals?.stackOverflow?.stackOverflowUrl || `https://stackoverflow.com/questions/tagged/${safeCompany.toLowerCase().replace(/\s+/g, '-')}`,
    available: Boolean(signals?.stackOverflow && signals.stackOverflow.questionCount > 0),
  });

  links.push({
    key: 'googleTrends',
    label: 'Google Trends',
    url: signals?.googleTrends?.trendUrl || `https://trends.google.com/trends/explore?q=${safeCompany}`,
    available: Boolean(signals?.googleTrends && signals.googleTrends.averageInterest > 0),
  });

  return links;
}

function scoreAuditSignals(signals) {
  const wiki = signals.wikipedia;
  const clearbit = signals.clearbit;
  const finance = signals.yahooFinance;
  const sec = signals.sec;
  const fmp = signals.fmp;
  const openCorporates = signals.openCorporates;
  const github = signals.github;
  const hn = signals.hackerNews;
  const reddit = signals.reddit;
  const perplexity = signals.perplexity;
  const wayback = signals.waybackMachine;
  const patent = signals.patent;
  const stackoverflow = signals.stackOverflow;
  const domain = signals.domainReputation;
  const trends = signals.googleTrends;

  const openCorporatesStatusBonus = openCorporates?.inactive === false
    ? 12
    : openCorporates?.inactive === true
      ? -10
      : 0;

  const companyQualityParts = {
    base: 32,
    clearbitDomain: clearbit?.domain ? 18 : 0,
    wikipediaDepth: wiki?.hasPage ? clampNumber(Math.round((wiki.extractLength || 0) / 120), 5, 25) : 0,
    githubOrgMaturity: github?.org ? clampNumber(Math.round(Math.log10((github.publicRepos || 0) + 1) * 14), 0, 16) : 0,
    openCorporatesStatus: openCorporatesStatusBonus,
    hackerNewsMentions: clampNumber(Math.round(Math.log10((hn?.mentions2y || 0) + 1) * 8), 0, 10),
  };
  let companyQuality = companyQualityParts.base
    + companyQualityParts.clearbitDomain
    + companyQualityParts.wikipediaDepth
    + companyQualityParts.githubOrgMaturity
    + companyQualityParts.openCorporatesStatus
    + companyQualityParts.hackerNewsMentions;
  companyQuality = clampNumber(companyQuality, 0, 100);

  const marketCap = Number.isFinite(finance?.marketCap)
    ? finance.marketCap
    : (Number.isFinite(fmp?.marketCap) ? fmp.marketCap : null);

  let financialHealthBase = 45;
  let financialHealthMarketCapBand = 'unknown';
  if (marketCap != null) {
    if (marketCap >= 50e9) {
      financialHealthBase = 88;
      financialHealthMarketCapBand = 'mega-cap (>= $50B)';
    } else if (marketCap >= 10e9) {
      financialHealthBase = 78;
      financialHealthMarketCapBand = 'large-cap (>= $10B)';
    } else if (marketCap >= 1e9) {
      financialHealthBase = 68;
      financialHealthMarketCapBand = 'mid-cap (>= $1B)';
    } else if (marketCap >= 3e8) {
      financialHealthBase = 58;
      financialHealthMarketCapBand = 'small-cap (>= $300M)';
    } else {
      financialHealthBase = 50;
      financialHealthMarketCapBand = 'micro-cap (< $300M)';
    }
  }

  const changePercent = Number.isFinite(finance?.changePercent) ? finance.changePercent : null;
  const financialHealthTrendAdj = Number.isFinite(changePercent)
    ? (changePercent >= 0 ? 4 : -4)
    : 0;

  const altmanAdj = Number.isFinite(fmp?.altmanZScore)
    ? clampNumber(Math.round((fmp.altmanZScore - 1.8) * 3), -8, 12)
    : 0;
  const piotroskiAdj = Number.isFinite(fmp?.piotroskiScore)
    ? clampNumber((fmp.piotroskiScore - 5) * 2, -8, 8)
    : 0;

  let secFilingFreshnessAdj = 0;
  const sec10kMs = sec?.filings?.last10KDate ? Date.parse(sec.filings.last10KDate) : NaN;
  if (Number.isFinite(sec10kMs)) {
    const daysSince10k = Math.round((Date.now() - sec10kMs) / (24 * 60 * 60 * 1000));
    if (daysSince10k <= 420) secFilingFreshnessAdj = 4;
    else if (daysSince10k <= 550) secFilingFreshnessAdj = 1;
    else secFilingFreshnessAdj = -4;
  }

  let financialHealth = financialHealthBase + financialHealthTrendAdj + altmanAdj + piotroskiAdj + secFilingFreshnessAdj;
  financialHealth = clampNumber(financialHealth, 0, 100);

  const productLegitimacyParts = {
    base: 26,
    clearbitDomain: clearbit?.domain ? 14 : 0,
    wikipediaPresence: wiki?.hasPage ? 14 : 0,
    secRegistrant: sec?.cik ? 12 : 0,
    openCorporatesRecord: openCorporates?.opencorporatesUrl ? 12 : 0,
    githubStars: github?.org ? clampNumber(Math.round(Math.log10((github.totalStars || 0) + 1) * 18), 6, 28) : 0,
    githubFollowers: github?.org ? clampNumber(Math.round(Math.log10((github.followers || 0) + 1) * 8), 0, 12) : 0,
    hackerNewsMentions: clampNumber(Math.round(Math.log10((hn?.mentions2y || 0) + 1) * 10), 0, 15),
    patents: patent?.patentsCount ? clampNumber(Math.round(Math.log10((patent.patentsCount || 0) + 1) * 12), 0, 16) : 0,
    stackOverflowPresence: stackoverflow?.questionCount ? clampNumber(Math.round(Math.log10((stackoverflow.questionCount || 0) + 1) * 8), 0, 12) : 0,
    domainReputation: (domain?.hasMXRecords ? 8 : 0) + (domain?.domainAgeYears && domain.domainAgeYears >= 3 ? 6 : 0),
    googleTrendsInterest: trends?.averageInterest ? clampNumber(Math.round((trends.averageInterest / 100) * 8), 0, 8) : 0,
    waybackArchiveAge: wayback?.yearsSinceFirstArchive ? clampNumber(Math.round((wayback.yearsSinceFirstArchive / 15) * 8), 0, 8) : 0,
  };
  let productLegitimacy = productLegitimacyParts.base
    + productLegitimacyParts.clearbitDomain
    + productLegitimacyParts.wikipediaPresence
    + productLegitimacyParts.secRegistrant
    + productLegitimacyParts.openCorporatesRecord
    + productLegitimacyParts.githubStars
    + productLegitimacyParts.githubFollowers
    + productLegitimacyParts.hackerNewsMentions
    + productLegitimacyParts.patents
    + productLegitimacyParts.stackOverflowPresence
    + productLegitimacyParts.domainReputation
    + productLegitimacyParts.googleTrendsInterest
    + productLegitimacyParts.waybackArchiveAge;
  productLegitimacy = clampNumber(productLegitimacy, 0, 100);

  // Culture quality: stability + legitimacy + internet sentiment signals.
  const redditSentimentAdj = (reddit && !reddit.unavailable && reddit.postsFound > 0)
    ? clampNumber((reddit.positiveMentions - reddit.negativeMentions) * 3, -12, 9)
    : 0;
  const perplexityReputationAdj = Number.isFinite(perplexity?.reputationScore)
    ? clampNumber(Math.round((perplexity.reputationScore - 50) * 0.22), -11, 11)
    : 0;
  const glassdoorRatingAdj = Number.isFinite(perplexity?.glassdoorRating)
    ? clampNumber(Math.round((perplexity.glassdoorRating - 3.5) * 6), -9, 9)
    : 0;

  const cultureParts = {
    base: 20,
    companyQuality: Math.round(0.4 * companyQuality),
    financialHealth: Math.round(0.25 * financialHealth),
    productLegitimacy: Math.round(0.2 * productLegitimacy),
    redditSentiment: redditSentimentAdj,
    perplexityReputation: perplexityReputationAdj,
    glassdoorRating: glassdoorRatingAdj,
  };
  let cultureQuality = cultureParts.base + cultureParts.companyQuality + cultureParts.financialHealth
    + cultureParts.productLegitimacy + cultureParts.redditSentiment
    + cultureParts.perplexityReputation + cultureParts.glassdoorRating;
  cultureQuality = clampNumber(cultureQuality, 0, 100);

  const overallWeights = {
    companyQuality: 0.15,
    financialHealth: 0.3,
    productLegitimacy: 0.3,
    cultureQuality: 0.25,
  };
  const overall = clampNumber(
    Math.round(
      overallWeights.companyQuality * companyQuality
      + overallWeights.financialHealth * financialHealth
      + overallWeights.productLegitimacy * productLegitimacy
      + overallWeights.cultureQuality * cultureQuality,
    ),
    0,
    100,
  );

  const sourceCoverage = [wiki, clearbit, finance, sec, fmp, openCorporates, github, hn, reddit, perplexity, wayback, patent, stackoverflow, domain, trends]
    .filter((source) => Boolean(source) && !Boolean(source?.unavailable))
    .length;
  const confidence = sourceCoverage >= 6 ? 'high' : sourceCoverage >= 3 ? 'medium' : 'low';

  return {
    overall,
    companyQuality,
    financialHealth,
    productLegitimacy,
    cultureQuality,
    confidence,
    sourceCoverage,
    scoreBreakdown: {
      overallWeights,
      cultureProxyWeights: {
        base: 20,
        companyQuality: 0.4,
        financialHealth: 0.25,
        productLegitimacy: 0.2,
      },
      notes: [
        'Overall = 0.15*companyQuality + 0.30*financialHealth + 0.30*productLegitimacy + 0.25*cultureQuality',
        'cultureQuality is a proxy derived from legitimacy and stability signals in this MVP',
      ],
      categoryDetails: {
        companyQuality: {
          total: companyQuality,
          parts: companyQualityParts,
          explanation: [
            `base ${companyQualityParts.base}`,
            `+ clearbit domain ${companyQualityParts.clearbitDomain}`,
            `+ wikipedia depth ${companyQualityParts.wikipediaDepth}`,
            `+ github org maturity ${companyQualityParts.githubOrgMaturity}`,
            `+ OpenCorporates status ${companyQualityParts.openCorporatesStatus}`,
            `+ hn mentions ${companyQualityParts.hackerNewsMentions}`,
          ],
        },
        financialHealth: {
          total: financialHealth,
          parts: {
            baseFromMarketCap: financialHealthBase,
            marketCapBand: financialHealthMarketCapBand,
            trendAdjustment: financialHealthTrendAdj,
            altmanAdjustment: altmanAdj,
            piotroskiAdjustment: piotroskiAdj,
            secFilingFreshnessAdjustment: secFilingFreshnessAdj,
            marketCap,
            changePercent,
            altmanZScore: Number.isFinite(fmp?.altmanZScore) ? fmp.altmanZScore : null,
            piotroskiScore: Number.isFinite(fmp?.piotroskiScore) ? fmp.piotroskiScore : null,
          },
          explanation: [
            `base from market-cap band (${financialHealthMarketCapBand}): ${financialHealthBase}`,
            `+ trend adjustment from latest price move: ${financialHealthTrendAdj}`,
            `+ Altman Z adjustment: ${altmanAdj}`,
            `+ Piotroski adjustment: ${piotroskiAdj}`,
            `+ SEC filing freshness adjustment: ${secFilingFreshnessAdj}`,
          ],
        },
        productLegitimacy: {
          total: productLegitimacy,
          parts: productLegitimacyParts,
          explanation: [
            `base ${productLegitimacyParts.base}`,
            `+ clearbit domain ${productLegitimacyParts.clearbitDomain}`,
            `+ wikipedia presence ${productLegitimacyParts.wikipediaPresence}`,
            `+ SEC registrant signal ${productLegitimacyParts.secRegistrant}`,
            `+ OpenCorporates record ${productLegitimacyParts.openCorporatesRecord}`,
            `+ github stars ${productLegitimacyParts.githubStars}`,
            `+ github followers ${productLegitimacyParts.githubFollowers}`,
            `+ hn mentions ${productLegitimacyParts.hackerNewsMentions}`,
            ...(patent?.patentsCount ? [`+ patents filed ${productLegitimacyParts.patents}`] : []),
            ...(stackoverflow?.questionCount ? [`+ stack overflow adoption ${productLegitimacyParts.stackOverflowPresence}`] : []),
            ...(domain?.hasMXRecords || domain?.domainAgeYears ? [`+ domain reputation (valid MX: ${domain?.hasMXRecords ? 'yes' : 'no'}, age: ${domain?.domainAgeYears || 'unknown'} years): ${productLegitimacyParts.domainReputation}`] : []),
            ...(trends?.averageInterest ? [`+ google trends interest ${productLegitimacyParts.googleTrendsInterest}`] : []),
            ...(wayback?.yearsSinceFirstArchive ? [`+ wayback archive history (${wayback.yearsSinceFirstArchive} years): ${productLegitimacyParts.waybackArchiveAge}`] : []),
          ],
        },
        cultureQuality: {
          total: cultureQuality,
          parts: cultureParts,
          explanation: [
            `base ${cultureParts.base}`,
            `+ 0.4*companyQuality => ${cultureParts.companyQuality}`,
            `+ 0.25*financialHealth => ${cultureParts.financialHealth}`,
            `+ 0.2*productLegitimacy => ${cultureParts.productLegitimacy}`,
            ...(reddit && !reddit.unavailable ? [`+ reddit sentiment (${reddit.positiveMentions}↑ ${reddit.negativeMentions}↓ from ${reddit.postsFound} posts): ${redditSentimentAdj}`] : []),
            ...(Number.isFinite(perplexity?.reputationScore) ? [`+ perplexity reputation score ${perplexity.reputationScore}/100: ${perplexityReputationAdj}`] : []),
            ...(Number.isFinite(perplexity?.glassdoorRating) ? [`+ glassdoor rating ${perplexity.glassdoorRating}/5: ${glassdoorRatingAdj}`] : []),
          ],
        },
      },
    },
  };
}

async function computeCompanyAudit(company) {
  const normalizedCompany = String(company || '').trim();
  const methodsUsed = [];

  // Track each provider call
  const trackSignal = async (name, fn) => {
    try {
      const result = await fn();
      methodsUsed.push({
        provider: name,
        endpoint: `/api/audit/source?provider=${name}&company=${encodeURIComponent(normalizedCompany)}`,
        success: result?.available !== false,
      });
      return result;
    } catch (err) {
      methodsUsed.push({
        provider: name,
        endpoint: `/api/audit/source?provider=${name}&company=${encodeURIComponent(normalizedCompany)}`,
        success: false,
        error: err.message,
      });
      return null;
    }
  };

  const clearbitSignal = await trackSignal('clearbit', () => fetchClearbitSignal(normalizedCompany));

  const [wikipediaSignal, yahooSignal, secSignal, openCorporatesSignal, hnSignal, redditSignal] = await Promise.all([
    trackSignal('wikipedia', () => fetchWikipediaSignal(normalizedCompany)),
    trackSignal('yahooFinance', () => fetchYahooFinanceSignal(normalizedCompany)),
    trackSignal('sec', () => fetchSecSignal(normalizedCompany)),
    trackSignal('openCorporates', () => fetchOpenCorporatesSignal(normalizedCompany)),
    trackSignal('hackerNews', () => fetchHackerNewsSignal(normalizedCompany)),
    trackSignal('reddit', () => fetchRedditSignal(normalizedCompany)),
  ]);

  const [fmpSignal, githubSignal, perplexitySignal] = await Promise.all([
    trackSignal('fmp', () => fetchFmpSignal(normalizedCompany, yahooSignal)),
    trackSignal('github', () => fetchGitHubSignal(normalizedCompany, clearbitSignal)),
    trackSignal('perplexity', () => fetchPerplexitySignal(normalizedCompany)),
  ]);

  const [waybackSignal, patentSignal, stackOverflowSignal, domainSignal, trendSignal] = await Promise.all([
    trackSignal('waybackMachine', () => fetchWaybackMachineSignal(normalizedCompany)),
    trackSignal('patent', () => fetchPatentSignal(normalizedCompany)),
    trackSignal('stackOverflow', () => fetchStackOverflowSignal(normalizedCompany)),
    trackSignal('domainReputation', () => fetchDomainReputationSignal(normalizedCompany)),
    trackSignal('googleTrends', () => fetchGoogleTrendsSignal(normalizedCompany)),
  ]);

  const signals = {
    clearbit: clearbitSignal,
    wikipedia: wikipediaSignal,
    yahooFinance: yahooSignal,
    sec: secSignal,
    openCorporates: openCorporatesSignal,
    fmp: fmpSignal,
    github: githubSignal,
    hackerNews: hnSignal,
    reddit: redditSignal,
    perplexity: perplexitySignal,
    waybackMachine: waybackSignal,
    patent: patentSignal,
    stackOverflow: stackOverflowSignal,
    domainReputation: domainSignal,
    googleTrends: trendSignal,
  };

  const scores = scoreAuditSignals(signals);
  return {
    company: normalizedCompany,
    ...scores,
    updatedAt: new Date().toISOString(),
    signals,
    methodsUsed,
    internetResearch: {
      reddit: redditSignal && !redditSignal.unavailable ? redditSignal : null,
      perplexity: perplexitySignal && !perplexitySignal.unavailable ? perplexitySignal : null,
    },
    sourceLinks: buildAuditSourceLinks(normalizedCompany, signals),
    notes: [
      'Audit uses 15+ public data sources: SEC EDGAR, OpenCorporates, Yahoo Finance, GitHub, Wikipedia, Hacker News, Reddit, Stack Overflow, Patents API, Wayback Machine, Domain Registration, Google Trends, Perplexity AI, and more.',
      'Product legitimacy now scores innovation (patents), tech adoption (Stack Overflow), domain reputation, search interest, and archival history.',
      'Culture score includes internet signals: Reddit sentiment, Perplexity AI research, and Glassdoor rating when available.',
      'Financial score is strongest for public companies; lower confidence for private firms.',
      'Note: Some data sources may return null if APIs are temporarily unavailable or rate-limited.',
    ],
  };
}

function isAuditFresh(entry) {
  if (!entry?.updatedAt) return false;
  const updatedAtMs = Date.parse(entry.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return false;
  return Date.now() - updatedAtMs <= COMPANY_AUDIT_TTL_MS;
}

function normalizeAuditEntry(entry, companyName) {
  if (!entry || typeof entry !== 'object') return entry;

  const signals = entry.signals && typeof entry.signals === 'object' ? entry.signals : {};
  const company = String(entry.company || companyName || '').trim();
  const methodsUsed = Array.isArray(entry.methodsUsed) ? entry.methodsUsed : [];
  const normalized = { ...entry, company, signals, methodsUsed };

  if (!Array.isArray(normalized.sourceLinks) || normalized.sourceLinks.length === 0) {
    normalized.sourceLinks = buildAuditSourceLinks(company, signals);
  }

  const computed = scoreAuditSignals(signals);

  if (!normalized.scoreBreakdown || typeof normalized.scoreBreakdown !== 'object') {
    normalized.scoreBreakdown = computed.scoreBreakdown;
  }

  if (!normalized.scoreBreakdown?.categoryDetails) {
    normalized.scoreBreakdown = {
      ...normalized.scoreBreakdown,
      categoryDetails: computed.scoreBreakdown?.categoryDetails,
    };
  }

  return normalized;
}

function getAuditScoreFromCache(company) {
  const key = normalizeCompanyKey(company);
  const cached = companyAuditCache[key];
  if (cached && Number.isFinite(cached.overall) && isAuditFresh(cached)) {
    return Math.round(cached.overall);
  }
  return 50;
}

async function getCompanyAudit(company, refresh = false) {
  const normalized = String(company || '').trim();
  const key = normalizeCompanyKey(normalized);
  if (!key) return null;

  const cached = companyAuditCache[key];
  if (!refresh && cached && isAuditFresh(cached)) {
    const normalizedCached = normalizeAuditEntry(cached, normalized);
    companyAuditCache[key] = normalizedCached;
    return normalizedCached;
  }

  const computed = normalizeAuditEntry(await computeCompanyAudit(normalized), normalized);
  companyAuditCache[key] = computed;
  saveCompanyAudits();
  return computed;
}

// Bookmarks and hidden jobs storage
function loadBookmarks() {
  try {
    if (fs.existsSync(BOOKMARKS_FILE)) {
      const data = fs.readFileSync(BOOKMARKS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[bookmarks] Error loading bookmarks:', err.message);
  }
  return { bookmarked: [], hidden: [], hiddenCompanies: [] };
}

function saveBookmarks(data) {
  try {
    fs.writeFileSync(BOOKMARKS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    console.log('[bookmarks] Saved bookmarks:', data.bookmarked.length, 'jobs,', data.hidden.length, 'hidden jobs,', data.hiddenCompanies.length, 'hidden companies');
  } catch (err) {
    console.error('[bookmarks] Error saving bookmarks:', err.message);
  }
}

function normalizeBookmarksData(data) {
  return normalizeBookmarksDataComponent(data);
}

function persistBookmarksData(nextData) {
  bookmarksData = normalizeBookmarksData(nextData);
  saveBookmarks(bookmarksData);
  return bookmarksData;
}

let bookmarksData = loadBookmarks();

function withCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST,DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Parse RSS 2.0 XML into plain objects. Handles CDATA and self-closing <link/>.
function parseRssItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[1];
    const title = (b.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/) || [])[1] || '';
    const linkRaw = (b.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '';
    const guidRaw = (b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/) || [])[1] || '';
    const link = linkRaw.trim() || guidRaw.trim();
    const pubDate = (b.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '';
    const description = (b.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/) || [])[1] || '';
    if (title.trim()) items.push({ title: title.trim(), link, pubDate: pubDate.trim(), description: description.trim() });
  }
  return items;
}

function normalizeJobType(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeJobField(value) {
  return String(value || '').trim().toLowerCase();
}

const END_PRODUCT_CATEGORY_DEFS = [
  {
    id: 'autonomous-vehicles',
    label: 'Driverless Cars / AV',
    patterns: [
      /\b(driverless|self-driving|autonomous vehicle|robotaxi|adas|av stack|vehicle autonomy|autonomy stack|autonomous driving)\b/i,
      /\b(autonomy|onboard autonomy|av behavior|trajectory planning|motion planning|prediction stack|planning stack|localization|hd map|mapping stack)\b/i,
      /\b(perception stack|computer vision for driving|sensor fusion|fleet autonomy|on-vehicle|vehicle platform|driver assistance|av simulation)\b/i,
      /\b(waymo|zoox|cruise|nuro|motional|xpeng|nio|aurora|plus\b|agtonomy|scout motors|joby|wisk)\b/i,
    ],
  },
  {
    id: 'virtual-power-plants',
    label: 'Virtual Power Plants',
    patterns: [
      /\b(virtual power plant|\bvpp\b|demand response|distributed energy resource|derms|grid edge|load flexibility|home energy orchestration)\b/i,
      /\b(behind the meter|aggregated load|flex load|demand-side|grid services|utility demand response|energy orchestration)\b/i,
      /\b(adms\/derms|der optimization|vpp operations|grid dispatch software)\b/i,
    ],
  },
  {
    id: 'battery-storage',
    label: 'Batteries / Energy Storage',
    patterns: [
      /\b(battery storage|energy storage|grid storage|battery management system|\bbms\b|lithium[- ]ion|cell manufacturing|battery pack)\b/i,
      /\b(electrolyte|anode|cathode|cell chemistry|battery materials|state of charge|cell balancing|storage systems)\b/i,
      /\b(quantumscape|form energy|redwood materials|ses\b|group14|northvolt)\b/i,
    ],
  },
  {
    id: 'building-design-cad',
    label: 'Building CAD / Optimization',
    patterns: [
      /\b(cad software|building optimization|building energy modeling|building simulation|hvac design|revit|autocad|bim|aec|building performance)\b/i,
      /\b(energy model|energy simulation|building analytics|design automation|architectural software|construction tech|site design)\b/i,
      /\b(aurora solar|nextracker|autodesk|bentley systems|trimble)\b/i,
    ],
  },
  {
    id: 'advanced-manufacturing',
    label: '3D Fabrication / Manufacturing',
    patterns: [
      /\b(3d fabrication|3d printing|additive manufacturing|digital fabrication|fabrication software|cnc|manufacturing automation|robotic manufacturing)\b/i,
      /\b(factory automation|process automation|manufacturing systems|industrial controls|plc|mes systems|production line)\b/i,
      /\b(scout motors|tesla|rivian|lucid|gigafactory)\b/i,
    ],
  },
  {
    id: 'grid-software',
    label: 'Grid Software',
    patterns: [
      /\b(power systems|grid software|transmission planning|distribution planning|substation|utility software|power flow|load forecasting|grid operations)\b/i,
      /\b(grid analytics|interconnection|scada|outage management|utility operations|ev charging network|charger management|evse)\b/i,
      /\b(weavegrid|gridware|gridmatic|hitachi energy|charge point|chargepoint|terawatt infrastructure|span\b|nrel|national renewable energy laboratory|inspire clean energy|mainspring energy)\b/i,
    ],
  },
  {
    id: 'robotics-drones',
    label: 'Robotics / Drones',
    patterns: [
      /\b(robotics|robotic systems|warehouse robotics|industrial robot|drone platform|\buav\b|autonomous robot|field robot)\b/i,
      /\b(drone|flight software|avionics|autopilot|ground control|airframe|air mobility|aerial robotics|robot perception)\b/i,
      /\b(zipline|saildrone|pyka|muon space|planet\b|epirus|joby|wisk)\b/i,
    ],
  },
  {
    id: 'carbon-software',
    label: 'Carbon Accounting / MRV',
    patterns: [
      /\b(carb(?:on)? accounting|carbon management|emissions reporting|carbon market|carbon offset|mrv\b|life cycle assessment|lca software|ghg inventory)\b/i,
      /\b(scope 1|scope 2|scope 3|decarbonization platform|sustainability reporting|climate reporting|carbon removal)\b/i,
      /\b(watershed|pachama|sylvera|carbonchain|lithos carbon)\b/i,
    ],
  },
  {
    id: 'mobility-platforms',
    label: 'Mobility / Transportation Platforms',
    patterns: [
      /\b(mobility platform|transportation platform|ride share|rider app|fleet platform|transit software|logistics platform|dispatch system)\b/i,
      /\b(micro[- ]?mobility|scooter|bike share|last mile|fleet operations|vehicle operations|telematics|route optimization)\b/i,
      /\b(lime|spin\b|bird\b|via transporation|via transportation|may mobility)\b/i,
    ],
  },
  {
    id: 'climate-intelligence',
    label: 'Climate Data / Forecasting',
    patterns: [
      /\b(climate intelligence|climate risk|weather intelligence|weather platform|forecasting platform|earth observation|remote sensing|satellite analytics)\b/i,
      /\b(geospatial|wildfire detection|methane monitoring|carbon intelligence|crop intelligence|weather modeling|atmospheric modeling)\b/i,
      /\b(tomorrow\.io|overstory|cervest|aidash|pano ai|regrow|methanesat)\b/i,
    ],
  },
  {
    id: 'enterprise-ai-software',
    label: 'Enterprise AI / Software Platforms',
    patterns: [
      /\b(ai platform|agentic|llm platform|ai\/ml platform|data platform|developer platform|enterprise software|saas platform|workflow automation)\b/i,
      /\b(devops platform|cloud platform|security platform|payments platform|identity platform|productivity platform|analytics platform|observability)\b/i,
      /\b(datadog|anthropic|chime|apollo|workiva|ixl learning)\b/i,
    ],
  },
  {
    id: 'software-infrastructure-platforms',
    label: 'Core Software / Infrastructure',
    patterns: [
      /\b(data platform|backend platform|frontend platform|full[- ]?stack platform|developer platform|infrastructure platform|platform engineering)\b/i,
      /\b(devops|site reliability|sre\b|cloud infrastructure|kubernetes|distributed systems|internal tools|observability platform|api platform)\b/i,
      /\b(application platform|enterprise platform|security engineering platform|runtime platform|compute platform|storage platform)\b/i,
    ],
  },
  {
    id: 'health-biotech-platforms',
    label: 'Health / Biotech Platforms',
    patterns: [
      /\b(healthtech|digital health|clinical platform|medical platform|biotech platform|genomics platform|diagnostics software|life sciences software)\b/i,
      /\b(patient|provider|care delivery|clinical workflow|medical imaging|bioinformatics|therapeutics platform)\b/i,
      /\b(10x genomics|vaxcyte|prenuvo|heartflow|suki|doximity|eurofins)\b/i,
    ],
  },
  {
    id: 'mental-health-tech',
    label: 'Mental Health Tech',
    patterns: [
      /\b(mental health|behavioral health|therapy platform|teletherapy|digital therapeutics|care navigation|wellbeing platform)\b/i,
      /\b(psychiatry|psychology|therapist|counseling|depression|anxiety|substance use treatment)\b/i,
      /\b(springhealth|lyra health|modern health|talkspace|betterhelp|cerebral|headspace)\b/i,
    ],
  },
  {
    id: 'edtech-learning-platforms',
    label: 'EdTech / Learning Platforms',
    patterns: [
      /\b(edtech|learning platform|education platform|classroom software|student platform|assessment platform|curriculum platform)\b/i,
      /\b(k-12|higher education|teacher tools|instructional software|adaptive learning|school operations)\b/i,
      /\b(ixl learning|duolingo|coursera|udemy|classdojo|brightwheel|chegg|2u\b)\b/i,
    ],
  },
  {
    id: 'agri-food-systems',
    label: 'Agri / Food Systems',
    patterns: [
      /\b(agtech|agri[- ]?tech|precision agriculture|food supply|food system|crop intelligence|farm operations|farm automation|agriculture software)\b/i,
      /\b(food waste|sustainable food|soil carbon|regenerative agriculture|farm robotics|digital agronomy)\b/i,
      /\b(indigo\b|afresh|regrow ag|terramera|blue river technologies)\b/i,
    ],
  },
  {
    id: 'energy-marketplaces-finance',
    label: 'Energy Markets / Finance',
    patterns: [
      /\b(energy marketplace|energy trading|power markets|grid markets|retail energy|demand bidding|wholesale power|energy procurement)\b/i,
      /\b(clean energy financing|solar financing|project finance platform|energy insights platform|utility billing|demand economics)\b/i,
      /\b(goodleap|levelten energy|arcadia|energy solutions|sympower|workiva)\b/i,
    ],
  },
];

const END_PRODUCT_COMPANY_PRIORS = [
  { re: /\b(waymo|zoox|cruise|nuro|motional|xpeng|nio|plus\b|agtonomy|aurora\b|scout motors|joby|wisk)\b/i, category: 'autonomous-vehicles' },
  { re: /\b(zipline|saildrone|pyka|muon space|planet\b|epirus|skydio|anduril)\b/i, category: 'robotics-drones' },
  { re: /\b(weavegrid|gridware|gridmatic|hitachi energy|charge ?point|terawatt infrastructure|span\b|nextracker|inspire clean energy|nrel|national renewable energy laboratory|mainspring energy|electric power engineers|nextera energy|renew home|arcadia|sympower|volta charging|fluence|energyhub|ge vernova|enphase)\b/i, category: 'grid-software' },
  { re: /\b(quantumscape|form energy|redwood materials|group14|ses\b|northvolt|sila nanotechnologies|electric hydrogen|antora energy|radiant|commonwealth fusion systems|cfs)\b/i, category: 'battery-storage' },
  { re: /\b(watershed|pachama|sylvera|carbonchain|lithos carbon|regrow|cervest|aidash|catona climate|overstory|pano ai|methanesat)\b/i, category: 'carbon-software' },
  { re: /\b(aurora solar|autodesk|bentley systems|trimble)\b/i, category: 'building-design-cad' },
  { re: /\b(lime|spin\b|bird\b|via transporation|via transportation|may mobility)\b/i, category: 'mobility-platforms' },
  { re: /\b(tomorrow\.io|esri|planet\b|muon space|overstory|aidash|cervest)\b/i, category: 'climate-intelligence' },
  { re: /\b(datadog|anthropic|chime|apollo|workiva|ixl learning|govini|goodleap|afresh technologies|indigo)\b/i, category: 'enterprise-ai-software' },
  { re: /\b(10x genomics|vaxcyte|prenuvo|heartflow|suki|doximity|eurofins)\b/i, category: 'health-biotech-platforms' },
  { re: /\b(springhealth|lyra health|modern health|talkspace|betterhelp|cerebral|headspace)\b/i, category: 'mental-health-tech' },
  { re: /\b(ixl learning|duolingo|coursera|udemy|classdojo|brightwheel|chegg|2u\b)\b/i, category: 'edtech-learning-platforms' },
  { re: /\b(indigo\b|afresh|regrow ag|terramera|blue river technologies)\b/i, category: 'agri-food-systems' },
  { re: /\b(goodleap|levelten energy|arcadia|energy solutions|sympower)\b/i, category: 'energy-marketplaces-finance' },
  { re: /\b(conduit tech|apollo|govini|anthropic|datadog)\b/i, category: 'software-infrastructure-platforms' },
];

function buildEndProductCorpus(job) {
  return [
    job.title,
    job.company,
    job.description,
    ...toArray(job.locations),
    ...toArray(job.jobTypes),
    ...toArray(job.sectors),
    ...toArray(job.industries),
    ...toArray(job.categories),
    ...toArray(job.subCategories),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function buildCompanyLookupContext(companyName) {
  const companyKey = normalizeCompanyKey(companyName);
  const auditEntry = companyAuditCache[companyKey];
  const signals = auditEntry?.signals && typeof auditEntry.signals === 'object'
    ? auditEntry.signals
    : null;
  if (!signals) return '';

  const clearbit = signals.clearbit || null;
  const wikipedia = signals.wikipedia || null;
  const github = signals.github || null;
  const domain = signals.domainReputation || null;

  return [
    clearbit?.name,
    clearbit?.domain,
    clearbit?.type,
    wikipedia?.title,
    wikipedia?.description,
    github?.name,
    github?.description,
    domain?.domain,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

const RESUME_MATCH_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by',
  'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or',
  'that', 'the', 'their', 'them', 'they', 'this', 'to', 'was', 'were', 'with',
]);
function canonicalCompanyName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function classifyEndProductFromCompanyContext(company, corpus, fieldHint = '', lookupContext = '') {
  const companyName = String(company || '');
  for (const prior of END_PRODUCT_COMPANY_PRIORS) {
    if (prior.re.test(companyName)) return prior.category;
  }

  if (!corpus) return 'software-infrastructure-platforms';

  let bestCategory = 'other';
  let bestScore = 0;
  let secondBestScore = 0;
  const combinedLookup = String(lookupContext || '').toLowerCase();

  for (const category of END_PRODUCT_CATEGORY_DEFS) {
    let score = 0;
    for (const pattern of category.patterns) {
      if (pattern.test(corpus)) score += 1;
      if (pattern.test(companyName)) score += 1.35;
      if (combinedLookup && pattern.test(combinedLookup)) score += 1.15;
    }
    if (score > bestScore) {
      secondBestScore = bestScore;
      bestScore = score;
      bestCategory = category.id;
    } else if (score > secondBestScore) {
      secondBestScore = score;
    }
  }

  const scoreGap = bestScore - secondBestScore;
  const isLowConfidence = bestScore < 1.15 || scoreGap < 0.45;

  // Field fallback to reduce uncategorized jobs when product signals are sparse.
  const field = normalizeJobField(fieldHint || '');
  if (isLowConfidence && field === 'mentalhealth') {
    return 'mental-health-tech';
  }
  if (isLowConfidence && (field === 'medical' || field === 'globalhealth')) {
    return 'health-biotech-platforms';
  }
  if (isLowConfidence && field === 'edtech') {
    return 'edtech-learning-platforms';
  }
  if (isLowConfidence && field === 'agtech') {
    return 'agri-food-systems';
  }

  // Last-resort mapping: keep jobs out of "other" with a stable platform bucket.
  if (bestCategory === 'other') {
    if (/\b(health|clinical|biotech|genomics|medical|patient|provider)\b/i.test(corpus)) {
      return 'health-biotech-platforms';
    }
    if (/\b(mental|therapy|behavioral|psychiatry|counseling)\b/i.test(corpus)) {
      return 'mental-health-tech';
    }
    if (/\b(learning|education|student|teacher|school|classroom)\b/i.test(corpus)) {
      return 'edtech-learning-platforms';
    }
    if (/\b(platform|backend|frontend|full[- ]?stack|devops|cloud|security|api|data|machine learning|software engineer|site reliability|sre\b)\b/i.test(corpus)) {
      return 'software-infrastructure-platforms';
    }
    return 'software-infrastructure-platforms';
  }

  return bestCategory;
}

function buildCompanyEndProductMap(jobs) {
  const companyCorpus = new Map();
  const companyFields = new Map();
  const companyDisplayName = new Map();
  const companyLookupContext = new Map();

  for (const job of jobs) {
    const companyKey = canonicalCompanyName(job?.company);
    if (!companyKey) continue;
    if (!companyDisplayName.has(companyKey)) {
      companyDisplayName.set(companyKey, String(job?.company || companyKey));
      companyLookupContext.set(companyKey, buildCompanyLookupContext(job?.company || companyKey));
    }

    const corpusPart = buildEndProductCorpus(job);
    if (corpusPart) {
      companyCorpus.set(companyKey, `${companyCorpus.get(companyKey) || ''} ${corpusPart}`.trim());
    }

    const field = normalizeJobField(job?.jobField || '');
    if (field) {
      const fieldCounts = companyFields.get(companyKey) || new Map();
      fieldCounts.set(field, (fieldCounts.get(field) || 0) + 1);
      companyFields.set(companyKey, fieldCounts);
    }
  }

  const companyCategoryMap = new Map();
  for (const [companyKey, corpus] of companyCorpus.entries()) {
    const fieldCounts = companyFields.get(companyKey) || new Map();
    let dominantField = '';
    let dominantCount = 0;
    for (const [field, count] of fieldCounts.entries()) {
      if (count > dominantCount) {
        dominantField = field;
        dominantCount = count;
      }
    }
    const displayName = companyDisplayName.get(companyKey) || companyKey;
    const lookupContext = companyLookupContext.get(companyKey) || '';
    companyCategoryMap.set(
      companyKey,
      classifyEndProductFromCompanyContext(displayName, corpus, dominantField, lookupContext),
    );
  }

  return companyCategoryMap;
}

function applyCompanyEndProductCategories(jobs, sourceJobs = jobs) {
  const companyCategoryMap = buildCompanyEndProductMap(sourceJobs || jobs);
  return jobs.map((job) => {
    const companyKey = canonicalCompanyName(job?.company);
    const companyCategory = companyKey ? companyCategoryMap.get(companyKey) : null;
    return {
      ...job,
      endProductCategory: companyCategory || classifyEndProduct(job),
    };
  });
}

function getCompanyCategorizedJobsCached(jobs) {
  const datasetKey = getJobsDatasetKey(jobs);
  if (companyEndProductCache.datasetKey === datasetKey && companyEndProductCache.jobs.length === jobs.length) {
    return companyEndProductCache.jobs;
  }

  const categorizedJobs = applyCompanyEndProductCategories(jobs, jobs);
  companyEndProductCache = {
    datasetKey,
    jobs: categorizedJobs,
  };
  return categorizedJobs;
}

function getJobLookupByIdCached(jobs) {
  const datasetKey = getJobsDatasetKey(jobs);
  if (jobLookupCache.datasetKey === datasetKey && jobLookupCache.byId.size === jobs.length) {
    return jobLookupCache.byId;
  }

  const byId = new Map();
  for (const job of jobs) {
    if (!job || !job.id) continue;
    byId.set(job.id, job);
  }
  jobLookupCache = {
    datasetKey,
    byId,
  };
  return byId;
}

function classifyEndProduct(job) {
  const company = String(job?.company || '');
  const corpus = buildEndProductCorpus(job);
  const field = normalizeJobField(job?.jobField || '');
  const lookupContext = buildCompanyLookupContext(company);
  return classifyEndProductFromCompanyContext(company, corpus, field, lookupContext);
}

function getJobCacheKey(job) {
  return String(job?.id || `${job?.company || ''}|${job?.title || ''}|${job?.url || ''}`);
}

function getResumeComparisonAlgorithmKey(rankingMode, queryText) {
  return `${String(rankingMode || 'classic').trim().toLowerCase()}|${String(queryText || '').trim().toLowerCase()}`;
}

function getResumeScoreCached(job, datasetKey, rankingMode, queryText, resumeProfile, resumeId) {
  const algorithmKey = getResumeComparisonAlgorithmKey(rankingMode, queryText);
  const cacheKey = `${datasetKey}|${resumeId}|${getJobCacheKey(job)}|${algorithmKey}`;
  const cached = derivedScoreCache.resume.get(cacheKey);
  if (cached && cached.resumeKeywordBreakdown) return cached;

  const computed = scoreJobAgainstResume(job, rankingMode, queryText, resumeProfile || RESUME_PROFILES[resumeId]);
  derivedScoreCache.resume.set(cacheKey, computed);
  trimMapCache(derivedScoreCache.resume);
  return computed;
}

function getImpactScoreCached(job, datasetKey, impactMode) {
  const cacheKey = `${datasetKey}|${impactMode}|${getJobCacheKey(job)}`;
  const cached = derivedScoreCache.impact.get(cacheKey);
  if (cached && cached.impactKeywordBreakdown) return cached;

  const computed = scoreImpact(job, impactMode);
  derivedScoreCache.impact.set(cacheKey, computed);
  trimMapCache(derivedScoreCache.impact);
  return computed;
}

function getAuditScoreCached(company, datasetKey) {
  const companyKey = normalizeCompanyKey(company);
  const entry = companyAuditCache[companyKey];
  const version = (entry && isAuditFresh(entry) && entry.updatedAt)
    ? String(entry.updatedAt)
    : 'stale';
  const cacheKey = `${datasetKey}|${companyKey}|${version}`;
  const cached = derivedScoreCache.audit.get(cacheKey);
  if (Number.isFinite(cached)) return cached;

  const computed = getAuditScoreFromCache(company);
  derivedScoreCache.audit.set(cacheKey, computed);
  trimMapCache(derivedScoreCache.audit);
  return computed;
}

function normalizeEndProductCategory(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'all') return 'all';
  if (END_PRODUCT_CATEGORY_DEFS.some((category) => category.id === normalized)) return normalized;
  if (normalized === 'other') return 'other';
  return 'all';
}

function hydrateEndProductCategory(job) {
  const endProductCategory = normalizeEndProductCategory(job?.endProductCategory);
  // Reclassify stale "other" labels from file cache with latest rules.
  if (endProductCategory !== 'all' && endProductCategory !== 'other') {
    return { ...job, endProductCategory };
  }
  return { ...job, endProductCategory: classifyEndProduct(job) };
}

// ─── Company Size Classification ────────────────────────────────────────────
// Tiers: startup (<50), small (50-200), medium (200-1000), large (1000-10000), very-large (10000+)
const COMPANY_SIZE_VERY_LARGE_RE = /\b(google|alphabet|amazon|microsoft|apple|meta\b|facebook|ibm|oracle|salesforce|sap|intel|qualcomm|cisco|dell|hp\b|hewlett|accenture|deloitte|mckinsey|boeing|siemens|lg\b|samsung|sony|tata\b|infosys|wipro|cognizant|capgemini|ericsson|nokia|snap\b|netflix|paypal|ebay|uber\b|lyft|airbnb|twitter\b|linkedin|adobe|autodesk|intuit|workday|servicenow|atlassian|shopify|stripe\b|square\b|block\b|twilio|okta\b|zendesk|hubspot|splunk|elastic\b|mongodb|snowflake|databricks|palantir|leidos|lockheed|raytheon|northrop|general\s*electric|ge\b|ford\b|gm\b|general\s*motors|toyota|volkswagen|shell\b|bp\b|chevron|exxon|totalenergies|engie|iberdrola|nextera|duke\s*energy|dominion\s*energy|constellation\b|brookfield|blackrock|vanguard|jpmorgan|bank\s*of\s*america|wells\s*fargo|goldman\s*sachs|morgan\s*stanley|reuters|bloomberg)\b/i;

const COMPANY_SIZE_LARGE_RE = /\b(waymo|cruise\b|rivian|lucid\b|nikola\b|sunnova|sunrun|sunpower|first\s*solar|vivint|tesla\b|nio\b|xpeng|polestar|avid\b|avid\s*technology|sofi\b|doximity|veeva|coursera|duolingo|kahoot|chegg|2u\b|udemy|robinhood|coinbase|openai\b|anthropic\b|inflection|cohere\b|mistral\b|stability|midjourney|scale\s*ai|anduril|c3\.ai|c3ai|datarobot|samsara|fleet\s*complete|trimble|bentley\s*systems|autodesk|plaid|brex|ramp\b|gusto\b|rippling|lattice\b|greenhouse\b|lever\b|ashby\b|workato|mulesoft|boomi|zapier|klaviyo|sendgrid|twilio|vonage|8x8|ringcentral|zendesk|freshworks|intercom|drift\b|gainsight|amplitude|mixpanel|segment\b|heap\b|pendo|braze\b|iterable|sendbird|agora\b|daily\.co|zoom\b|webex|slack\b|notion\b|airtable|asana\b|monday\.com|clickup|smartsheet|basecamp|figma\b|canva\b|invision|miro\b|lucidchart|datadog|new\s*relic|dynatrace|grafana|splunk|sumo\s*logic|elastic\b|mongodb\b|redis\b|couchbase|neo4j|cassandra|cockroachdb|planetscale|neon\b|supabase|hasura|auth0\b|okta\b|ping\s*identity|forgerock|sailpoint|cyberark|crowdstrike|sentinelone|palo\s*alto\s*networks|fortinet|checkpoint|tenable|qualys|rapid7|darktrace|vectra\b|lacework|orca\s*security|wiz\b|snyk\b|veracode|sonatype|checkmarx|hashicorp|pulumi|terraform|ansible|puppet\b|chef\b|redhat|canonical\b|ubuntu|suse\b|cloudera|hortonworks|pivotal\b|vmware|nutanix|pure\s*storage|netapp|commvault|veeam|zerto|rubrik|cohesity|druva|clumio|coreweave|lambda\s*labs|together\s*ai|fireworks\b|anyscale|ray\b|determined|weights\s*&\s*biases|wandb|mlflow|metaflow|kubeflow|vertex\s*ai|sagemaker|azureml)\b/i;

const COMPANY_SIZE_MEDIUM_RE = /\b(watershed\b|helion\b|form\s*energy|twelve\b|brimstone\b|span\b|sweep\b|leap\b|agreena|sylvera|insitro|owkin|abridge\b|dandy\b|notable\b|corti\b|fathom\b|medely\b|hinge\s*health|brightwheel|classdojo|springhealth|lyra\s*health|cerebral\b|modern\s*health|talkspace|betterhelp|daylight\b|lifestance|sword\s*health|alma\b|arc\b|brex\b|scale\b|hugging\s*face|perplexity|character\b|adept\b|together\b|mosaic\b|lighton|nomic\b|runway\b|synthesia|pika\b|luma\b|elevenlabs|hedra\b|suno\b|udio\b|ideogram|adobe\s*firefly|openart|lexica|civitai|getimg|nightcafe|dreamstudio|replicate|fal\b|baseten|modal\b|beam\b|mystic\b|qoddi|lepton|salad\b|vast\.ai|runpod|paperspace|coreweave|sfcompute|hotaisle|voltage\s*park|tensordock|aws\b|gcp\b|azure\b|climatebase|terra\b|eightyk|kaya\b|ideo\b)\b/i;

function classifyCompanySize(companyName) {
  const name = String(companyName || '').toLowerCase();
  if (COMPANY_SIZE_VERY_LARGE_RE.test(name)) return 'very-large';
  if (COMPANY_SIZE_LARGE_RE.test(name)) return 'large';
  if (COMPANY_SIZE_MEDIUM_RE.test(name)) return 'medium';
  // Default heuristics: companies with known-small signals
  if (/\b(labs|ventures|studio|garden|collective|cooperative|foundation|institute|alliance|initiative|fund\b|trust\b|circle\b)\b/.test(name)) return 'startup';
  return 'small';
}

function normalizeCompanySize(value) {
  const v = String(value || '').trim().toLowerCase();
  if (['very-large', 'large', 'medium', 'small', 'startup'].includes(v)) return v;
  return 'small';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeJob(job) {
  const title = job.title || 'Untitled role';
  const company = job.employer_name || job.name_of_employer || 'Unknown company';
  const locations = toArray(job.locations).filter(Boolean);
  const remotePreferences = toArray(job.remote_preferences).filter(Boolean);
  const jobTypes = toArray(job.job_types).filter(Boolean);
  const sectors = toArray(job.sectors).filter(Boolean);
  const industries = toArray(job.industries).filter(Boolean);
  const categories = toArray(job.categories).filter(Boolean);
  const subCategories = toArray(job.sub_categories).filter(Boolean);
  const experienceLevels = toArray(job.experience_levels).filter(Boolean);
  const description = decodeHtmlEntities(String(job.description || ''));

  return hydrateEndProductCategory({
    id: String(job.id || ''),
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: job.activation_date || null,
    logo: job.logo || job.employer_logo || null,
    url: `https://climatebase.org/job/${job.id}/${slugify(title)}`,
    source: 'climatebase',
    jobField: 'climate',
    companySize: classifyCompanySize(company),
    description,
    sectors,
    industries,
    categories,
    subCategories,
    experienceLevels,
  });
}

// ─── ATS Company Lists ─────────────────────────────────────────────────────
// [slug, display name] pairs discovered by probing the public Greenhouse/Lever APIs
const GREENHOUSE_COMPANIES = [
  ['spacex', 'SpaceX'], ['gotion', 'Gotion'], ['nuro', 'Nuro'], ['gropyus', 'Gropyus'],
  ['oklo', 'Oklo'], ['nexamp', 'Nexamp'], ['bird', 'Bird'], ['navvis', 'Navvis'],
  ['cellink', 'CelLink'], ['kaluza', 'Kaluza'], ['epirus', 'Epirus'],
  ['panthalassa', 'Panthalassa'], ['energyhub', 'EnergyHub'], ['refurbed', 'refurbed'],
  ['spin', 'Spin'], ['glydways', 'Glydways'], ['overstory', 'Overstory'], ['ohme', 'Ohme'],
  ['tomorrow', 'Tomorrow'], ['mill', 'Mill'], ['beewise', 'Beewise'],
  ['smartrent', 'SmartRent'], ['beam', 'Beam'], ['fernride', 'Fernride'],
  ['carbonchain', 'CarbonChain'], ['albedo', 'Albedo'], ['watershed', 'Watershed'],
  ['future', 'Future'], ['patch', 'Patch'], ['runwise', 'Runwise'], ['baton', 'Baton'],
  ['acumen', 'Acumen'], ['group14', 'Group14'], ['phaidra', 'Phaidra'],
  ['coefficient', 'Coefficient'], ['orbisk', 'Orbisk'], ['outrider', 'Outrider'],
  ['quilt', 'Quilt'], ['kettle', 'Kettle'], ['ses', 'SES'], ['archer', 'Archer'],
  ['eridan', 'Eridan'], ['amperon', 'Amperon'], ['tempo', 'Tempo'],
  ['carbonfuture', 'Carbonfuture'], ['sunnova', 'Sunnova'], ['supernal', 'Supernal'],
  ['climateai', 'ClimateAi'], ['konux', 'KONUX'], ['cloverly', 'Cloverly'],
  ['indigo', 'Indigo Ag'], ['reach', 'Reach'], ['sesamm', 'SESAMm'], ['visia', 'Visia'],
  ['samsara', 'Samsara'], ['chargepoint', 'ChargePoint'], ['lucidmotors', 'Lucid Motors'],
  ['spire', 'Spire Global'], ['momentus', 'Momentus'], ['carbondirect', 'Carbon Direct'],
  // New additions
  ['redwoodmaterials', 'Redwood Materials'], ['antora', 'Antora Energy'],
  ['array', 'Array Technologies'], ['rondoenergy', 'Rondo Energy'],
  ['kodiak', 'Kodiak Robotics'],
  // Electrification — EV / charging / battery
  ['solidpower', 'Solid Power'],
  // Electrification — smart home / home efficiency
  ['brightcoreenergy', 'BrightCore Energy'],
  // Electrification — induction appliances
  ['chefman', 'Chefman'],
  // Expanded batch 2
  ['sunnova', 'Sunnova'], ['planetlabs', 'Planet Labs'], ['tempo', 'Tempo Automation'],
  ['ginkgobioworks', 'Ginkgo Bioworks'], ['avnos', 'Avnos'],
  ['tomorrow', 'Tomorrow.io'], ['watershed', 'Watershed'], ['patch', 'Patch'],
  ['clearway', 'Clearway Energy'], ['resilience', 'Resilience'],
  // Medtech AI / imaging additions
  ['pathai', 'PathAI'], ['iterativehealth', 'Iterative Health'],
  ['freenome', 'Freenome'], ['komodohealth', 'Komodo Health'],
  ['suki', 'Suki'], ['natera', 'Natera'], ['butterflynetwork', 'Butterfly Network'],
  ['prenuvo', 'Prenuvo'], ['heartflowinc', 'Heartflow'], ['cleerlyhealth', 'Cleerly'],
  ['ezra', 'Ezra'],
  // EdTech
  ['duolingo', 'Duolingo'], ['khanacademy', 'Khan Academy'], ['coursera', 'Coursera'],
  ['newsela', 'Newsela'], ['outschool', 'Outschool'], ['masterclass', 'MasterClass'],
  ['2u', '2U'], ['seesaw', 'Seesaw'], ['edmentum', 'Edmentum'], ['d2l', 'D2L'],
  ['udemy', 'Udemy'], ['ixllearning', 'IXL Learning'],
  // Mental Health Tech
  ['springhealth', 'Spring Health'], ['crisistextline', 'Crisis Text Line'],
  ['cerebral', 'Cerebral'], ['modernhealth', 'Modern Health'],
  ['talkspace', 'Talkspace'], ['betterhelp', 'BetterHelp'],
  ['amwell', 'Amwell'], ['tebra', 'Tebra'], ['daylight', 'Daylight'],
  ['careaccess', 'CareAccess'], ['sunnyside', 'Sunnyside'],
  // AgTech / Food Security
  ['pivotbio', 'Pivot Bio'], ['bluerivertech', 'Blue River Technology'],
  ['misfitsmarket', 'Misfits Market'], ['toogoodtogo', 'Too Good To Go'],
  ['secondharvest', 'Second Harvest'], ['eatjust', 'Eat Just'], ['hellofresh', 'HelloFresh'],
  // Global Health Tech
  ['dimagi', 'Dimagi'], ['givewell', 'GiveWell'], ['givedirectly', 'GiveDirectly'],
  ['oneacrefund', 'One Acre Fund'], ['doctorswithoutborders', 'Doctors Without Borders'],
  ['flyzipline', 'Zipline'],
  // Global Health / Research orgs
  ['rti', 'RTI International'], ['deliveryassociates', 'Delivery Associates'],
  // Mental Health additions
  ['ww', 'WW (Weight Watchers)'], ['ophelia', 'Ophelia Health'],
  ['found', 'Found'], ['alma', 'Alma'], ['workithealth', 'Workit Health'],
  // EdTech additions
  ['datacamp', 'DataCamp'], ['udacity', 'Udacity'], ['springboard', 'Springboard'],
  // AgTech / Food
  ['flashfood', 'Flashfood'],
  // Climate / Civic
  ['350', '350.org'], ['oddball', 'Oddball'], ['civicactions', 'CivicActions'],
  ['democracyworks', 'Democracy Works'], ['via', 'Via Transportation'],
  ['hyliion', 'Hyliion'], ['lucidmotors', 'Lucid Motors'],
  // Medical - genomics / precision medicine (wave 4)
  ['onemedical', 'One Medical'], ['veracyte', 'Veracyte'], ['10xgenomics', '10x Genomics'],
  ['pacificbiosciences', 'Pacific Biosciences'], ['illumina', 'Illumina'],
  ['twist', 'Twist Bioscience'], ['veeva', 'Veeva Systems'],
  ['recursion', 'Recursion Pharmaceuticals'], ['relay', 'Relay Therapeutics'],
  ['flatironhealth', 'Flatiron Health'], ['doximity', 'Doximity'],
  // Mental health - additional wave 4
  ['oura', 'Oura'], ['headspace', 'Headspace'],
  ['rula', 'Rula Health'], ['workhuman', 'Workhuman'],
  ['pelago', 'Pelago'], ['wellthy', 'Wellthy'],
  // EdTech - additional wave 4
  ['amplify', 'Amplify'], ['varsitytutors', 'Varsity Tutors'],
  ['renaissance', 'Renaissance Learning'],
  // AgTech - additional wave 4
  ['localbounti', 'Local Bounti'], ['terramera', 'Terramera'],
  // Digital health insurance
  ['oscar', 'Oscar Health'],
  // Wave 8 - clean transport / additional climate
  ['motional', 'Motional'], ['waymo', 'Waymo'],
  // Civic/Climate
  ['codeforamerica', 'Code for America'], ['nrdc', 'NRDC'],
  ['internationalrescuecommittee', 'International Rescue Committee'],
  ['pathfinderintl', 'Pathfinder International'], ['jhpiego', 'Jhpiego'],
  ['mercycorps', 'Mercy Corps'],
  // Civic advocacy + education nonprofits (wave 10)
  ['aclu', 'ACLU'], ['collegetrack', 'College Track'],
  // Financial inclusion (wave 11)
  ['chime', 'Chime'], ['earnin', 'EarnIn'], ['oportun', 'Oportun'],
  // Journalism / media (wave 11)
  ['propublica', 'ProPublica'], ['axios', 'Axios'],
  // Accessibility / learning differences (wave 11)
  ['understood', 'Understood.org'],
  // Civic tech + biotech (wave 13)
  ['vaxcyte', 'Vaxcyte'], ['govini', 'Govini'], ['accela', 'Accela'],
  ['res', 'Resource Environmental Solutions'],
  // EdTech platforms (wave 15)
  ['coursera', 'Coursera'], ['udacity', 'Udacity'], ['udemy', 'Udemy'], ['masterclass', 'MasterClass'],
  // Clean transport (wave 17)
  ['lyft', 'Lyft'],
  // Accessibility tech (wave 17)
  ['accessibe', 'accessiBe'],
  // Social impact tech platforms (wave 18)
  ['twilio', 'Twilio'], ['pagerduty', 'PagerDuty'], ['datadog', 'Datadog'],
  // GIS / environmental data (wave 19)
  ['esri', 'Esri'],
  // Housing tech (wave 19)
  ['opendoor', 'Opendoor'], ['roofstock', 'Roofstock'],
  // Dev infrastructure (wave 19)
  ['okta', 'Okta'], ['cloudflare', 'Cloudflare'], ['elastic', 'Elastic'], ['mongodb', 'MongoDB'],
  // Effective altruism / impact (wave 20)
  ['givewell', 'GiveWell'], ['acumen', 'Acumen'],
  // Social enterprise / ethical brands (wave 20)
  ['bombas', 'Bombas'], ['everlane', 'Everlane'],
  // Financial wellness (wave 20)
  ['sofi', 'SoFi'],
  // Climate / earth observation (wave 21)
  ['capellaspace', 'Capella Space'],
  ['oceanx', 'OceanX'],
  // Advanced energy + climate policy (wave 23)
  ['kairospower', 'Kairos Power'], ['wri', 'World Resources Institute'],
  // Humanitarian / nonprofit additions
  ['humanrightswatch', 'Human Rights Watch'], ['teachforall', 'Teach For All'],
  // Nonprofit wave 3 (confirmed via probe)
  ['brennan', 'Brennan Center for Justice'],
  // Nonprofit waves 4-5 (confirmed via probe)
  ['themarshallproject', 'The Marshall Project'], ['winrock', 'Winrock International'],
  ['kivaorg', 'Kiva'], ['ithaka', 'ITHAKA'], ['wikimedia', 'Wikimedia Foundation'],
  ['mozilla', 'Mozilla Foundation'], ['voxmedia', 'Vox Media'], ['aha', 'American Heart Association'],
];

const LEVER_COMPANIES = [
  ['zoox', 'Zoox'], ['verkor', 'Verkor'], ['goodleap', 'GoodLeap'],
  ['gridware', 'Gridware'], ['velo3d', 'Velo3D'], ['blablacar', 'BlaBlaCar'],
  ['pyka', 'Pyka'], ['arcadia', 'Arcadia'], ['omnidian', 'Omnidian'],
  ['cleanspark', 'CleanSpark'], ['lightship', 'Lightship'], ['gridmatic', 'Gridmatic'],
  ['voltus', 'Voltus'], ['arable', 'Arable'], ['agtonomy', 'Agtonomy'],
  ['brighte', 'Brighte'], ['verdigris', 'Verdigris'], ['perennial', 'Perennial'],
  ['envelio', 'envelio'], ['yardzen', 'Yardzen'], ['shiru', 'Shiru'],
  ['prolific-machines', 'Prolific Machines'], ['constellation', 'Constellation'],
  // New additions
  ['sila', 'Sila Nanotechnologies'],
  ['bloom', 'Bloom Energy'], ['arcadia', 'Arcadia Power'], ['voltus', 'Voltus'],
  // Medtech AI / imaging additions
  ['rapidai', 'RapidAI'], ['whiterabbit', 'WhiteRabbit'], ['h1', 'H1'],
  ['artera', 'Artera'], ['radformation', 'Radformation'],
  // EdTech
  ['brilliant', 'Brilliant'], ['edpuzzle', 'EdPuzzle'], ['kiddom', 'Kiddom'],
  // Mental Health Tech
  ['lyrahealth', 'Lyra Health'], ['ro', 'Ro Health'], ['whoop', 'WHOOP'],
  ['bighealth', 'Big Health'], ['lifestance', 'LifeStance Health'], ['mantra', 'Mantra Health'],
  // AgTech
  ['arable', 'Arable'],
  // Global Health Tech
  ['greenlight', 'Greenlight'],
  // Mental Health additions
  ['swordhealth', 'Sword Health'],
  // Climate additions
  ['invinity', 'Invinity Energy Systems'], ['sierraclub', 'Sierra Club'],
  // EdTech
  ['skillshare', 'Skillshare'],
  // Gender equity in tech (wave 14)
  ['girlswhocode', 'Girls Who Code'],
  // Nonprofit wave 3 (confirmed via probe)
  ['brookings', 'Brookings Institution'], ['ppfa', 'Planned Parenthood'],
  // Nonprofit waves 4-5 (confirmed via probe)
  ['commoncause', 'Common Cause'],
];

const ASHBY_COMPANIES = [
  ['helion', 'Helion Energy'], ['formenergy', 'Form Energy'],
  ['iceye', 'ICEYE'], ['vertical-aerospace', 'Vertical Aerospace'],
  ['span', 'SPAN'], ['sweep', 'Sweep'], ['leap', 'Leap'],
  ['twelve', 'Twelve'], ['brimstone', 'Brimstone Energy'],
  ['fourth-power', 'Fourth Power'], ['agreena', 'Agreena'],
  ['watershed', 'Watershed'], ['sylvera', 'Sylvera'],
  // Medtech AI / imaging additions
  ['insitro', 'insitro'], ['owkin', 'Owkin'], ['abridge', 'Abridge'],
  ['dandy', 'Dandy'], ['notable', 'Notable'], ['corti', 'Corti'],
  ['fathom', 'Fathom'], ['medely', 'Medely'],
  // Medical / Health marketplace
  ['sesame', 'Sesame Care'],
  // Mental Health / MSK
  ['hinge-health', 'Hinge Health'],
  // EdTech
  ['brightwheel', 'Brightwheel'], ['lambda', 'Bloomtech / Lambda School'],
  ['classdojo', 'ClassDojo'], ['prodigy-education', 'Prodigy Education'],
  // Climate additions
  ['amber', 'Amber'], ['blink', 'Blink Charging'],
];

const BREEZY_COMPANIES = [
  // EdTech
  ['duolingo', 'Duolingo', 'edtech'],
];

const BAMBOOHR_COMPANIES = [
  // Global Health
  ['givedirectly', 'GiveDirectly', 'globalhealth'],
  ['idinsight', 'IDinsight', 'globalhealth'],
  ['msf', 'Doctors Without Borders (MSF)', 'globalhealth'],
  ['savethechildren', 'Save the Children', 'globalhealth'],
  ['jhpiego', 'Jhpiego', 'globalhealth'],
  ['worldvisionusa', 'World Vision USA', 'globalhealth'],
  ['worldvision', 'World Vision', 'globalhealth'],
  // AgTech
  ['bowery', 'Bowery Farming', 'agtech'],
  ['aerobotics', 'Aerobotics', 'agtech'],
  // Mental Health
  ['mantra', 'Mantra Health', 'mentalhealth'],
];

const MEDICAL_COMPANY_SLUGS = new Set([
  'pathai', 'iterativehealth', 'freenome', 'komodohealth', 'suki', 'natera',
  'butterflynetwork', 'prenuvo', 'heartflowinc', 'cleerlyhealth', 'ezra',
  'rapidai', 'whiterabbit', 'h1', 'artera', 'radformation',
  'insitro', 'owkin', 'abridge', 'dandy', 'notable', 'corti', 'fathom', 'medely',
  'sesame', 'hinge-health',
  // Wave 4
  'onemedical', 'veracyte', '10xgenomics', 'pacificbiosciences', 'illumina',
  'twist', 'veeva', 'recursion', 'relay',
  'flatironhealth', 'doximity', 'wellthy',
  'oscar',
]);

const EDTECH_SLUGS = new Set([
  'duolingo', 'khanacademy', 'coursera', 'newsela', 'outschool', 'masterclass',
  '2u', 'seesaw', 'edmentum', 'd2l', 'brilliant', 'edpuzzle', 'udemy', 'ixllearning', 'kiddom',
  'datacamp', 'udacity', 'springboard', 'skillshare', 'brightwheel', 'lambda', 'classdojo',
  'prodigy-education',
  // Wave 4
  'amplify', 'varsitytutors', 'renaissance', 'kahoot', 'quizlet', 'chegg',
]);

const MENTALHEALTH_SLUGS = new Set([
  'springhealth', 'crisistextline', 'cerebral', 'modernhealth', 'talkspace',
  'betterhelp', 'amwell', 'tebra', 'daylight', 'careaccess', 'sunnyside',
  'lyrahealth', 'ro', 'whoop', 'bighealth', 'lifestance', 'mantra',
  'ww', 'ophelia', 'found', 'alma', 'workithealth', 'swordhealth',
  // Wave 4
  'oura', 'headspace', 'rula', 'workhuman', 'pelago',
]);

const AGTECH_SLUGS = new Set([
  'indigo', 'pivotbio', 'bluerivertech', 'misfitsmarket', 'toogoodtogo',
  'secondharvest', 'eatjust', 'hellofresh', 'arable', 'flashfood',
  // Wave 4
  'localbounti', 'terramera', 'apeel', 'notco',
]);

const GLOBALHEALTH_SLUGS = new Set([
  'dimagi', 'givewell', 'givedirectly', 'oneacrefund', 'doctorswithoutborders',
  'flyzipline', 'greenlight', 'idinsight', 'msf',
  'rti', 'deliveryassociates',
  // Wave 4
  'savethechildren', 'jhpiego', 'worldvisionusa', 'internationalrescuecommittee',
  'pathfinderintl', 'mercycorps', 'fhi360', 'psi', 'codeforamerica',
  // Humanitarian nonprofit additions
  'humanrightswatch', 'teachforall',
  // Nonprofit wave 3 (confirmed via probe)
  'brennan', 'aclu', 'brookings', 'ppfa',
  // Nonprofit waves 4-5 (confirmed via probe)
  'themarshallproject', 'winrock', 'kivaorg', 'commoncause',
  'ithaka', 'wikimedia', 'mozilla', 'voxmedia', 'aha',
]);

const BREEZY_FIELD_MAP = new Map(BREEZY_COMPANIES.map(([slug, , field]) => [slug, field]));
const BAMBOOHR_FIELD_MAP = new Map(BAMBOOHR_COMPANIES.map(([slug, , field]) => [slug, field]));

function getJobFieldForSource(source, slug = '') {
  if (source === 'greenhouse' || source === 'lever' || source === 'ashby') {
    if (MEDICAL_COMPANY_SLUGS.has(slug)) return 'medical';
    if (EDTECH_SLUGS.has(slug)) return 'edtech';
    if (MENTALHEALTH_SLUGS.has(slug)) return 'mentalhealth';
    if (AGTECH_SLUGS.has(slug)) return 'agtech';
    if (GLOBALHEALTH_SLUGS.has(slug)) return 'globalhealth';
    return 'climate';
  }
  if (source === 'breezy') return BREEZY_FIELD_MAP.get(slug) || 'climate';
  if (source === 'bamboo') return BAMBOOHR_FIELD_MAP.get(slug) || 'climate';
  return 'climate';
}

function inferAtsSlugFromJob(job) {
  const id = String(job && job.id ? job.id : '');
  const source = String(job && job.source ? job.source : '').toLowerCase();
  const match = id.match(/^(?:gh|lv|ab|br|bh)_([^_]+)_.+$/);
  if (match) return match[1];
  if (source === 'greenhouse' || source === 'lever' || source === 'ashby') {
    const url = String(job && job.url ? job.url : '');
    const urlMatch = url.match(/\/(?:boards\.greenhouse\.io|jobs\.lever\.co|jobs\.ashbyhq\.com)\/([^/?#]+)/i);
    if (urlMatch) return urlMatch[1].toLowerCase();
  }
  if (source === 'breezy') {
    const url = String(job && job.url ? job.url : '');
    const urlMatch = url.match(/https?:\/\/([^.]+)\.breezy\.hr/i);
    if (urlMatch) return urlMatch[1].toLowerCase();
  }
  if (source === 'bamboo') {
    const url = String(job && job.url ? job.url : '');
    const urlMatch = url.match(/https?:\/\/([^.]+)\.bamboohr\.com/i);
    if (urlMatch) return urlMatch[1].toLowerCase();
  }
  return '';
}

function hydrateJobField(job) {
  const source = String(job && job.source ? job.source : 'climatebase').toLowerCase();
  // Always re-classify ATS jobs so slug sets stay current without cache invalidation
  if (source === 'greenhouse' || source === 'lever' || source === 'ashby') {
    const slug = inferAtsSlugFromJob(job);
    return { ...job, jobField: getJobFieldForSource(source, slug) };
  }
  if (source === 'breezy' || source === 'bamboo') {
    const slug = inferAtsSlugFromJob(job);
    return { ...job, jobField: getJobFieldForSource(source, slug) };
  }
  // RemoteOK: keep the field that was inferred at normalize time
  if (source === 'remoteok') return job;
  // Non-ATS: keep existing or default to climate
  if (job && job.jobField) return job;
  return { ...job, jobField: 'climate' };
}

// ─── ATS Normalizers ───────────────────────────────────────────────────────
function normalizeGreenhouseJob(hit, company, slug) {
  const title = hit.title || 'Untitled role';
  const locationName = hit.location && hit.location.name ? hit.location.name : '';
  const locations = locationName ? [locationName] : [];
  const isRemote = /remote/i.test(locationName);
  const remotePreferences = isRemote ? ['Remote'] : [];
  return {
    id: `gh_${slug}_${hit.id}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes: [],
    datePosted: hit.updated_at ? hit.updated_at.slice(0, 10) : null,
    logo: null,
    url: hit.absolute_url || `https://boards.greenhouse.io/${slug}`,
    source: 'greenhouse',
    jobField: getJobFieldForSource('greenhouse', slug),
    companySize: classifyCompanySize(company),
  };
}

function normalizeLeverJob(hit, company, slug) {
  const title = hit.text || hit.title || 'Untitled role';
  const locationName = (hit.categories && hit.categories.location) || '';
  const locations = locationName ? [locationName] : [];
  const isRemote = /remote/i.test(locationName) || hit.workplaceType === 'remote';
  const remotePreferences = isRemote ? ['Remote'] : [];
  const commitment = (hit.categories && hit.categories.commitment) || '';
  const jobTypes = commitment ? [commitment] : [];
  return {
    id: `lv_${slug}_${hit.id}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: hit.createdAt ? new Date(hit.createdAt).toISOString().slice(0, 10) : null,
    logo: null,
    url: hit.hostedUrl || hit.applyUrl || `https://jobs.lever.co/${slug}`,
    source: 'lever',
    jobField: getJobFieldForSource('lever', slug),
    companySize: classifyCompanySize(company),
  };
}

function normalizeAshbyJob(hit, company, slug) {
  const title = hit.title || 'Untitled role';
  const locationName = hit.location || '';
  const secondaryLocations = (hit.secondaryLocations || []).map((l) => l.location || l).filter(Boolean);
  const locations = [locationName, ...secondaryLocations].filter(Boolean);
  const isRemote = hit.isRemote || /remote/i.test(locationName) || hit.workplaceType === 'Remote';
  const remotePreferences = isRemote ? ['Remote'] : [];
  const employmentType = hit.employmentType || '';
  const jobTypes = employmentType ? [employmentType] : [];
  return {
    id: `ab_${slug}_${hit.id}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: hit.publishedAt ? hit.publishedAt.slice(0, 10) : null,
    logo: null,
    url: hit.jobUrl || `https://jobs.ashbyhq.com/${slug}`,
    source: 'ashby',
    jobField: getJobFieldForSource('ashby', slug),
    companySize: classifyCompanySize(company),
  };
}

function normalizeBreezyJob(hit, company, slug) {
  const title = hit.name || 'Untitled role';
  const loc = hit.location && hit.location.name ? hit.location.name : '';
  const isRemote = !!(hit.location && hit.location.is_remote);
  const locations = loc ? [loc] : [];
  const remotePreferences = isRemote ? ['Remote'] : [];
  const jobType = hit.type && hit.type.name ? hit.type.name : '';
  const jobTypes = jobType ? [jobType] : [];
  return {
    id: `br_${slug}_${hit.id}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: hit.published_date ? hit.published_date.slice(0, 10) : null,
    logo: null,
    url: hit.url || `https://${slug}.breezy.hr`,
    source: 'breezy',
    jobField: getJobFieldForSource('breezy', slug),
    companySize: classifyCompanySize(company),
  };
}

function normalizeBambooJob(hit, company, slug) {
  const title = hit.jobOpeningName || 'Untitled role';
  const city = hit.location && hit.location.city ? hit.location.city : '';
  const state = hit.location && hit.location.state ? hit.location.state : '';
  const locParts = [city, state].filter(Boolean);
  const locationName = locParts.join(', ');
  const isRemote = hit.isRemote === true || hit.locationType === '2';
  const locations = locationName ? [locationName] : [];
  const remotePreferences = isRemote ? ['Remote'] : [];
  const empStatus = hit.employmentStatusLabel || '';
  const jobTypes = empStatus ? [empStatus] : [];
  return {
    id: `bh_${slug}_${hit.id}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: null,
    logo: null,
    url: `https://${slug}.bamboohr.com/careers/${hit.id}`,
    source: 'bamboo',
    jobField: getJobFieldForSource('bamboo', slug),
    companySize: classifyCompanySize(company),
  };
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Company name → jobField for Built In classification
const BUILTIN_COMPANY_FIELD_RE = [
  [/duolingo|khan\s*academy|coursera|newsela|outschool|masterclass|\b2u\b|seesaw|edmentum|d2l|brilliant|edpuzzle|udemy|ixl|kiddom|datacamp|udacity|springboard|skillshare|brightwheel|lambda\s*school|bloomtech|classdojo|prodigy|amplify\s*education|varsity\s*tutors|renaissance\s*learning|kahoot|quizlet|chegg/i, 'edtech'],
  [/spring\s*health|crisis\s*text\s*line|woebot|lyra\s*health|cerebral|modern\s*health|talkspace|betterhelp|amwell|tebra|daylight|care\s*access|sunnyside|life\s*stance|big\s*health|mantra|noom|headspace|calm\b|brightside|weight\s*watchers|\bww\b|ophelia|workit|sword\s*health|hinge\s*health|alma\s*care|\balma\b|found\s*health|oura|rula|workhuman|pelago/i, 'mentalhealth'],
  [/pivot\s*bio|blue\s*river|misfits\s*market|too\s*good\s*to\s*go|second\s*harvest|eat\s*just|hellofresh|indigo\s*ag|taranis|farmers\s*business|flashfood|local\s*bounti|terramera|apeel|notco/i, 'agtech'],
  [/dimagi|zipline|give\s*directly|one\s*acre|givewell|doctors\s*without\s*borders|medic\s*mobile|greenlight|livinggoods|village\s*reach|last\s*mile|rti\s*international|delivery\s*associates|save\s*the\s*children|jhpiego|world\s*vision|international\s*rescue|pathfinder\s*international|mercy\s*corps|fhi\s*360|\bpsi\b.*health|code\s*for\s*america/i, 'globalhealth'],
];

function classifyBuiltInField(company) {
  for (const [re, field] of BUILTIN_COMPANY_FIELD_RE) {
    if (re.test(company)) return field;
  }
  return 'climate';
}

function normalizeBuiltInJob(jobPosting, pageUrl) {
  const title = decodeHtmlEntities(jobPosting.title || 'Untitled role');
  const company = decodeHtmlEntities(
    (jobPosting.hiringOrganization && jobPosting.hiringOrganization.name) || 'Unknown company',
  );
  const description = decodeHtmlEntities(String(jobPosting.description || ''));

  const rawLocations = Array.isArray(jobPosting.jobLocation)
    ? jobPosting.jobLocation
    : (jobPosting.jobLocation ? [jobPosting.jobLocation] : []);

  const locations = rawLocations
    .map((loc) => {
      const addr = loc && loc.address ? loc.address : {};
      const city = addr.addressLocality || '';
      const region = addr.addressRegion || '';
      const country = addr.addressCountry || '';
      return [city, region, country].filter(Boolean).join(', ');
    })
    .filter(Boolean);

  const employmentType = jobPosting.employmentType;
  const jobTypes = employmentType
    ? (Array.isArray(employmentType) ? employmentType : [employmentType])
    : [];

  const desc = String(jobPosting.description || '').toLowerCase();
  const remoteFlag = /\bremote\b/.test(desc);
  const remotePreferences = remoteFlag ? ['Remote'] : [];

  const idMatch = String(pageUrl).match(/\/(\d+)\/?$/);
  const id = (jobPosting.identifier && jobPosting.identifier.value)
    || (idMatch ? idMatch[1] : slugify(`${company}_${title}`));

  const logo = jobPosting.hiringOrganization
    && jobPosting.hiringOrganization.logo
    && jobPosting.hiringOrganization.logo.url
      ? jobPosting.hiringOrganization.logo.url
      : null;

  return {
    id: `bi_${id}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: jobPosting.datePosted || null,
    logo,
    url: pageUrl,
    source: 'builtin',
    jobField: classifyBuiltInField(company),
    companySize: classifyCompanySize(company),
    description,
  };
}

function normalizeTerraJob(jobPosting, pageUrl) {
  const title = decodeHtmlEntities(jobPosting.title || 'Untitled role');
  const company = decodeHtmlEntities(
    (jobPosting.hiringOrganization && jobPosting.hiringOrganization.name) || 'Unknown company',
  );
  const descriptionRaw = decodeHtmlEntities(String(jobPosting.description || ''));

  const rawLocations = Array.isArray(jobPosting.jobLocation)
    ? jobPosting.jobLocation
    : (jobPosting.jobLocation ? [jobPosting.jobLocation] : []);

  const locations = rawLocations
    .map((loc) => {
      const addr = loc && loc.address ? loc.address : {};
      const city = decodeHtmlEntities(addr.addressLocality || '');
      const region = decodeHtmlEntities(addr.addressRegion || '');
      const country = decodeHtmlEntities(addr.addressCountry || '');
      return [city, region, country].filter(Boolean).join(', ');
    })
    .filter(Boolean);

  const employmentType = jobPosting.employmentType;
  const jobTypes = employmentType
    ? (Array.isArray(employmentType) ? employmentType : [employmentType])
    : [];

  const description = descriptionRaw.toLowerCase();
  const remotePreferences = /\bremote\b/.test(description) ? ['Remote'] : [];

  const idMatch = String(pageUrl).match(/-(\d+)\/?$/);
  const id = idMatch ? idMatch[1] : slugify(`${company}_${title}`);

  return {
    id: `td_${id}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: jobPosting.datePosted || null,
    logo: null,
    url: pageUrl,
    source: 'terra',
    jobField: 'climate',
    companySize: classifyCompanySize(company),
    description: descriptionRaw,
  };
}

// Map 80k Hours tags_area values to jobField
const EIGHTYKHOURS_AREA_FIELD = {
  'Climate change': 'climate',
  'Global health & development': 'globalhealth',
  'Biosecurity & pandemic preparedness': 'globalhealth',
  'AI safety & policy': 'climate',
  'Nuclear security': 'climate',
  'Animal welfare': 'climate',
  'Technical': 'climate',
  'Other policy-focused': 'climate',
  'Building effective altruism': 'climate',
  'Macrostrategy': 'climate',
  'Career development': 'climate',
};

function normalize80kJob(hit) {
  const title = hit.title || 'Untitled role';
  const company = hit.company_name || (hit.company && hit.company.name) || 'Unknown company';
  const logo = hit.company_logo_url || null;
  const url = hit.url_external || `https://jobs.80000hours.org/?objectID=${hit.objectID}`;

  const cityTags = toArray(hit.tags_city);
  const countryTags = toArray(hit.tags_country);
  const loc80k = toArray(hit.tags_location_80k);
  const locations = [...new Set([...cityTags, ...countryTags, ...loc80k])].filter(Boolean);

  const locType = toArray(hit.tags_location_type);
  const isRemote = locType.some((t) => /remote/i.test(t)) || /remote/i.test(locations.join(' '));
  const remotePreferences = isRemote ? ['Remote'] : [];

  const roleType = toArray(hit.tags_role_type);
  const jobTypes = roleType.length ? roleType : [];

  const datePosted = hit.posted_at
    ? new Date(hit.posted_at * 1000).toISOString().slice(0, 10)
    : null;

  const areas = toArray(hit.tags_area);
  const jobField80k = (() => {
    for (const area of areas) {
      const f = EIGHTYKHOURS_AREA_FIELD[area];
      if (f) return f;
    }
    return 'climate';
  })();

  return {
    id: `ek_${hit.objectID || hit.post_pk}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted,
    logo,
    url,
    source: 'eightyk',
    jobField: jobField80k,
    companySize: classifyCompanySize(company),
  };
}

async function fetch80kHoursJobs() {
  try {
    const allHits = [];
    let page = 0;
    while (true) {
      const r = await fetch(
        `https://${EIGHTYKHOURS_APP_ID}-dsn.algolia.net/1/indexes/${EIGHTYKHOURS_INDEX}/query`,
        {
          method: 'POST',
          headers: {
            'X-Algolia-Application-Id': EIGHTYKHOURS_APP_ID,
            'X-Algolia-API-Key': EIGHTYKHOURS_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: '',
            hitsPerPage: 100,
            page,
          }),
          signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
        },
      );
      if (!r.ok) break;
      const d = await r.json();
      const hits = d.hits || [];
      allHits.push(...hits);
      if (page >= (d.nbPages || 1) - 1) break;
      page += 1;
    }
    const jobs = allHits.map(normalize80kJob).filter((j) => j.id && j.title);
    console.log(`[80khours] ${jobs.length} jobs`);
    return jobs;
  } catch (e) {
    console.log('[80khours] 0 jobs:', e.message);
    return [];
  }
}

// ─── ATS Fetchers ──────────────────────────────────────────────────────────
async function fetchGreenhouseJobs() {
  const all = [];
  for (let i = 0; i < GREENHOUSE_COMPANIES.length; i += ATS_FETCH_CONCURRENCY) {
    const batch = GREENHOUSE_COMPANIES.slice(i, i + ATS_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(async ([slug, company]) => {
      try {
        const r = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`,
          { signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) },
        );
        if (!r.ok) return [];
        const j = await r.json();
        return (j.jobs || []).map((hit) => normalizeGreenhouseJob(hit, company, slug));
      } catch { return []; }
    }));
    for (const jobs of results) all.push(...jobs);
  }
  console.log(`[greenhouse] ${all.length} jobs from ${GREENHOUSE_COMPANIES.length} companies`);
  return all;
}

async function fetchLeverJobs() {
  const all = [];
  for (let i = 0; i < LEVER_COMPANIES.length; i += ATS_FETCH_CONCURRENCY) {
    const batch = LEVER_COMPANIES.slice(i, i + ATS_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(async ([slug, company]) => {
      try {
        const r = await fetch(
          `https://api.lever.co/v0/postings/${slug}?mode=json`,
          { signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) },
        );
        if (!r.ok) return [];
        const j = await r.json();
        if (!Array.isArray(j)) return [];
        return j.map((hit) => normalizeLeverJob(hit, company, slug));
      } catch { return []; }
    }));
    for (const jobs of results) all.push(...jobs);
  }
  console.log(`[lever] ${all.length} jobs from ${LEVER_COMPANIES.length} companies`);
  return all;
}

async function fetchAshbyJobs() {
  const all = [];
  for (let i = 0; i < ASHBY_COMPANIES.length; i += ATS_FETCH_CONCURRENCY) {
    const batch = ASHBY_COMPANIES.slice(i, i + ATS_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(async ([slug, company]) => {
      try {
        const r = await fetch(
          `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
          { signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) },
        );
        if (!r.ok) return [];
        const j = await r.json();
        return (j.jobs || []).map((hit) => normalizeAshbyJob(hit, company, slug));
      } catch { return []; }
    }));
    for (const jobs of results) all.push(...jobs);
  }
  console.log(`[ashby] ${all.length} jobs from ${ASHBY_COMPANIES.length} companies`);
  return all;
}

async function fetchBreezyJobs() {
  const all = [];
  const results = await Promise.all(BREEZY_COMPANIES.map(async ([slug, company]) => {
    try {
      const r = await fetch(`https://${slug}.breezy.hr/json`, { signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) });
      if (!r.ok) return [];
      const j = await r.json();
      if (!Array.isArray(j)) return [];
      return j.map((hit) => normalizeBreezyJob(hit, company, slug));
    } catch { return []; }
  }));
  for (const jobs of results) all.push(...jobs);
  console.log(`[breezy] ${all.length} jobs from ${BREEZY_COMPANIES.length} companies`);
  return all;
}

async function fetchBambooJobs() {
  const all = [];
  const results = await Promise.all(BAMBOOHR_COMPANIES.map(async ([slug, company]) => {
    try {
      const r = await fetch(`https://${slug}.bamboohr.com/careers/list`, { signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) });
      if (!r.ok) return [];
      const j = await r.json();
      return (j.result || []).map((hit) => normalizeBambooJob(hit, company, slug));
    } catch { return []; }
  }));
  for (const jobs of results) all.push(...jobs);
  console.log(`[bamboo] ${all.length} jobs from ${BAMBOOHR_COMPANIES.length} companies`);
  return all;
}

async function fetchBuiltInJobs() {
  const jobUrls = new Set();

  for (let page = 1; ; page += 1) {
    const url = `https://builtin.com/jobs?page=${page}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) });
      if (!r.ok) break;
      const html = await r.text();

      const matches = html.match(/https:\/\/builtin\.com\/job\/[^"\s<]+\/\d+/g) || [];
      const uniqueMatches = Array.from(new Set(matches));
      if (uniqueMatches.length === 0) break;
      for (const m of uniqueMatches) {
        jobUrls.add(m);
      }

      // If we got fewer than a page worth, pagination likely ended.
      if (uniqueMatches.length < 20) break;
    } catch {
      break;
    }
  }

  const urls = Array.from(jobUrls);
  const jobs = [];

  for (let i = 0; i < urls.length; i += BUILTIN_FETCH_CONCURRENCY) {
    const batch = urls.slice(i, i + BUILTIN_FETCH_CONCURRENCY);
    const results = await Promise.all(batch.map(async (jobUrl) => {
      try {
        const r = await fetch(jobUrl, { signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) });
        if (!r.ok) return null;
        const html = await r.text();
        const m = html.match(/<script type="application\/ld(?:\+|&#x2B;)json">\s*([\s\S]*?)\s*<\/script>/i);
        if (!m) return null;
        const data = JSON.parse(m[1]);
        const graph = Array.isArray(data['@graph']) ? data['@graph'] : [];
        const posting = graph.find((x) => x && x['@type'] === 'JobPosting');
        if (!posting) return null;
        return normalizeBuiltInJob(posting, jobUrl);
      } catch {
        return null;
      }
    }));
    for (const job of results) {
      if (job && job.id && job.title) jobs.push(job);
    }
  }

  console.log(`[builtin] ${jobs.length} jobs from ${urls.length} discovered URLs`);
  return jobs;
}

async function fetchTerraJobs() {
  try {
    const boardHtml = await fetch(TERRA_BOARD_URL, {
      signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
    }).then((r) => (r.ok ? r.text() : ''));

    const matches = boardHtml.match(/https:\/\/www\.terra\.do\/climate-jobs\/job-board\/[^"\s]+-\d+\//g) || [];
    const urls = Array.from(new Set(matches));
    const jobs = [];

    for (let i = 0; i < urls.length; i += BUILTIN_FETCH_CONCURRENCY) {
      const batch = urls.slice(i, i + BUILTIN_FETCH_CONCURRENCY);
      const results = await Promise.all(batch.map(async (jobUrl) => {
        try {
          const html = await fetch(jobUrl, {
            signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
          }).then((r) => (r.ok ? r.text() : ''));
          const m = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/i);
          if (!m) return null;
          const json = JSON.parse(m[1]);
          if (!json || json['@type'] !== 'JobPosting') return null;
          return normalizeTerraJob(json, jobUrl);
        } catch {
          return null;
        }
      }));
      for (const job of results) {
        if (job && job.id && job.title) jobs.push(job);
      }
    }

    console.log(`[terra] ${jobs.length} jobs from ${urls.length} discovered URLs`);
    return jobs;
  } catch {
    console.log('[terra] 0 jobs');
    return [];
  }
}

// ─── Flat-file Job Cache ───────────────────────────────────────────────────
async function saveJobsToFile(jobs) {
  try {
    await fs.promises.writeFile(
      JOBS_CACHE_FILE,
      JSON.stringify({ savedAt: Date.now(), jobs }),
    );
    console.log(`[cache] Saved ${jobs.length} jobs to ${JOBS_CACHE_FILE}`);
  } catch (err) {
    console.error('[cache] Failed to save jobs to file:', err.message);
  }
}

async function loadJobsFromFile() {
  try {
    const raw = await fs.promises.readFile(JOBS_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      savedAt: parsed.savedAt || 0,
      jobs: (parsed.jobs || []).map(hydrateJobField).map(hydrateEndProductCategory),
    };
  } catch {
    return null;
  }
}

// ─── RemoteOK ─────────────────────────────────────────────────────────────
// Public API, no auth — ingest all currently available remote jobs.

function normalizeRemoteOKJob(hit) {
  const title = hit.position || 'Untitled role';
  const company = hit.company || 'Unknown company';
  const isRemote = true;
  // Infer field from tags
  const tags = (hit.tags || []).join(' ').toLowerCase();
  let jobField = 'climate';
  if (/health|medical|clinical|pharma|biotech/.test(tags)) jobField = 'medical';
  else if (/edtech|education|learning|teaching/.test(tags)) jobField = 'edtech';
  else if (/mental|wellness|therapy/.test(tags)) jobField = 'mentalhealth';
  else if (/agtech|agriculture|food|farm/.test(tags)) jobField = 'agtech';
  return hydrateEndProductCategory({
    id: `rok_${hit.id || hit.slug}`,
    title,
    company,
    locations: ['Remote'],
    remotePreferences: ['Remote'],
    jobTypes: [],
    datePosted: hit.date ? hit.date.slice(0, 10) : null,
    logo: hit.company_logo || null,
    url: hit.url || `https://remoteok.com/remote-jobs/${hit.slug}`,
    source: 'remoteok',
    jobField,
    companySize: classifyCompanySize(company),
  });
}

async function fetchRemoteOKJobs() {
  try {
    const r = await fetch('https://remoteok.com/api', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; job-board-aggregator/1.0)' },
      signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.log('[remoteok] 0 jobs');
      return [];
    }

    const jobs = await r.json();
    if (!Array.isArray(jobs)) {
      console.log('[remoteok] 0 jobs');
      return [];
    }

    const all = [];
    const seen = new Set();
    for (const hit of jobs) {
      if (!hit.id && !hit.slug) continue; // skip legal notice header
      const key = String(hit.id || hit.slug);
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(normalizeRemoteOKJob(hit));
    }

    console.log(`[remoteok] ${all.length} jobs`);
    return all;
  } catch {
    console.log('[remoteok] 0 jobs');
    return [];
  }
}

function inferJobFieldFromText(text) {
  const t = String(text || '').toLowerCase();
  if (/health|medical|clinical|pharma|biotech/.test(t)) return 'medical';
  if (/edtech|education|learning|teaching|school|university/.test(t)) return 'edtech';
  if (/mental|wellness|therapy|psychiatry|psychology/.test(t)) return 'mentalhealth';
  if (/agtech|agriculture|food|farm/.test(t)) return 'agtech';
  if (/global health|humanitarian|international development|public health|ngo/.test(t)) return 'globalhealth';
  return 'climate';
}

function normalizeRemotiveJob(hit) {
  const title = String(hit?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(hit?.company_name || 'Unknown company').trim() || 'Unknown company';
  const category = String(hit?.category || '').trim();
  const locations = [String(hit?.candidate_required_location || 'Remote').trim() || 'Remote'];
  const publicationDate = hit?.publication_date ? String(hit.publication_date).slice(0, 10) : null;
  const sourceText = [
    title,
    company,
    category,
    ...(Array.isArray(hit?.tags) ? hit.tags : []),
    String(hit?.description || ''),
  ].join(' ');

  return hydrateEndProductCategory({
    id: `rm_${hit?.id || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations,
    remotePreferences: ['Remote'],
    jobTypes: category ? [category] : [],
    datePosted: publicationDate,
    logo: hit?.company_logo_url || null,
    url: hit?.url || 'https://remotive.com/remote-jobs',
    source: 'remotive',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchRemotiveJobs() {
  try {
    const r = await fetch('https://remotive.com/api/remote-jobs', {
      signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.log('[remotive] 0 jobs');
      return [];
    }

    const payload = await r.json();
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const normalized = jobs.map(normalizeRemotiveJob).filter((job) => job.id && job.title);
    console.log(`[remotive] ${normalized.length} jobs`);
    return normalized;
  } catch {
    console.log('[remotive] 0 jobs');
    return [];
  }
}

function normalizeArbeitnowJob(hit) {
  const title = String(hit?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(hit?.company_name || 'Unknown company').trim() || 'Unknown company';
  const locations = Array.isArray(hit?.location) ? hit.location : [String(hit?.location || '').trim()].filter(Boolean);
  const tags = Array.isArray(hit?.tags) ? hit.tags : [];
  const sourceText = [title, company, ...tags, String(hit?.description || '')].join(' ');

  return hydrateEndProductCategory({
    id: `an_${hit?.slug || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations,
    remotePreferences: Boolean(hit?.remote) ? ['Remote'] : [],
    jobTypes: tags,
    datePosted: hit?.created_at ? String(hit.created_at).slice(0, 10) : null,
    logo: null,
    url: hit?.url || `https://www.arbeitnow.com/jobs/${hit?.slug || ''}`,
    source: 'arbeitnow',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchArbeitnowJobs() {
  try {
    const all = [];
    let page = 1;
    while (true) {
      const r = await fetch(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, {
        signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
      });
      if (!r.ok) break;
      const payload = await r.json();
      const jobs = Array.isArray(payload?.data) ? payload.data : [];
      if (jobs.length === 0) break;
      all.push(...jobs);

      const hasNext = Boolean(payload?.links?.next);
      if (!hasNext) break;
      page += 1;
    }

    const normalized = all.map(normalizeArbeitnowJob).filter((job) => job.id && job.title);
    console.log(`[arbeitnow] ${normalized.length} jobs`);
    return normalized;
  } catch {
    console.log('[arbeitnow] 0 jobs');
    return [];
  }
}

function normalizeMuseJob(hit) {
  const title = String(hit?.name || 'Untitled role').trim() || 'Untitled role';
  const company = String(hit?.company?.name || 'Unknown company').trim() || 'Unknown company';
  const locations = toArray(hit?.locations).map((loc) => String(loc?.name || '').trim()).filter(Boolean);
  const levels = toArray(hit?.levels).map((level) => String(level?.name || '').trim()).filter(Boolean);
  const categories = toArray(hit?.categories).map((cat) => String(cat?.name || '').trim()).filter(Boolean);
  const type = String(hit?.type || '').trim();
  const jobTypes = [...new Set([...levels, ...categories, ...(type ? [type] : [])])];
  const published = String(hit?.publication_date || '').trim();
  const sourceText = [title, company, ...jobTypes, String(hit?.contents || '')].join(' ');
  const remotePreferences = /remote/i.test(sourceText) ? ['Remote'] : [];

  return hydrateEndProductCategory({
    id: `tm_${hit?.id || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations,
    remotePreferences,
    jobTypes,
    datePosted: published ? published.slice(0, 10) : null,
    logo: hit?.company?.logo || null,
    url: hit?.refs?.landing_page || hit?.refs?.job_page || 'https://www.themuse.com/jobs',
    source: 'themuse',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchTheMuseJobs() {
  try {
    const all = [];
    let page = 1;
    while (true) {
      const r = await fetch(`https://www.themuse.com/api/public/jobs?page=${page}`, {
        signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
      });
      if (!r.ok) break;

      const payload = await r.json();
      const results = Array.isArray(payload?.results) ? payload.results : [];
      if (results.length === 0) break;
      all.push(...results);

      const pageCount = Number(payload?.page_count || 0);
      if ((pageCount > 0 && page >= pageCount) || !payload?.page) break;
      page += 1;
    }

    const normalized = all.map(normalizeMuseJob).filter((job) => job.id && job.title);
    console.log(`[themuse] ${normalized.length} jobs`);
    return normalized;
  } catch {
    console.log('[themuse] 0 jobs');
    return [];
  }
}

// ─── USAJOBS (Federal Government) ──────────────────────────────────────────

function normalizeUSAJobsJob(hit) {
  const title = String(hit?.position_title || 'Untitled role').trim() || 'Untitled role';
  const agency = String(hit?.organization_name || hit?.department_name || 'Unknown agency').trim() || 'Unknown agency';
  const locations = hit?.locations && Array.isArray(hit.locations)
    ? hit.locations.map((loc) => String(loc || '').trim()).filter(Boolean)
    : [];
  const jobTypes = [];
  if (hit?.job_grade) jobTypes.push(`Grade ${hit.job_grade}`);
  if (hit?.employment_type) jobTypes.push(hit.employment_type);
  if (hit?.work_schedule) jobTypes.push(hit.work_schedule);

  const sourceText = [
    title,
    agency,
    hit?.summary || '',
    ...jobTypes,
  ].join(' ');

  return hydrateEndProductCategory({
    id: `usajobs_${hit?.id || slugify(`${agency}_${title}`)}`,
    title,
    company: agency,
    locations: locations.length > 0 ? locations : ['Multiple Locations'],
    remotePreferences: (hit?.remote_preference === true || String(hit?.remote_preference || '').toLowerCase() === 'true') ? ['Remote'] : [],
    jobTypes,
    datePosted: hit?.posted_date ? String(hit.posted_date).slice(0, 10) : null,
    logo: null,
    url: hit?.apply_uri || `https://www.usajobs.gov/GetJob/ViewDetails/${hit?.id || ''}`,
    source: 'usajobs',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'large', // Federal government is always large
  });
}



async function fetchUSAJobsJobs() {
  try {
    const usajobsApiKey = String(process.env.USAJOBS_API_KEY || '').trim();
    if (!usajobsApiKey) {
      console.log('[usajobs] 0 jobs (missing USAJOBS_API_KEY)');
      return [];
    }

    const all = [];
    const pageSize = 500; // Max per USAJOBS API
    for (let page = 1; ; page += 1) {
      const skip = (page - 1) * pageSize;
      const params = new URLSearchParams({
        'page.from': skip,
        'page.size': pageSize,
        'include': 'remote_preference,work_schedule,position_level',
      });

      const r = await fetch(`https://data.usajobs.gov/api/search?${params.toString()}`, {
        headers: {
          'Authorization-Key': usajobsApiKey,
          'User-Agent': 'job-finder/1.0',
        },
        signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
      });

      if (!r.ok) {
        console.log(`[usajobs] Stopped at page ${page} (HTTP ${r.status})`);
        break;
      }

      const payload = await r.json();
      const results = Array.isArray(payload?.SearchResult?.SearchResultItems)
        ? payload.SearchResult.SearchResultItems.map((item) => item.MatchedObjectDescriptor)
        : [];

      if (results.length === 0) {
        console.log(`[usajobs] Reached end at page ${page}`);
        break;
      }

      all.push(...results);
    }

    const normalized = all.map(normalizeUSAJobsJob).filter((job) => job.id && job.title);
    console.log(`[usajobs] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[usajobs] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Upwork (Freelance/Creative) ───────────────────────────────────────────

function normalizeUpworkJob(hit) {
  const title = String(hit?.title || 'Untitled role').trim() || 'Untitled role';
  const skills = Array.isArray(hit?.skills) ? hit.skills.map((s) => String(s?.name || '').trim()).filter(Boolean) : [];
  const company = 'Upwork Client'; // Upwork jobs are from various clients
  const budget = hit?.budget?.currencyCode ? `${hit.budget.currencyCode} ${hit.budget.minimum}-${hit.budget.maximum}` : '';

  const sourceText = [
    title,
    company,
    ...skills,
    hit?.description || '',
  ].join(' ');

  return hydrateEndProductCategory({
    id: `upwork_${hit?.id || slugify(title)}`,
    title,
    company,
    locations: ['Remote'], // Upwork is remote-first
    remotePreferences: ['Remote'],
    jobTypes: [...skills, ...(budget ? [budget] : [])],
    datePosted: hit?.date_posted ? String(hit.date_posted).slice(0, 10) : null,
    logo: null,
    url: hit?.url || `https://www.upwork.com/jobs/${hit?.id || ''}`,
    source: 'upwork',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'small',
  });
}



async function fetchUpworkJobs() {
  try {
    // Note: Upwork's official API is rate-limited for free tier.
    // Using public job listings endpoint as fallback.
    const all = [];

    // Upwork public search doesn't have a direct JSON API, but we can try the feed.
    // For now, returning empty to avoid rate limiting. Consider adding API key.
    console.log('[upwork] 0 jobs (API requires authentication)');
    return [];
  } catch (err) {
    console.log(`[upwork] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Working Nomads (Remote Jobs Aggregator – replaces Dice) ─────────────────

function normalizeWorkingNomadsJob(job) {
  const title = String(job?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(job?.company || 'Unknown company').trim() || 'Unknown company';
  const location = String(job?.job_location || 'Remote').trim() || 'Remote';
  const category = String(job?.category || '').trim();
  const type = String(job?.job_type || '').trim();
  const sourceText = [title, company, location, category, type].join(' ');

  return hydrateEndProductCategory({
    id: `workingnomads_${job?.id || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations: [location],
    remotePreferences: ['Remote'],
    jobTypes: [type, category].filter(Boolean),
    datePosted: job?.publish_date ? String(job.publish_date).slice(0, 10) : null,
    logo: null,
    url: job?.url || 'https://www.workingnomads.com/jobs',
    source: 'workingnomads',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchDiceJobs() {
  try {
    // Working Nomads public REST API — no auth required. Replaces defunct Dice integration.
    const r = await fetch('https://www.workingnomads.com/api/exposed_jobs/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
      signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.log(`[workingnomads] 0 jobs (HTTP ${r.status})`);
      return [];
    }
    const payload = await r.json();
    const jobs = Array.isArray(payload) ? payload : Array.isArray(payload?.jobs) ? payload.jobs : [];
    const normalized = jobs.map(normalizeWorkingNomadsJob).filter((j) => j.id && j.title);
    console.log(`[workingnomads] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[workingnomads] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── TaskRabbit (Service Professionals & Trades) ────────────────────────────

function normalizeTaskRabbitJob(task) {
  const title = String(task?.category || 'Service Task').trim() || 'Service Task';
  const location = String(task?.service_area || 'Multiple Locations').trim() || 'Multiple Locations';
  const budget = task?.budget ? `$${task.budget}` : '';
  const description = String(task?.description || '').trim();

  const sourceText = [title, location, description, budget].join(' ');

  return hydrateEndProductCategory({
    id: `taskrabbit_${task?.id || slugify(title + location)}`,
    title: `${title} (Task)`,
    company: 'TaskRabbit',
    locations: [location],
    remotePreferences: [],
    jobTypes: [title, ...(budget ? [budget] : [])],
    datePosted: task?.posted_date ? String(task.posted_date).slice(0, 10) : null,
    logo: null,
    url: task?.task_url || 'https://www.taskrabbit.com/find-a-service',
    source: 'taskrabbit',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'small',
  });
}

async function fetchTaskRabbitJobs() {
  try {
    // TaskRabbit's public API lists available tasks/services.
    // Scraping/API access would require authentication, so returning placeholder.
    // Real implementation would use their API: https://www.taskrabbit.com/api
    console.log('[taskrabbit] 0 jobs (API requires authentication)');
    return [];
  } catch (err) {
    console.log(`[taskrabbit] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Craigslist Services & Gigs (Web Scraping) ──────────────────────────────

function normalizeCraigslistJob(posting) {
  const title = String(posting?.title || 'Service').trim() || 'Service';
  const location = String(posting?.location || 'Bay Area').trim() || 'Bay Area';
  const postedText = String(posting?.posted || '').trim();
  const description = String(posting?.body || '').substring(0, 500);

  const sourceText = [title, location, description].join(' ');

  return hydrateEndProductCategory({
    id: `craigslist_${posting?.pid || slugify(title + location + postedText)}`,
    title,
    company: 'Craigslist Service Provider',
    locations: [location],
    remotePreferences: [],
    jobTypes: ['Gig', 'Service'],
    datePosted: postedText ? postedText.slice(0, 10) : null,
    logo: null,
    url: posting?.url || 'https://www.craigslist.org/search/ggg',
    source: 'craigslist',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'startup',
  });
}

async function fetchCraigslistJobs() {
  try {
    // Craigslist RSS for jobs (jjj) and gigs (ggg) — <guid> holds the URL, not <link>
    const cities = [
      'sfbay', 'newyork', 'losangeles', 'chicago', 'houston',
      'philadelphia', 'denver', 'austin', 'seattle', 'portland',
      'atlanta', 'boston', 'dallas', 'miami', 'phoenix',
      'washingtondc', 'sandiego', 'minneapolis', 'detroit', 'orlando',
      'lasvegas', 'charlotte', 'nashville', 'sacramento', 'stlouis',
      'columbus', 'kansascity', 'cleveland', 'indianapolis', 'milwaukee',
      'pittsburgh', 'cincinnati', 'raleigh', 'richmond', 'saltlakecity',
      'neworleans', 'oklahomacity', 'boise', 'albuquerque', 'tampa',
    ];
    const categories = ['jjj', 'ggg', 'sof', 'web', 'egr', 'med', 'edu', 'bus'];
    const offsets = Array.from({ length: Math.max(1, Math.min(6, INGEST_VOLUME_MULTIPLIER + 1)) }, (_, i) => i * 120);
    const all = [];

    for (const city of cities) {
      for (const cat of categories) {
        for (const offset of offsets) {
          try {
            const r = await fetch(`https://${city}.craigslist.org/search/${cat}?format=rss&s=${offset}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
              signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
            });
            if (!r.ok) continue;
            const items = parseRssItems(await r.text());
            for (const item of items) {
              if (item.title && item.link) {
                all.push({
                  title: item.title,
                  location: city,
                  url: item.link,
                  pid: slugify(item.title + item.link),
                  posted: item.pubDate
                    ? (() => { try { return new Date(item.pubDate).toISOString().slice(0, 10); } catch { return new Date().toISOString().slice(0, 10); } })()
                    : new Date().toISOString().slice(0, 10),
                });
              }
            }
          } catch { continue; }
        }
      }
    }

    const normalized = all.map(normalizeCraigslistJob).filter((j) => j.id && j.title);
    console.log(`[craigslist] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[craigslist] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Angie's List (Home Services Professionals) ──────────────────────────────

function normalizeAngiesListJob(pro) {
  const name = String(pro?.name || 'Professional').trim() || 'Professional';
  const service = String(pro?.service || 'Home Service').trim() || 'Home Service';
  const location = String(pro?.service_area || 'Multiple Locations').trim() || 'Multiple Locations';
  const title = `${service} Professional: ${name}`;

  const sourceText = [title, location, String(pro?.bio || '')].join(' ');

  return hydrateEndProductCategory({
    id: `angieslist_${pro?.id || slugify(name + service)}`,
    title,
    company: name,
    locations: [location],
    remotePreferences: [],
    jobTypes: [service, 'Licensed', 'Vetted'],
    datePosted: null,
    logo: pro?.photo_url || null,
    url: pro?.profile_url || 'https://www.angieslist.com/companylist/us/all/all-services/companies.htm',
    source: 'angieslist',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'small',
  });
}

async function fetchAngiesListJobs() {
  try {
    // Angie's List requires scraping or API access with credentials.
    // Public endpoint is rate-limited and requires user-agent spoofing.
    console.log('[angieslist] 0 jobs (requires authentication)');
    return [];
  } catch (err) {
    console.log(`[angieslist] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── FlexJobs (Remote & Trade Jobs) ──────────────────────────────────────────

function normalizeFlexJobsJob(job) {
  const title = String(job?.job_title || 'Untitled role').trim() || 'Untitled role';
  const company = String(job?.company_name || 'Unknown company').trim() || 'Unknown company';
  const category = String(job?.category || '').trim();
  const jobType = String(job?.job_type || '').trim();
  const locations = String(job?.location || 'Remote').trim().split(',').filter(Boolean);

  const sourceText = [title, company, category, jobType].join(' ');

  return hydrateEndProductCategory({
    id: `flexjobs_${job?.id || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations: locations.length > 0 ? locations : ['Remote'],
    remotePreferences: (job?.remote === true || String(job?.remote || '').toLowerCase() === 'true') ? ['Remote'] : [],
    jobTypes: [jobType, category].filter(Boolean),
    datePosted: job?.date_posted ? String(job.date_posted).slice(0, 10) : null,
    logo: null,
    url: job?.job_url || 'https://www.flexjobs.com',
    source: 'flexjobs',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchFlexJobsJobs() {
  try {
    // FlexJobs requires paid membership for API access or web scraping.
    // Free tier has limited access.
    console.log('[flexjobs] 0 jobs (requires membership)');
    return [];
  } catch (err) {
    console.log(`[flexjobs] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Porch (Home Services & Contractors) ────────────────────────────────────

function normalizePorchJob(contractor) {
  const name = String(contractor?.business_name || 'Contractor').trim() || 'Contractor';
  const service = String(contractor?.service_type || 'Home Services').trim() || 'Home Services';
  const location = String(contractor?.service_area || 'Multiple Locations').trim() || 'Multiple Locations';
  const title = `${service}: ${name}`;

  const sourceText = [title, location, String(contractor?.description || '')].join(' ');

  return hydrateEndProductCategory({
    id: `porch_${contractor?.id || slugify(name + service)}`,
    title,
    company: name,
    locations: [location],
    remotePreferences: [],
    jobTypes: [service, 'Licensed', 'Insured'],
    datePosted: null,
    logo: contractor?.photo_url || null,
    url: contractor?.profile_url || 'https://www.porch.com',
    source: 'porch',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'small',
  });
}

async function fetchPorchJobs() {
  try {
    // Porch requires API authentication for contractor listings.
    console.log('[porch] 0 jobs (requires authentication)');
    return [];
  } catch (err) {
    console.log(`[porch] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Indeed (Largest Job Board via RSS Search Feeds) ───────────────────────

function normalizeIndeedJob(item, queryLabel = '') {
  const rawTitle = String(item?.title || '').trim();
  const description = String(item?.description || '').replace(/<[^>]+>/g, ' ').trim();
  const cleanTitle = rawTitle.replace(/\s+-\s+.*$/, '').trim();
  const title = cleanTitle || rawTitle || 'Untitled role';
  const sourceText = [rawTitle, title, description, queryLabel].join(' ');

  let company = 'Indeed Listing';
  const companyFromTitle = rawTitle.match(/-\s*([^\-|]+)$/);
  if (companyFromTitle?.[1]) {
    company = companyFromTitle[1].trim() || company;
  }

  const locationFromDesc = description.match(/\b([A-Za-z\s]+,\s*[A-Z]{2})\b/);
  const location = locationFromDesc?.[1] ? locationFromDesc[1].trim() : 'Multiple Locations';

  return hydrateEndProductCategory({
    id: `indeed_${slugify((item?.link || '') + '_' + title)}`,
    title,
    company,
    locations: [location],
    remotePreferences: /remote|work from home|anywhere|hybrid/i.test(sourceText) ? ['Remote'] : [],
    jobTypes: queryLabel ? [queryLabel] : [],
    datePosted: item?.pubDate
      ? (() => { try { return new Date(item.pubDate).toISOString().slice(0, 10); } catch { return null; } })()
      : null,
    logo: null,
    url: item?.link || 'https://www.indeed.com',
    source: 'indeed',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
    description: description.slice(0, 700),
  });
}

async function fetchIndeedJobs() {
  try {
    const queryVariants = [
      { q: 'software engineer', label: 'Engineering' },
      { q: 'data scientist', label: 'Data' },
      { q: 'machine learning engineer', label: 'AI/ML' },
      { q: 'product manager', label: 'Product' },
      { q: 'devops engineer', label: 'DevOps' },
      { q: 'sales manager', label: 'Sales' },
      { q: 'customer success manager', label: 'Customer Success' },
      { q: 'operations manager', label: 'Operations' },
      { q: 'finance analyst', label: 'Finance' },
      { q: 'legal counsel', label: 'Legal' },
      { q: 'sustainability analyst', label: 'Climate' },
      { q: 'renewable energy engineer', label: 'Climate' },
      { q: 'global health specialist', label: 'Global Health' },
      { q: 'biotech scientist', label: 'Biotech' },
      { q: 'supply chain manager', label: 'Supply Chain' },
      { q: 'nurse practitioner', label: 'Medical' },
      { q: 'teacher', label: 'Education' },
    ];
    const locations = ['Remote', 'United States', 'California', 'New York, NY', 'Texas'];
    const starts = Array.from({ length: Math.max(2, Math.min(8, INGEST_VOLUME_MULTIPLIER * 2)) }, (_, i) => i * 10);

    const items = [];
    for (const variant of queryVariants) {
      for (const location of locations) {
        for (const start of starts) {
          try {
            const params = new URLSearchParams({
              q: variant.q,
              l: location,
              start: String(start),
              sort: 'date',
            });
            const r = await fetch(`https://www.indeed.com/rss?${params.toString()}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
              signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
            });
            if (!r.ok) continue;
            const feedItems = parseRssItems(await r.text());
            for (const item of feedItems) {
              items.push({ ...item, __queryLabel: variant.label });
            }
          } catch {
            continue;
          }
        }
      }
    }

    const seen = new Set();
    const normalized = items
      .map((item) => normalizeIndeedJob(item, item.__queryLabel || ''))
      .filter((job) => job.id && job.title && !seen.has(job.id) && seen.add(job.id));
    console.log(`[indeed] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[indeed] 0 jobs (error: ${err.message})`);
    return [];
  }
}

function extractJsonLdObjectsFromHtml(html) {
  const blocks = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(String(html || ''))) !== null) {
    const raw = String(match[1] || '').trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Skip invalid JSON-LD blocks.
    }
  }

  const flat = [];
  const pushObj = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(pushObj);
      return;
    }
    if (Array.isArray(obj['@graph'])) {
      obj['@graph'].forEach(pushObj);
      return;
    }
    flat.push(obj);
  };
  blocks.forEach(pushObj);
  return flat;
}

function normalizeZipRecruiterJob(posting, sourceUrl) {
  const title = String(posting?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(posting?.hiringOrganization?.name || posting?.name || 'Unknown company').trim() || 'Unknown company';
  const location = String(posting?.jobLocation?.address?.addressLocality || posting?.jobLocation?.name || 'Multiple Locations').trim() || 'Multiple Locations';
  const description = String(posting?.description || '').replace(/<[^>]+>/g, ' ').trim();
  const sourceText = [title, company, location, description].join(' ');

  return hydrateEndProductCategory({
    id: `ziprecruiter_${slugify(String(posting?.url || sourceUrl || '') + '_' + title)}`,
    title,
    company,
    locations: [location],
    remotePreferences: /remote|work from home|anywhere|hybrid/i.test(sourceText) ? ['Remote'] : [],
    jobTypes: posting?.employmentType ? [String(posting.employmentType)] : [],
    datePosted: posting?.datePosted ? String(posting.datePosted).slice(0, 10) : null,
    logo: null,
    url: String(posting?.url || sourceUrl || 'https://www.ziprecruiter.com/jobs-search'),
    source: 'ziprecruiter',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
    description: description.slice(0, 700),
  });
}

async function fetchZipRecruiterJobs() {
  try {
    const queries = [
      'software engineer', 'data scientist', 'machine learning engineer', 'product manager',
      'devops engineer', 'sales manager', 'customer success manager', 'operations manager',
      'renewable energy engineer', 'nurse practitioner', 'teacher',
    ];
    const locations = ['Remote', 'United States'];
    const pages = Array.from({ length: Math.max(1, Math.min(6, INGEST_VOLUME_MULTIPLIER + 1)) }, (_, i) => i + 1);
    const items = [];

    for (const query of queries) {
      for (const location of locations) {
        for (const page of pages) {
          try {
            const params = new URLSearchParams({
              search: query,
              location,
              page: String(page),
            });
            const url = `https://www.ziprecruiter.com/jobs-search?${params.toString()}`;
            const r = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
              signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
            });
            if (r.status === 403) {
              console.log('[ziprecruiter] 0 jobs (blocked by anti-bot protection in current runtime)');
              return [];
            }
            if (!r.ok) continue;
            const html = await r.text();
            const jsonLd = extractJsonLdObjectsFromHtml(html);
            for (const obj of jsonLd) {
              if (String(obj?.['@type'] || '').toLowerCase() === 'jobposting') {
                items.push(normalizeZipRecruiterJob(obj, url));
              }
            }
          } catch {
            continue;
          }
        }
      }
    }

    const seen = new Set();
    const normalized = items.filter((job) => job.id && job.title && !seen.has(job.id) && seen.add(job.id));
    console.log(`[ziprecruiter] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[ziprecruiter] 0 jobs (error: ${err.message})`);
    return [];
  }
}

function normalizeMonsterJob(posting, sourceUrl) {
  const title = String(posting?.title || posting?.name || 'Untitled role').trim() || 'Untitled role';
  const company = String(posting?.hiringOrganization?.name || 'Unknown company').trim() || 'Unknown company';
  const location = String(posting?.jobLocation?.address?.addressLocality || posting?.jobLocation?.name || 'Multiple Locations').trim() || 'Multiple Locations';
  const description = String(posting?.description || '').replace(/<[^>]+>/g, ' ').trim();
  const sourceText = [title, company, location, description].join(' ');

  return hydrateEndProductCategory({
    id: `monster_${slugify(String(posting?.url || sourceUrl || '') + '_' + title)}`,
    title,
    company,
    locations: [location],
    remotePreferences: /remote|work from home|anywhere|hybrid/i.test(sourceText) ? ['Remote'] : [],
    jobTypes: posting?.employmentType ? [String(posting.employmentType)] : [],
    datePosted: posting?.datePosted ? String(posting.datePosted).slice(0, 10) : null,
    logo: null,
    url: String(posting?.url || sourceUrl || 'https://www.monster.com/jobs/search'),
    source: 'monster',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
    description: description.slice(0, 700),
  });
}

async function fetchMonsterJobs() {
  try {
    const queries = [
      'software engineer', 'data scientist', 'product manager', 'devops engineer',
      'sales manager', 'operations manager', 'marketing manager', 'teacher',
    ];
    const locations = ['remote', 'united-states'];
    const pages = Array.from({ length: Math.max(1, Math.min(5, INGEST_VOLUME_MULTIPLIER + 1)) }, (_, i) => i + 1);
    const items = [];

    for (const query of queries) {
      for (const location of locations) {
        for (const page of pages) {
          try {
            const q = encodeURIComponent(query.replace(/\s+/g, '-'));
            const l = encodeURIComponent(location);
            const url = `https://www.monster.com/jobs/search/?q=${q}&where=${l}&page=${page}`;
            const r = await fetch(url, {
              headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
              signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
            });
            if (r.status === 403) {
              console.log('[monster] 0 jobs (blocked by anti-bot protection in current runtime)');
              return [];
            }
            if (!r.ok) continue;
            const html = await r.text();
            const jsonLd = extractJsonLdObjectsFromHtml(html);
            for (const obj of jsonLd) {
              if (String(obj?.['@type'] || '').toLowerCase() === 'jobposting') {
                items.push(normalizeMonsterJob(obj, url));
              }
            }
          } catch {
            continue;
          }
        }
      }
    }

    const seen = new Set();
    const normalized = items.filter((job) => job.id && job.title && !seen.has(job.id) && seen.add(job.id));
    console.log(`[monster] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[monster] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── We Work Remotely (Remote Jobs via RSS) ────────────────────────────────

function normalizeWeWorkRemotelyJob(item) {
  // WWR RSS title format: "Company Name: Job Title"
  const rawTitle = String(item?.title || '').trim();
  const colonIdx = rawTitle.indexOf(': ');
  const company = colonIdx > 0 ? rawTitle.slice(0, colonIdx).trim() : 'Unknown company';
  const title = colonIdx > 0 ? rawTitle.slice(colonIdx + 2).trim() : rawTitle || 'Untitled role';
  const description = String(item?.description || '').replace(/<[^>]+>/g, ' ').substring(0, 200);
  const sourceText = [title, company, description].join(' ');

  return hydrateEndProductCategory({
    id: `weworkremotely_${slugify(rawTitle + (item?.link || ''))}`,
    title: title || 'Untitled role',
    company: company || 'Unknown company',
    locations: ['Remote'],
    remotePreferences: ['Remote'],
    jobTypes: [],
    datePosted: item?.pubDate ? (() => { try { return new Date(item.pubDate).toISOString().slice(0, 10); } catch { return null; } })() : null,
    logo: null,
    url: item?.link || 'https://www.weworkremotely.com',
    source: 'weworkremotely',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchWeWorkRemotelyJobs() {
  try {
    const feeds = [
      'https://weworkremotely.com/categories/remote-programming-jobs.rss',
      'https://weworkremotely.com/categories/remote-design-jobs.rss',
      'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
      'https://weworkremotely.com/categories/remote-product-management-jobs.rss',
      'https://weworkremotely.com/categories/remote-marketing-jobs.rss',
      'https://weworkremotely.com/categories/remote-finance-legal-jobs.rss',
      'https://weworkremotely.com/categories/remote-writing-jobs.rss',
      'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
    ];
    const all = [];
    for (const feed of feeds) {
      try {
        const r = await fetch(feed, {
          headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
          signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
        });
        if (!r.ok) continue;
        all.push(...parseRssItems(await r.text()));
      } catch { continue; }
    }
    const normalized = all.map(normalizeWeWorkRemotelyJob).filter((j) => j.id && j.title);
    console.log(`[weworkremotely] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[weworkremotely] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Remote.co (Remote Jobs RSS — replaces AngelList) ──────────────────────

function normalizeRemoteCoJob(item) {
  const rawTitle = String(item?.title || '').trim();
  const description = String(item?.description || '').replace(/<[^>]+>/g, ' ').substring(0, 200);
  const sourceText = [rawTitle, description].join(' ');

  return hydrateEndProductCategory({
    id: `remoteco_${slugify(rawTitle + (item?.link || ''))}`,
    title: rawTitle || 'Untitled role',
    company: 'Remote Company',
    locations: ['Remote'],
    remotePreferences: ['Remote'],
    jobTypes: [],
    datePosted: item?.pubDate ? (() => { try { return new Date(item.pubDate).toISOString().slice(0, 10); } catch { return null; } })() : null,
    logo: null,
    url: item?.link || 'https://remote.co/remote-jobs/',
    source: 'remoteco',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'startup',
  });
}

async function fetchAngelListJobs() {
  try {
    // Remote.co public RSS feeds — replaces defunct AngelList API
    const feeds = [
      'https://remote.co/remote-jobs/developer/feed/',
      'https://remote.co/remote-jobs/designer/feed/',
      'https://remote.co/remote-jobs/manager-director/feed/',
      'https://remote.co/remote-jobs/writer/feed/',
      'https://remote.co/remote-jobs/customer-service/feed/',
      'https://remote.co/remote-jobs/sales/feed/',
      'https://remote.co/remote-jobs/recruiter/feed/',
    ];
    const all = [];
    for (const feed of feeds) {
      try {
        const r = await fetch(feed, {
          headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
          signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
        });
        if (!r.ok) continue;
        all.push(...parseRssItems(await r.text()));
      } catch { continue; }
    }
    const normalized = all.map(normalizeRemoteCoJob).filter((j) => j.id && j.title);
    console.log(`[remoteco] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[remoteco] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Python.org Jobs (Developer Jobs JSON — replaces Dev.to) ─────────────

function normalizePythonOrgJob(item) {
  const title = String(item?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(
    item?.author?.name || (Array.isArray(item?.authors) && item.authors[0]?.name) || 'Unknown company'
  ).trim() || 'Unknown company';
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  const locationTag = tags.find((t) => /^location:/i.test(t));
  const location = locationTag ? locationTag.replace(/^location:/i, '').trim() : 'Multiple Locations';
  const description = String(item?.summary || item?.content_text || '').substring(0, 200);
  const isRemote = /remote/i.test(location + ' ' + description);
  const sourceText = [title, company, location, ...tags, description].join(' ');

  return hydrateEndProductCategory({
    id: `pythondotorg_${item?.id || slugify(title + company)}`,
    title,
    company,
    locations: [location],
    remotePreferences: isRemote ? ['Remote'] : [],
    jobTypes: tags.filter((t) => !/^location:/i.test(t)).slice(0, 3),
    datePosted: item?.date_published ? String(item.date_published).slice(0, 10) : null,
    logo: null,
    url: item?.url || item?.external_url || 'https://www.python.org/jobs/',
    source: 'pythondotorg',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchDevToJobs() {
  try {
    // Python.org jobs RSS feed (JSON endpoint no longer available)
    const r = await fetch('https://www.python.org/jobs/feed/rss/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
      signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) {
      console.log(`[pythondotorg] 0 jobs (HTTP ${r.status})`);
      return [];
    }
    const items = parseRssItems(await r.text());
    const normalized = items
      .map((item) => {
        const rawTitle = String(item?.title || '').trim();
        const parts = rawTitle.split(/\s+at\s+/i);
        const title = parts[0] || rawTitle || 'Untitled role';
        const company = parts[1] || 'Unknown company';
        return hydrateEndProductCategory({
          id: `pythondotorg_${slugify((item?.link || '') + '_' + rawTitle)}`,
          title,
          company,
          locations: ['Multiple Locations'],
          remotePreferences: /remote|work from home|anywhere/i.test(rawTitle + ' ' + String(item?.description || '')) ? ['Remote'] : [],
          jobTypes: [],
          datePosted: item?.pubDate
            ? (() => { try { return new Date(item.pubDate).toISOString().slice(0, 10); } catch { return null; } })()
            : null,
          logo: null,
          url: item?.link || 'https://www.python.org/jobs/',
          source: 'pythondotorg',
          jobField: inferJobFieldFromText(`${title} ${company} ${item?.description || ''}`),
          companySize: classifyCompanySize(company),
        });
      })
      .filter((j) => j.id && j.title);
    console.log(`[pythondotorg] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[pythondotorg] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Dribbble (Design/Creative Jobs) ──────────────────────────────────────

function normalizeDribbbleJob(job) {
  const title = String(job?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(job?.company?.name || 'Unknown company').trim() || 'Unknown company';
  const location = String(job?.location || 'Remote').trim() || 'Remote';
  const experience = String(job?.experience_level || '').trim();

  const sourceText = [title, company, location, experience, 'design'].join(' ');

  return hydrateEndProductCategory({
    id: `dribbble_${job?.id || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations: [location],
    remotePreferences: (job?.remote === true || location.toLowerCase() === 'remote') ? ['Remote'] : [],
    jobTypes: ['Design', ...(experience ? [experience] : [])],
    datePosted: job?.published_at ? String(job.published_at).slice(0, 10) : null,
    logo: job?.company?.avatar_url || null,
    url: job?.url || 'https://dribbble.com/jobs',
    source: 'dribbble',
    jobField: 'climate', // Default, but design is distinct
    companySize: classifyCompanySize(company),
  });
}

async function fetchDribbbleJobs() {
  try {
    // Dribbble has a public jobs listing but scraping requires careful handling
    console.log('[dribbble] 0 jobs (requires authentication)');
    return [];
  } catch (err) {
    console.log(`[dribbble] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Hacker News "Who is Hiring" (Tech Jobs via Algolia) ──────────────────

function normalizeHackerNewsJob(item) {
  // Supports both Algolia format (comment_text, created_at, objectID) and Firebase format (text, time, id)
  const rawText = String(item?.comment_text || item?.text || '').replace(/<[^>]+>/g, ' ').trim();
  const titleMatch = rawText.match(/^([^|\n]{10,100})(?:\s*\||\n)/) || rawText.match(/^(.{10,100})/);
  const title = titleMatch ? titleMatch[1].trim() : rawText.substring(0, 100).trim();
  const companyMatch = rawText.match(/\|\s*([^|]+?)\s*(?:\||$)/);
  const company = companyMatch ? companyMatch[1].trim() : (item?.author || 'HN Hiring');
  const isRemote = /remote|distributed|anywhere/i.test(rawText);

  const sourceText = rawText;

  return hydrateEndProductCategory({
    id: `hackernews_${item?.objectID || item?.id || slugify(title + company)}`,
    title: title || 'Untitled role',
    company,
    locations: [isRemote ? 'Remote' : 'On-site'],
    remotePreferences: isRemote ? ['Remote'] : [],
    jobTypes: ['Engineering'],
    datePosted: item?.created_at
      ? String(item.created_at).slice(0, 10)
      : (item?.time ? new Date(item.time * 1000).toISOString().slice(0, 10) : null),
    logo: null,
    url: item?.url || `https://news.ycombinator.com/item?id=${item?.objectID || item?.id}`,
    source: 'hackernews',
    jobField: inferJobFieldFromText(sourceText),
    companySize: classifyCompanySize(company),
  });
}

async function fetchHackerNewsJobs() {
  try {
    // Step 1: Find recent "Ask HN: Who is Hiring?" threads via Algolia
    const hnThreadCount = Math.max(8, Math.min(20, INGEST_VOLUME_MULTIPLIER * 4));
    const searchR = await fetch(
      `https://hn.algolia.com/api/v1/search?tags=ask_hn,story&query=Ask+HN%3A+Who+is+Hiring%3F&hitsPerPage=${hnThreadCount}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' }, signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) },
    );
    if (!searchR.ok) {
      console.log('[hackernews] 0 jobs (Algolia unavailable)');
      return [];
    }
    const searchPayload = await searchR.json();
    const threads = Array.isArray(searchPayload?.hits) ? searchPayload.hits.filter((t) => t?.objectID) : [];
    if (threads.length === 0) {
      console.log('[hackernews] 0 jobs (no hiring thread found)');
      return [];
    }

    // Step 2: Fetch top-level comments from each recent monthly story
    const combined = [];
    for (const thread of threads) {
      const storyId = String(thread.objectID);
      try {
        const commentsR = await fetch(
          `https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_${storyId}&hitsPerPage=1000`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' }, signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS) },
        );
        if (!commentsR.ok) continue;
        const commentsPayload = await commentsR.json();
        const comments = Array.isArray(commentsPayload?.hits) ? commentsPayload.hits : [];
        const topLevel = comments.filter((c) => String(c?.parent_id) === storyId && c?.comment_text);
        combined.push(...topLevel);
      } catch {
        continue;
      }
    }

    const seen = new Set();
    const normalized = combined
      .map(normalizeHackerNewsJob)
      .filter((j) => j.id && j.title && !seen.has(j.id) && seen.add(j.id));
    console.log(`[hackernews] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[hackernews] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Jooble (Public Search Pages via RSS) ──────────────────────────────────

function normalizeJoobleJob(item, queryLabel = '') {
  const rawTitle = String(item?.title || '').trim();
  const title = rawTitle.replace(/^\[[^\]]+\]\s*/g, '').trim() || 'Untitled role';
  const description = String(item?.description || '').replace(/<[^>]+>/g, ' ').trim();
  const sourceText = [title, description, queryLabel].join(' ');

  return hydrateEndProductCategory({
    id: `jooble_${slugify((item?.link || '') + '_' + title)}`,
    title,
    company: 'Jooble Listing',
    locations: ['Multiple Locations'],
    remotePreferences: /remote|work from home|anywhere/i.test(sourceText) ? ['Remote'] : [],
    jobTypes: queryLabel ? [queryLabel] : [],
    datePosted: item?.pubDate
      ? (() => { try { return new Date(item.pubDate).toISOString().slice(0, 10); } catch { return null; } })()
      : null,
    logo: null,
    url: item?.link || 'https://jooble.org',
    source: 'jooble',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'small',
    description,
  });
}

async function fetchJoobleJobs() {
  try {
    const queryVariants = [
      { q: 'software engineer', label: 'Engineering' },
      { q: 'data scientist', label: 'Data' },
      { q: 'machine learning engineer', label: 'AI/ML' },
      { q: 'product manager', label: 'Product' },
      { q: 'ux designer', label: 'Design' },
      { q: 'devops engineer', label: 'DevOps' },
      { q: 'backend engineer', label: 'Engineering' },
      { q: 'frontend engineer', label: 'Engineering' },
      { q: 'full stack engineer', label: 'Engineering' },
      { q: 'security engineer', label: 'Security' },
      { q: 'site reliability engineer', label: 'DevOps' },
      { q: 'cloud engineer', label: 'Cloud' },
      { q: 'mobile developer', label: 'Mobile' },
      { q: 'embedded engineer', label: 'Embedded' },
      { q: 'research scientist ai', label: 'AI/ML' },
      { q: 'data engineer', label: 'Data' },
      { q: 'business analyst', label: 'Analytics' },
      { q: 'project manager', label: 'Project Management' },
      { q: 'sales manager', label: 'Sales' },
      { q: 'account executive', label: 'Sales' },
      { q: 'customer success', label: 'Customer Success' },
      { q: 'customer support specialist', label: 'Support' },
      { q: 'operations manager', label: 'Operations' },
      { q: 'finance manager', label: 'Finance' },
      { q: 'legal counsel', label: 'Legal' },
      { q: 'recruiter talent', label: 'People' },
      { q: 'marketing manager', label: 'Marketing' },
      { q: 'policy analyst climate', label: 'Policy' },
      { q: 'renewable energy engineer', label: 'Climate' },
      { q: 'sustainability analyst', label: 'Climate' },
      { q: 'solar engineer', label: 'Climate' },
      { q: 'battery engineer', label: 'Climate' },
      { q: 'global health analyst', label: 'Global Health' },
      { q: 'biotech scientist', label: 'Biotech' },
      { q: 'clinical data manager', label: 'Medical' },
      { q: 'supply chain manager', label: 'Supply Chain' },
      { q: 'procurement specialist', label: 'Supply Chain' },
      { q: 'manufacturing engineer', label: 'Manufacturing' },
      { q: 'teacher education technology', label: 'EdTech' },
      { q: 'software engineer remote', label: 'Engineering' },
      { q: 'data scientist remote', label: 'Data' },
      { q: 'ml engineer remote', label: 'AI/ML' },
      { q: 'product manager remote', label: 'Product' },
      { q: 'cybersecurity analyst', label: 'Security' },
      { q: 'qa engineer', label: 'Quality' },
      { q: 'platform engineer', label: 'Infrastructure' },
      { q: 'site reliability', label: 'DevOps' },
      { q: 'solutions architect', label: 'Cloud' },
      { q: 'data analyst', label: 'Analytics' },
      { q: 'business operations', label: 'Operations' },
      { q: 'technical writer', label: 'Writing' },
      { q: 'customer support remote', label: 'Support' },
      { q: 'recruiting coordinator', label: 'People' },
      { q: 'people operations', label: 'People' },
      { q: 'accounting manager', label: 'Finance' },
      { q: 'financial analyst', label: 'Finance' },
      { q: 'legal operations', label: 'Legal' },
      { q: 'policy manager', label: 'Policy' },
      { q: 'climate analyst', label: 'Climate' },
      { q: 'energy analyst', label: 'Climate' },
      { q: 'carbon accounting', label: 'Climate' },
      { q: 'global health manager', label: 'Global Health' },
      { q: 'public health specialist', label: 'Global Health' },
      { q: 'biostatistician', label: 'Medical' },
      { q: 'research associate biotech', label: 'Biotech' },
      { q: 'sourcing manager', label: 'Supply Chain' },
      { q: 'logistics analyst', label: 'Supply Chain' },
      { q: 'industrial engineer', label: 'Manufacturing' },
      { q: 'instructional designer', label: 'EdTech' },
      { q: 'curriculum developer', label: 'EdTech' },
      { q: 'nurse practitioner', label: 'Medical' },
      { q: 'physician assistant', label: 'Medical' },
      { q: 'teacher', label: 'Education' },
      { q: 'account executive remote', label: 'Sales' },
      { q: 'sales development representative', label: 'Sales' },
      { q: 'growth marketing', label: 'Marketing' },
      { q: 'content strategist', label: 'Marketing' },
      { q: 'executive assistant', label: 'Operations' },
      { q: 'chief of staff', label: 'Operations' },
    ];

    const joobleModifiers = [
      'remote',
      'usa',
      'worldwide',
      'entry level',
      'senior',
      'contract',
      'part time',
      'full time',
      'hybrid',
      'onsite',
    ].slice(0, Math.min(10, INGEST_VOLUME_MULTIPLIER * 2));

    const expandedVariants = [];
    const baseForExpansion = queryVariants.slice(0, Math.min(queryVariants.length, 30 + (INGEST_VOLUME_MULTIPLIER * 10)));
    for (const base of baseForExpansion) {
      for (const modifier of joobleModifiers) {
        expandedVariants.push({ q: `${base.q} ${modifier}`.trim(), label: base.label });
      }
    }

    const seenQueries = new Set();
    const allVariants = [...queryVariants, ...expandedVariants].filter((variant) => {
      const key = `${variant.label}|${variant.q}`.toLowerCase();
      if (seenQueries.has(key)) return false;
      seenQueries.add(key);
      return true;
    });

    const items = [];
    for (const variant of allVariants) {
      try {
        const params = new URLSearchParams({
          q: variant.q,
          r: '1',
        });
        const r = await fetch(`https://jooble.org/rss?${params.toString()}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
          signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
        });
        if (!r.ok) continue;
        const feedItems = parseRssItems(await r.text());
        for (const item of feedItems) {
          items.push({ ...item, __queryLabel: variant.label });
        }
      } catch {
        continue;
      }
    }

    const normalized = items
      .map((item) => normalizeJoobleJob(item, item.__queryLabel || ''))
      .filter((job) => job.id && job.title);
    console.log(`[jooble] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[jooble] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── ReliefWeb (Global Humanitarian Jobs API) ─────────────────────────────

function normalizeReliefWebJob(item) {
  const fields = item?.fields || {};
  const title = String(fields?.title || 'Untitled role').trim() || 'Untitled role';
  const sourceOrg = Array.isArray(fields?.source) && fields.source.length > 0
    ? String(fields.source[0]?.name || 'ReliefWeb Organization').trim()
    : 'ReliefWeb Organization';
  const countries = Array.isArray(fields?.country)
    ? fields.country.map((country) => String(country?.name || '').trim()).filter(Boolean)
    : [];
  const careerCategories = Array.isArray(fields?.career_categories)
    ? fields.career_categories.map((c) => String(c?.name || '').trim()).filter(Boolean)
    : [];
  const bodyText = String(fields?.body || '').replace(/<[^>]+>/g, ' ').slice(0, 700);
  const sourceText = [title, sourceOrg, countries.join(' '), careerCategories.join(' '), bodyText].join(' ');

  return hydrateEndProductCategory({
    id: `reliefweb_${item?.id || slugify(`${sourceOrg}_${title}`)}`,
    title,
    company: sourceOrg || 'ReliefWeb Organization',
    locations: countries.length > 0 ? countries : ['Global'],
    remotePreferences: /remote|home-?based|work from home|anywhere/i.test(sourceText) ? ['Remote'] : [],
    jobTypes: careerCategories,
    datePosted: fields?.date?.created ? String(fields.date.created).slice(0, 10) : null,
    logo: null,
    url: String(fields?.url || item?.href || 'https://reliefweb.int/jobs'),
    source: 'reliefweb',
    jobField: 'globalhealth',
    companySize: classifyCompanySize(sourceOrg),
    description: bodyText,
  });
}

async function fetchReliefWebJobs() {
  try {
    const perPage = 250;
    const pages = Math.max(6, Math.min(16, INGEST_VOLUME_MULTIPLIER * 4));
    const data = [];
    let accessDenied = false;

    for (let page = 0; page < pages; page += 1) {
      const params = new URLSearchParams({
        appname: String(process.env.RELIEFWEB_APPNAME || '').trim() || 'job-finder.invalid',
        profile: 'full',
        limit: String(perPage),
        offset: String(page * perPage),
      });
      const r = await fetch(`https://api.reliefweb.int/v2/jobs?${params.toString()}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
        signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
      });
      if (r.status === 403) {
        accessDenied = true;
        break;
      }
      if (!r.ok) break;
      const payload = await r.json();
      const chunk = Array.isArray(payload?.data) ? payload.data : [];
      if (chunk.length === 0) break;
      data.push(...chunk);
      if (chunk.length < perPage) break;
    }

    const normalized = data.map(normalizeReliefWebJob).filter((job) => job.id && job.title);
    if (normalized.length === 0 && accessDenied) {
      console.log('[reliefweb] 0 jobs (RELIEFWEB_APPNAME approval required)');
      return [];
    }
    console.log(`[reliefweb] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[reliefweb] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Reddit Hiring Communities (Public JSON feeds) ────────────────────────

function normalizeRedditHiringJob(post, subreddit) {
  const title = String(post?.title || 'Untitled role').trim() || 'Untitled role';
  const selfText = String(post?.selftext || '').replace(/\s+/g, ' ').trim();
  const isHiring = /\[hiring\]|hiring|we\s+are\s+hiring|job\s+opening/i.test(title + ' ' + selfText);
  const isRemote = /remote|work from home|anywhere/i.test(title + ' ' + selfText);
  const sourceText = [title, selfText, subreddit].join(' ');

  return hydrateEndProductCategory({
    id: `redditjobs_${post?.id || slugify(title)}`,
    title,
    company: `r/${subreddit}`,
    locations: [isRemote ? 'Remote' : 'Multiple Locations'],
    remotePreferences: isRemote ? ['Remote'] : [],
    jobTypes: [isHiring ? 'Hiring' : 'Opportunity'],
    datePosted: post?.created_utc ? new Date(post.created_utc * 1000).toISOString().slice(0, 10) : null,
    logo: null,
    url: post?.url || (post?.permalink ? `https://www.reddit.com${post.permalink}` : 'https://www.reddit.com'),
    source: 'redditjobs',
    jobField: inferJobFieldFromText(sourceText),
    companySize: 'small',
    description: selfText.slice(0, 700),
  });
}

async function fetchRedditJobs() {
  try {
    const subreddits = [
      'forhire', 'remotejobs', 'hiring', 'jobbit', 'remotework',
      'jobopenings', 'jobs', 'techjobs', 'devjobs', 'cscareerquestions',
    ];
    const listingModes = ['new', 'hot', 'rising', 'top'];
    const redditPageDepth = Math.max(1, Math.min(4, INGEST_VOLUME_MULTIPLIER));
    const posts = [];
    let blockedByReddit = false;

    for (const subreddit of subreddits) {
      for (const mode of listingModes) {
        try {
          let after = null;
          for (let page = 0; page < redditPageDepth; page += 1) {
            const suffix = mode === 'top' ? 't=month&' : '';
            const afterParam = after ? `&after=${encodeURIComponent(after)}` : '';
            const r = await fetch(`https://www.reddit.com/r/${subreddit}/${mode}.json?${suffix}limit=100${afterParam}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
              signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
            });
            if (r.status === 403) {
              blockedByReddit = true;
              break;
            }
            if (!r.ok) break;
            const payload = await r.json();
            const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
            for (const child of children) {
              if (child?.data) posts.push({ ...child.data, __subreddit: subreddit });
            }
            after = payload?.data?.after || null;
            if (!after || children.length === 0) break;
          }
        } catch {
          continue;
        }
        if (blockedByReddit) break;
      }
      if (blockedByReddit) break;
    }

    const globalSearchQueries = [
      '%5BHiring%5D',
      'hiring+remote',
      'job+opening+software',
      'we+are+hiring',
      'hiring+data+scientist',
      'hiring+product+manager',
      'hiring+devops',
      'hiring+sales',
      'hiring+customer+success',
      'hiring+climate',
    ];

    for (const encodedQuery of globalSearchQueries) {
      if (blockedByReddit) break;
      try {
        let after = null;
        for (let page = 0; page < redditPageDepth; page += 1) {
          const afterParam = after ? `&after=${encodeURIComponent(after)}` : '';
          const r = await fetch(`https://www.reddit.com/search.json?q=${encodedQuery}&sort=new&t=month&limit=100${afterParam}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (job-finder/1.0)' },
            signal: AbortSignal.timeout(ATS_FETCH_TIMEOUT_MS),
          });
          if (r.status === 403) {
            blockedByReddit = true;
            break;
          }
          if (!r.ok) break;
          const payload = await r.json();
          const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
          for (const child of children) {
            if (child?.data) posts.push({ ...child.data, __subreddit: String(child.data.subreddit || 'jobs') });
          }
          after = payload?.data?.after || null;
          if (!after || children.length === 0) break;
        }
      } catch {
        continue;
      }
    }

    if (blockedByReddit && posts.length === 0) {
      console.log('[redditjobs] 0 jobs (blocked by anti-bot protection in current runtime)');
      return [];
    }

    const seenPostIds = new Set();
    const normalized = posts
      .filter((post) => {
        const id = String(post?.id || '').trim();
        if (!id || seenPostIds.has(id)) return false;
        seenPostIds.add(id);
        return true;
      })
      .filter((post) => /\[hiring\]|hiring|job|opening|vacancy|position/i.test(`${post?.title || ''} ${post?.selftext || ''}`))
      .map((post) => normalizeRedditHiringJob(post, post.__subreddit || 'jobs'))
      .filter((job) => job.id && job.title);
    console.log(`[redditjobs] ${normalized.length} jobs`);
    return normalized;
  } catch (err) {
    console.log(`[redditjobs] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Idealist.org (Nonprofit/NGO Jobs) ────────────────────────────────────

function normalizeIdealistJob(posting) {
  const title = String(posting?.title || 'Untitled role').trim() || 'Untitled role';
  const org = String(posting?.organization?.name || 'Unknown organization').trim() || 'Unknown organization';
  const locations = Array.isArray(posting?.locations)
    ? posting.locations.map((l) => String(l?.city || l?.country || '').trim()).filter(Boolean)
    : [String(posting?.location || 'Multiple Locations').trim() || 'Multiple Locations'];
  const type = String(posting?.posting_type || 'Position').trim();

  const sourceText = [title, org, type, 'nonprofit'].join(' ');

  return hydrateEndProductCategory({
    id: `idealist_${posting?.id || slugify(`${org}_${title}`)}`,
    title,
    company: org,
    locations: locations.length > 0 ? locations : ['Multiple Locations'],
    remotePreferences: [],
    jobTypes: [type],
    datePosted: posting?.updated_at ? String(posting.updated_at).slice(0, 10) : null,
    logo: null,
    url: posting?.url || 'https://www.idealist.org',
    source: 'idealist',
    jobField: 'globalhealth',
    companySize: 'small',
  });
}

async function fetchIdealistJobs() {
  try {
    // Idealist.org has limited public API access
    console.log('[idealist] 0 jobs (requires authentication)');
    return [];
  } catch (err) {
    console.log(`[idealist] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Kaggle (Data Science Jobs) ───────────────────────────────────────────

function normalizeKaggleJob(job) {
  const title = String(job?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(job?.company?.name || 'Unknown company').trim() || 'Unknown company';
  const location = String(job?.location || 'Remote').trim() || 'Remote';
  const salaryMin = job?.salary_min ? `$${job.salary_min}k` : '';

  const sourceText = [title, company, location, 'data science', salaryMin].join(' ');

  return hydrateEndProductCategory({
    id: `kaggle_${job?.id || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations: [location],
    remotePreferences: (job?.remote === true) ? ['Remote'] : [],
    jobTypes: ['Data Science', ...(salaryMin ? [salaryMin] : [])],
    datePosted: job?.posted_date ? String(job.posted_date).slice(0, 10) : null,
    logo: null,
    url: job?.url || 'https://www.kaggle.com/jobs',
    source: 'kaggle',
    jobField: 'edtech',
    companySize: classifyCompanySize(company),
  });
}

async function fetchKaggleJobs() {
  try {
    // Kaggle has a public jobs page but requires scraping or membership
    console.log('[kaggle] 0 jobs (requires authentication)');
    return [];
  } catch (err) {
    console.log(`[kaggle] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Product Hunt (Startup/Product Jobs) ──────────────────────────────────

function normalizeProductHuntJob(job) {
  const title = String(job?.title || 'Untitled role').trim() || 'Untitled role';
  const company = String(job?.company?.name || 'Unknown company').trim() || 'Unknown company';
  const location = String(job?.location || 'Remote').trim() || 'Remote';
  const category = String(job?.category || 'Product').trim();

  const sourceText = [title, company, location, category, 'startup'].join(' ');

  return hydrateEndProductCategory({
    id: `producthunt_${job?.id || slugify(`${company}_${title}`)}`,
    title,
    company,
    locations: [location],
    remotePreferences: (job?.remote === true || location.toLowerCase() === 'remote') ? ['Remote'] : [],
    jobTypes: [category],
    datePosted: job?.created_at ? String(job.created_at).slice(0, 10) : null,
    logo: job?.company?.image_url || null,
    url: job?.url || 'https://www.producthunt.com/jobs',
    source: 'producthunt',
    jobField: 'climate',
    companySize: 'startup',
  });
}

async function fetchProductHuntJobs() {
  try {
    // Product Hunt jobs require API key or scraping
    console.log('[producthunt] 0 jobs (requires authentication)');
    return [];
  } catch (err) {
    console.log(`[producthunt] 0 jobs (error: ${err.message})`);
    return [];
  }
}

// ─── Combined Ingestion ────────────────────────────────────────────────────
async function fetchJobSourceBatch(sources) {
  return Promise.all(sources.map(async ({ label, fetcher }) => {
    try {
      return await fetcher();
    } catch (error) {
      console.warn(`[ingest] ${label} failed (${error?.message || 'unknown error'})`);
      return [];
    }
  }));
}

async function fetchAllJobs() {
  const ingestStartedAt = Date.now();
  const [
    climatebaseJobs,
    greenhouseJobs,
    leverJobs,
    ashbyJobs,
    breezyJobs,
    bambooJobs,
    builtInJobs,
    terraJobs,
    eightykJobs,
    remoteokJobs,
    remotiveJobs,
    arbeitnowJobs,
    themuseJobs,
    usajobsJobs,
    upworkJobs,
    diceJobs,
    taskrabbitJobs,
    craigslistJobs,
    angieslistJobs,
    flexjobsJobs,
    porchJobs,
    indeedJobs,
    zipRecruiterJobs,
    monsterJobs,
    weworkremotelyJobs,
    angellistJobs,
    devtoJobs,
    dribbbleJobs,
    hackerNewsJobs,
    joobleJobs,
    reliefwebJobs,
    redditJobs,
    idealistJobs,
    kaggleJobs,
    producthuntJobs,
  ] = await fetchJobSourceBatch([
    { label: 'climatebase', fetcher: fetchClimatebaseJobs },
    { label: 'greenhouse', fetcher: fetchGreenhouseJobs },
    { label: 'lever', fetcher: fetchLeverJobs },
    { label: 'ashby', fetcher: fetchAshbyJobs },
    { label: 'breezy', fetcher: fetchBreezyJobs },
    { label: 'bamboo', fetcher: fetchBambooJobs },
    { label: 'builtin', fetcher: fetchBuiltInJobs },
    { label: 'terra', fetcher: fetchTerraJobs },
    { label: '80khours', fetcher: fetch80kHoursJobs },
    { label: 'remoteok', fetcher: fetchRemoteOKJobs },
    { label: 'remotive', fetcher: fetchRemotiveJobs },
    { label: 'arbeitnow', fetcher: fetchArbeitnowJobs },
    { label: 'themuse', fetcher: fetchTheMuseJobs },
    { label: 'usajobs', fetcher: fetchUSAJobsJobs },
    { label: 'upwork', fetcher: fetchUpworkJobs },
    { label: 'dice', fetcher: fetchDiceJobs },
    { label: 'taskrabbit', fetcher: fetchTaskRabbitJobs },
    { label: 'craigslist', fetcher: fetchCraigslistJobs },
    { label: 'angieslist', fetcher: fetchAngiesListJobs },
    { label: 'flexjobs', fetcher: fetchFlexJobsJobs },
    { label: 'porch', fetcher: fetchPorchJobs },
    { label: 'indeed', fetcher: fetchIndeedJobs },
    { label: 'ziprecruiter', fetcher: fetchZipRecruiterJobs },
    { label: 'monster', fetcher: fetchMonsterJobs },
    { label: 'weworkremotely', fetcher: fetchWeWorkRemotelyJobs },
    { label: 'angellist', fetcher: fetchAngelListJobs },
    { label: 'devto', fetcher: fetchDevToJobs },
    { label: 'dribbble', fetcher: fetchDribbbleJobs },
    { label: 'hackernews', fetcher: fetchHackerNewsJobs },
    { label: 'jooble', fetcher: fetchJoobleJobs },
    { label: 'reliefweb', fetcher: fetchReliefWebJobs },
    { label: 'redditjobs', fetcher: fetchRedditJobs },
    { label: 'idealist', fetcher: fetchIdealistJobs },
    { label: 'kaggle', fetcher: fetchKaggleJobs },
    { label: 'producthunt', fetcher: fetchProductHuntJobs },
  ]);

  // Deduplicate by source-specific identity first so cross-platform duplicates are retained.
  // This intentionally favors higher volume over aggressive cross-source collapse.
  const seen = new Set();
  const all = [];
  for (const job of [
    ...climatebaseJobs,
    ...greenhouseJobs,
    ...leverJobs,
    ...ashbyJobs,
    ...breezyJobs,
    ...bambooJobs,
    ...builtInJobs,
    ...terraJobs,
    ...eightykJobs,
    ...remoteokJobs,
    ...remotiveJobs,
    ...arbeitnowJobs,
    ...themuseJobs,
    ...usajobsJobs,
    ...upworkJobs,
    ...diceJobs,
    ...taskrabbitJobs,
    ...craigslistJobs,
    ...angieslistJobs,
    ...flexjobsJobs,
    ...porchJobs,
    ...indeedJobs,
    ...zipRecruiterJobs,
    ...monsterJobs,
    ...weworkremotelyJobs,
    ...angellistJobs,
    ...devtoJobs,
    ...dribbbleJobs,
    ...hackerNewsJobs,
    ...joobleJobs,
    ...reliefwebJobs,
    ...redditJobs,
    ...idealistJobs,
    ...kaggleJobs,
    ...producthuntJobs,
  ]) {
    const source = String(job?.source || '').trim().toLowerCase();
    const stableId = String(job?.id || '').trim();
    const key = stableId
      ? `${source}|${stableId}`
      : `${source}|${slugify(job.title)}_${slugify(job.company)}_${slugify(job.url || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(job);
  }

  const sourceCounts = {
    climatebase: climatebaseJobs.length,
    greenhouse: greenhouseJobs.length,
    lever: leverJobs.length,
    ashby: ashbyJobs.length,
    breezy: breezyJobs.length,
    bamboo: bambooJobs.length,
    builtin: builtInJobs.length,
    terra: terraJobs.length,
    '80khours': eightykJobs.length,
    remoteok: remoteokJobs.length,
    remotive: remotiveJobs.length,
    arbeitnow: arbeitnowJobs.length,
    themuse: themuseJobs.length,
    usajobs: usajobsJobs.length,
    upwork: upworkJobs.length,
    dice: diceJobs.length,
    taskrabbit: taskrabbitJobs.length,
    craigslist: craigslistJobs.length,
    angieslist: angieslistJobs.length,
    flexjobs: flexjobsJobs.length,
    porch: porchJobs.length,
    indeed: indeedJobs.length,
    ziprecruiter: zipRecruiterJobs.length,
    monster: monsterJobs.length,
    weworkremotely: weworkremotelyJobs.length,
    angellist: angellistJobs.length,
    devto: devtoJobs.length,
    dribbble: dribbbleJobs.length,
    hackernews: hackerNewsJobs.length,
    jooble: joobleJobs.length,
    reliefweb: reliefwebJobs.length,
    redditjobs: redditJobs.length,
    idealist: idealistJobs.length,
    kaggle: kaggleJobs.length,
    producthunt: producthuntJobs.length,
  };
  const entries = Object.entries(sourceCounts);
  const zeroSources = entries.filter(([, count]) => Number(count || 0) === 0).map(([label]) => label);
  const topSources = entries
    .slice()
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))
    .slice(0, 8)
    .map(([label, count]) => `${label}:${count}`);
  const totalRaw = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const durationMs = Date.now() - ingestStartedAt;
  const criticalSources = ['climatebase', 'greenhouse', 'lever', 'hackernews', 'indeed', 'redditjobs', 'jooble'];
  const criticalZero = criticalSources.filter((label) => Number(sourceCounts[label] || 0) === 0);
  const anomalies = [];
  if (durationMs >= INGEST_HEALTH_WARN_SLOW_MS) anomalies.push('slow-ingest');
  if (criticalZero.length > 0) anomalies.push('critical-source-zero');

  if (INGEST_HEALTH_VERBOSE || anomalies.length > 0) {
    console.log(`[ingest-health] ${JSON.stringify({
      durationMs,
      totalUnique: all.length,
      totalRaw,
      sourceCount: entries.length,
      topSources,
      zeroSources,
      criticalZero,
      anomalies,
    })}`);
  }

  console.log(
    `[ingest] Total unique: ${all.length}` +
    ` (climatebase: ${climatebaseJobs.length},` +
    ` greenhouse: ${greenhouseJobs.length},` +
    ` lever: ${leverJobs.length},` +
    ` ashby: ${ashbyJobs.length},` +
    ` breezy: ${breezyJobs.length},` +
    ` bamboo: ${bambooJobs.length},` +
    ` builtin: ${builtInJobs.length},` +
    ` terra: ${terraJobs.length},` +
    ` 80khours: ${eightykJobs.length},` +
    ` remoteok: ${remoteokJobs.length},` +
    ` remotive: ${remotiveJobs.length},` +
    ` arbeitnow: ${arbeitnowJobs.length},` +
    ` themuse: ${themuseJobs.length},` +
    ` usajobs: ${usajobsJobs.length},` +
    ` upwork: ${upworkJobs.length},` +
    ` dice: ${diceJobs.length},` +
    ` taskrabbit: ${taskrabbitJobs.length},` +
    ` craigslist: ${craigslistJobs.length},` +
    ` angieslist: ${angieslistJobs.length},` +
    ` flexjobs: ${flexjobsJobs.length},` +
    ` porch: ${porchJobs.length},` +
    ` indeed: ${indeedJobs.length},` +
    ` ziprecruiter: ${zipRecruiterJobs.length},` +
    ` monster: ${monsterJobs.length},` +
    ` weworkremotely: ${weworkremotelyJobs.length},` +
    ` angellist: ${angellistJobs.length},` +
    ` devto: ${devtoJobs.length},` +
    ` dribbble: ${dribbbleJobs.length},` +
    ` hackernews: ${hackerNewsJobs.length},` +
    ` jooble: ${joobleJobs.length},` +
    ` reliefweb: ${reliefwebJobs.length},` +
    ` redditjobs: ${redditJobs.length},` +
    ` idealist: ${idealistJobs.length},` +
    ` kaggle: ${kaggleJobs.length},` +
    ` producthunt: ${producthuntJobs.length})`,
  );
  return all;
}

async function fetchAlgoliaPage({
  page,
  query = '',
  facetFilters = undefined,
  facets = undefined,
  numericFilters = undefined,
  hitsPerPage = ALGOLIA_HITS_PER_PAGE,
}) {
  const body = {
    query,
    facetFilters,
    facets,
    numericFilters,
    hitsPerPage,
    page,
    attributesToRetrieve: [
      'id', 'title', 'name_of_employer', 'logo',
      'locations', 'remote_preferences', 'job_types', 'activation_date',
    ],
    attributesToHighlight: [],
    attributesToSnippet: [],
  };
  let lastError = null;
  for (let attempt = 1; attempt <= ALGOLIA_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(
        `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/${ALGOLIA_INDEX}/query`,
        {
          method: 'POST',
          headers: {
            'X-Algolia-Application-Id': ALGOLIA_APP_ID,
            'X-Algolia-API-Key': ALGOLIA_API_KEY,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(`Algolia request failed with status ${response.status}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt < ALGOLIA_FETCH_RETRIES) {
        const backoffMs = 250 * (2 ** (attempt - 1));
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }
  throw lastError || new Error('Algolia request failed');
}

async function fetchClimatebaseJobs() {
  const nowEpoch = Math.floor(Date.now() / 1000);
  const minWindowSecs = Math.max(1, Math.floor(ALGOLIA_MIN_WINDOW_DAYS * 86_400));

  // Step 1: discover all category facet values
  const facetProbe = await fetchAlgoliaPage({
    page: 0,
    query: '',
    facets: ['categories'],
    hitsPerPage: 0,
  });
  const categoryFacets = (facetProbe.facets && facetProbe.facets.categories) || {};
  const categories = Object.keys(categoryFacets);
  console.log(`[ingest] ${categories.length} categories discovered`);

  async function fetchPagesForCategory(category, startEpoch, endEpoch) {
    const numericFilters = [
      `activation_date_i>=${startEpoch}`,
      `activation_date_i<=${endEpoch}`,
    ];
    const facetFilters = [[`categories:${category}`]];

    const firstPage = await fetchAlgoliaPage({
      page: 0,
      query: '',
      facetFilters,
      numericFilters,
    });

    const totalPages = Math.max(1, Number(firstPage.nbPages || 1));
    let hits = firstPage.hits || [];

    for (let start = 1; start < totalPages; start += ALGOLIA_PAGE_CONCURRENCY) {
      const batchPages = [];
      const end = Math.min(start + ALGOLIA_PAGE_CONCURRENCY, totalPages);
      for (let page = start; page < end; page += 1) {
        batchPages.push(page);
      }
      const batchResults = await Promise.all(
        batchPages.map((page) => fetchAlgoliaPage({ page, query: '', facetFilters, numericFilters })),
      );
      for (const result of batchResults) {
        hits = hits.concat(result.hits || []);
      }
    }

    return { hits, nbPages: totalPages };
  }

  async function fetchCategoryRecursively(category, startEpoch, endEpoch, depth = 0) {
    const { hits, nbPages } = await fetchPagesForCategory(category, startEpoch, endEpoch);
    const windowSecs = endEpoch - startEpoch;

    // Saturated at page cap — split time window and recurse to recover more hits
    if (
      nbPages * ALGOLIA_HITS_PER_PAGE <= hits.length &&
      depth < ALGOLIA_MAX_SPLIT_DEPTH &&
      windowSecs > minWindowSecs
    ) {
      const mid = Math.floor((startEpoch + endEpoch) / 2);
      const [left, right] = await Promise.all([
        fetchCategoryRecursively(category, startEpoch, mid, depth + 1),
        fetchCategoryRecursively(category, mid + 1, endEpoch, depth + 1),
      ]);
      return left.concat(right);
    }

    return hits;
  }

  const uniqueById = new Map();
  for (let i = 0; i < categories.length; i += ALGOLIA_CATEGORY_CONCURRENCY) {
    const batch = categories.slice(i, i + ALGOLIA_CATEGORY_CONCURRENCY);
    const results = await Promise.all(
      batch.map((cat) => fetchCategoryRecursively(cat, ALGOLIA_START_EPOCH, nowEpoch)),
    );
    for (const hits of results) {
      for (const hit of hits) {
        const id = String(hit.id || hit.objectID || '');
        if (!id || uniqueById.has(id)) continue;
        const normalized = normalizeJob(hit);
        if (!normalized.id || !normalized.title) continue;
        uniqueById.set(id, normalized);
      }
    }
    console.log(`[ingest] ${Math.min(i + ALGOLIA_CATEGORY_CONCURRENCY, categories.length)}/${categories.length} categories done — ${uniqueById.size} jobs`);
  }

  console.log(`[ingest] Complete: ${uniqueById.size} total jobs`);
  return Array.from(uniqueById.values());
}

// ─── SWE Title Filter ──────────────────────────────────────────────────────
// Matches: Software Engineer, Senior/Staff/Principal Software Engineer,
// plus common adjacent engineering titles (ML Engineer, AI Engineer, etc.)
// Excludes: Sales/Solutions Engineering, Environmental Engineer, etc.
const SWE_TITLE_RE = /\b(software|ml|ai|machine learning|computer vision|vision|imaging|medical imaging|backend|back-end|front-?end|full.?stack|platform|infrastructure|systems?|data|embedded|mobile|devops|cloud|security|reliability|site reliability|ml[/ ]?ops|mlops|research|applied)\s+engineer(?:ing)?\b/i;

const SWE_EXCLUDE_RE = /\b(sales|solutions?\s+engineer|mechanical|electrical|hardware|civil|audio|manufacturing|environmental|chemical|agricultural|nuclear|process|field|customer|support|applications?\s+engineer)\b/i;

function isSoftwareEngineerRole(title) {
  const t = title.toLowerCase();
  if (SWE_EXCLUDE_RE.test(t)) return false;
  return SWE_TITLE_RE.test(t);
}

async function getJobsWithCache() {
  const now = Date.now();
  const isFresh = now - cacheUpdatedAt < CACHE_TTL_MS;

  if (isFresh && jobsCache.length > 0) {
    return { jobs: jobsCache, stale: false, fromCache: true };
  }

  const refreshInBackground = () => {
    if (CACHE_OFFLINE_ONLY) return;
    if (cacheRefreshPromise) return;

    cacheRefreshPromise = (async () => {
      try {
        const freshJobs = await fetchAllJobs();
        jobsCache = freshJobs;
        cacheUpdatedAt = Date.now();
        await saveJobsToFile(freshJobs);
        console.log(`[cache] Background refresh complete — ${freshJobs.length} jobs cached`);
      } catch (err) {
        console.warn(`[cache] Background refresh skipped (${err?.message || 'unknown error'})`);
      } finally {
        cacheRefreshPromise = null;
      }
    })();
  };

  // If we already have jobs in memory, serve them immediately and refresh asynchronously.
  if (jobsCache.length > 0) {
    refreshInBackground();
    return { jobs: jobsCache, stale: true, fromCache: true };
  }

  // Cold start: hydrate from disk regardless of age so cache works without internet.
  const fileCached = await loadJobsFromFile();
  if (fileCached && fileCached.jobs.length > 0) {
    jobsCache = fileCached.jobs;
    cacheUpdatedAt = fileCached.savedAt || 0;
    const ageMins = Math.round((now - (fileCached.savedAt || now)) / 60000);
    const stale = now - (fileCached.savedAt || 0) >= CACHE_TTL_MS;
    console.log(`[cache] Loaded ${jobsCache.length} jobs from file cache (age: ${ageMins}m, stale: ${stale ? 'yes' : 'no'})`);
    refreshInBackground();
    return { jobs: jobsCache, stale, fromCache: true };
  }

  if (CACHE_OFFLINE_ONLY) {
    throw new Error('Offline cache mode is enabled and no local jobs cache is available yet. Connect once to build jobs.json.');
  }

  // No cache available: fetch synchronously once to bootstrap.
  const freshJobs = await fetchAllJobs();
  jobsCache = freshJobs;
  cacheUpdatedAt = now;
  void saveJobsToFile(freshJobs);
  return { jobs: freshJobs, stale: false, fromCache: false };
}

// ─── Resume-based AI Matching (Hybrid) ─────────────────────────────────────
// A faster, richer matcher: weighted terms + concept ontology + semantic anchor overlap
// + role-fit heuristics. Optional local embedding rerank can be enabled per-request.
const RESUME_PROFILE_TEXT = [
  'Principal-level software engineer with strong AI/ML and LLM systems experience.',
  'Hands-on in Python, TypeScript, JavaScript, React, Node.js, C++, graphics/3D/real-time.',
  'Built RAG, agentic workflows, production platform systems, and developer tooling.',
  'Strong preference for climate-impact and mission-driven engineering roles.',
].join(' ');

const RESUME_TERM_WEIGHTS = {
  ai: 4.2, ml: 3.8, llm: 4.4, nlp: 3.2, 'machine learning': 4.2,
  'large language model': 4.2, 'generative ai': 4.3, rag: 3.7,
  'retrieval augmented': 3.6, agent: 3.3, 'multi-agent': 4.1, multiagent: 4.1,
  langchain: 3.6, langgraph: 3.6, 'fine-tuning': 3.1, finetuning: 3.1,
  pytorch: 3.2, 'neural network': 3.1, 'deep learning': 3.1,
  transformer: 2.8, openai: 2.6, gpt: 2.6, embedding: 2.7,
  'vector search': 2.8, 'prompt engineering': 3.2, 'foundation model': 3.1,
  'language model': 3.1, 'conversational ai': 3.0, 'ai safety': 3.5,
  'trust and safety': 2.5, 'content moderation': 2.0, 'ai engineer': 4.2,
  'ai engineering': 4.2, 'ml engineer': 3.7, 'ml engineering': 3.7,

  principal: 3.8, staff: 2.8, senior: 2.2, lead: 2.2, architect: 2.6,

  python: 2.8, javascript: 2.6, typescript: 2.3, react: 2.8,
  'node.js': 2.3, nodejs: 2.3, 'c++': 3.1, cpp: 2.6, 'c#': 2.1,

  webgl: 3.2, unity: 2.7, 'three.js': 2.7, threejs: 2.7, graphics: 2.6,
  '3d': 2.1, vr: 2.6, 'virtual reality': 2.6, 'augmented reality': 2.1,
  ar: 2.1, rendering: 2.7, shader: 2.7, opengl: 2.7, 'real-time': 2.1,
  'game engine': 2.1, simulation: 1.6,

  climate: 3.2, 'clean energy': 2.7, energy: 2.1, sustainability: 2.7,
  carbon: 2.7, renewable: 2.1, decarbonization: 2.8, environmental: 2.1,
  'net zero': 2.7, cleantech: 2.7, 'climate tech': 3.2,
  // Electrification keywords
  'electric vehicle': 3.0, 'ev charging': 2.8, 'heat pump': 2.8,
  'induction': 2.5, 'induction cooking': 2.8, 'home electrification': 3.0,
  'building efficiency': 2.6, 'smart home': 2.6, 'energy management': 2.5,
  'demand response': 2.4, 'grid edge': 2.5, 'battery': 2.3,
  'charging infrastructure': 2.7, 'vehicle electrification': 2.8,

  'software engineer': 1.7, 'software engineering': 1.7, developer: 1.6,
  'full stack': 2.1, fullstack: 2.1, frontend: 2.1, backend: 2.1,
  'full-stack': 2.1, platform: 1.7, infrastructure: 1.7,

  audio: 2.0, dsp: 2.0, 'signal processing': 2.0, plugin: 1.5,
  accessibility: 2.1, safety: 2.0, moderation: 1.5,
};

const MATCH_FACETS = {
  ai: [
    'ai', 'ml', 'llm', 'machine learning', 'generative ai', 'rag', 'langchain', 'langgraph',
    'embedding', 'vector search', 'openai', 'pytorch', 'transformer', 'model',
  ],
  engineering: [
    'software engineer', 'backend', 'frontend', 'full stack', 'platform', 'infrastructure',
    'distributed systems', 'api', 'services', 'cloud', 'devops', 'reliability',
  ],
  climate: [
    'climate', 'clean energy', 'decarbonization', 'renewable', 'carbon', 'sustainability',
    'grid', 'electrification', 'net zero', 'environmental',
  ],
  tech: [
    'python', 'typescript', 'javascript', 'react', 'node.js', 'nodejs', 'c++', 'webgl',
    'three.js', 'graphics', 'real-time', 'data',
  ],
};

const RESUME_ANCHORS = [
  'principal software engineer',
  'ai engineer',
  'machine learning engineer',
  'llm platform',
  'rag systems',
  'agentic workflows',
  'python typescript react node.js',
  'c++ graphics real-time',
  'climate tech impact',
  'senior platform engineering',
];

const ULTRA_SIGNAL_PHRASES = [
  ['retrieval augmented generation', 8],
  ['large language model', 8],
  ['machine learning platform', 7],
  ['agentic workflow', 7],
  ['applied ai', 6],
  ['mlops', 6],
  ['vector database', 6],
  ['prompt engineering', 5],
  ['developer platform', 5],
  ['distributed systems', 5],
  ['real-time rendering', 5],
  ['computer graphics', 4],
  ['climate tech', 5],
  ['carbon accounting', 4],
  ['clean energy', 4],
  ['decarbonization', 4],
];

const ULTRA_SKILL_CANONICAL = {
  python: ['python'],
  typescript: ['typescript', 'ts'],
  javascript: ['javascript', 'js', 'node.js', 'nodejs'],
  react: ['react'],
  cplusplus: ['c++', 'cpp'],
  llm: ['llm', 'large language model', 'foundation model'],
  rag: ['rag', 'retrieval augmented', 'retrieval augmented generation'],
  agents: ['agent', 'agentic', 'multi-agent', 'multiagent'],
  ml: ['machine learning', 'ml', 'deep learning', 'neural network'],
  embeddings: ['embedding', 'vector search', 'vector database'],
  mlops: ['mlops', 'model serving', 'inference'],
  climate: ['climate', 'climate tech', 'decarbonization', 'net zero'],
  energy: ['clean energy', 'renewable', 'grid', 'electrification', 'carbon'],
  graphics: ['graphics', 'webgl', 'three.js', 'rendering', 'shader', 'opengl'],
  platform: ['platform', 'infrastructure', 'distributed systems', 'reliability'],
};

const ULTRA_RESUME_SKILLS = new Set([
  'python', 'typescript', 'javascript', 'react', 'cplusplus', 'llm', 'rag',
  'agents', 'ml', 'embeddings', 'mlops', 'climate', 'energy', 'graphics', 'platform',
]);

const NEGATIVE_ROLE_TERMS = [
  'sales engineer', 'solutions engineer', 'customer success', 'account executive', 'account manager',
  'marketing', 'recruiter', 'talent acquisition', 'mechanical engineer', 'electrical engineer',
  'civil engineer', 'field engineer',
];

// Resume2: Ben Gibbons - Principal C++ Audio Engineer (VR/AI/Spatial)
const RESUME2_PROFILE_TEXT = [
  'Principal C++ Audio Engineer with 10+ years building real-time audio systems.',
  'Expertise in spatial audio, audio plugins (VST/AU), DSP algorithms.',
  'Strong background in VR/spatial computing, real-time optimization.',
  'AI/LLM interest: audio AI, voice models, speech synthesis.',
  'Skills: C++, audio DSP, real-time systems, VR, spatial computing.',
].join(' ');

const RESUME2_TERM_WEIGHTS = {
  // Audio & DSP
  audio: 4.0, dsp: 4.0, 'digital signal processing': 4.0, 'audio plugin': 4.5,
  'audio engineering': 4.2, 'audio developer': 4.2, vst: 3.8, au: 3.8,
  'plugin development': 4.0, 'real-time audio': 4.3, 'spatial audio': 4.5,
  '3d audio': 4.2, 'immersive audio': 4.3, 'ambisonics': 3.8, 'hrtf': 3.8,
  'speech synthesis': 3.5, 'voice synthesis': 3.5, 'audio processing': 4.0,
  
  // VR & Spatial Computing
  vr: 4.5, 'virtual reality': 4.5, 'spatial computing': 4.5,
  'augmented reality': 3.5, ar: 3.5, 'xr': 4.2, 'extended reality': 4.2,
  'immersive': 3.8, '3d': 3.5, spatial: 3.8, 'spatial interaction': 3.8,
  'motion tracking': 3.5, haptic: 3.5, headset: 3.0,
  
  // C++ & Systems Programming
  'c++': 4.5, cpp: 4.2, 'c++11': 4.0, 'c++17': 4.0, 'c++20': 4.0,
  'systems programming': 3.8, 'low-level': 3.8, 'memory management': 3.5,
  'real-time': 4.0, 'real-time systems': 4.2, optimization: 3.5,
  performance: 3.2,
  
  // AI/LLM (Secondary for resume2)
  ai: 3.8, llm: 4.0, 'large language model': 4.0, 'machine learning': 3.5,
  ml: 3.5, rag: 3.2, 'neural network': 3.0, agent: 3.2,
  
  // Relevant Tech
  python: 2.5, typescript: 2.5, javascript: 2.5, rust: 3.5,
  python: 2.5, webgl: 2.8, 'three.js': 2.8, unity: 3.2,
  unreal: 3.2, 'unreal engine': 3.2,
  
  // Skills & Seniority
  principal: 3.8, staff: 3.2, senior: 2.5, lead: 2.5, architect: 2.8,
  'audio engineer': 4.2, 'vr engineer': 4.0, 'spatial engineer': 4.0,
  
  // Accessibility
  accessibility: 3.5, 'accessible': 3.2, inclusive: 2.8,
  
  // General
  'software engineer': 1.5, developer: 1.5, engineer: 1.5,
};

const RESUME2_MATCH_FACETS = {
  vr: ['vr', 'virtual reality', 'spatial computing', 'xr', 'ar', 'augmented reality', 'immersive'],
  audio: ['audio', 'dsp', 'audio plugin', 'vst', 'au', 'spatial audio', 'immersive audio'],
  ai: ['ai', 'llm', 'machine learning', 'neural network', 'speech', 'voice'],
  tech: ['c++', 'cpp', 'rust', 'real-time', 'optimization', 'graphics', 'unity', 'unreal'],
};

const RESUME2_ANCHORS = [
  'principal audio engineer',
  'spatial audio vr',
  'audio dsp plugin development',
  'real-time spatial computing',
  'vr spatial audio',
  'audio llm speech synthesis',
  'c++ real-time systems',
  'audio engineering spatial',
];

const RESUME2_SIGNAL_PHRASES = [
  ['spatial audio', 7],
  ['audio dsp', 7],
  ['vr spatial', 7],
  ['audio plugin development', 8],
  ['real-time audio', 7],
  ['dsp algorithms', 6],
  ['immersive audio', 6],
  ['speech synthesis', 5],
  ['audio engineering', 6],
  ['vr platform', 6],
  ['spatial computing', 6],
  ['audio optimization', 5],
  ['plugin development', 5],
  ['real-time systems', 5],
  ['c++ optimization', 5],
];

const RESUME2_SKILL_CANONICAL = {
  cplusplus: ['c++', 'cpp', 'c plus plus'],
  audio: ['audio', 'audio dsp', 'audio engineering'],
  dsp: ['dsp', 'digital signal processing'],
  plugin: ['plugin', 'plugin development', 'vst', 'au'],
  vr: ['vr', 'virtual reality', 'spatial computing'],
  spatial: ['spatial', 'spatial audio', '3d audio', 'ambisonics'],
  llm: ['llm', 'large language model', 'speech synthesis'],
  ml: ['machine learning', 'ml', 'neural network'],
  realtime: ['real-time', 'realtime', 'low-latency'],
  graphics: ['graphics', 'rendering', 'webgl', 'unity', 'unreal'],
  optimization: ['optimization', 'performance', 'memory management'],
  accessibility: ['accessibility', 'accessible', 'inclusive'],
  ai: ['ai', 'artificial intelligence'],
};

const RESUME2_RESUME_SKILLS = new Set([
  'cplusplus', 'audio', 'dsp', 'plugin', 'vr', 'spatial', 'llm', 'ml',
  'realtime', 'graphics', 'optimization', 'accessibility', 'ai',
]);

// Resume Profiles Registry
const RESUME_PROFILES = {
  resume1: {
    profileText: RESUME_PROFILE_TEXT,
    termWeights: RESUME_TERM_WEIGHTS,
    matchFacets: MATCH_FACETS,
    anchors: RESUME_ANCHORS,
    signalPhrases: ULTRA_SIGNAL_PHRASES,
    skillCanonical: ULTRA_SKILL_CANONICAL,
    resumeSkills: ULTRA_RESUME_SKILLS,
    domainBoostFn: (text) => {
      // Resume1: AI/ML/Climate focus
      const patterns = [
        /\b(climate|cleantech|clean energy|decarbonization|carbon)\b/gi,
        /\b(ai|machine learning|llm|rag|generative ai|agents)\b/gi,
      ];
      return patterns.some(p => p.test(text)) ? 1.15 : 1.0;
    },
    missionRe: /\b(impact|climate|decarbonization|sustainability|ai|mission-driven)\b/i,
  },
  resume2: {
    profileText: RESUME2_PROFILE_TEXT,
    termWeights: RESUME2_TERM_WEIGHTS,
    matchFacets: RESUME2_MATCH_FACETS,
    anchors: RESUME2_ANCHORS,
    signalPhrases: RESUME2_SIGNAL_PHRASES,
    skillCanonical: RESUME2_SKILL_CANONICAL,
    resumeSkills: RESUME2_RESUME_SKILLS,
    domainBoostFn: (text) => {
      // Resume2: Audio/VR/Spatial focus
      const patterns = [
        /\b(audio|dsp|spatial|immersive|vr|virtual reality|xr)\b/gi,
        /\b(c\+\+|plugin|real-time|optimization)\b/gi,
      ];
      return patterns.some(p => p.test(text)) ? 1.15 : 1.0;
    },
    missionRe: /\b(audio|vr|spatial|immersive|plugin|real-time)\b/i,
  },
};

const LOCAL_MODEL_DEFAULT = process.env.LOCAL_MATCH_MODEL === '1';
const DEFAULT_RANKING_MODE = (() => {
  const m = (process.env.DEFAULT_RANKING_MODE || 'hybrid').toLowerCase();
  if (m === 'classic') return 'classic';
  if (m === 'ultra') return 'ultra';
  return 'hybrid';
})();
const OLLAMA_EMBED_URL = process.env.OLLAMA_EMBED_URL || 'http://127.0.0.1:11434/api/embeddings';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'nomic-embed-text';
const LOCAL_MODEL_TOP_K = Number(process.env.LOCAL_MODEL_TOP_K || 80);
const LOCAL_MODEL_TIMEOUT_MS = Number(process.env.LOCAL_MODEL_TIMEOUT_MS || 4000);
const LOCAL_MODEL_BLEND = Number(process.env.LOCAL_MODEL_BLEND || 0.18);
const ULTRA_LOCAL_MODEL_TOP_K = Number(process.env.ULTRA_LOCAL_MODEL_TOP_K || 140);
const ULTRA_LOCAL_MODEL_BLEND = Number(process.env.ULTRA_LOCAL_MODEL_BLEND || 0.35);

const localEmbeddingCache = new Map();
const resumeEmbeddingPromises = {};

function readJsonFile(filePath, fallback) {
  return readJsonFileComponent(filePath, fallback);
}

function writeJsonFile(filePath, data) {
  return writeJsonFileComponent(filePath, data);
}

function ensurePrivateDataDir() {
  fs.mkdirSync(PRIVATE_DATA_DIR, { recursive: true });
}

function getServerSecretMaterial() {
  const envSecret = String(process.env.AUTH_SECRET || process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (envSecret) return envSecret;

  ensurePrivateDataDir();
  try {
    if (fs.existsSync(AUTH_SECRET_FILE)) {
      return fs.readFileSync(AUTH_SECRET_FILE, 'utf-8').trim();
    }
    const generated = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(AUTH_SECRET_FILE, generated, { mode: 0o600 });
    return generated;
  } catch (err) {
    console.error('[auth] Failed to initialize server secret:', err.message);
    return 'job-finder-dev-secret';
  }
}

const SERVER_SECRET_MATERIAL = getServerSecretMaterial();
const DATA_ENCRYPTION_KEY = crypto.createHash('sha256').update(SERVER_SECRET_MATERIAL).digest();

function encryptPrivatePayload(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', DATA_ENCRYPTION_KEY, iv);
  const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    version: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64'),
  });
}

function decryptPrivatePayload(raw) {
  const parsed = JSON.parse(String(raw || '{}'));
  const iv = Buffer.from(String(parsed.iv || ''), 'base64');
  const tag = Buffer.from(String(parsed.tag || ''), 'base64');
  const data = Buffer.from(String(parsed.data || ''), 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', DATA_ENCRYPTION_KEY, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(decrypted.toString('utf-8'));
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseCookies(req) {
  return parseCookiesComponent(req);
}

function setSessionCookie(res, token, expiresAt) {
  res.setHeader('Set-Cookie', buildSessionCookieValue(SESSION_COOKIE_NAME, token, expiresAt));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', buildClearSessionCookieValue(SESSION_COOKIE_NAME));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return hashPasswordComponent(password, salt);
}

function verifyPassword(password, salt, expectedHash) {
  return verifyPasswordComponent(password, salt, expectedHash);
}

function normalizeResumeText(text) {
  return normalizeResumeTextComponent(text);
}

async function extractTextFromFile(buffer, mimeType, fileName) {
  const lowerMimeType = String(mimeType || '').toLowerCase();
  const lowerFileName = String(fileName || '').toLowerCase();

  // PDF
  if (lowerMimeType.includes('pdf') || lowerFileName.endsWith('.pdf')) {
    try {
      const pdfData = await pdfParse(buffer);
      return (pdfData.text || '').trim();
    } catch (error) {
      console.error('[resume] PDF extraction error:', error.message);
      throw new Error('Failed to extract text from PDF');
    }
  }

  // Word (.docx)
  if (lowerMimeType.includes('word') || lowerMimeType.includes('vnd.openxmlformats-officedocument.wordprocessingml') ||
      lowerFileName.endsWith('.docx')) {
    try {
      const doc = await Document.fromBuffer(buffer);
      const paragraphs = [];
      for (const section of doc.sections) {
        for (const element of section.children) {
          if (element.text) {
            paragraphs.push(element.text);
          }
        }
      }
      const text = paragraphs.join('\n');
      return text.trim();
    } catch (error) {
      console.error('[resume] DOCX extraction error:', error.message);
      throw new Error('Failed to extract text from Word document');
    }
  }

  // Plain text
  if (lowerMimeType.includes('text') || lowerFileName.endsWith('.txt')) {
    try {
      const text = buffer.toString('utf-8');
      return text.trim();
    } catch (error) {
      console.error('[resume] Text extraction error:', error.message);
      throw new Error('Failed to extract text from file');
    }
  }

  // Try UTF-8 decoding as fallback for unknown types
  try {
    const text = buffer.toString('utf-8');
    return text.trim();
  } catch (error) {
    throw new Error('Unsupported file format. Please upload a PDF, Word document, or plain text file.');
  }
}

function splitResumeSentences(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function buildTermWeightsFromText(text) {
  const tokens = tokenizeAndBigram(text);
  const frequencies = new Map();
  for (const token of tokens) {
    const normalized = String(token || '').trim().toLowerCase();
    if (normalized.length < 2) continue;
    frequencies.set(normalized, (frequencies.get(normalized) || 0) + 1);
  }

  const sorted = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 180);

  const weights = {};
  for (const [term, count] of sorted) {
    const boost = term.length > 16 ? 1.2 : term.includes(' ') ? 1.6 : 1;
    weights[term] = Math.max(1, Math.round(Math.min(18, count * boost)));
  }
  return weights;
}

function buildFacetMapFromText(text) {
  const lowered = String(text || '').toLowerCase();
  const tokens = new Set(tokenizeAndBigram(text));
  const sourceFacets = Object.values(MATCH_FACETS).flat();
  const profileFacets = {
    ai: [],
    engineering: [],
    climate: [],
    tech: [],
  };

  for (const facet of sourceFacets) {
    if (tokens.has(facet) || lowered.includes(facet)) {
      if (MATCH_FACETS.ai.includes(facet)) profileFacets.ai.push(facet);
      else if ((MATCH_FACETS.engineering || []).includes(facet)) profileFacets.engineering.push(facet);
      else if ((MATCH_FACETS.climate || []).includes(facet)) profileFacets.climate.push(facet);
      else profileFacets.tech.push(facet);
    }
  }

  if (!profileFacets.ai.length) profileFacets.ai = (MATCH_FACETS.ai || []).slice(0, 12);
  if (!profileFacets.engineering.length) profileFacets.engineering = (MATCH_FACETS.engineering || []).slice(0, 12);
  if (!profileFacets.climate.length) profileFacets.climate = (MATCH_FACETS.climate || []).slice(0, 12);
  if (!profileFacets.tech.length) profileFacets.tech = (MATCH_FACETS.tech || []).slice(0, 12);

  return profileFacets;
}

function buildAnchorsFromText(text) {
  const sentences = splitResumeSentences(text);
  const scored = sentences
    .map((sentence) => {
      const lowered = sentence.toLowerCase();
      const tokenCount = tokenizeAndBigram(sentence).length;
      const signalScore = [
        'led', 'built', 'shipped', 'launched', 'designed', 'scaled', 'architected', 'improved', 'managed', 'owned', 'research', 'ml', 'ai', 'climate', 'impact', 'product', 'platform', 'backend', 'frontend', 'data', 'systems', 'embedded', 'product'
      ].reduce((sum, term) => sum + (lowered.includes(term) ? 1 : 0), 0);
      return { sentence, score: signalScore * 4 + Math.min(12, tokenCount) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((item) => item.sentence);

  return scored.length > 0 ? scored : [String(text || '').slice(0, 160)].filter(Boolean);
}

function buildSkillSetFromText(text) {
  const lowered = String(text || '').toLowerCase();
  const skills = new Set();
  for (const [canonical, aliases] of Object.entries(ULTRA_SKILL_CANONICAL || {})) {
    if (aliases.some((alias) => lowered.includes(alias))) {
      skills.add(canonical);
    }
  }
  if (!skills.size) {
    for (const alias of ['typescript', 'javascript', 'python', 'react', 'node', 'ml', 'ai', 'sql', 'postgres', 'aws', 'gcp', 'azure']) {
      if (lowered.includes(alias)) skills.add(alias);
    }
  }
  return skills;
}

function buildSignalPhrasesFromText(text) {
  const lowered = String(text || '').toLowerCase();
  const phrases = new Map(ULTRA_SIGNAL_PHRASES || []);
  for (const phrase of ['led a team', 'built and shipped', 'launched', 'improved conversion', 'reduced latency', 'scaled', 'architected', 'machine learning', 'large language model', 'climate', 'health', 'accessibility']) {
    if (lowered.includes(phrase)) {
      phrases.set(phrase, Math.max(phrases.get(phrase) || 0, 2));
    }
  }
  return [...phrases.entries()].slice(0, 28);
}

function buildMissionRegexFromText(text) {
  const lowered = String(text || '').toLowerCase();
  const missionHints = [];
  if (/climate|carbon|energy|renewable|decarbon|grid|electrification/.test(lowered)) missionHints.push('climate');
  if (/health|medical|therapy|patient|clinical|diagnos|wellness/.test(lowered)) missionHints.push('health');
  if (/education|learn|teacher|student|curriculum|school/.test(lowered)) missionHints.push('education');
  if (/accessibility|assistive|inclusive|disability/.test(lowered)) missionHints.push('accessibility');
  if (/nonprofit|public interest|civic|government|policy|humanitarian/.test(lowered)) missionHints.push('mission');
  if (!missionHints.length) return /climate|decarbonization|renewable|carbon|global health|humanitarian|electric vehicle|ev charging|heat pump|induction cooking|home electrification|building efficiency|smart home energy/;
  return new RegExp(missionHints.join('|'), 'i');
}

function buildProfileLabelFromText(text, fallback = 'Uploaded Resume') {
  return buildProfileLabelFromTextComponent(text, fallback);
}

function buildCustomResumeProfile(text, label = 'Uploaded Resume') {
  const normalizedText = normalizeResumeText(text);
  const termWeights = buildTermWeightsFromText(normalizedText);
  const matchFacets = buildFacetMapFromText(normalizedText);
  const anchors = buildAnchorsFromText(normalizedText);
  const resumeSkills = buildSkillSetFromText(normalizedText);
  return {
    profileText: normalizedText,
    termWeights,
    matchFacets,
    anchors,
    signalPhrases: buildSignalPhrasesFromText(normalizedText),
    skillCanonical: ULTRA_SKILL_CANONICAL,
    resumeSkills,
    domainBoostFn: (job, textLower = '') => {
      if (/climate|carbon|energy|renewable|decarbon|grid|electrification/.test(normalizedText.toLowerCase())) {
        return /climate|energy|renewable|carbon|grid|electrification/.test(String(textLower || '').toLowerCase()) ? 6 : 2;
      }
      if (/health|medical|therapy|patient|clinical|wellness/.test(normalizedText.toLowerCase())) {
        return /health|medical|therapy|patient|clinical|wellness/.test(String(textLower || '').toLowerCase()) ? 6 : 1;
      }
      return 0;
    },
    missionRe: buildMissionRegexFromText(normalizedText),
    resumeLabel: label,
    source: 'uploaded',
  };
}

function averageNumericMaps(maps, fallback = {}) {
  const totals = new Map();
  const counts = new Map();
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue;
    for (const [key, value] of Object.entries(map)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      totals.set(key, (totals.get(key) || 0) + numeric);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const result = {};
  const keys = new Set([...Object.keys(fallback), ...totals.keys()]);
  for (const key of keys) {
    const total = totals.get(key) || 0;
    const count = counts.get(key) || 0;
    result[key] = count > 0 ? Math.round(total / count) : Number(fallback[key] || 0);
  }
  return result;
}

function averageStringLists(lists) {
  const counts = new Map();
  for (const list of lists) {
    for (const item of (Array.isArray(list) ? list : [])) {
      const normalized = String(item || '').trim();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([item]) => item)
    .slice(0, 24);
}

function combineResumeProfiles(profiles, mode = 'average', label = 'Combined Resume') {
  const activeProfiles = profiles.filter(Boolean);
  if (!activeProfiles.length) return buildCustomResumeProfile('', label);
  if (activeProfiles.length === 1) return activeProfiles[0];

  const profileText = activeProfiles.map((profile) => profile.profileText || '').filter(Boolean).join('\n\n');
  const factor = mode === 'sum' ? 1 : 1 / activeProfiles.length;
  const termWeights = {};
  const allTerms = new Set();
  for (const profile of activeProfiles) {
    for (const [term, weight] of Object.entries(profile.termWeights || {})) {
      allTerms.add(term);
      termWeights[term] = (termWeights[term] || 0) + (Number(weight) || 0) * factor;
    }
  }
  for (const term of allTerms) {
    termWeights[term] = Math.max(1, Math.round(termWeights[term] || 0));
  }

  return {
    profileText,
    termWeights,
    matchFacets: {
      ai: averageStringLists(activeProfiles.map((p) => p.matchFacets?.ai || [])),
      engineering: averageStringLists(activeProfiles.map((p) => p.matchFacets?.engineering || [])),
      climate: averageStringLists(activeProfiles.map((p) => p.matchFacets?.climate || [])),
      tech: averageStringLists(activeProfiles.map((p) => p.matchFacets?.tech || [])),
    },
    anchors: averageStringLists(activeProfiles.map((p) => p.anchors || [])),
    signalPhrases: averageStringLists(activeProfiles.map((p) => (p.signalPhrases || []).map(([phrase]) => phrase))),
    skillCanonical: ULTRA_SKILL_CANONICAL,
    resumeSkills: new Set(activeProfiles.flatMap((p) => [...(p.resumeSkills || [])])),
    domainBoostFn: (job, textLower = '') => activeProfiles.reduce((sum, profile) => {
      try {
        return sum + Number(profile.domainBoostFn ? profile.domainBoostFn(job, textLower) : 0);
      } catch {
        return sum;
      }
    }, 0) / activeProfiles.length,
    missionRe: activeProfiles.some((profile) => profile.missionRe && /climate|health|education|mission/i.test(String(profile.missionRe)))
      ? /climate|health|education|mission/i
      : /climate|decarbonization|renewable|carbon|global health|humanitarian|electric vehicle|ev charging|heat pump|induction cooking|home electrification|building efficiency|smart home energy/,
    compositeMode: mode,
    componentCount: activeProfiles.length,
    resumeLabel: label,
    source: 'composite',
  };
}

function normalizeResumeRecord(record, fallbackIndex = 0) {
  return normalizeResumeRecordComponent(record, fallbackIndex);
}

function loadResumeLibrary() {
  try {
    const data = readJsonFile(RESUMES_FILE, { resumes: [] });
    const resumes = Array.isArray(data?.resumes) ? data.resumes.map((item, index) => normalizeResumeRecord(item, index)) : [];
    return { resumes };
  } catch (err) {
    console.error('[resumes] Error loading resume library:', err.message);
    return { resumes: [] };
  }
}

function saveResumeLibrary(data) {
  try {
    const normalized = {
      resumes: Array.isArray(data?.resumes) ? data.resumes.map((item, index) => normalizeResumeRecord(item, index)) : [],
    };
    const saved = writeJsonFile(RESUMES_FILE, normalized);
    if (!saved) {
      throw new Error('Failed to write resumes.json');
    }
    console.log('[resumes] Saved resume library:', normalized.resumes.length, 'resumes');
    return normalized;
  } catch (err) {
    console.error('[resumes] Error saving resume library:', err.message);
    return resumeLibraryData && Array.isArray(resumeLibraryData.resumes)
      ? resumeLibraryData
      : { resumes: [] };
  }
}

function persistResumeLibrary(nextData) {
  resumeLibraryData = saveResumeLibrary(nextData);
  clearResumeDerivedCaches();
  return resumeLibraryData;
}

let resumeLibraryData = loadResumeLibrary();

function refreshResumeLibraryFromDisk() {
  resumeLibraryData = loadResumeLibrary();
  clearResumeDerivedCaches();
  return resumeLibraryData;
}

function getUploadedResumeRecord(resumeId) {
  const normalizedId = String(resumeId || '').trim();
  if (!normalizedId) return null;
  return (resumeLibraryData.resumes || []).find((resume) => resume.id === normalizedId) || null;
}

function defaultPrivateUserData() {
  return defaultPrivateUserDataComponent();
}

function normalizePrivateUserData(data) {
  return normalizePrivateUserDataComponent(data);
}

function normalizePrivateStore(data) {
  return normalizePrivateStoreComponent(data, { sessionTtlMs: SESSION_TTL_MS });
}

function loadLegacyPrivateData() {
  return {
    bookmarks: loadBookmarks(),
    resumes: (loadResumeLibrary() || {}).resumes || [],
  };
}

function loadPrivateStore() {
  ensurePrivateDataDir();
  if (fs.existsSync(AUTH_STORE_FILE)) {
    try {
      return normalizePrivateStore(decryptPrivatePayload(fs.readFileSync(AUTH_STORE_FILE, 'utf-8')));
    } catch (err) {
      console.error('[auth] Failed to decrypt auth store:', err.message);
    }
  }

  const migrated = normalizePrivateStore({ legacy: loadLegacyPrivateData() });
  try {
    fs.writeFileSync(AUTH_STORE_FILE, encryptPrivatePayload(migrated), { mode: 0o600 });
    if (fs.existsSync(BOOKMARKS_FILE)) fs.unlinkSync(BOOKMARKS_FILE);
    if (fs.existsSync(RESUMES_FILE)) fs.unlinkSync(RESUMES_FILE);
  } catch (err) {
    console.error('[auth] Failed to initialize encrypted auth store:', err.message);
  }
  return migrated;
}

function savePrivateStore(nextStore) {
  privateStore = normalizePrivateStore(nextStore);
  ensurePrivateDataDir();
  fs.writeFileSync(AUTH_STORE_FILE, encryptPrivatePayload(privateStore), { mode: 0o600 });
  clearResumeDerivedCaches();
  return privateStore;
}

let privateStore = loadPrivateStore();

function getPrivateUserData(userId) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) return defaultPrivateUserData();
  return normalizePrivateUserData(privateStore.dataByUser?.[normalizedUserId] || defaultPrivateUserData());
}

function savePrivateUserData(userId, nextUserData) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) throw new Error('userId is required');
  return savePrivateStore({
    ...privateStore,
    dataByUser: {
      ...privateStore.dataByUser,
      [normalizedUserId]: normalizePrivateUserData(nextUserData),
    },
  });
}

function findUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return null;
  return privateStore.users.find((user) => user.email === normalized) || null;
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function createSessionForUser(userId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  const session = {
    id: crypto.randomBytes(24).toString('hex'),
    userId,
    createdAt: now.toISOString(),
    expiresAt,
  };
  savePrivateStore({
    ...privateStore,
    sessions: [...privateStore.sessions.filter((entry) => entry.userId !== userId), session],
  });
  return session;
}

function getAuthUserFromRequest(req) {
  const cookies = parseCookies(req);
  const sessionId = String(cookies[SESSION_COOKIE_NAME] || '').trim();
  if (!sessionId) return null;
  const now = Date.now();
  const session = privateStore.sessions.find((entry) => entry.id === sessionId && Date.parse(entry.expiresAt) > now);
  if (!session) return null;
  return privateStore.users.find((user) => user.id === session.userId) || null;
}

function requireAuthUser(req, res) {
  const user = getAuthUserFromRequest(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required' }));
    return null;
  }
  return user;
}

function getOrCreateAnonymousUser(req, res) {
  const cookies = parseCookies(req);
  let anonId = String(cookies[ANONYMOUS_COOKIE_NAME] || '').trim();
  
  if (!anonId) {
    anonId = `anon-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    res.setHeader('Set-Cookie', `${ANONYMOUS_COOKIE_NAME}=${anonId}; Path=/; HttpOnly; Max-Age=31536000; Secure; SameSite=Lax`);
  }
  
  return anonId;
}

function getAnonymousResumeForUser(anonUserId) {
  const entry = anonymousResumes.get(anonUserId);
  if (!entry) return null;
  
  const now = Date.now();
  const expiresAt = entry.uploadedAt + ANONYMOUS_RESUME_TTL_MS;
  
  if (now > expiresAt) {
    anonymousResumes.delete(anonUserId);
    return null;
  }
  
  return {
    text: entry.text,
    profile: entry.profile,
    uploadedAt: entry.uploadedAt,
    expiresAt,
  };
}

function saveAnonymousResumeForUser(anonUserId, text, profile) {
  anonymousResumes.set(anonUserId, {
    text,
    profile,
    uploadedAt: Date.now(),
  });
}

function consumeLegacyDataForUser(userId) {
  const currentData = getPrivateUserData(userId);
  if ((currentData.resumes || []).length > 0 || (currentData.bookmarks?.bookmarked || []).length > 0 || (currentData.bookmarks?.hidden || []).length > 0 || (currentData.bookmarks?.hiddenCompanies || []).length > 0) {
    return;
  }

  const legacy = normalizePrivateUserData(privateStore.legacy || defaultPrivateUserData());
  if ((legacy.resumes || []).length === 0 && (legacy.bookmarks?.bookmarked || []).length === 0 && (legacy.bookmarks?.hidden || []).length === 0 && (legacy.bookmarks?.hiddenCompanies || []).length === 0) {
    return;
  }

  savePrivateStore({
    ...privateStore,
    dataByUser: {
      ...privateStore.dataByUser,
      [userId]: legacy,
    },
    legacy: defaultPrivateUserData(),
  });
}

function getBookmarksDataForUser(userId) {
  return normalizeBookmarksData(getPrivateUserData(userId).bookmarks || {});
}

function persistBookmarksDataForUser(userId, nextData) {
  const currentData = getPrivateUserData(userId);
  const nextUserData = {
    ...currentData,
    bookmarks: normalizeBookmarksData(nextData),
  };
  savePrivateUserData(userId, nextUserData);
  return nextUserData.bookmarks;
}

function getResumeLibraryForUser(userId) {
  return { resumes: getPrivateUserData(userId).resumes || [] };
}

function persistResumeLibraryForUser(userId, nextData) {
  const currentData = getPrivateUserData(userId);
  const normalized = {
    resumes: Array.isArray(nextData?.resumes) ? nextData.resumes.map((item, index) => normalizeResumeRecord(item, index)) : [],
  };
  savePrivateUserData(userId, { ...currentData, resumes: normalized.resumes });
  clearResumeDerivedCaches();
  return normalized;
}

function getUploadedResumeRecordForUser(userId, resumeId) {
  const normalizedId = String(resumeId || '').trim();
  if (!normalizedId) return null;
  return (getResumeLibraryForUser(userId).resumes || []).find((resume) => resume.id === normalizedId) || null;
}

function getResumeProfileFromRecord(record, fallbackLabel = 'Uploaded Resume') {
  if (!record) return null;
  const cacheKey = buildResumeRecordRevisionKey(record);
  const cached = resumeProfileCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const computed = buildCustomResumeProfile(record.text, record.name || fallbackLabel);
  resumeProfileCache.set(cacheKey, computed);
  trimMapCacheToLimit(resumeProfileCache, RESUME_PROFILE_CACHE_MAX);
  return computed;
}

function resolveResumeSelection(userId, resumeSelection = {}) {
  const type = String(resumeSelection.type || 'uploaded').trim().toLowerCase();

  if (type === 'uploaded') {
    const resumeId = String(resumeSelection.resumeId || '').trim();
    const record = getUploadedResumeRecordForUser(userId, resumeId);
    if (!record) {
      throw new Error('Resume not found. Please upload a resume to continue.');
    }
    return {
      resumeKey: `uploaded:${record.id}`,
      profile: getResumeProfileFromRecord(record, record.name),
      ids: [record.id],
    };
  }

  if (type === 'blend') {
    const ids = Array.isArray(resumeSelection.resumeIds)
      ? resumeSelection.resumeIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const records = ids.map((id) => getUploadedResumeRecordForUser(userId, id)).filter(Boolean);
    if (records.length === 0) {
      throw new Error('No valid resumes found for blending. Please upload resumes.');
    }
    const profiles = records.map((record) => getResumeProfileFromRecord(record, record.name)).filter(Boolean);
    const label = String(resumeSelection.label || records.map((record) => record.name).join(' + ') || 'Blended Resume').trim() || 'Blended Resume';
    const mode = String(resumeSelection.mode || 'average').trim().toLowerCase() === 'sum' ? 'sum' : 'average';
    const blendCacheKey = buildBlendResumeRevisionKey(records, mode, label);
    let combined = resumeProfileCache.get(blendCacheKey);
    if (!combined) {
      combined = combineResumeProfiles(profiles, mode, label);
      resumeProfileCache.set(blendCacheKey, combined);
      trimMapCacheToLimit(resumeProfileCache, RESUME_PROFILE_CACHE_MAX);
    }
    const key = `${mode}:${profiles.map((profile) => profile.source || 'resume').join('+') || 'resume'}`;
    return { resumeKey: key, profile: combined, ids };
  }

  throw new Error('Invalid resume selection type. Please upload a resume.');
}

function parseResumeSelectionFromParams(params) {
  const resumeMode = String(params.get('resumeMode') || '').trim().toLowerCase();
  const resumeIdsParam = String(params.get('resumeIds') || '').trim();
  const resumeIdParam = String(params.get('resumeId') || '').trim();
  const blendMode = String(params.get('resumeBlend') || 'average').trim().toLowerCase();
  const label = String(params.get('resumeLabel') || '').trim();

  if (resumeIdsParam) {
    return {
      type: 'blend',
      mode: blendMode === 'sum' ? 'sum' : 'average',
      label,
      resumeIds: resumeIdsParam.split(',').map((id) => String(id || '').trim()).filter(Boolean),
    };
  }

  if (resumeMode === 'uploaded' && resumeIdParam) {
    return { type: 'uploaded', resumeId: resumeIdParam };
  }

  if (resumeMode === 'blend' && resumeIdParam) {
    return {
      type: 'blend',
      mode: blendMode === 'sum' ? 'sum' : 'average',
      label,
      resumeIds: resumeIdParam.split('+').map((id) => String(id || '').trim()).filter(Boolean),
    };
  }

  return { type: 'uploaded', resumeId: resumeIdParam || null };
}

function tokenizeAndBigram(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/node\.js/g, 'node.js nodejs')
    .replace(/three\.js/g, 'three.js threejs')
    .replace(/full-stack/g, 'full-stack full stack')
    .replace(/multi-agent/g, 'multi-agent multiagent')
    .replace(/ai\/ml/g, 'ai ml')
    .replace(/c\+\+/g, 'c++');

  const words = normalized
    .replace(/[^a-z0-9#+.\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .filter((t) => !RESUME_MATCH_STOP_WORDS.has(t));

  const terms = [...words];
  for (let i = 0; i < words.length - 1; i++) terms.push(`${words[i]} ${words[i + 1]}`);
  for (let i = 0; i < words.length - 2; i++) terms.push(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  return terms;
}

function buildJobMatchingText(job) {
  return [
    job.title,
    job.company,
    ...(job.jobTypes || []),
    ...(job.locations || []),
    ...(job.remotePreferences || []),
    job.description || '',
    ...(job.sectors || []),
    ...(job.industries || []),
    ...(job.categories || []),
    ...(job.subCategories || []),
    ...(job.experienceLevels || []),
  ].join(' ');
}

function countFacetHits(termSet, facetTerms) {
  let hits = 0;
  for (const t of facetTerms) {
    if (termSet.has(t)) hits += 1;
  }
  return hits;
}

function jaccardOverlap(aSet, bSet) {
  let inter = 0;
  for (const v of aSet) {
    if (bSet.has(v)) inter += 1;
  }
  const union = aSet.size + bSet.size - inter;
  return union > 0 ? inter / union : 0;
}

function countPhraseSignals(textLower, signalPhrases = ULTRA_SIGNAL_PHRASES) {
  let score = 0;
  for (const [phrase, weight] of signalPhrases) {
    if (textLower.includes(phrase)) score += weight;
  }
  return score;
}

function extractUltraCanonicalSkills(textLower, skillCanonical = ULTRA_SKILL_CANONICAL) {
  const skills = new Set();
  for (const [canonical, aliases] of Object.entries(skillCanonical)) {
    if (aliases.some((a) => textLower.includes(a))) skills.add(canonical);
  }
  return skills;
}

function overlapScore(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const item of aSet) {
    if (bSet.has(item)) inter += 1;
  }
  return inter / Math.max(1, Math.min(aSet.size, bSet.size));
}

function getAnchorSemanticScore(termSet, anchors = RESUME_ANCHORS) {
  let best = 0;
  for (const anchor of anchors) {
    const aSet = new Set(tokenizeAndBigram(anchor));
    const overlap = jaccardOverlap(termSet, aSet);
    if (overlap > best) best = overlap;
  }
  return Math.round(best * 100);
}

function toLegacyCategoryBreakdown(uniqueTerms, termWeights = RESUME_TERM_WEIGHTS, matchFacets = MATCH_FACETS) {
  const aiTerms = new Set(matchFacets.ai || []);
  const engTerms = new Set(matchFacets.engineering || matchFacets.audio || []);
  const climateTerms = new Set(matchFacets.climate || matchFacets.vr || []);

  const breakdown = { ai: 0, engineering: 0, climate: 0, tech: 0 };
  for (const term of uniqueTerms) {
    const weight = termWeights[term] || 0;
    if (!weight) continue;
    if (aiTerms.has(term)) breakdown.ai += weight;
    else if (engTerms.has(term)) breakdown.engineering += weight;
    else if (climateTerms.has(term)) breakdown.climate += weight;
    else breakdown.tech += weight;
  }
  return breakdown;
}

function scoreRoleFit(job) {
  const t = String(job.title || '').toLowerCase();
  if (/\b(intern|internship|new grad|junior|entry level|apprentice)\b/.test(t)) return -18;
  if (/\b(principal|staff)\b/.test(t)) return 16;
  if (/\b(senior|lead|architect)\b/.test(t)) return 10;
  return 0;
}

function negativeRolePenalty(jobTextLower) {
  for (const n of NEGATIVE_ROLE_TERMS) {
    if (jobTextLower.includes(n)) return -14;
  }
  return 0;
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = Number(a[i]) || 0;
    const bv = Number(b[i]) || 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function fetchOllamaEmbedding(text) {
  const key = String(text || '').slice(0, 2000);
  if (localEmbeddingCache.has(key)) return localEmbeddingCache.get(key);

  const response = await fetch(OLLAMA_EMBED_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: key }),
    signal: AbortSignal.timeout(LOCAL_MODEL_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Local embedding request failed: ${response.status}`);
  const payload = await response.json();
  const vec = payload.embedding || (Array.isArray(payload.embeddings) ? payload.embeddings[0] : null);
  if (!Array.isArray(vec)) throw new Error('Local embedding response missing vector');
  localEmbeddingCache.set(key, vec);
  return vec;
}

async function getResumeEmbeddingForProfile(resumeKey, profile) {
  const cacheKey = String(resumeKey || profile?.resumeLabel || profile?.source || 'resume');
  const text = profile && profile.profileText ? profile.profileText : '';
  if (!resumeEmbeddingPromises[cacheKey]) {
    resumeEmbeddingPromises[cacheKey] = fetchOllamaEmbedding(text).catch((err) => {
      resumeEmbeddingPromises[cacheKey] = null;
      throw err;
    });
  }
  return resumeEmbeddingPromises[cacheKey];
}

function scoreJobAgainstResumeClassic(job, profile = null) {
  const termWeights = profile ? profile.termWeights : RESUME_TERM_WEIGHTS;
  const matchFacets = profile ? profile.matchFacets : MATCH_FACETS;
  const jobText = [
    job.title,
    job.company,
    ...(job.jobTypes || []),
    ...(job.remotePreferences || []),
  ].join(' ');

  const uniqueTerms = new Set(tokenizeAndBigram(jobText));
  const keywordTerms = new Set(tokenizeAndBigram(buildJobMatchingText(job)));
  let rawScore = 0;
  for (const term of uniqueTerms) {
    const weight = termWeights[term] || 0;
    rawScore += weight;
  }

  return {
    rawScore,
    resumeKeywordBreakdown: buildResumeKeywordBreakdown(keywordTerms, termWeights, matchFacets, job),
    breakdown: toLegacyCategoryBreakdown(uniqueTerms, termWeights, matchFacets),
  };
}

function scoreJobAgainstResumeHybrid(job, profile = null) {
  const termWeights = profile ? profile.termWeights : RESUME_TERM_WEIGHTS;
  const matchFacets = profile ? profile.matchFacets : MATCH_FACETS;
  const anchors = profile ? profile.anchors : RESUME_ANCHORS;
  const domainBoostFn = profile ? profile.domainBoostFn : (j) => (j.jobField === 'climate' || j.jobField === 'globalhealth') ? 4.0 : 0;

  const jobText = buildJobMatchingText(job);
  const jobTextLower = String(jobText || '').toLowerCase();
  const uniqueTerms = new Set(tokenizeAndBigram(jobText));

  let weightedTermScore = 0;
  for (const term of uniqueTerms) {
    const weight = termWeights[term];
    if (weight) weightedTermScore += weight;
  }

  const facetKeys = Object.keys(matchFacets);
  const facetHits = facetKeys.map((k) => countFacetHits(uniqueTerms, matchFacets[k]));
  const facetCoverageScore = facetHits.reduce((sum, hits, i) => {
    const cap = i === 0 ? 8 : 8;
    return sum + (Math.min(hits, cap) * (i === 0 ? 2.6 : i === 1 ? 2.2 : i === 2 ? 1.7 : 1.6));
  }, 0);

  const semanticAnchorScore = getAnchorSemanticScore(uniqueTerms, anchors); // 0-100
  const roleFit = scoreRoleFit(job);
  const negativePenalty = negativeRolePenalty(jobTextLower);
  const domainBoost = domainBoostFn(job, jobTextLower);

  const rawScore =
    (weightedTermScore * 1.0)
    + (facetCoverageScore * 0.9)
    + (semanticAnchorScore * 0.22)
    + roleFit
    + negativePenalty
    + domainBoost;

  return {
    rawScore,
    resumeKeywordBreakdown: buildResumeKeywordBreakdown(uniqueTerms, termWeights, matchFacets, job),
    breakdown: {
      [facetKeys[0] || 'ai']: facetHits[0] || 0,
      [facetKeys[1] || 'engineering']: facetHits[1] || 0,
      [facetKeys[2] || 'climate']: facetHits[2] || 0,
      [facetKeys[3] || 'tech']: facetHits[3] || 0,
      semantic: semanticAnchorScore,
    },
  };
}

function scoreJobAgainstResumeUltra(job, queryText = '', profile = null) {
  const hybrid = scoreJobAgainstResumeHybrid(job, profile);
  const skillCanonical = profile ? profile.skillCanonical : ULTRA_SKILL_CANONICAL;
  const resumeSkills = profile ? profile.resumeSkills : ULTRA_RESUME_SKILLS;
  const signalPhrases = profile ? profile.signalPhrases : ULTRA_SIGNAL_PHRASES;
  const missionRe = profile ? profile.missionRe : /climate|decarbonization|renewable|carbon|global health|humanitarian|electric vehicle|ev charging|heat pump|induction cooking|home electrification|building efficiency|smart home energy/;

  const jobText = buildJobMatchingText(job);
  const textLower = String(jobText || '').toLowerCase();
  const uniqueTerms = new Set(tokenizeAndBigram(jobText));
  const queryLower = String(queryText || '').toLowerCase();

  const skillSet = extractUltraCanonicalSkills(textLower, skillCanonical);
  const skillOverlap = overlapScore(skillSet, resumeSkills);
  const skillScore = Math.round(skillOverlap * 100);

  const phraseSignal = countPhraseSignals(textLower, signalPhrases);

  let queryBoost = 0;
  if (queryLower) {
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length > 2);
    const matched = queryTerms.filter((t) => textLower.includes(t)).length;
    if (queryTerms.length > 0) queryBoost = Math.round((matched / queryTerms.length) * 20);
  }

  const missionBoost = missionRe.test(textLower) ? 8 : 0;
  const titleBoost = /principal|staff|senior|lead/.test(String(job.title || '').toLowerCase()) ? 6 : 0;

  const rawScore =
    (hybrid.rawScore * 0.9)
    + (skillScore * 0.8)
    + (phraseSignal * 1.2)
    + queryBoost
    + missionBoost
    + titleBoost;

  return {
    rawScore,
    resumeKeywordBreakdown: buildResumeKeywordBreakdown(
      uniqueTerms,
      profile ? profile.termWeights : RESUME_TERM_WEIGHTS,
      profile ? profile.matchFacets : MATCH_FACETS,
      job,
    ),
    breakdown: {
      ...hybrid.breakdown,
      skills: skillSet.size,
      phrase: phraseSignal,
    },
  };
}

function scoreJobAgainstResumeBase(job, rankingMode, queryText = '', profile = null) {
  if (rankingMode === 'classic') return scoreJobAgainstResumeClassic(job, profile);
  if (rankingMode === 'ultra') return scoreJobAgainstResumeUltra(job, queryText, profile);
  return scoreJobAgainstResumeHybrid(job, profile);
}

function scoreJobAgainstResume(job, rankingMode, queryText = '', profile = null) {
  if (!profile) {
    throw new Error('Resume profile is required. No resume is available for scoring.');
  }
  return scoreJobAgainstResumeBase(job, rankingMode, queryText, profile);
}

async function rerankWithLocalModel(jobs, options = {}) {
  const topK = Number(options.topK || LOCAL_MODEL_TOP_K);
  const blend = Number(options.blend || LOCAL_MODEL_BLEND);
  const query = String(options.query || '').trim();
  const resumeId = String(options.resumeId || 'resume1').trim();
  const profile = RESUME_PROFILES[resumeId];
  if (!profile) return { jobs, localModelApplied: false };
  
  const profileText = profile.profileText || '';
  const top = jobs.slice(0, topK);
  if (!top.length) return { jobs, localModelApplied: false };

  try {
    const resumePrompt = query
      ? `${profileText}\nTarget search intent: ${query}`
      : profileText;
    const resumeEmbedding = await (query ? fetchOllamaEmbedding(resumePrompt) : getResumeEmbedding(resumeId));
    const enriched = await Promise.all(top.map(async (job) => {
      const text = buildJobMatchingText(job);
      const emb = await fetchOllamaEmbedding(text);
      const sim = cosineSimilarity(resumeEmbedding, emb);
      const llmScore = Math.max(0, Math.min(100, Math.round(((sim + 1) / 2) * 100)));
      const boostedResume = Math.round((job.resumeScore * (1 - blend)) + (llmScore * blend));
      const boostedTotal = Math.round((boostedResume + job.impactScore + job.bayScore + job.freshnessScore) / 4);
      return {
        ...job,
        llmScore,
        resumeScore: boostedResume,
        score: boostedTotal,
      };
    }));

    const reranked = enriched
      .sort((a, b) => b.score - a.score)
      .concat(jobs.slice(topK));

    return { jobs: reranked, localModelApplied: true };
  } catch {
    return { jobs, localModelApplied: false };
  }
}

// ─── Proximity Scoring by Location ────────────────────────────────────────
const LOCATION_STRINGS = {
  'bay-area': [
    'san francisco', 'sf, ca', 'san mateo', 'oakland', 'san jose',
    'palo alto', 'mountain view', 'sunnyvale', 'santa clara', 'berkeley',
    'redwood city', 'foster city', 'menlo park', 'burlingame', 'fremont',
    'hayward', 'east bay', 'south bay', 'bay area', 'silicon valley',
    'emeryville', 'alameda', 'walnut creek', 'pleasanton', 'san ramon',
    'milpitas', 'cupertino', 'campbell', 'los gatos', 'san leandro',
    'south san francisco', 'san carlos', 'belmont', 'daly city',
  ],
  'california': [
    'california', ', ca', 'los angeles', 'san diego', 'sacramento',
    'fresno', 'long beach', 'anaheim', 'riverside', 'stockton',
  ],
  'east-coast': [
    'new york', 'boston', 'philadelphia', 'washington', 'dc', 'd.c.',
    'baltimore', 'maryland', 'massachusetts', 'new jersey', 'connecticut',
    'rhode island', 'new hampshire', 'vermont', 'pennsylvania',
  ],
  'west-coast': [
    'seattle', 'portland', 'oregon', 'washington', 'los angeles',
    'san diego', 'california', 'pacific northwest',
  ],
};

// City-to-region mappings for custom locations
const CITY_LOCATION_MAP = {
  'seattle': { keywords: ['seattle', 'wa'], regions: ['west-coast'], label: 'Seattle, WA' },
  'portland': { keywords: ['portland', 'or'], regions: ['west-coast'], label: 'Portland, OR' },
  'los-angeles': { keywords: ['los angeles', 'la', 'ca'], regions: ['california', 'west-coast'], label: 'Los Angeles, CA' },
  'san-diego': { keywords: ['san diego', 'ca'], regions: ['california', 'west-coast'], label: 'San Diego, CA' },
  'san-francisco': { keywords: ['san francisco', 'sf'], regions: ['bay-area'], label: 'San Francisco, CA' },
  'san-jose': { keywords: ['san jose', 'ca'], regions: ['bay-area'], label: 'San Jose, CA' },
  'oakland': { keywords: ['oakland', 'ca'], regions: ['bay-area'], label: 'Oakland, CA' },
  'berkeley': { keywords: ['berkeley', 'ca'], regions: ['bay-area'], label: 'Berkeley, CA' },
  'palo-alto': { keywords: ['palo alto', 'ca'], regions: ['bay-area'], label: 'Palo Alto, CA' },
  'mountain-view': { keywords: ['mountain view', 'ca'], regions: ['bay-area'], label: 'Mountain View, CA' },
  'sunnyvale': { keywords: ['sunnyvale', 'ca'], regions: ['bay-area'], label: 'Sunnyvale, CA' },
  'cupertino': { keywords: ['cupertino', 'ca'], regions: ['bay-area'], label: 'Cupertino, CA' },
  'redwood-city': { keywords: ['redwood city', 'ca'], regions: ['bay-area'], label: 'Redwood City, CA' },
  'menlo-park': { keywords: ['menlo park', 'ca'], regions: ['bay-area'], label: 'Menlo Park, CA' },
  'sacramento': { keywords: ['sacramento', 'ca'], regions: ['california'], label: 'Sacramento, CA' },
  'fresno': { keywords: ['fresno', 'ca'], regions: ['california'], label: 'Fresno, CA' },
  'anaheim': { keywords: ['anaheim', 'ca'], regions: ['california'], label: 'Anaheim, CA' },
  'new-york': { keywords: ['new york', 'ny'], regions: ['east-coast'], label: 'New York, NY' },
  'boston': { keywords: ['boston', 'ma'], regions: ['east-coast'], label: 'Boston, MA' },
  'philadelphia': { keywords: ['philadelphia', 'pa'], regions: ['east-coast'], label: 'Philadelphia, PA' },
  'washington-dc': { keywords: ['washington', 'dc'], regions: ['east-coast'], label: 'Washington, DC' },
  'baltimore': { keywords: ['baltimore', 'md'], regions: ['east-coast'], label: 'Baltimore, MD' },
  'pittsburgh': { keywords: ['pittsburgh', 'pa'], regions: ['east-coast'], label: 'Pittsburgh, PA' },
  'providence': { keywords: ['providence', 'ri'], regions: ['east-coast'], label: 'Providence, RI' },
  'newark': { keywords: ['newark', 'nj'], regions: ['east-coast'], label: 'Newark, NJ' },
  'chicago': { keywords: ['chicago', 'il'], regions: ['midwest'], label: 'Chicago, IL' },
  'minneapolis': { keywords: ['minneapolis', 'mn'], regions: ['midwest'], label: 'Minneapolis, MN' },
  'detroit': { keywords: ['detroit', 'mi'], regions: ['midwest'], label: 'Detroit, MI' },
  'columbus': { keywords: ['columbus', 'oh'], regions: ['midwest'], label: 'Columbus, OH' },
  'st-louis': { keywords: ['st. louis', 'st louis', 'mo'], regions: ['midwest'], label: 'St. Louis, MO' },
  'kansas-city': { keywords: ['kansas city', 'mo'], regions: ['midwest'], label: 'Kansas City, MO' },
  'denver': { keywords: ['denver', 'co'], regions: ['midwest'], label: 'Denver, CO' },
  'austin': { keywords: ['austin', 'tx'], regions: ['south'], label: 'Austin, TX' },
  'dallas': { keywords: ['dallas', 'tx'], regions: ['south'], label: 'Dallas, TX' },
  'houston': { keywords: ['houston', 'tx'], regions: ['south'], label: 'Houston, TX' },
  'atlanta': { keywords: ['atlanta', 'ga'], regions: ['south'], label: 'Atlanta, GA' },
  'miami': { keywords: ['miami', 'fl'], regions: ['south'], label: 'Miami, FL' },
  'orlando': { keywords: ['orlando', 'fl'], regions: ['south'], label: 'Orlando, FL' },
  'nashville': { keywords: ['nashville', 'tn'], regions: ['south'], label: 'Nashville, TN' },
  'charlotte': { keywords: ['charlotte', 'nc'], regions: ['south'], label: 'Charlotte, NC' },
  'raleigh': { keywords: ['raleigh', 'nc'], regions: ['south'], label: 'Raleigh, NC' },
  'new-orleans': { keywords: ['new orleans', 'la'], regions: ['south'], label: 'New Orleans, LA' },
};

const REGION_CENTROIDS = {
  'bay-area': { lat: 37.7749, lng: -122.4194, label: 'Bay Area' },
  california: { lat: 36.7783, lng: -119.4179, label: 'California' },
  'west-coast': { lat: 37.7749, lng: -122.4194, label: 'West Coast' },
  'east-coast': { lat: 40.7128, lng: -74.0060, label: 'East Coast' },
};

const CITY_COORDINATES = {
  seattle: { lat: 47.6062, lng: -122.3321 },
  portland: { lat: 45.5152, lng: -122.6784 },
  'los-angeles': { lat: 34.0522, lng: -118.2437 },
  'san-diego': { lat: 32.7157, lng: -117.1611 },
  'san-francisco': { lat: 37.7749, lng: -122.4194 },
  'san-jose': { lat: 37.3382, lng: -121.8863 },
  oakland: { lat: 37.8044, lng: -122.2712 },
  berkeley: { lat: 37.8715, lng: -122.2730 },
  'palo-alto': { lat: 37.4419, lng: -122.1430 },
  'mountain-view': { lat: 37.3861, lng: -122.0839 },
  sunnyvale: { lat: 37.3688, lng: -122.0363 },
  cupertino: { lat: 37.3229, lng: -122.0322 },
  'redwood-city': { lat: 37.4852, lng: -122.2364 },
  'menlo-park': { lat: 37.4530, lng: -122.1817 },
  sacramento: { lat: 38.5816, lng: -121.4944 },
  fresno: { lat: 36.7378, lng: -119.7871 },
  anaheim: { lat: 33.8366, lng: -117.9143 },
  'new-york': { lat: 40.7128, lng: -74.0060 },
  boston: { lat: 42.3601, lng: -71.0589 },
  philadelphia: { lat: 39.9526, lng: -75.1652 },
  'washington-dc': { lat: 38.9072, lng: -77.0369 },
  baltimore: { lat: 39.2904, lng: -76.6122 },
  pittsburgh: { lat: 40.4406, lng: -79.9959 },
  providence: { lat: 41.8240, lng: -71.4128 },
  newark: { lat: 40.7357, lng: -74.1724 },
  chicago: { lat: 41.8781, lng: -87.6298 },
  minneapolis: { lat: 44.9778, lng: -93.2650 },
  detroit: { lat: 42.3314, lng: -83.0458 },
  columbus: { lat: 39.9612, lng: -82.9988 },
  'st-louis': { lat: 38.6270, lng: -90.1994 },
  'kansas-city': { lat: 39.0997, lng: -94.5786 },
  denver: { lat: 39.7392, lng: -104.9903 },
  austin: { lat: 30.2672, lng: -97.7431 },
  dallas: { lat: 32.7767, lng: -96.7970 },
  houston: { lat: 29.7604, lng: -95.3698 },
  atlanta: { lat: 33.7490, lng: -84.3880 },
  miami: { lat: 25.7617, lng: -80.1918 },
  orlando: { lat: 28.5383, lng: -81.3792 },
  nashville: { lat: 36.1627, lng: -86.7816 },
  charlotte: { lat: 35.2271, lng: -80.8431 },
  raleigh: { lat: 35.7796, lng: -78.6382 },
  'new-orleans': { lat: 29.9511, lng: -90.0715 },
};

const CITY_DISTANCE_MATCHERS = Object.entries(CITY_LOCATION_MAP)
  .map(([slug, data]) => {
    const coords = CITY_COORDINATES[slug];
    if (!coords) return null;
    const cityName = String(data.label || '').split(',')[0].trim().toLowerCase();
    const keywords = Array.isArray(data.keywords)
      ? data.keywords.map((k) => String(k || '').trim().toLowerCase()).filter((k) => k.length >= 4)
      : [];
    const patterns = [...new Set([cityName, ...keywords])];
    return {
      slug,
      label: data.label || cityName,
      coords,
      patterns,
    };
  })
  .filter(Boolean);

function isFiniteCoordinate(value) {
  return Number.isFinite(Number(value));
}

function haversineDistanceKm(from, to) {
  const lat1 = Number(from.lat);
  const lng1 = Number(from.lng);
  const lat2 = Number(to.lat);
  const lng2 = Number(to.lng);
  if (![lat1, lng1, lat2, lng2].every((n) => Number.isFinite(n))) return null;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    (Math.sin(dLat / 2) ** 2)
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * (Math.sin(dLng / 2) ** 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function scoreDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm)) return 5;
  if (distanceKm <= 25) return 95;
  if (distanceKm <= 50) return 90;
  if (distanceKm <= 100) return 82;
  if (distanceKm <= 250) return 70;
  if (distanceKm <= 500) return 55;
  if (distanceKm <= 1000) return 40;
  if (distanceKm <= 2500) return 25;
  return 10;
}

function resolveTargetCoordinates(targetLocation, targetCoordinates = null) {
  if (targetCoordinates && isFiniteCoordinate(targetCoordinates.lat) && isFiniteCoordinate(targetCoordinates.lng)) {
    return { lat: Number(targetCoordinates.lat), lng: Number(targetCoordinates.lng) };
  }
  if (targetLocation && CITY_COORDINATES[targetLocation]) {
    return CITY_COORDINATES[targetLocation];
  }
  if (targetLocation && REGION_CENTROIDS[targetLocation]) {
    return REGION_CENTROIDS[targetLocation];
  }

  const normalized = String(targetLocation || '').toLowerCase();
  const matchedCity = CITY_DISTANCE_MATCHERS.find((entry) =>
    entry.patterns.some((pattern) => normalized.includes(pattern)),
  );
  return matchedCity ? matchedCity.coords : null;
}

function resolveJobCoordinates(job) {
  const locationText = [...job.locations, ...job.remotePreferences].join(' ').toLowerCase();
  const matchedCity = CITY_DISTANCE_MATCHERS.find((entry) =>
    entry.patterns.some((pattern) => locationText.includes(pattern)),
  );
  if (!matchedCity) return null;
  return {
    ...matchedCity.coords,
    label: matchedCity.label,
  };
}

function scoreProximity(job, targetLocation = 'bay-area', targetCoordinates = null, targetLocationLabel = '') {
  const locationText = [...job.locations, ...job.remotePreferences].join(' ').toLowerCase();
  const isRemote = job.remotePreferences.some((p) => p.toLowerCase().includes('remote'));
  const isHybrid = job.remotePreferences.some((p) => p.toLowerCase().includes('hybrid'));

  const resolvedTargetCoordinates = resolveTargetCoordinates(targetLocation, targetCoordinates);
  const resolvedJobCoordinates = resolveJobCoordinates(job);

  if (resolvedTargetCoordinates && resolvedJobCoordinates) {
    const distanceKm = haversineDistanceKm(resolvedTargetCoordinates, resolvedJobCoordinates);
    const roundedDistanceKm = Math.round(distanceKm || 0);
    const distanceScore = scoreDistanceKm(distanceKm);
    const distanceLabel = `${resolvedJobCoordinates.label} · ${roundedDistanceKm} km away`;

    if (isRemote) return { bayScore: Math.max(distanceScore, 50), bayLabel: `${distanceLabel} + Remote` };
    if (isHybrid) return { bayScore: Math.max(distanceScore - 10, 25), bayLabel: `${distanceLabel} (Hybrid)` };
    return { bayScore: distanceScore, bayLabel: distanceLabel };
  }

  // Check for specific location match
  let isTargetLocation = false;
  let isAlternateLocation = false;
  let targetLabel = targetLocationLabel || targetLocation;

  // Handle predefined region categories (US-based quick picks)
  if (targetLocation && LOCATION_STRINGS[targetLocation]) {
    isTargetLocation = LOCATION_STRINGS[targetLocation].some((s) => locationText.includes(s));
    // Check other locations for comparison
    for (const [loc, strings] of Object.entries(LOCATION_STRINGS)) {
      if (loc !== targetLocation && strings.some((s) => locationText.includes(s))) {
        isAlternateLocation = true;
        break;
      }
    }
  }
  // Handle predefined city locations (US cities)
  else if (targetLocation && CITY_LOCATION_MAP[targetLocation]) {
    const cityData = CITY_LOCATION_MAP[targetLocation];
    targetLabel = cityData.label;
    // Check if job location contains any of the city keywords
    isTargetLocation = cityData.keywords.some((keyword) => locationText.includes(keyword));
    // If not a direct match, check if it's in any of the city's regions
    if (!isTargetLocation) {
      for (const region of cityData.regions) {
        if (LOCATION_STRINGS[region] && LOCATION_STRINGS[region].some((s) => locationText.includes(s))) {
          isAlternateLocation = true;
          break;
        }
      }
    }
  }
  // Handle Geonames worldwide locations (format: "city, country" or just "city name")
  else if (targetLocation && !targetLocation.startsWith('geo-')) {
    // For worldwide locations, do simple keyword matching on the city/country name
    const targetKeywords = targetLocation.toLowerCase().split(',').map((s) => s.trim());
    // Check if any of the target keywords appear in the job location
    isTargetLocation = targetKeywords.some((keyword) => keyword.length > 2 && locationText.includes(keyword));
    targetLabel = targetLocation;
  }

  if (isTargetLocation && isRemote) return { bayScore: 100, bayLabel: `${targetLabel} + Remote` };
  if (isTargetLocation) return { bayScore: 95, bayLabel: targetLabel };
  if (isRemote) return { bayScore: 50, bayLabel: 'Remote' };
  if (isHybrid) return { bayScore: 25, bayLabel: 'Hybrid' };
  if (isAlternateLocation) return { bayScore: 12, bayLabel: 'Different US Region' };
  if (!job.locations.length) return { bayScore: 35, bayLabel: 'Location TBD' };
  return { bayScore: 5, bayLabel: 'Distant/International' };
}

// Keep old function name for backward compatibility
function scoreBayAreaProximity(job, targetLocation = 'bay-area', targetCoordinates = null, targetLocationLabel = '') {
  return scoreProximity(job, targetLocation, targetCoordinates, targetLocationLabel);
}

// ─── Real-World Impact Scoring ─────────────────────────────────────────────
// Tiers ordered from highest to lowest impact; first match wins.
const IMPACT_TIERS = [
  {
    score: 95, label: 'Direct Decarbonization',
    terms: [
      'solar', 'wind energy', 'offshore wind', 'geothermal', 'nuclear',
      'carbon capture', 'carbon removal', 'direct air capture', 'dac',
      'carbon dioxide removal', 'cdr', 'carbon sequestration',
    ],
  },
  {
    score: 88, label: 'Clean Energy',
    terms: [
      'energy storage', 'battery storage', 'grid storage', 'clean energy',
      'renewable energy', 'green hydrogen', 'hydrogen fuel', 'fuel cell',
      'clean power', 'wind farm', 'solar farm',
    ],
  },
  {
    score: 82, label: 'Clean Transport',
    terms: [
      'electric vehicle', 'ev charging', 'zero emission', 'zero-emission',
      'clean transportation', 'sustainable aviation', 'aviation fuel',
      'fleet electrification', 'ebike', 'e-mobility',
    ],
  },
  {
    score: 76, label: 'Built Environment',
    terms: [
      'building decarbonization', 'building efficiency', 'heat pump',
      'energy efficiency', 'smart building', 'electrification',
      'deep retrofit', 'green building', 'leed',
    ],
  },
  {
    score: 70, label: 'Food & Land',
    terms: [
      'regenerative agriculture', 'sustainable agriculture', 'food systems',
      'reforestation', 'afforestation', 'land use', 'biodiversity',
      'nature-based', 'blue carbon', 'ocean health', 'wetland',
    ],
  },
  {
    score: 64, label: 'Climate Science',
    terms: [
      'climate research', 'climate modeling', 'climate science', 'climate data',
      'emissions data', 'earth observation', 'remote sensing', 'satellite imagery',
      'atmospheric', 'climate analytics',
    ],
  },
  {
    score: 56, label: 'Climate Policy',
    terms: [
      'climate policy', 'clean energy policy', 'environmental justice',
      'carbon policy', 'regulatory', 'advocacy', 'public policy', 'legislation',
    ],
  },
  {
    score: 48, label: 'Climate Finance',
    terms: [
      'climate finance', 'green finance', 'carbon market', 'carbon credit',
      'carbon offset', 'impact investing', 'green bond', 'sustainability bond',
    ],
  },
  {
    score: 38, label: 'ESG & Reporting',
    terms: [
      'esg', 'sustainability reporting', 'carbon accounting', 'scope 3',
      'csrd', 'ghg', 'emissions tracking', 'disclosures',
    ],
  },
  {
    score: 28, label: 'Climate Adjacent',
    terms: ['sustainability', 'climate', 'cleantech', 'environmental', 'clean tech', 'net zero'],
  },
];

function scoreImpactClassic(job) {
  const text = [job.title, job.company, ...job.jobTypes].join(' ').toLowerCase();
  for (const tier of IMPACT_TIERS) {
    if (tier.terms.some((t) => text.includes(t))) {
      const matchedTerms = getMatchedImpactTerms(text, tier.terms, tier.label, 8);
      return {
        impactScore: tier.score,
        impactLabel: tier.label,
        impactKeywordBreakdown: buildImpactKeywordBreakdown(
          'classic',
          [matchedTerms],
          { notes: [`Matched impact tier: ${tier.label}`] },
        ),
      };
    }
  }
  return {
    impactScore: 18,
    impactLabel: 'General',
    impactKeywordBreakdown: buildImpactKeywordBreakdown('classic', [], { notes: ['No tier-specific climate terms were matched.'] }),
  };
}

const IMPACT_ULTRA_DIRECT = [
  'direct air capture', 'carbon removal', 'carbon dioxide removal', 'cdr', 'carbon capture',
  'methane abatement', 'green hydrogen', 'electrolyzer', 'geothermal', 'fusion', 'fission',
  'offshore wind', 'wind turbine', 'solar inverter', 'battery storage', 'long duration storage',
  'grid scale storage', 'heat pump', 'building decarbonization', 'industrial decarbonization',
  'scope 1', 'scope 2', 'scope 3', 'life cycle assessment', 'lca', 'reforestation', 'afforestation',
  'nature-based carbon', 'blue carbon', 'sustainable aviation fuel', 'saf',
];

const IMPACT_ULTRA_ENABLEMENT = [
  'energy management', 'energy optimization', 'demand response', 'grid software', 'virtual power plant',
  'vpp', 'smart charging', 'ev charging', 'electrification', 'load forecasting', 'climate analytics',
  'satellite imagery', 'remote sensing', 'climate model', 'emissions monitoring', 'carbon accounting',
  'esg reporting', 'sustainability reporting', 'building efficiency', 'waste heat', 'recycling',
  'circular economy', 'water efficiency', 'supply chain decarbonization',
];

const IMPACT_ULTRA_ADAPTATION = [
  'adaptation', 'resilience', 'flood', 'wildfire', 'heat risk', 'disaster response',
  'microgrid', 'grid resilience', 'drought', 'insurance risk', 'catastrophe model',
  'climate risk', 'stormwater', 'air quality',
];

const IMPACT_ULTRA_POLICY_FINANCE = [
  'climate policy', 'clean energy policy', 'regulatory', 'public policy', 'environmental justice',
  'impact investing', 'green bond', 'climate finance', 'project finance', 'carbon market',
  'carbon credit', 'article 6',
];

const IMPACT_ULTRA_NEGATIVE = [
  'oil and gas', 'fossil fuel', 'coal mining', 'fracking', 'drilling', 'upstream oil',
  'pipeline operations', 'tobacco', 'defense weapons',
];

const IMPACT_SOURCE_PRIOR = {
  climatebase: 9,
  terra: 8,
  eightyk: 8,
  greenhouse: 3,
  lever: 3,
  ashby: 3,
  breezy: 2,
  bamboo: 2,
  builtin: 2,
  remoteok: 0,
};

const IMPACT_FIELD_PRIOR = {
  climate: 12,
  agtech: 7,
  globalhealth: 5,
  medical: 4,
  mentalhealth: 2,
  edtech: 1,
};

const IMPACT_SOCIAL_CORE = [
  'healthcare', 'health care', 'clinical', 'patient', 'medical', 'hospital', 'provider',
  'diagnostics', 'telehealth', 'public health', 'mental health', 'behavioral health',
  'therapy', 'therapeutic', 'care delivery', 'care coordination', 'care management',
  'education', 'learning', 'classroom', 'school', 'student', 'teacher', 'curriculum',
  'literacy', 'assessment', 'edtech', 'workforce development',
];

const IMPACT_SOCIAL_ACCESS = [
  'underserved', 'low-income', 'affordable', 'access', 'equity', 'inclusive', 'inclusion',
  'rural', 'medicaid', 'medicare', 'community health', 'safety net', 'lmic',
  'global health', 'disability', 'accessibility', 'language access',
];

const IMPACT_SOCIAL_OUTCOMES = [
  'outcomes', 'evidence-based', 'evidence based', 'early intervention', 'preventive care',
  'adherence', 'readmission', 'mortality', 'morbidity', 'student achievement',
  'learning outcomes', 'graduation', 'retention', 'attendance',
];

const IMPACT_SOCIAL_NEGATIVE = [
  'casino', 'sports betting', 'gambling', 'predatory lending', 'payday loan',
  'surveillance advertising', 'ad targeting', 'clickbait',
];

const IMPACT_SOCIAL_FIELD_PRIOR = {
  globalhealth: 14,
  medical: 13,
  mentalhealth: 13,
  edtech: 12,
  agtech: 6,
  climate: 2,
};

const IMPACT_SOCIAL_SOURCE_PRIOR = {
  eightyk: 7,
  builtin: 4,
  climatebase: 2,
  greenhouse: 2,
  lever: 2,
  ashby: 2,
  terra: 2,
  breezy: 1,
  bamboo: 1,
  remoteok: 0,
};

function countDistinctKeywordHits(text, terms) {
  let hits = 0;
  for (const term of terms) {
    if (text.includes(term)) hits += 1;
  }
  return hits;
}

function scoreImpactUltra(job) {
  const title = String(job.title || '').toLowerCase();
  const company = String(job.company || '').toLowerCase();
  const description = String(job.description || '').toLowerCase();
  const source = String(job.source || 'climatebase').toLowerCase();
  const field = normalizeJobField(job.jobField || '');
  const sectors = toArray(job.sectors).join(' ').toLowerCase();
  const industries = toArray(job.industries).join(' ').toLowerCase();
  const categories = toArray(job.categories).join(' ').toLowerCase();
  const subCategories = toArray(job.subCategories).join(' ').toLowerCase();
  const jobTypes = toArray(job.jobTypes).join(' ').toLowerCase();

  const corpus = [title, company, description, sectors, industries, categories, subCategories, jobTypes].join(' ');
  const titleCompany = `${title} ${company}`;

  const directHits = countDistinctKeywordHits(corpus, IMPACT_ULTRA_DIRECT);
  const enablementHits = countDistinctKeywordHits(corpus, IMPACT_ULTRA_ENABLEMENT);
  const adaptationHits = countDistinctKeywordHits(corpus, IMPACT_ULTRA_ADAPTATION);
  const policyFinanceHits = countDistinctKeywordHits(corpus, IMPACT_ULTRA_POLICY_FINANCE);
  const negativeHits = countDistinctKeywordHits(corpus, IMPACT_ULTRA_NEGATIVE);

  const missionIntentHits = countDistinctKeywordHits(corpus, [
    'climate', 'decarbonization', 'decarbonisation', 'net zero', 'carbon neutral',
    'sustainability', 'clean energy', 'energy transition', 'emissions reduction',
    'electrification', 'environmental',
  ]);

  const titleIntentHits = countDistinctKeywordHits(titleCompany, [
    'climate', 'sustainability', 'carbon', 'clean energy', 'decarbonization', 'energy transition',
  ]);

  const seniorityHits = countDistinctKeywordHits(title, [
    'staff', 'senior staff', 'principal', 'lead', 'architect', 'director', 'head', 'manager',
  ]);

  const directScore = Math.min(46, directHits * 9);
  const enablementScore = Math.min(24, enablementHits * 4);
  const adaptationScore = Math.min(12, adaptationHits * 3);
  const policyFinanceScore = Math.min(10, policyFinanceHits * 2.5);
  const missionScore = Math.min(12, missionIntentHits * 1.8 + titleIntentHits * 2.6);
  const leverageScore = Math.min(6, seniorityHits * 2);
  const fieldScore = IMPACT_FIELD_PRIOR[field] || 0;
  const sourceScore = IMPACT_SOURCE_PRIOR[source] || 0;
  const penalty = Math.min(20, negativeHits * 6);

  let total = 10
    + directScore
    + enablementScore
    + adaptationScore
    + policyFinanceScore
    + missionScore
    + leverageScore
    + fieldScore
    + sourceScore
    - penalty;

  // Confidence bonus for jobs with multiple independent impact signals.
  const signalFamilies = [
    directHits > 0,
    enablementHits > 0,
    adaptationHits > 0,
    policyFinanceHits > 0,
    missionIntentHits > 1,
    field === 'climate',
  ].filter(Boolean).length;
  total += Math.min(8, signalFamilies * 1.5);

  const impactScore = Math.max(8, Math.min(100, Math.round(total)));
  let impactLabel = 'General';
  if (impactScore >= 90) impactLabel = 'Transformative';
  else if (impactScore >= 80) impactLabel = 'Very High';
  else if (impactScore >= 68) impactLabel = 'High';
  else if (impactScore >= 52) impactLabel = 'Medium';
  else if (impactScore >= 36) impactLabel = 'Limited';

  const directTerms = getMatchedImpactTerms(corpus, IMPACT_ULTRA_DIRECT, 'direct', 11);
  const enablementTerms = getMatchedImpactTerms(corpus, IMPACT_ULTRA_ENABLEMENT, 'enablement', 7);
  const adaptationTerms = getMatchedImpactTerms(corpus, IMPACT_ULTRA_ADAPTATION, 'adaptation', 6);
  const policyTerms = getMatchedImpactTerms(corpus, IMPACT_ULTRA_POLICY_FINANCE, 'policy-finance', 5);

  return {
    impactScore,
    impactLabel,
    impactKeywordBreakdown: buildImpactKeywordBreakdown(
      'ultra',
      [directTerms, enablementTerms, adaptationTerms, policyTerms],
      {
        notes: [
          `Direct hits: ${directHits}`,
          `Enablement hits: ${enablementHits}`,
          `Adaptation hits: ${adaptationHits}`,
          `Policy/finance hits: ${policyFinanceHits}`,
        ],
      },
    ),
  };
}

function scoreImpactSocial(job) {
  const title = String(job.title || '').toLowerCase();
  const company = String(job.company || '').toLowerCase();
  const description = String(job.description || '').toLowerCase();
  const source = String(job.source || 'climatebase').toLowerCase();
  const field = normalizeJobField(job.jobField || '');
  const sectors = toArray(job.sectors).join(' ').toLowerCase();
  const industries = toArray(job.industries).join(' ').toLowerCase();
  const categories = toArray(job.categories).join(' ').toLowerCase();
  const subCategories = toArray(job.subCategories).join(' ').toLowerCase();
  const jobTypes = toArray(job.jobTypes).join(' ').toLowerCase();

  const corpus = [title, company, description, sectors, industries, categories, subCategories, jobTypes].join(' ');
  const titleCompany = `${title} ${company}`;

  const coreHits = countDistinctKeywordHits(corpus, IMPACT_SOCIAL_CORE);
  const accessHits = countDistinctKeywordHits(corpus, IMPACT_SOCIAL_ACCESS);
  const outcomeHits = countDistinctKeywordHits(corpus, IMPACT_SOCIAL_OUTCOMES);
  const negativeHits = countDistinctKeywordHits(corpus, IMPACT_SOCIAL_NEGATIVE);

  const titleSignalHits = countDistinctKeywordHits(titleCompany, [
    'health', 'mental health', 'clinical', 'medical', 'education', 'learning', 'teacher',
    'student', 'public health', 'care', 'therapy',
  ]);

  const scaleHits = countDistinctKeywordHits(corpus, [
    'population', 'nationwide', 'statewide', 'district-wide', 'multi-site', 'enterprise',
    'health system', 'public sector',
  ]);

  const coreScore = Math.min(42, coreHits * 7);
  const accessScore = Math.min(22, accessHits * 4.5);
  const outcomesScore = Math.min(18, outcomeHits * 3.5);
  const titleScore = Math.min(10, titleSignalHits * 2.5);
  const scaleScore = Math.min(8, scaleHits * 2.2);
  const fieldScore = IMPACT_SOCIAL_FIELD_PRIOR[field] || 0;
  const sourceScore = IMPACT_SOCIAL_SOURCE_PRIOR[source] || 0;
  const penalty = Math.min(20, negativeHits * 6);

  let total = 12
    + coreScore
    + accessScore
    + outcomesScore
    + titleScore
    + scaleScore
    + fieldScore
    + sourceScore
    - penalty;

  const signalFamilies = [
    coreHits > 0,
    accessHits > 0,
    outcomeHits > 0,
    titleSignalHits > 0,
    field === 'medical' || field === 'mentalhealth' || field === 'edtech' || field === 'globalhealth',
  ].filter(Boolean).length;
  total += Math.min(8, signalFamilies * 1.6);

  const impactScore = Math.max(8, Math.min(100, Math.round(total)));
  let impactLabel = 'General';
  if (impactScore >= 88) impactLabel = 'High Social Impact';
  else if (impactScore >= 72) impactLabel = 'Strong Social Impact';
  else if (impactScore >= 56) impactLabel = 'Social Impact';
  else if (impactScore >= 38) impactLabel = 'Some Social Impact';

  const coreTerms = getMatchedImpactTerms(corpus, IMPACT_SOCIAL_CORE, 'core', 9);
  const accessTerms = getMatchedImpactTerms(corpus, IMPACT_SOCIAL_ACCESS, 'access', 7);
  const outcomeTerms = getMatchedImpactTerms(corpus, IMPACT_SOCIAL_OUTCOMES, 'outcomes', 6);

  return {
    impactScore,
    impactLabel,
    impactKeywordBreakdown: buildImpactKeywordBreakdown(
      'social',
      [coreTerms, accessTerms, outcomeTerms],
      {
        notes: [
          `Core hits: ${coreHits}`,
          `Access hits: ${accessHits}`,
          `Outcome hits: ${outcomeHits}`,
        ],
      },
    ),
  };
}

function scoreImpact(job, impactMode = 'classic') {
  if (impactMode === 'ultra') {
    return scoreImpactUltra(job);
  }
  if (impactMode === 'social') {
    return scoreImpactSocial(job);
  }
  return scoreImpactClassic(job);
}

// ─── Freshness Scoring ────────────────────────────────────────────────────
// Returns 0-100 based on how recently the job was posted.
function scoreFreshness(job) {
  if (!job.datePosted) return { freshnessScore: 30, freshnessLabel: 'Unknown' };

  const ageDays = (Date.now() - new Date(job.datePosted).getTime()) / 86_400_000;

  if (ageDays < 0)  return { freshnessScore: 100, freshnessLabel: 'Today' }; // clock skew
  if (ageDays < 1)  return { freshnessScore: 100, freshnessLabel: 'Today' };
  if (ageDays < 3)  return { freshnessScore: 92,  freshnessLabel: '< 3 days' };
  if (ageDays < 7)  return { freshnessScore: 82,  freshnessLabel: 'This week' };
  if (ageDays < 14) return { freshnessScore: 68,  freshnessLabel: '< 2 weeks' };
  if (ageDays < 30) return { freshnessScore: 50,  freshnessLabel: 'This month' };
  if (ageDays < 60) return { freshnessScore: 32,  freshnessLabel: '< 2 months' };
  if (ageDays < 90) return { freshnessScore: 18,  freshnessLabel: '< 3 months' };
  return { freshnessScore: 8, freshnessLabel: 'Older' };
}

// ─── Job Filtering ─────────────────────────────────────────────────────────
function tokenizeSearchFallback(query) {
  return [...new Set(
    String(query || '')
      .toLowerCase()
      .split(/[^a-z0-9+#.]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 2),
  )];
}

function filterJobs(jobs, query) {
  if (!query) {
    return jobs;
  }

  const q = String(query || '').toLowerCase().trim();
  const phraseMatches = jobs.filter((job) => {
    return (
      job.title.toLowerCase().includes(q) ||
      job.company.toLowerCase().includes(q) ||
      job.locations.some((location) => location.toLowerCase().includes(q)) ||
      job.remotePreferences.some((pref) => pref.toLowerCase().includes(q))
    );
  });

  if (phraseMatches.length > 0) {
    return phraseMatches;
  }

  const queryTokens = tokenizeSearchFallback(q);
  if (queryTokens.length === 0) {
    return jobs;
  }

  return jobs.filter((job) => {
    const haystack = [
      String(job.title || ''),
      String(job.company || ''),
      ...(Array.isArray(job.locations) ? job.locations : []),
      ...(Array.isArray(job.remotePreferences) ? job.remotePreferences : []),
    ].join(' ').toLowerCase();

    return queryTokens.some((token) => haystack.includes(token));
  });
}

const US_STATE_RE = /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\b/i;
const US_KW_RE = /united states|usa|\bU\.S\.|washington dc|new york city/i;
const UNKNOWN_LOCATION_RE = /location not listed|not listed|unknown|tbd/i;

function isUsJob(job) {
  const locs = toArray(job.locations).map((l) => String(l || ''));
  const prefs = toArray(job.remotePreferences).map((p) => String(p || '').toLowerCase());
  if (locs.some((l) => UNKNOWN_LOCATION_RE.test(l))) return true;
  if (locs.some((l) => US_STATE_RE.test(l) || US_KW_RE.test(l))) return true;
  if (prefs.some((p) => p.includes('remote')) && locs.length === 0) return true;
  return false;
}

const EVENT_LOOP_YIELD_INTERVAL = 200;
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

async function handleJobsApi(req, res, url) {
  try {
    const searchStartedAt = Date.now();
    const searchTimings = {};
    const markSearchTiming = (stage) => {
      searchTimings[stage] = Date.now() - searchStartedAt;
    };
    const authUser = getAuthUserFromRequest(req);
    const requestId = String(url.searchParams.get('requestId') || '').trim();
    startRequestProgress(requestId);
    const q = (url.searchParams.get('q') || '').trim();
    const sortByParam = (url.searchParams.get('sortBy') || 'total').trim().toLowerCase();
    const resumeIdParam = (url.searchParams.get('resumeId') || '').trim().toLowerCase();
    const builtInResumeIdParam = (url.searchParams.get('builtInResumeId') || '').trim().toLowerCase();
    const validResumeIds = new Set(Object.keys(RESUME_PROFILES));
    const resumeId = validResumeIds.has(builtInResumeIdParam) ? builtInResumeIdParam : (validResumeIds.has(resumeIdParam) ? resumeIdParam : '');
    const rankingModeParam = (url.searchParams.get('rankingMode') || '').trim().toLowerCase();
    const impactModeParam = (url.searchParams.get('impactMode') || '').trim().toLowerCase();
    const localModelParam = (url.searchParams.get('localModel') || '').trim().toLowerCase();
    const usOnlyParam = (url.searchParams.get('usOnly') || '1').trim().toLowerCase();
    const locationParam = (url.searchParams.get('location') || 'bay-area').trim().toLowerCase();
    const locationLabelParam = String(url.searchParams.get('locationLabel') || '').trim();
    const locationLatParam = Number(url.searchParams.get('locationLat'));
    const locationLngParam = Number(url.searchParams.get('locationLng'));
    const targetLocation = locationParam;
    const targetLocationLabel = locationLabelParam || locationParam;
    const targetLocationCoordinates = (Number.isFinite(locationLatParam) && Number.isFinite(locationLngParam))
      ? { lat: locationLatParam, lng: locationLngParam }
      : null;
    const resumeSelection = parseResumeSelectionFromParams(url.searchParams);
    const validResumeIds2 = new Set(Object.keys(RESUME_PROFILES));
    const hasBuiltInResume = builtInResumeIdParam && validResumeIds2.has(builtInResumeIdParam);
    const requiresResume = hasBuiltInResume || Boolean(resumeSelection?.resumeId) || (Array.isArray(resumeSelection?.resumeIds) && resumeSelection.resumeIds.length > 0);
    if (!requiresResume) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'A selected resume is required' }));
      return;
    }
    
    let resumeKey, resumeProfile;
    if (hasBuiltInResume) {
      resumeKey = resumeId;
      resumeProfile = RESUME_PROFILES[resumeId];
    } else {
      // Try authenticated user first
      if (authUser) {
        ({ resumeKey, profile: resumeProfile } = resolveResumeSelection(authUser?.id, resumeSelection));
      } else {
        // Try anonymous user's resume
        const anonUserId = getOrCreateAnonymousUser(req, res);
        const anonResume = getAnonymousResumeForUser(anonUserId);
        if (!anonResume) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please upload a resume to continue' }));
          return;
        }
        resumeKey = `anonymous:${anonUserId}`;
        resumeProfile = anonResume.profile;
      }
    }
    const limitParam = Number(url.searchParams.get('limit'));
    const offsetParam = Number(url.searchParams.get('offset'));
    const limit = Number.isFinite(limitParam)
      ? Math.min(Math.max(limitParam, 1), 200)
      : 100;
    const offset = Number.isFinite(offsetParam)
      ? Math.max(offsetParam, 0)
      : 0;

    const sourcesParam = (url.searchParams.get('sources') || '').trim();
    const jobTypesParam = (url.searchParams.get('jobTypes') || '').trim();
    const jobFieldsParam = (url.searchParams.get('jobFields') || '').trim();
    const companySizesParam = (url.searchParams.get('companySizes') || '').trim();
    const endProductCategoryParam = (url.searchParams.get('endProductCategory') || 'all').trim().toLowerCase();
    const bookmarkFilterParam = (url.searchParams.get('bookmarkFilter') || 'all').trim().toLowerCase();
    const sourcesFilter = sourcesParam
      ? new Set(sourcesParam.split(',').map((s) => s.trim()).filter(Boolean))
      : null;
    const jobTypesFilter = jobTypesParam
      ? new Set(jobTypesParam.split(',').map((s) => normalizeJobType(s)).filter(Boolean))
      : null;
    const jobFieldsFilter = jobFieldsParam
      ? new Set(jobFieldsParam.split(',').map((s) => normalizeJobField(s)).filter(Boolean))
      : null;
    const companySizesFilter = companySizesParam
      ? new Set(companySizesParam.split(',').map((s) => normalizeCompanySize(s)).filter(Boolean))
      : null;
    const endProductCategoryFilter = normalizeEndProductCategory(endProductCategoryParam);
    const bookmarkFilter = ['all', 'bookmarked-only', 'hide-bookmarked'].includes(bookmarkFilterParam)
      ? bookmarkFilterParam
      : 'all';
    const usOnly = !['0', 'false', 'no', 'off'].includes(usOnlyParam);
    markSearchTiming('paramsParsed');

    const { jobs, stale, fromCache } = await getJobsWithCache();
    const datasetKey = resetDerivedCachesIfDatasetChanged(jobs);
    const companyCategorizedJobs = getCompanyCategorizedJobsCached(jobs);
    const roleTotal = companyCategorizedJobs.length;
    const matchedJobs = filterJobs(companyCategorizedJobs, q);
    const usFilteredJobs = usOnly ? matchedJobs.filter((job) => isUsJob(job)) : matchedJobs;
    markSearchTiming('datasetLoadedAndFiltered');
    updateRequestProgress(requestId, {
      stepKey: 'filtering',
      title: 'Filtering jobs',
      detail: 'Applying search, location, and persisted visibility filters.',
      processed: usFilteredJobs.length,
      total: Math.max(1, roleTotal),
      percent: 12,
      checklist: [
        { key: 'dataset', label: 'Loaded cached dataset', status: 'done' },
        { key: 'filters', label: 'Applied query and filter constraints', status: 'active' },
      ],
    });

    const validSortBy = new Set(['total', 'resume', 'impact', 'bay', 'fresh']);
    const sortBy = validSortBy.has(sortByParam) ? sortByParam : 'total';
    const rankingMode = (rankingModeParam === 'classic' || rankingModeParam === 'hybrid' || rankingModeParam === 'ultra')
      ? rankingModeParam
      : DEFAULT_RANKING_MODE;
    const impactMode = (impactModeParam === 'classic' || impactModeParam === 'ultra' || impactModeParam === 'social')
      ? impactModeParam
      : 'classic';
    const useLocalModel = localModelParam
      ? ['1', 'true', 'yes', 'on'].includes(localModelParam)
      : (rankingMode === 'ultra' ? true : LOCAL_MODEL_DEFAULT);
    const scoreWeights = parseScoreWeightsFromParams(url.searchParams);
    const normalizedBookmarks = authUser ? getBookmarksDataForUser(authUser.id) : normalizeBookmarksData({});
    const bookmarkedSet = new Set(normalizedBookmarks.bookmarked);
    const hiddenSet = new Set(normalizedBookmarks.hidden);
    const hiddenCompanySet = new Set(normalizedBookmarks.hiddenCompanies);

    const searchCacheKey = buildJobsSearchCacheKey({
      datasetKey,
      q,
      sortBy,
      rankingMode,
      impactMode,
      useLocalModel,
      usOnly,
      resumeKey,
      resumeSelection,
      scoreWeights,
      sourcesParam,
      jobTypesParam,
      jobFieldsParam,
      companySizesParam,
      endProductCategoryFilter,
      bookmarkFilter,
      targetLocation,
      targetLocationLabel,
      targetLocationCoordinates,
      bookmarksVersion: buildBookmarksVersion(normalizedBookmarks),
    });

    cleanupExpiredJobSearchCache();
    const cachedSearch = jobSearchCache.get(searchCacheKey);
    if (cachedSearch && (Date.now() - cachedSearch.createdAt) <= JOB_SEARCH_CACHE_TTL_MS) {
      markSearchTiming('searchCacheHit');
      // Keep insertion order LRU-ish by reinserting on hit.
      jobSearchCache.delete(searchCacheKey);
      jobSearchCache.set(searchCacheKey, cachedSearch);

      const pageCacheKey = `${offset}:${limit}`;
      const cachedPage = cachedSearch.pageCache instanceof Map
        ? cachedSearch.pageCache.get(pageCacheKey)
        : null;

      if (cachedPage) {
        const cachedPageJobs = Array.isArray(cachedPage.jobs) ? cachedPage.jobs : [];
        const hasLegacyPageShape = cachedPageJobs.some((job) => !job || !job.resumeKeywordBreakdown || !job.impactKeywordBreakdown);
        if (hasLegacyPageShape && cachedSearch.pageCache instanceof Map) {
          cachedSearch.pageCache.delete(pageCacheKey);
        }
      }

      const refreshedCachedPage = cachedSearch.pageCache instanceof Map
        ? cachedSearch.pageCache.get(pageCacheKey)
        : null;

      if (refreshedCachedPage) {
        markSearchTiming('exactPageCacheHit');
        updateRequestProgress(requestId, {
          stepKey: 'cache-hit',
          title: 'Returning exact cached page',
          detail: 'Same request parameters detected. Serving page directly from cache.',
          processed: 1,
          total: 1,
          percent: 98,
          checklist: [
            { key: 'dataset', label: 'Loaded cached dataset', status: 'done' },
            { key: 'filters', label: 'Applied query and filter constraints', status: 'done' },
            { key: 'search-cache', label: 'Matched 5-minute search cache', status: 'done' },
            { key: 'page-cache', label: 'Matched exact page cache entry', status: 'done' },
          ],
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            source: CLIMATEBASE_JOBS_URL,
            query: q,
            sortBy,
            rankingMode,
            impactMode,
            scoreWeights: scoreWeights.raw,
            usOnly,
            resumeId: resumeKey,
            resumeSelection,
            endProductCategory: endProductCategoryFilter,
            bookmarkFilter,
            count: refreshedCachedPage.count,
            offset,
            limit,
            filteredAvailable: cachedSearch.filteredTotal,
            totalAvailable: jobs.length,
            sweAvailable: roleTotal,
            sourceCounts: cachedSearch.sourceCounts,
            jobTypeCounts: cachedSearch.jobTypeCounts,
            jobFieldCounts: cachedSearch.jobFieldCounts,
            companySizeCounts: cachedSearch.companySizeCounts,
            endProductCounts: cachedSearch.endProductCounts,
            cache: {
              fromCache,
              stale,
              updatedAt: cacheUpdatedAt ? new Date(cacheUpdatedAt).toISOString() : null,
              searchCacheHit: true,
              exactRequestCacheHit: true,
              searchCacheAgeMs: Date.now() - cachedSearch.createdAt,
            },
            matching: {
              version: rankingMode === 'classic' ? 'v1-classic' : rankingMode === 'ultra' ? 'v3-ultra' : 'v2-hybrid',
              mode: rankingMode,
              localModelRequested: useLocalModel,
              localModelApplied: (rankingMode === 'hybrid' || rankingMode === 'ultra') ? Boolean(cachedSearch.localModelApplied) : false,
              localModel: OLLAMA_MODEL,
            },
            jobs: refreshedCachedPage.jobs,
          }),
        );
        logJobSearchHealth('success', {
          durationMs: Date.now() - searchStartedAt,
          requestId,
          query: q,
          cachePath: 'exact-page-cache-hit',
          sortBy,
          rankingMode,
          impactMode,
          usOnly,
          offset,
          limit,
          totalReturned: Number(refreshedCachedPage.count || 0),
          filteredAvailable: Number(cachedSearch.filteredTotal || 0),
          totalAvailable: Number(jobs.length || 0),
          searchCacheHit: true,
          exactRequestCacheHit: true,
          stale,
          sourceCounts: cachedSearch.sourceCounts,
          timingsMs: searchTimings,
        });
        finishRequestProgress(requestId);
        return;
      }

      const jobLookupById = getJobLookupByIdCached(companyCategorizedJobs);
      const pageJobIds = cachedSearch.rankedJobIds.slice(offset, offset + limit);
      const scoredJobs = [];
      const curveMaxRaw = Math.max(1, Number(cachedSearch.curveMaxRaw || RESUME_SCORE_FALLBACK_MAX_RAW));

      updateRequestProgress(requestId, {
        stepKey: 'cache-page-build',
        title: 'Building page from cached ranking',
        detail: 'Reusing ranked job IDs and computing only this page slice.',
        processed: 0,
        total: Math.max(1, pageJobIds.length),
        percent: 72,
        checklist: [
          { key: 'dataset', label: 'Loaded cached dataset', status: 'done' },
          { key: 'filters', label: 'Applied query and filter constraints', status: 'done' },
          { key: 'search-cache', label: 'Matched 5-minute search cache', status: 'done' },
          { key: 'page-cache', label: 'Preparing page slice scores', status: 'active' },
        ],
      });

      for (let idx = 0; idx < pageJobIds.length; idx += 1) {
        const jobId = pageJobIds[idx];
        const job = jobLookupById.get(jobId);
        if (!job) continue;
        const resumeScoreData = getResumeScoreCached(job, datasetKey, rankingMode, q, resumeProfile, resumeId);
        const bayScoreData = scoreBayAreaProximity(job, targetLocation, targetLocationCoordinates, targetLocationLabel);
        const impactScoreData = getImpactScoreCached(job, datasetKey, impactMode);
        const freshnessData = scoreFreshness(job);
        const resumeScore = Math.min(100, Math.max(0, Math.round(((resumeScoreData.rawScore || 0) / curveMaxRaw) * 100)));
        const auditScore = getAuditScoreCached(job.company, datasetKey);
        const scoreValues = {
          resumeScore,
          impactScore: impactScoreData.impactScore,
          bayScore: bayScoreData.bayScore,
          freshnessScore: freshnessData.freshnessScore,
          auditScore,
        };
        const score = computeWeightedTotalScore(scoreValues, scoreWeights.normalized);
        scoredJobs.push({
          ...job,
          ...resumeScoreData,
          ...bayScoreData,
          ...impactScoreData,
          ...freshnessData,
          score,
          resumeScore,
          auditScore,
          scoreComponents: {
            weights: {
              resumeScore: scoreWeights.normalized.resume,
              impactScore: scoreWeights.normalized.impact,
              bayScore: scoreWeights.normalized.bay,
              freshnessScore: scoreWeights.normalized.fresh,
              auditScore: scoreWeights.normalized.audit,
            },
            values: scoreValues,
            formula: `total = ${scoreWeights.normalized.resume.toFixed(2)}*resume + ${scoreWeights.normalized.impact.toFixed(2)}*impact + ${scoreWeights.normalized.bay.toFixed(2)}*bay + ${scoreWeights.normalized.fresh.toFixed(2)}*fresh + ${scoreWeights.normalized.audit.toFixed(2)}*audit`,
          },
          rawScore: undefined,
        });
        if (idx % EVENT_LOOP_YIELD_INTERVAL === 0 || idx === pageJobIds.length - 1) {
          const processed = idx + 1;
          const pct = Math.round((processed / Math.max(1, pageJobIds.length)) * 22);
          updateRequestProgress(requestId, {
            processed,
            total: Math.max(1, pageJobIds.length),
            percent: Math.min(96, 72 + pct),
          });
          await yieldToEventLoop();
        }
      }
      markSearchTiming('cacheSliceScored');

      const pageJobs = scoredJobs.map(serializeJobPageItem);
      if (!(cachedSearch.pageCache instanceof Map)) {
        cachedSearch.pageCache = new Map();
      }
      cachedSearch.pageCache.set(pageCacheKey, {
        count: scoredJobs.length,
        jobs: pageJobs,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          source: CLIMATEBASE_JOBS_URL,
          query: q,
          sortBy,
          rankingMode,
          impactMode,
          scoreWeights: scoreWeights.raw,
          usOnly,
          resumeId: resumeKey,
          resumeSelection,
          endProductCategory: endProductCategoryFilter,
          bookmarkFilter,
          count: scoredJobs.length,
          offset,
          limit,
          filteredAvailable: cachedSearch.filteredTotal,
          totalAvailable: jobs.length,
          sweAvailable: roleTotal,
          sourceCounts: cachedSearch.sourceCounts,
          jobTypeCounts: cachedSearch.jobTypeCounts,
          jobFieldCounts: cachedSearch.jobFieldCounts,
          companySizeCounts: cachedSearch.companySizeCounts,
          endProductCounts: cachedSearch.endProductCounts,
          cache: {
            fromCache,
            stale,
            updatedAt: cacheUpdatedAt ? new Date(cacheUpdatedAt).toISOString() : null,
            searchCacheHit: true,
            exactRequestCacheHit: false,
            searchCacheAgeMs: Date.now() - cachedSearch.createdAt,
          },
          matching: {
            version: rankingMode === 'classic' ? 'v1-classic' : rankingMode === 'ultra' ? 'v3-ultra' : 'v2-hybrid',
            mode: rankingMode,
            localModelRequested: useLocalModel,
            localModelApplied: (rankingMode === 'hybrid' || rankingMode === 'ultra') ? Boolean(cachedSearch.localModelApplied) : false,
            localModel: OLLAMA_MODEL,
          },
          jobs: pageJobs,
        }),
      );
      logJobSearchHealth('success', {
        durationMs: Date.now() - searchStartedAt,
        requestId,
        query: q,
        cachePath: 'search-cache-hit',
        sortBy,
        rankingMode,
        impactMode,
        usOnly,
        offset,
        limit,
        totalReturned: scoredJobs.length,
        filteredAvailable: Number(cachedSearch.filteredTotal || 0),
        totalAvailable: Number(jobs.length || 0),
        searchCacheHit: true,
        exactRequestCacheHit: false,
        stale,
        sourceCounts: cachedSearch.sourceCounts,
        timingsMs: searchTimings,
      });
      finishRequestProgress(requestId);
      return;
    }

    markSearchTiming('searchCacheMiss');

    const sourceCounts = {};
    const jobTypeCounts = {};
    const jobFieldCounts = {};
    const companySizeCounts = {};
    const endProductCounts = {};
    let curveMaxRaw = 1;
    updateRequestProgress(requestId, {
      stepKey: 'resume-scan',
      title: 'Scanning jobs against resume profile',
      detail: 'Building stable resume score bounds and facet counts.',
      processed: 0,
      total: Math.max(1, usFilteredJobs.length),
      percent: 22,
      checklist: [
        { key: 'dataset', label: 'Loaded cached dataset', status: 'done' },
        { key: 'filters', label: 'Applied query and filter constraints', status: 'done' },
        { key: 'resume-scan', label: 'Scanning jobs vs resume', status: 'active' },
      ],
    });

    // Build facet counts for the keyword-matched population.
    for (let idx = 0; idx < usFilteredJobs.length; idx += 1) {
      const job = usFilteredJobs[idx];
      const src = job.source || 'climatebase';
      sourceCounts[src] = (sourceCounts[src] || 0) + 1;

      for (const jobType of toArray(job.jobTypes)) {
        const normalized = normalizeJobType(jobType);
        if (!normalized) continue;
        jobTypeCounts[normalized] = (jobTypeCounts[normalized] || 0) + 1;
      }

      const field = normalizeJobField(job.jobField || 'climate');
      if (field) {
        jobFieldCounts[field] = (jobFieldCounts[field] || 0) + 1;
      }

      const size = normalizeCompanySize(job.companySize || classifyCompanySize(job.company));
      companySizeCounts[size] = (companySizeCounts[size] || 0) + 1;

      const endProductCategory = normalizeEndProductCategory(job.endProductCategory || classifyEndProduct(job));
      if (endProductCategory !== 'all') {
        endProductCounts[endProductCategory] = (endProductCounts[endProductCategory] || 0) + 1;
      }

      if (idx > 0 && idx % EVENT_LOOP_YIELD_INTERVAL === 0) {
        const processed = idx + 1;
        const pct = Math.round((processed / Math.max(1, usFilteredJobs.length)) * 24);
        updateRequestProgress(requestId, {
          processed,
          total: Math.max(1, usFilteredJobs.length),
          percent: Math.min(56, 22 + pct),
        });
        await yieldToEventLoop();
      }

    }
    markSearchTiming('resumeScanDone');

    // Apply source filter after computing counts
    const sourceFilteredJobs = sourcesFilter
      ? usFilteredJobs.filter((job) => sourcesFilter.has(job.source || 'climatebase'))
      : usFilteredJobs;
    const typeFilteredJobs = jobTypesFilter
      ? sourceFilteredJobs.filter((job) =>
          toArray(job.jobTypes).some((jobType) => jobTypesFilter.has(normalizeJobType(jobType))),
        )
      : sourceFilteredJobs;
    const fieldFilteredJobs = jobFieldsFilter
      ? typeFilteredJobs.filter((job) => jobFieldsFilter.has(normalizeJobField(job.jobField || 'climate')))
      : typeFilteredJobs;
    const sizeFilteredJobs = companySizesFilter
      ? fieldFilteredJobs.filter((job) => companySizesFilter.has(normalizeCompanySize(job.companySize || classifyCompanySize(job.company))))
      : fieldFilteredJobs;
    const endProductFilteredJobs = endProductCategoryFilter !== 'all'
      ? sizeFilteredJobs.filter((job) => normalizeEndProductCategory(job.endProductCategory || classifyEndProduct(job)) === endProductCategoryFilter)
      : sizeFilteredJobs;
    // Apply persisted hidden/bookmark visibility rules before scoring/pagination.
    let visibilityFilteredJobs = endProductFilteredJobs.filter((job) =>
      !hiddenSet.has(job.id) && !hiddenCompanySet.has(job.company),
    );
    if (bookmarkFilter === 'bookmarked-only') {
      visibilityFilteredJobs = visibilityFilteredJobs.filter((job) => bookmarkedSet.has(job.id));
    } else if (bookmarkFilter === 'hide-bookmarked') {
      visibilityFilteredJobs = visibilityFilteredJobs.filter((job) => !bookmarkedSet.has(job.id));
    }

    const filteredTotal = visibilityFilteredJobs.length;
    markSearchTiming('filtersApplied');
    updateRequestProgress(requestId, {
      stepKey: 'page-scoring',
      title: 'Scoring filtered jobs',
      detail: 'Computing weighted totals for filtered roles.',
      processed: 0,
      total: Math.max(1, filteredTotal),
      percent: 58,
      checklist: [
        { key: 'dataset', label: 'Loaded cached dataset', status: 'done' },
        { key: 'filters', label: 'Applied query and filter constraints', status: 'done' },
        { key: 'resume-scan', label: 'Scanned resume relevance bounds', status: 'done' },
        { key: 'page-scoring', label: 'Scoring filtered jobs', status: 'active' },
      ],
    });

    // Score every job across three dimensions, then build a composite 0-100.
    // Resume/impact/audit values are memoized by dataset + relevant settings.
    const withRaw = [];
    for (let idx = 0; idx < visibilityFilteredJobs.length; idx += 1) {
      const job = visibilityFilteredJobs[idx];
      const resumeScoreData = getResumeScoreCached(job, datasetKey, rankingMode, q, resumeProfile, resumeKey);
      const raw = Number(resumeScoreData?.rawScore || 0);
      if (raw > curveMaxRaw) curveMaxRaw = raw;
      withRaw.push({
        ...job,
        ...resumeScoreData,
        ...scoreBayAreaProximity(job, targetLocation, targetLocationCoordinates, targetLocationLabel),
        ...getImpactScoreCached(job, datasetKey, impactMode),
        ...scoreFreshness(job),
      });
      if (idx > 0 && idx % EVENT_LOOP_YIELD_INTERVAL === 0) {
        const processed = idx + 1;
        const pct = Math.round((processed / Math.max(1, visibilityFilteredJobs.length)) * 16);
        updateRequestProgress(requestId, {
          processed,
          total: Math.max(1, visibilityFilteredJobs.length),
          percent: Math.min(74, 58 + pct),
        });
        await yieldToEventLoop();
      }
    }
    markSearchTiming('baseScoresComputed');

    const scoredAll = [];
    for (let idx = 0; idx < withRaw.length; idx += 1) {
      const job = withRaw[idx];
      const resumeScore = Math.min(100, Math.max(0, Math.round((job.rawScore / Math.max(1, curveMaxRaw)) * 100)));
      const auditScore = getAuditScoreCached(job.company, datasetKey);
      const scoreValues = {
        resumeScore,
        impactScore: job.impactScore,
        bayScore: job.bayScore,
        freshnessScore: job.freshnessScore,
        auditScore,
      };
      const score = computeWeightedTotalScore(scoreValues, scoreWeights.normalized);
      scoredAll.push({
        ...job,
        score,
        resumeScore,
        auditScore,
        scoreComponents: {
          weights: {
            resumeScore: scoreWeights.normalized.resume,
            impactScore: scoreWeights.normalized.impact,
            bayScore: scoreWeights.normalized.bay,
            freshnessScore: scoreWeights.normalized.fresh,
            auditScore: scoreWeights.normalized.audit,
          },
          values: scoreValues,
          formula: `total = ${scoreWeights.normalized.resume.toFixed(2)}*resume + ${scoreWeights.normalized.impact.toFixed(2)}*impact + ${scoreWeights.normalized.bay.toFixed(2)}*bay + ${scoreWeights.normalized.fresh.toFixed(2)}*fresh + ${scoreWeights.normalized.audit.toFixed(2)}*audit`,
        },
        rawScore: undefined,
      });
      if (idx > 0 && idx % EVENT_LOOP_YIELD_INTERVAL === 0) {
        const processed = idx + 1;
        const pct = Math.round((processed / Math.max(1, withRaw.length)) * 14);
        updateRequestProgress(requestId, {
          processed,
          total: Math.max(1, withRaw.length),
          percent: Math.min(88, 74 + pct),
        });
        await yieldToEventLoop();
      }
    }
    markSearchTiming('compositeScoresComputed');

    const sorters = {
      total: (a, b) => b.score - a.score,
      resume: (a, b) => b.resumeScore - a.resumeScore,
      impact: (a, b) => b.impactScore - a.impactScore,
      bay: (a, b) => b.bayScore - a.bayScore,
      fresh: (a, b) => b.freshnessScore - a.freshnessScore,
    };

    let rankedAll = scoredAll
      .sort(sorters[sortBy])
      ;

    let localModelApplied = false;
    if ((rankingMode === 'hybrid' || rankingMode === 'ultra') && useLocalModel && (sortBy === 'total' || sortBy === 'resume')) {
      updateRequestProgress(requestId, {
        stepKey: 'rerank',
        title: 'Running rerank pass',
        detail: 'Applying local-model reranking for top candidates.',
        processed: 0,
        total: 1,
        percent: 90,
        checklist: [
          { key: 'dataset', label: 'Loaded cached dataset', status: 'done' },
          { key: 'filters', label: 'Applied query and filter constraints', status: 'done' },
          { key: 'resume-scan', label: 'Scanned resume relevance bounds', status: 'done' },
          { key: 'page-scoring', label: 'Scored filtered jobs', status: 'done' },
          { key: 'rerank', label: 'Reranking top jobs', status: 'active' },
        ],
      });
      const reranked = await rerankWithLocalModel(rankedAll, {
        topK: rankingMode === 'ultra' ? ULTRA_LOCAL_MODEL_TOP_K : LOCAL_MODEL_TOP_K,
        blend: rankingMode === 'ultra' ? ULTRA_LOCAL_MODEL_BLEND : LOCAL_MODEL_BLEND,
        query: q,
        resumeId,
        resumeProfile,
      });
      rankedAll = reranked.jobs;
      localModelApplied = reranked.localModelApplied;
      markSearchTiming('rerankDone');
    }

    updateRequestProgress(requestId, {
      stepKey: 'finalize',
      title: 'Finalizing response payload',
      detail: 'Slicing page, serializing jobs, and preparing metadata.',
      processed: 1,
      total: 1,
      percent: 97,
      checklist: [
        { key: 'dataset', label: 'Loaded cached dataset', status: 'done' },
        { key: 'filters', label: 'Applied query and filter constraints', status: 'done' },
        { key: 'resume-scan', label: 'Scanned resume relevance bounds', status: 'done' },
        { key: 'page-scoring', label: 'Scored filtered jobs', status: 'done' },
        { key: 'finalize', label: 'Serialized response payload', status: 'active' },
      ],
    });

    jobSearchCache.set(searchCacheKey, {
      createdAt: Date.now(),
      curveMaxRaw,
      rankedJobIds: rankedAll.map((job) => job.id).filter(Boolean),
      filteredTotal,
      localModelApplied,
      sourceCounts: { ...sourceCounts },
      jobTypeCounts: { ...jobTypeCounts },
      jobFieldCounts: { ...jobFieldCounts },
      companySizeCounts: { ...companySizeCounts },
      endProductCounts: { ...endProductCounts },
      pageCache: new Map(),
    });
    trimJobSearchCache();

    const scoredJobs = rankedAll.slice(offset, offset + limit);
    const pageJobs = scoredJobs.map(serializeJobPageItem);
    markSearchTiming('responseReady');

    const cachedSearchAfterSet = jobSearchCache.get(searchCacheKey);
    if (cachedSearchAfterSet && cachedSearchAfterSet.pageCache instanceof Map) {
      cachedSearchAfterSet.pageCache.set(`${offset}:${limit}`, {
        count: scoredJobs.length,
        jobs: pageJobs,
      });
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        source: CLIMATEBASE_JOBS_URL,
        query: q,
        sortBy,
        rankingMode,
        impactMode,
        scoreWeights: scoreWeights.raw,
        usOnly,
        resumeId: resumeKey,
        resumeSelection,
        endProductCategory: endProductCategoryFilter,
        bookmarkFilter,
        count: scoredJobs.length,
        offset,
        limit,
        filteredAvailable: filteredTotal,
        totalAvailable: jobs.length,
        sweAvailable: roleTotal,
        sourceCounts,
        jobTypeCounts,
        jobFieldCounts,
        companySizeCounts,
        endProductCounts,
        cache: {
          fromCache,
          stale,
          updatedAt: cacheUpdatedAt ? new Date(cacheUpdatedAt).toISOString() : null,
          searchCacheHit: false,
          exactRequestCacheHit: false,
        },
        resumeId: resumeKey,
        resumeSelection,
        matching: {
          version: rankingMode === 'classic' ? 'v1-classic' : rankingMode === 'ultra' ? 'v3-ultra' : 'v2-hybrid',
          mode: rankingMode,
          localModelRequested: useLocalModel,
          localModelApplied: (rankingMode === 'hybrid' || rankingMode === 'ultra') ? localModelApplied : false,
          localModel: OLLAMA_MODEL,
        },
        jobs: pageJobs,
      }),
    );
    logJobSearchHealth('success', {
      durationMs: Date.now() - searchStartedAt,
      requestId,
      query: q,
      cachePath: 'search-cache-miss',
      sortBy,
      rankingMode,
      impactMode,
      usOnly,
      offset,
      limit,
      totalReturned: scoredJobs.length,
      filteredAvailable: filteredTotal,
      totalAvailable: Number(jobs.length || 0),
      searchCacheHit: false,
      exactRequestCacheHit: false,
      stale,
      sourceCounts,
      timingsMs: searchTimings,
    });
    finishRequestProgress(requestId);
  } catch (error) {
    const requestId = String(url.searchParams.get('requestId') || '').trim();
    updateRequestProgress(requestId, {
      stepKey: 'error',
      title: 'Search failed',
      detail: error instanceof Error ? error.message : 'Unknown error',
      completed: true,
    });
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = /authentication required|selected resume is required|resume not found|no valid resumes found/i.test(message) ? 400 : 502;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: statusCode === 400 ? message : 'Unable to fetch climate jobs right now',
        details: message,
      }),
    );
    logJobSearchHealth('error', {
      durationMs: 0,
      requestId,
      query: (url.searchParams.get('q') || '').trim(),
      cachePath: 'error',
      sortBy: (url.searchParams.get('sortBy') || 'total').trim().toLowerCase(),
      rankingMode: (url.searchParams.get('rankingMode') || '').trim().toLowerCase(),
      impactMode: (url.searchParams.get('impactMode') || '').trim().toLowerCase(),
      usOnly: !['0', 'false', 'no', 'off'].includes((url.searchParams.get('usOnly') || '1').trim().toLowerCase()),
      offset: Number(url.searchParams.get('offset') || 0),
      limit: Number(url.searchParams.get('limit') || 0),
      totalReturned: 0,
      filteredAvailable: 0,
      totalAvailable: 0,
      searchCacheHit: false,
      exactRequestCacheHit: false,
      stale: false,
      sourceCounts: null,
      timingsMs: null,
      errorMessage: message,
    });
  }
}

async function handleBookmarksApi(req, res) {
  const authUser = requireAuthUser(req, res);
  if (!authUser) return;

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getBookmarksDataForUser(authUser.id)));
    return;
  }

  if (req.method === 'POST') {
    readRequestBody(req).then((body) => {
      try {
        const incomingData = JSON.parse(body);
        if (
          Array.isArray(incomingData.bookmarked) &&
          Array.isArray(incomingData.hidden) &&
          Array.isArray(incomingData.hiddenCompanies)
        ) {
          const saved = persistBookmarksDataForUser(authUser.id, incomingData);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'saved', data: saved }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid bookmarks structure' }));
        }
      } catch (err) {
        console.error('[bookmarks] Error parsing POST data:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    }).catch((err) => {
      console.error('[bookmarks] Error reading POST data:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
    });
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

async function handleResumeBreakdownApi(req, res, url) {
  const authUser = requireAuthUser(req, res);
  if (!authUser) return;

  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const resumeId = String(url.searchParams.get('resumeId') || '').trim();
  if (!resumeId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'resumeId parameter required' }));
    return;
  }

  const record = getUploadedResumeRecordForUser(authUser.id, resumeId);
  if (!record) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Resume not found' }));
    return;
  }

  const profile = getResumeProfileFromRecord(record, record.name);
  if (!profile) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to build profile' }));
    return;
  }
  const breakdownCacheKey = buildResumeRecordRevisionKey(record);
  let payload = resumeBreakdownCache.get(breakdownCacheKey);
  if (!payload) {
    payload = buildResumeBreakdownPayload(record, profile);
    resumeBreakdownCache.set(breakdownCacheKey, payload);
    trimMapCacheToLimit(resumeBreakdownCache, RESUME_BREAKDOWN_CACHE_MAX);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function handleRequestProgressApi(req, res, url) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  cleanupExpiredRequestProgress();
  const requestId = String(url.searchParams.get('requestId') || '').trim();
  if (!requestId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'requestId parameter required' }));
    return;
  }

  const entry = requestProgressCache.get(requestId);
  if (!entry) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Request progress not found' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(entry));
}

async function handleBookmarksActionApi(req, res) {
  const authUser = requireAuthUser(req, res);
  if (!authUser) return;

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  readRequestBody(req).then(async (body) => {
    try {
      const payload = JSON.parse(body || '{}');
      const action = String(payload.action || '').trim().toLowerCase();
      const jobId = String(payload.jobId || '').trim();
      const company = String(payload.company || '').trim();
      const next = getBookmarksDataForUser(authUser.id);

      if (action === 'toggle-bookmark-job') {
        if (!jobId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'jobId is required' }));
          return;
        }
        const ids = new Set(next.bookmarked);
        if (ids.has(jobId)) ids.delete(jobId);
        else ids.add(jobId);
        next.bookmarked = [...ids];
      } else if (action === 'toggle-hide-job') {
        if (!jobId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'jobId is required' }));
          return;
        }
        const ids = new Set(next.hidden);
        if (ids.has(jobId)) ids.delete(jobId);
        else ids.add(jobId);
        next.hidden = [...ids];
      } else if (action === 'bookmark-company-all') {
        if (!company) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'company is required' }));
          return;
        }
        const { jobs } = await getJobsWithCache();
        const companyJobIds = jobs
          .filter((job) => String(job.company || '').trim() === company)
          .map((job) => String(job.id || '').trim())
          .filter(Boolean);
        const ids = new Set(next.bookmarked);
        companyJobIds.forEach((id) => ids.add(id));
        next.bookmarked = [...ids];
      } else if (action === 'toggle-hide-company') {
        if (!company) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'company is required' }));
          return;
        }
        const companies = new Set(next.hiddenCompanies);
        if (companies.has(company)) companies.delete(company);
        else companies.add(company);
        next.hiddenCompanies = [...companies];
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid action' }));
        return;
      }

      const saved = persistBookmarksDataForUser(authUser.id, next);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'saved', data: saved }));
    } catch (err) {
      console.error('[bookmarks] Error processing action:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  }).catch((err) => {
    console.error('[bookmarks] Error reading request body:', err.message);
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid request body' }));
  });
}

async function handleResumesApi(req, res) {
  const anonUserId = getOrCreateAnonymousUser(req, res);

  if (req.method === 'GET') {
    const resumeData = getAnonymousResumeForUser(anonUserId);
    const now = Date.now();
    const resumeId = `anonymous-${anonUserId}`;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      uploadedResumes: resumeData ? [{
        id: resumeId,
        name: 'Current Resume',
        sourceName: 'Upload',
        uploadedAt: new Date(resumeData.uploadedAt).toISOString(),
        expiresAt: new Date(resumeData.expiresAt).toISOString(),
        expiresInMs: Math.max(0, resumeData.expiresAt - now),
        type: 'uploaded',
      }] : [],
    }));
    return;
  }

  if (req.method === 'POST') {
    const contentType = String(req.headers['content-type'] || '').toLowerCase();

    // Handle multipart/form-data (file uploads)
    if (contentType.includes('multipart/form-data')) {
      const bb = Busboy({ headers: req.headers });
      let fileName = '';
      let fileBuffer = Buffer.alloc(0);
      let hasFile = false;

      bb.on('file', (fieldname, file, info) => {
        if (fieldname === 'file' || fieldname === 'resume') {
          hasFile = true;
          fileName = info.filename;
          const chunks = [];
          file.on('data', (data) => {
            chunks.push(data);
          });
          file.on('end', () => {
            fileBuffer = Buffer.concat(chunks);
          });
        }
      });

      bb.on('close', async () => {
        try {
          if (!hasFile) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'No file provided' }));
            return;
          }

          const mimeType = String(contentType || '').split(';')[0].trim();
          const text = await extractTextFromFile(fileBuffer, mimeType, fileName);
          const normalizedText = normalizeResumeText(text);
          
          if (!normalizedText) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Resume file is empty or could not be parsed' }));
            return;
          }

          const profile = buildCustomResumeProfile(normalizedText, 'Current Resume');
          saveAnonymousResumeForUser(anonUserId, normalizedText, profile);

          const expiresAt = Date.now() + ANONYMOUS_RESUME_TTL_MS;
          const resumeId = `anonymous-${anonUserId}`;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'saved',
            resume: {
              id: resumeId,
              name: 'Current Resume',
              sourceName: 'Upload',
              uploadedAt: new Date().toISOString(),
              expiresAt: new Date(expiresAt).toISOString(),
              expiresInMs: ANONYMOUS_RESUME_TTL_MS,
              type: 'uploaded',
            },
          }));
        } catch (err) {
          console.error('[resumes] Error saving resume from file:', err.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Failed to process resume file' }));
        }
      });

      bb.on('error', (err) => {
        console.error('[resumes] Busboy error:', err.message);
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to parse file upload' }));
        }
      });

      req.pipe(bb);
      return;
    }

    // Handle application/json (plain text resume)
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const text = normalizeResumeText(payload.text || payload.resumeText || '');
        if (!text) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Resume text is required' }));
          return;
        }

        const profile = buildCustomResumeProfile(text, 'Current Resume');
        saveAnonymousResumeForUser(anonUserId, text, profile);

        const expiresAt = Date.now() + ANONYMOUS_RESUME_TTL_MS;
        const resumeId = `anonymous-${anonUserId}`;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'saved',
          resume: {
            id: resumeId,
            name: 'Current Resume',
            sourceName: 'Upload',
            uploadedAt: new Date().toISOString(),
            expiresAt: new Date(expiresAt).toISOString(),
            expiresInMs: ANONYMOUS_RESUME_TTL_MS,
            type: 'uploaded',
          },
        }));
      } catch (err) {
        console.error('[resumes] Error saving resume:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'DELETE') {
    anonymousResumes.delete(anonUserId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'deleted' }));
    return;
  }

  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

async function handleAuditProvidersApi(req, res) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    providers: {
      sec: {
        available: true,
        auth: 'none',
      },
      openCorporates: {
        available: Boolean(OPENCORPORATES_API_TOKEN),
        auth: 'api_token',
      },
      fmp: {
        available: Boolean(FMP_API_KEY),
        auth: 'api_key',
      },
      yahooFinance: {
        available: true,
        auth: 'none',
      },
      github: {
        available: true,
        auth: 'none',
      },
      wikipedia: {
        available: true,
        auth: 'none',
      },
      hackerNews: {
        available: true,
        auth: 'none',
      },
      reddit: {
        available: true,
        auth: 'none',
      },
      perplexity: {
        available: Boolean(PERPLEXITY_API_KEY),
        auth: 'api_key',
      },
      waybackMachine: {
        available: true,
        auth: 'none',
      },
      patent: {
        available: true,
        auth: 'none',
      },
      stackOverflow: {
        available: true,
        auth: 'none',
      },
      domainReputation: {
        available: true,
        auth: 'none',
      },
      googleTrends: {
        available: true,
        auth: 'none',
      },
      trustpilot: {
        available: true,
        auth: 'partner_or_data_solution',
      },
    },
  }));
}

async function handleAuditSourceApi(req, res, url) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const provider = String(url.searchParams.get('provider') || '').trim().toLowerCase();
  const company = String(url.searchParams.get('company') || '').trim();
  if (!provider) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'provider is required' }));
    return;
  }
  if (!company) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'company is required' }));
    return;
  }

  const clearbitSignal = await fetchClearbitSignal(company);
  let signal = null;

  if (provider === 'sec') signal = await fetchSecSignal(company);
  else if (provider === 'opencorporates') signal = await fetchOpenCorporatesSignal(company);
  else if (provider === 'fmp') signal = await fetchFmpSignal(company, null);
  else if (provider === 'yahoo' || provider === 'yahoofinance') signal = await fetchYahooFinanceSignal(company);
  else if (provider === 'github') signal = await fetchGitHubSignal(company, clearbitSignal);
  else if (provider === 'wikipedia') signal = await fetchWikipediaSignal(company);
  else if (provider === 'hackernews' || provider === 'hn') signal = await fetchHackerNewsSignal(company);
  else if (provider === 'clearbit') signal = clearbitSignal;
  else if (provider === 'reddit') signal = await fetchRedditSignal(company);
  else if (provider === 'perplexity') signal = await fetchPerplexitySignal(company);
  else if (provider === 'waybackmachine') signal = await fetchWaybackMachineSignal(company);
  else if (provider === 'patent') signal = await fetchPatentSignal(company);
  else if (provider === 'stackoverflow') signal = await fetchStackOverflowSignal(company);
  else if (provider === 'domainreputation') signal = await fetchDomainReputationSignal(company);
  else if (provider === 'googletrends') signal = await fetchGoogleTrendsSignal(company);
  else {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unsupported provider' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    provider,
    company,
    signal,
  }));
}

async function handleAuditSignalsApi(req, res, url) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const company = String(url.searchParams.get('company') || '').trim();
  if (!company) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'company is required' }));
    return;
  }

  const refresh = ['1', 'true', 'yes', 'on'].includes((url.searchParams.get('refresh') || '').trim().toLowerCase());
  const audit = await getCompanyAudit(company, refresh);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    company,
    updatedAt: audit?.updatedAt || null,
    confidence: audit?.confidence || null,
    sourceCoverage: audit?.sourceCoverage || 0,
    sourceLinks: audit?.sourceLinks || [],
    methodsUsed: audit?.methodsUsed || [],
    signals: audit?.signals || {},
  }));
}

async function handleCompanyAuditApi(req, res, url) {
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const company = (url.searchParams.get('company') || '').trim();
  const refresh = ['1', 'true', 'yes', 'on'].includes((url.searchParams.get('refresh') || '').trim().toLowerCase());
  if (!company) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'company is required' }));
    return;
  }

  const audit = await getCompanyAudit(company, refresh);
  if (!audit) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No audit available' }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(audit));
}

async function handleCompanyAuditsApi(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', async () => {
    try {
      const payload = JSON.parse(body || '{}');
      const refresh = Boolean(payload?.refresh);
      const companies = Array.isArray(payload?.companies)
        ? [...new Set(payload.companies.map((c) => String(c || '').trim()).filter(Boolean))].slice(0, COMPANY_AUDIT_BATCH_MAX)
        : [];

      if (companies.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'companies array is required' }));
        return;
      }

      const audits = {};
      for (const company of companies) {
        const audit = await getCompanyAudit(company, refresh);
        if (audit) {
          audits[company] = audit;
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: Object.keys(audits).length, audits }));
    } catch (err) {
      console.error('[company-audit] Error in batch API:', err.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
    }
  });
}

async function handleDistributionStatsApi(req, res, url) {
  try {
    const authUser = getAuthUserFromRequest(req);
    const q = (url.searchParams.get('q') || '').trim();
    const sortByParam = (url.searchParams.get('sortBy') || 'total').trim().toLowerCase();
    const rankingModeParam = (url.searchParams.get('rankingMode') || '').trim().toLowerCase();
    const impactModeParam = (url.searchParams.get('impactMode') || '').trim().toLowerCase();
    const localModelParam = (url.searchParams.get('localModel') || '').trim().toLowerCase();
    const usOnlyParam = (url.searchParams.get('usOnly') || '1').trim().toLowerCase();
    const locationParam = (url.searchParams.get('location') || 'bay-area').trim().toLowerCase();
    const locationLabelParam = String(url.searchParams.get('locationLabel') || '').trim();
    const locationLatParam = Number(url.searchParams.get('locationLat'));
    const locationLngParam = Number(url.searchParams.get('locationLng'));
    const targetLocation = locationParam;
    const targetLocationLabel = locationLabelParam || locationParam;
    const targetLocationCoordinates = (Number.isFinite(locationLatParam) && Number.isFinite(locationLngParam))
      ? { lat: locationLatParam, lng: locationLngParam }
      : null;
    const resumeSelection = parseResumeSelectionFromParams(url.searchParams);
    const builtInResumeIdParam = (url.searchParams.get('builtInResumeId') || '').trim().toLowerCase();
    const validResumeIds = new Set(Object.keys(RESUME_PROFILES));
    const hasBuiltInResume = builtInResumeIdParam && validResumeIds.has(builtInResumeIdParam);
    const requiresResume = hasBuiltInResume || Boolean(resumeSelection?.resumeId) || (Array.isArray(resumeSelection?.resumeIds) && resumeSelection.resumeIds.length > 0);
    if (!requiresResume) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'A selected resume is required' }));
      return;
    }
    
    let resumeKey, resumeProfile;
    if (hasBuiltInResume) {
      resumeKey = builtInResumeIdParam;
      resumeProfile = RESUME_PROFILES[builtInResumeIdParam];
    } else {
      // Try authenticated user first
      if (authUser) {
        ({ resumeKey, profile: resumeProfile } = resolveResumeSelection(authUser?.id, resumeSelection));
      } else {
        // Try anonymous user's resume
        const anonUserId = getOrCreateAnonymousUser(req, res);
        const anonResume = getAnonymousResumeForUser(anonUserId);
        if (!anonResume) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please upload a resume to continue' }));
          return;
        }
        resumeKey = `anonymous:${anonUserId}`;
        resumeProfile = anonResume.profile;
      }
    }
    const resumeId = Array.isArray(resumeSelection?.resumeIds) && resumeSelection.resumeIds.length > 0
      ? resumeSelection.resumeIds[0]
      : (hasBuiltInResume ? builtInResumeIdParam : String(resumeSelection?.resumeId || '').trim());
    const scoreWeights = parseScoreWeightsFromParams(url.searchParams);

    const sourcesParam = (url.searchParams.get('sources') || '').trim();
    const jobTypesParam = (url.searchParams.get('jobTypes') || '').trim();
    const jobFieldsParam = (url.searchParams.get('jobFields') || '').trim();
    const companySizesParam = (url.searchParams.get('companySizes') || '').trim();
    const endProductCategoryParam = (url.searchParams.get('endProductCategory') || 'all').trim().toLowerCase();
    const bookmarkFilterParam = (url.searchParams.get('bookmarkFilter') || 'all').trim().toLowerCase();
    const sourcesFilter = sourcesParam
      ? new Set(sourcesParam.split(',').map((s) => s.trim()).filter(Boolean))
      : null;
    const jobTypesFilter = jobTypesParam
      ? new Set(jobTypesParam.split(',').map((s) => normalizeJobType(s)).filter(Boolean))
      : null;
    const jobFieldsFilter = jobFieldsParam
      ? new Set(jobFieldsParam.split(',').map((s) => normalizeJobField(s)).filter(Boolean))
      : null;
    const companySizesFilter = companySizesParam
      ? new Set(companySizesParam.split(',').map((s) => normalizeCompanySize(s)).filter(Boolean))
      : null;
    const endProductCategoryFilter = normalizeEndProductCategory(endProductCategoryParam);
    const bookmarkFilter = ['all', 'bookmarked-only', 'hide-bookmarked'].includes(bookmarkFilterParam)
      ? bookmarkFilterParam
      : 'all';
    const usOnly = !['0', 'false', 'no', 'off'].includes(usOnlyParam);

    const { jobs } = await getJobsWithCache();
    const datasetKey = resetDerivedCachesIfDatasetChanged(jobs);
    const companyCategorizedJobs = getCompanyCategorizedJobsCached(jobs);
    const matchedJobs = filterJobs(companyCategorizedJobs, q);
    const usFilteredJobs = usOnly ? matchedJobs.filter((job) => isUsJob(job)) : matchedJobs;

    // Apply source filter after computing counts
    const sourceFilteredJobs = sourcesFilter
      ? usFilteredJobs.filter((job) => sourcesFilter.has(job.source || 'climatebase'))
      : usFilteredJobs;
    const typeFilteredJobs = jobTypesFilter
      ? sourceFilteredJobs.filter((job) =>
          toArray(job.jobTypes).some((jobType) => jobTypesFilter.has(normalizeJobType(jobType))),
        )
      : sourceFilteredJobs;
    const fieldFilteredJobs = jobFieldsFilter
      ? typeFilteredJobs.filter((job) => jobFieldsFilter.has(normalizeJobField(job.jobField || 'climate')))
      : typeFilteredJobs;
    const sizeFilteredJobs = companySizesFilter
      ? fieldFilteredJobs.filter((job) => companySizesFilter.has(normalizeCompanySize(job.companySize || classifyCompanySize(job.company))))
      : fieldFilteredJobs;
    const endProductFilteredJobs = endProductCategoryFilter !== 'all'
      ? sizeFilteredJobs.filter((job) => normalizeEndProductCategory(job.endProductCategory || classifyEndProduct(job)) === endProductCategoryFilter)
      : sizeFilteredJobs;
    const normalizedBookmarks = authUser ? getBookmarksDataForUser(authUser.id) : normalizeBookmarksData({});
    const bookmarkedSet = new Set(normalizedBookmarks.bookmarked);
    const hiddenSet = new Set(normalizedBookmarks.hidden);
    const hiddenCompanySet = new Set(normalizedBookmarks.hiddenCompanies);

    // Apply persisted hidden/bookmark visibility rules
    let visibilityFilteredJobs = endProductFilteredJobs.filter((job) =>
      !hiddenSet.has(job.id) && !hiddenCompanySet.has(job.company),
    );
    if (bookmarkFilter === 'bookmarked-only') {
      visibilityFilteredJobs = visibilityFilteredJobs.filter((job) => bookmarkedSet.has(job.id));
    } else if (bookmarkFilter === 'hide-bookmarked') {
      visibilityFilteredJobs = visibilityFilteredJobs.filter((job) => !bookmarkedSet.has(job.id));
    }

    const validSortBy = new Set(['total', 'resume', 'impact', 'bay', 'fresh']);
    const sortBy = validSortBy.has(sortByParam) ? sortByParam : 'total';
    const rankingMode = (rankingModeParam === 'classic' || rankingModeParam === 'hybrid' || rankingModeParam === 'ultra')
      ? rankingModeParam
      : DEFAULT_RANKING_MODE;
    const impactMode = (impactModeParam === 'classic' || impactModeParam === 'ultra' || impactModeParam === 'social')
      ? impactModeParam
      : 'classic';
    const useLocalModel = localModelParam
      ? ['1', 'true', 'yes', 'on'].includes(localModelParam)
      : (rankingMode === 'ultra' ? true : LOCAL_MODEL_DEFAULT);

    let curveMaxRaw = 1;

    // Score every job across three dimensions using cached derived values.
    const withRaw = [];
    for (let idx = 0; idx < visibilityFilteredJobs.length; idx += 1) {
      const job = visibilityFilteredJobs[idx];
      const resumeScoreData = getResumeScoreCached(job, datasetKey, rankingMode, q, resumeProfile, resumeId);
      const raw = Number(resumeScoreData?.rawScore || 0);
      if (raw > curveMaxRaw) curveMaxRaw = raw;
      withRaw.push({
        ...job,
        ...resumeScoreData,
        ...scoreBayAreaProximity(job, targetLocation, targetLocationCoordinates, targetLocationLabel),
        ...getImpactScoreCached(job, datasetKey, impactMode),
        ...scoreFreshness(job),
      });
      if (idx > 0 && idx % EVENT_LOOP_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    }

    const scoredAll = [];
    for (let idx = 0; idx < withRaw.length; idx += 1) {
      const job = withRaw[idx];
      const resumeScore = Math.min(100, Math.max(0, Math.round((job.rawScore / Math.max(1, curveMaxRaw)) * 100)));
      const auditScore = getAuditScoreCached(job.company, datasetKey);
      const score = computeWeightedTotalScore(
        {
          resumeScore,
          impactScore: job.impactScore,
          bayScore: job.bayScore,
          freshnessScore: job.freshnessScore,
          auditScore,
        },
        scoreWeights.normalized,
      );
      scoredAll.push({
        ...job,
        score,
        resumeScore,
        auditScore,
      });
      if (idx > 0 && idx % EVENT_LOOP_YIELD_INTERVAL === 0) {
        await yieldToEventLoop();
      }
    }

    const sorters = {
      total: (a, b) => b.score - a.score,
      resume: (a, b) => b.resumeScore - a.resumeScore,
      impact: (a, b) => b.impactScore - a.impactScore,
      bay: (a, b) => b.bayScore - a.bayScore,
      fresh: (a, b) => b.freshnessScore - a.freshnessScore,
    };

    let rankedAll = scoredAll.sort(sorters[sortBy]);

    if ((rankingMode === 'hybrid' || rankingMode === 'ultra') && useLocalModel && (sortBy === 'total' || sortBy === 'resume')) {
      const reranked = await rerankWithLocalModel(rankedAll, {
        topK: rankingMode === 'ultra' ? ULTRA_LOCAL_MODEL_TOP_K : LOCAL_MODEL_TOP_K,
        blend: rankingMode === 'ultra' ? ULTRA_LOCAL_MODEL_BLEND : LOCAL_MODEL_BLEND,
        query: q,
        resumeKey,
        resumeProfile,
      });
      rankedAll = reranked.jobs;
    }

    // Calculate distribution stats from scored jobs
    const scores = rankedAll.map((j) => j.score).filter((s) => typeof s === 'number' && s > 0).sort((a, b) => a - b);
    
    if (scores.length === 0) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          count: 0,
          mean: 0,
          median: 0,
          min: 0,
          max: 0,
          buckets: Array(10).fill(0),
          maxBucketCount: 0,
        }),
      );
      return;
    }

    const mean = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const median = scores.length % 2 === 0
      ? Math.round((scores[scores.length / 2 - 1] + scores[scores.length / 2]) / 2)
      : scores[Math.floor(scores.length / 2)];

    // Create 10 histogram buckets (0-100)
    const buckets = Array(10).fill(0);
    scores.forEach((s) => {
      const bucket = Math.min(9, Math.floor(s / 10));
      buckets[bucket] += 1;
    });
    const maxBucketCount = Math.max(...buckets);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        count: scores.length,
        mean,
        median,
        min: Math.round(scores[0]),
        max: Math.round(scores[scores.length - 1]),
        buckets,
        maxBucketCount,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const statusCode = /authentication required|selected resume is required|resume not found|no valid resumes found/i.test(message) ? 400 : 502;
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: statusCode === 400 ? message : 'Unable to calculate distribution stats',
        details: message,
      }),
    );
  }
}

// Cache for location searches (query -> results with TTL)
const LOCATIONS_CACHE = new Map();
const LOCATIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function searchWorldwideLocations(query, maxResults = 10) {
  if (!query || query.length < 2) {
    return [];
  }

  const cacheKey = `${query.toLowerCase()}:${maxResults}`;
  const cached = LOCATIONS_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.results;
  }

  try {
    // Using Nominatim (powered by OpenStreetMap) - completely free, no API key required
    // Reverse proxy through our own server to avoid CORS issues
    const searchUrl = new URL('https://nominatim.openstreetmap.org/search');
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('limit', Math.min(50, maxResults * 2));
    searchUrl.searchParams.set('addressdetails', '1');

    const nominatimData = await new Promise((resolve, reject) => {
      // Need to use HTTPS for Nominatim
      const https = require('https');
      https.get(searchUrl, { 
        timeout: 8000,
        headers: { 'User-Agent': 'climate-jobs-finder/1.0' } // Nominatim requires a User-Agent
      }, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`Nominatim HTTP ${response.statusCode}`));
          return;
        }
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error('Invalid JSON from Nominatim'));
          }
        });
        response.on('error', reject);
      }).on('error', reject);
    });

    if (!Array.isArray(nominatimData) || nominatimData.length === 0) {
      LOCATIONS_CACHE.set(cacheKey, { results: [], expiresAt: Date.now() + LOCATIONS_CACHE_TTL_MS });
      return [];
    }

    // Transform Nominatim results to our format
    // Filter for actual cities/towns (not streets, etc.)
    const results = nominatimData
      .filter((loc) => {
        // Include cities, towns, municipalities, and other relevant place types
        const relevantTypes = ['city', 'town', 'village', 'municipality', 'administrative', 'borough', 'metropolis'];
        return relevantTypes.some((type) => loc.type && loc.type.toLowerCase().includes(type)) ||
               relevantTypes.some((type) => loc.class && loc.class.toLowerCase() === type);
      })
      .slice(0, maxResults)
      .map((location) => {
        const address = location.address || {};
        // Build display label
        const city = location.name;
        const country = address.country || '';
        const state = address.state || '';
        
        let displayLabel = city;
        if (state && state !== city) {
          displayLabel = `${city}, ${state}`;
        } else if (country && country !== city) {
          displayLabel = `${city}, ${country}`;
        }

        return {
          value: `loc-${location.osm_id}`,
          label: city,
          country: country,
          state: state,
          displayLabel: displayLabel,
          lat: parseFloat(location.lat),
          lng: parseFloat(location.lon),
        };
      });

    LOCATIONS_CACHE.set(cacheKey, { results, expiresAt: Date.now() + LOCATIONS_CACHE_TTL_MS });
    return results;
  } catch (error) {
    console.error('[locations] Search error:', error instanceof Error ? error.message : error);
    return [];
  }
}

async function handleLocationsApi(req, res, url) {
  try {
    const q = (url.searchParams.get('q') || '').trim();
    const limit = Math.min(20, parseInt(url.searchParams.get('limit') || '10', 10));

    if (q.length < 2) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }

    const locations = await searchWorldwideLocations(q, limit);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(locations));
  } catch (error) {
    console.error('[locations-api] Error:', error instanceof Error ? error.message : error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Failed to search locations',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
    );
  }
}

const server = http.createServer((req, res) => {
  withCors(res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  if (url.pathname === '/api/jobs') {
    handleJobsApi(req, res, url).catch((error) => {
      try {
        console.error('[api/jobs] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch climate jobs right now', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/jobs] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/session') {
    const authUser = getAuthUserFromRequest(req);
    if (!authUser) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not signed in' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ user: sanitizeUser(authUser) }));
    return;
  }

  if (url.pathname === '/api/auth/register') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    readRequestBody(req).then((body) => {
      try {
        const payload = JSON.parse(body || '{}');
        const name = String(payload.name || '').trim();
        const email = String(payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');
        if (!name || !email || password.length < 8) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Name, email, and a password with at least 8 characters are required' }));
          return;
        }
        if (findUserByEmail(email)) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'An account with that email already exists' }));
          return;
        }

        const nowIso = new Date().toISOString();
        const { salt, hash } = hashPassword(password);
        const user = {
          id: `user-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
          email,
          name,
          passwordHash: hash,
          passwordSalt: salt,
          createdAt: nowIso,
          updatedAt: nowIso,
          lastLoginAt: nowIso,
        };
        savePrivateStore({
          ...privateStore,
          users: [...privateStore.users, user],
          dataByUser: {
            ...privateStore.dataByUser,
            [user.id]: defaultPrivateUserData(),
          },
        });
        consumeLegacyDataForUser(user.id);

        const session = createSessionForUser(user.id);
        setSessionCookie(res, session.id, session.expiresAt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: sanitizeUser(user) }));
      } catch (err) {
        console.error('[auth] Register failed:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/auth/login') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }
    readRequestBody(req).then((body) => {
      try {
        const payload = JSON.parse(body || '{}');
        const email = String(payload.email || '').trim().toLowerCase();
        const password = String(payload.password || '');
        const user = findUserByEmail(email);
        if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid email or password' }));
          return;
        }

        const updatedUser = {
          ...user,
          updatedAt: new Date().toISOString(),
          lastLoginAt: new Date().toISOString(),
        };
        savePrivateStore({
          ...privateStore,
          users: privateStore.users.map((entry) => (entry.id === updatedUser.id ? updatedUser : entry)),
        });
        consumeLegacyDataForUser(updatedUser.id);

        const session = createSessionForUser(updatedUser.id);
        setSessionCookie(res, session.id, session.expiresAt);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: sanitizeUser(updatedUser) }));
      } catch (err) {
        console.error('[auth] Login failed:', err.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request body' }));
      }
    });
    return;
  }

  if (url.pathname === '/api/auth/logout') {
    clearSessionCookie(res);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'signed-out' }));
    return;
  }

  if (url.pathname === '/api/bookmarks') {
    handleBookmarksApi(req, res).catch((error) => {
      try {
        console.error('[api/bookmarks] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch bookmarks', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/bookmarks] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/bookmarks/action') {
    handleBookmarksActionApi(req, res).catch((error) => {
      try {
        console.error('[api/bookmarks/action] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to update bookmark', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/bookmarks/action] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/resumes') {
    handleResumesApi(req, res).catch((error) => {
      try {
        console.error('[api/resumes] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch resumes', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/resumes] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/resume-breakdown') {
    handleResumeBreakdownApi(req, res, url).catch((error) => {
      try {
        console.error('[api/resume-breakdown] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to calculate resume breakdown', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/resume-breakdown] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/request-progress') {
    handleRequestProgressApi(req, res, url).catch((error) => {
      try {
        console.error('[api/request-progress] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch request progress', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/request-progress] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/audit/providers') {
    handleAuditProvidersApi(req, res).catch((error) => {
      try {
        console.error('[api/audit/providers] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch audit providers', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/audit/providers] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/audit/source') {
    handleAuditSourceApi(req, res, url).catch((error) => {
      try {
        console.error('[api/audit/source] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch audit source', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/audit/source] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/audit/signals') {
    handleAuditSignalsApi(req, res, url).catch((error) => {
      try {
        console.error('[api/audit/signals] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch audit signals', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/audit/signals] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/company-audit') {
    handleCompanyAuditApi(req, res, url).catch((error) => {
      try {
        console.error('[api/company-audit] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch company audit', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/company-audit] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/company-audits') {
    handleCompanyAuditsApi(req, res).catch((error) => {
      try {
        console.error('[api/company-audits] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch company audits', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/company-audits] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/distribution-stats') {
    handleDistributionStatsApi(req, res, url).catch((error) => {
      try {
        console.error('[api/distribution-stats] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to calculate distribution stats', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/distribution-stats] Error in error handler:', handlerError);
      }
    });
    return;
  }

  if (url.pathname === '/api/locations') {
    handleLocationsApi(req, res, url).catch((error) => {
      try {
        console.error('[api/locations] Unhandled error:', error);
        if (!res.headersSent && res.writable) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unable to fetch locations', details: String(error)?.substring(0, 200) }));
        }
      } catch (handlerError) {
        console.error('[api/locations] Error in error handler:', handlerError);
      }
    });
    return;
  }

  // Serve static files from frontend build directory
  const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
  const requestedFile = path.join(frontendDistPath, url.pathname);
  
  // Normalize path to prevent directory traversal
  if (requestedFile.startsWith(frontendDistPath) && fs.existsSync(requestedFile) && fs.statSync(requestedFile).isFile()) {
    const ext = path.extname(requestedFile).toLowerCase();
    const contentTypeMap = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    
    try {
      const fileContent = fs.readFileSync(requestedFile);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(fileContent);
      return;
    } catch {
      // Fall through to index.html
    }
  }

  // Serve index.html for all non-API routes (SPA routing)
  const indexPath = path.join(frontendDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    try {
      const indexContent = fs.readFileSync(indexPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(indexContent);
      return;
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading frontend\n');
      return;
    }
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Climate jobs backend is running. Frontend not yet built. Try /api/jobs\n');
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
    // Kick off full-site ingestion immediately so the cache is warm before the first request
    console.log('[cache] Background ingestion starting...');
    getJobsWithCache().then(({ jobs }) => {
      console.log(`[cache] Warmup complete — ${jobs.length} jobs cached`);
    }).catch((err) => {
      console.error('[cache] Warmup failed:', err.message);
    });
  });
}

module.exports = {
  buildResumeBreakdownPayload,
  fetchJobSourceBatch,
  getResumeComparisonAlgorithmKey,
  buildCustomResumeProfile,
  scoreJobAgainstResumeClassic,
  scoreJobAgainstResumeHybrid,
  scoreJobAgainstResumeUltra,
  scoreJobAgainstResume,
};
