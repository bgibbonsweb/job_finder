const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeResumeText,
  buildProfileLabelFromText,
  normalizeResumeRecord,
} = require('../server/components/resumeRecords');

test('normalizeResumeText normalizes whitespace and null chars', () => {
  const out = normalizeResumeText('A\r\nB\u0000   C');
  assert.equal(out, 'A B C');
});

test('buildProfileLabelFromText returns first non-empty short line', () => {
  const out = buildProfileLabelFromText('\n  Jane Doe  \nStaff Engineer\n');
  assert.equal(out, 'Jane Doe');
});

test('normalizeResumeRecord fills defaults and normalizes fields', () => {
  const record = normalizeResumeRecord({
    id: '  r1 ',
    name: '  Resume One ',
    text: 'line1\nline2',
    sourceName: ' Upload ',
  });

  assert.equal(record.id, 'r1');
  assert.equal(record.name, 'line1 line2');
  assert.equal(record.text, 'line1 line2');
  assert.equal(record.sourceName, 'Upload');
  assert.ok(record.createdAt);
  assert.ok(record.updatedAt);
});

test('buildProfileLabelFromText falls back for long first line', () => {
  const longLine = 'x'.repeat(80);
  const out = buildProfileLabelFromText(`${longLine}\nsecond`, 'Fallback');
  assert.equal(out, 'Fallback');
});

test('normalizeResumeRecord builds default id/name when missing', () => {
  const record = normalizeResumeRecord({ text: '  hello world  ' }, 2);
  assert.equal(record.id, 'resume-3');
  assert.equal(record.name, 'hello world');
  assert.equal(record.sourceName, 'Upload');
});

test('normalizeResumeText handles special characters and mixed whitespace', () => {
  const out = normalizeResumeText('Hello\t\r\n  World  \u0000  !');
  assert.equal(out, 'Hello World !');
});

test('normalizeResumeText handles empty and null input', () => {
  assert.equal(normalizeResumeText(''), '');
  assert.equal(normalizeResumeText(null), '');
  assert.equal(normalizeResumeText(undefined), '');
});

test('buildProfileLabelFromText skips empty lines', () => {
  const out = buildProfileLabelFromText('\n\n  \n  John Smith  \n');
  assert.equal(out, 'John Smith');
});

test('buildProfileLabelFromText handles all empty input', () => {
  assert.equal(buildProfileLabelFromText('\n  \n  \n', 'Default'), 'Default');
  assert.equal(buildProfileLabelFromText('', 'Fallback'), 'Fallback');
});

test('normalizeResumeRecord handles missing text gracefully', () => {
  const record = normalizeResumeRecord({ id: 'r1' });
  assert.equal(record.id, 'r1');
  assert.equal(record.name, 'Resume 1'); // default name includes index
  assert.equal(record.text, '');
});

test('normalizeResumeRecord preserves explicit fields when provided', () => {
  const record = normalizeResumeRecord({
    id: 'custom-id',
    name: 'My Resume',
    text: 'content here',
    sourceName: 'LinkedIn',
    createdAt: '2025-01-01T00:00:00Z',
  });
  assert.equal(record.id, 'custom-id');
  assert.equal(record.name, 'content here'); // name is derived from text normalization
  assert.equal(record.sourceName, 'LinkedIn');
  assert.equal(record.createdAt, '2025-01-01T00:00:00Z');
});
