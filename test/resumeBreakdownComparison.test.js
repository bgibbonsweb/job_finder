const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResumeBreakdownPayload,
  getResumeComparisonAlgorithmKey,
  buildCustomResumeProfile,
  scoreJobAgainstResumeClassic,
  scoreJobAgainstResumeHybrid,
  scoreJobAgainstResumeUltra,
  scoreJobAgainstResume,
} = require('../server');

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    title: 'Senior Full Stack Software Engineer',
    company: 'Climate Tech Co',
    jobTypes: ['Full Time', 'Engineering'],
    remotePreferences: ['Remote'],
    locations: ['San Francisco, CA'],
    jobField: 'climate',
    description:
      'Build node.js and react systems for climate software, data pipelines, and platform reliability.',
    ...overrides,
  };
}

test('buildResumeBreakdownPayload returns expected fields and keeps resume skills from Set', () => {
  const record = {
    id: 'r-1',
    name: 'Primary Resume',
    sourceName: 'Upload',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  const profile = {
    termWeights: {
      python: 10,
      react: 8,
      climate: 7,
      node: 6,
      platform: 5,
    },
    matchFacets: {
      engineering: ['python', 'react', 'node'],
      climate: ['climate'],
    },
    anchors: ['backend systems', 'platform engineering'],
    signalPhrases: [['led team', 3], ['shipped features', 2]],
    resumeSkills: new Set(['python', 'react', 'node.js']),
    profileText: 'Experienced software engineer building climate data platforms.',
  };

  const payload = buildResumeBreakdownPayload(record, profile);

  assert.equal(payload.resumeId, 'r-1');
  assert.equal(payload.resumeName, 'Primary Resume');
  assert.equal(payload.resumeSource, 'Upload');
  assert.equal(payload.breakdown.topKeywords[0].term, 'python');
  assert.equal(payload.breakdown.topKeywords[0].weight, 10);
  assert.deepEqual(payload.breakdown.skills, ['python', 'react', 'node.js']);
  assert.equal(payload.breakdown.signalPhrases[0].phrase, 'led team');
  assert.equal(payload.breakdown.signalPhrases[0].impact, 3);
  assert.ok(payload.breakdown.aiSummary.includes('No generative AI'));
});

test('getResumeComparisonAlgorithmKey normalizes mode and query text', () => {
  const key = getResumeComparisonAlgorithmKey('  HYBRID ', '  Full Stack Climate  ');
  assert.equal(key, 'hybrid|full stack climate');
});

test('scoreJobAgainstResume requires a profile', () => {
  assert.throws(
    () => scoreJobAgainstResume(makeJob(), 'classic', ''),
    /Resume profile is required/,
  );
});

test('scoreJobAgainstResume dispatches classic, hybrid, and ultra modes', () => {
  const profile = buildCustomResumeProfile(
    'Senior software engineer with python, react, node.js, data pipelines, and climate analytics experience.',
    'Test Resume',
  );
  const job = makeJob();

  const classicDirect = scoreJobAgainstResumeClassic(job, profile);
  const classicViaBase = scoreJobAgainstResume(job, 'classic', '', profile);
  assert.equal(classicViaBase.rawScore, classicDirect.rawScore);

  const hybridDirect = scoreJobAgainstResumeHybrid(job, profile);
  const hybridViaBase = scoreJobAgainstResume(job, 'hybrid', '', profile);
  assert.equal(hybridViaBase.rawScore, hybridDirect.rawScore);

  const ultraDirect = scoreJobAgainstResumeUltra(job, 'full stack climate', profile);
  const ultraViaBase = scoreJobAgainstResume(job, 'ultra', 'full stack climate', profile);
  assert.equal(ultraViaBase.rawScore, ultraDirect.rawScore);

  assert.ok(classicViaBase.resumeKeywordBreakdown.matchedCount >= 0);
  assert.ok(hybridViaBase.resumeKeywordBreakdown.matchedCount >= 0);
  assert.ok(ultraViaBase.resumeKeywordBreakdown.matchedCount >= 0);
});
