const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { constants: fsConstants } = require('node:fs');
const { spawn } = require('node:child_process');

const ROOT_DIR = path.join(__dirname, '..');
const JOBS_CACHE_PATH = path.join(ROOT_DIR, 'jobs.json');
const PORT = 39000 + Math.floor(Math.random() * 1000);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const FIXTURE_JOBS = {
  savedAt: Date.now(),
  jobs: [
    {
      id: 'fixture-job-ml',
      title: 'Senior Machine Learning Engineer',
      company: 'Climate Labs',
      locations: ['San Francisco, CA'],
      remotePreferences: ['Hybrid'],
      jobTypes: ['Full-time'],
      datePosted: '2026-05-01',
      logo: null,
      url: 'https://example.test/jobs/ml',
      source: 'greenhouse',
      jobField: 'climate',
      companySize: 'small',
      endProductCategory: 'climate-intelligence',
      description: 'Machine learning role focused on climate forecasting and data pipelines.',
    },
    {
      id: 'fixture-job-cpp',
      title: 'Principal C++ Audio Engineer',
      company: 'Spatial Audio Co',
      locations: ['Austin, TX'],
      remotePreferences: ['Remote'],
      jobTypes: ['Full-time'],
      datePosted: '2026-05-02',
      logo: null,
      url: 'https://example.test/jobs/cpp',
      source: 'lever',
      jobField: 'climate',
      companySize: 'small',
      endProductCategory: 'software-infrastructure-platforms',
      description: 'C++ and real-time audio role with GPU and low-latency systems work.',
    },
  ],
};

let hadOriginalJobsCache = false;
let originalJobsCache = '';
let serverProcess = null;

async function waitForServerReady(url, timeoutMs = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until server is ready or timeout is reached.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for server at ${url}`);
}

async function stopServer() {
  if (!serverProcess) return;

  const proc = serverProcess;
  serverProcess = null;

  if (proc.exitCode !== null) return;

  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // Ignore process kill errors in cleanup.
      }
    }, 3000);

    proc.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });

    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

test.before(async () => {
  try {
    await fs.access(JOBS_CACHE_PATH, fsConstants.F_OK);
    hadOriginalJobsCache = true;
    originalJobsCache = await fs.readFile(JOBS_CACHE_PATH, 'utf8');
  } catch {
    hadOriginalJobsCache = false;
    originalJobsCache = '';
  }

  await fs.writeFile(JOBS_CACHE_PATH, JSON.stringify(FIXTURE_JOBS), 'utf8');

  serverProcess = spawn(process.execPath, ['server.js'], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      CACHE_OFFLINE_ONLY: '1',
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitForServerReady(BASE_URL);
});

test.after(async () => {
  await stopServer();

  if (hadOriginalJobsCache) {
    await fs.writeFile(JOBS_CACHE_PATH, originalJobsCache, 'utf8');
    return;
  }

  await fs.rm(JOBS_CACHE_PATH, { force: true });
});

test('GET /api/jobs requires a selected resume when none is provided', async () => {
  const response = await fetch(`${BASE_URL}/api/jobs?limit=5`);
  assert.equal(response.status, 400);

  const body = await response.json();
  assert.match(String(body.error || ''), /selected resume is required/i);
});

test('GET /api/jobs accepts builtInResumeId and returns cached job data', async () => {
  const response = await fetch(
    `${BASE_URL}/api/jobs?limit=5&offset=0&rankingMode=classic&sortBy=total&builtInResumeId=resume2`,
  );
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.ok(Array.isArray(body.jobs));
  assert.ok(body.jobs.length >= 1);
  assert.equal(body.resumeId, 'resume2');
  assert.equal(body.totalAvailable, 2);
  assert.equal(body.filteredAvailable, 2);
  assert.equal(body.cache?.fromCache, true);
  assert.equal(body.sourceCounts?.greenhouse, 1);
  assert.equal(body.sourceCounts?.lever, 1);
  assert.equal(typeof body.jobs[0].score, 'number');
});

test('GET /api/jobs rejects unknown builtInResumeId when no uploaded resume is selected', async () => {
  const response = await fetch(`${BASE_URL}/api/jobs?limit=5&builtInResumeId=resume-does-not-exist`);
  assert.equal(response.status, 400);

  const body = await response.json();
  assert.match(String(body.error || ''), /selected resume is required/i);
});

test('GET /api/jobs falls back to safe defaults for invalid sort and ranking mode', async () => {
  const response = await fetch(
    `${BASE_URL}/api/jobs?limit=5&sortBy=not-a-real-sort&rankingMode=not-a-real-mode&builtInResumeId=resume1`,
  );
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.sortBy, 'total');
  assert.equal(body.rankingMode, 'hybrid');
  assert.ok(Array.isArray(body.jobs));
  assert.ok(body.jobs.length >= 1);
});

test('GET /api/jobs curves resume scores within matched jobs', async () => {
  const response = await fetch(
    `${BASE_URL}/api/jobs?q=machine&limit=5&rankingMode=classic&sortBy=resume&builtInResumeId=resume2`,
  );
  assert.equal(response.status, 200);

  const body = await response.json();
  assert.equal(body.count, 1);
  assert.equal(body.jobs[0]?.id, 'fixture-job-ml');
  assert.equal(Number(body.jobs[0]?.resumeScore), 100);
});
