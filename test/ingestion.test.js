const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchJobSourceBatch } = require('../server');

test('fetchJobSourceBatch returns empty results for failed sources and preserves successful ones', async () => {
  const warningMessages = [];
  const originalWarn = console.warn;
  console.warn = (message) => {
    warningMessages.push(String(message));
  };

  try {
    const results = await fetchJobSourceBatch([
      {
        label: 'climatebase',
        fetcher: async () => {
          throw new Error('connect ECONNREFUSED 209.58.135.36:443');
        },
      },
      {
        label: 'greenhouse',
        fetcher: async () => [{ id: 'job-1', source: 'greenhouse' }],
      },
    ]);

    assert.deepEqual(results, [[], [{ id: 'job-1', source: 'greenhouse' }]]);
    assert.equal(warningMessages.length, 1);
    assert.match(warningMessages[0], /\[ingest\] climatebase failed/i);
    assert.match(warningMessages[0], /ECONNREFUSED/i);
  } finally {
    console.warn = originalWarn;
  }
});