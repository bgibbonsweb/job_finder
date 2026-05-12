const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readJsonFile, writeJsonFile } = require('../server/components/jsonFile');

test('writeJsonFile/readJsonFile roundtrip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-finder-test-'));
  const file = path.join(dir, 'data.json');
  const payload = { a: 1, b: ['x'] };

  const ok = writeJsonFile(file, payload);
  assert.equal(ok, true);
  const read = readJsonFile(file, null);
  assert.deepEqual(read, payload);
});

test('readJsonFile returns fallback for missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-finder-test-'));
  const file = path.join(dir, 'missing.json');
  const fallback = { ok: true };
  assert.deepEqual(readJsonFile(file, fallback), fallback);
});

test('readJsonFile returns fallback for invalid JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-finder-test-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, '{not valid json', 'utf-8');
  const fallback = { bad: false };
  assert.deepEqual(readJsonFile(file, fallback), fallback);
});

test('writeJsonFile returns false when parent dir is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'job-finder-test-'));
  const file = path.join(dir, 'missing-parent', 'data.json');
  const ok = writeJsonFile(file, { a: 1 });
  assert.equal(ok, false);
});
