const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBookmarksData } = require('../server/components/bookmarks');

test('normalizeBookmarksData removes duplicates and trims values', () => {
  const result = normalizeBookmarksData({
    bookmarked: [' a ', 'a', '', null, 'b'],
    hidden: ['x', 'x', ' y '],
    hiddenCompanies: ['Co', 'Co ', '  '],
  });

  assert.deepEqual(result, {
    bookmarked: ['a', 'b'],
    hidden: ['x', 'y'],
    hiddenCompanies: ['Co'],
  });
});

test('normalizeBookmarksData handles missing shape', () => {
  assert.deepEqual(normalizeBookmarksData(null), {
    bookmarked: [],
    hidden: [],
    hiddenCompanies: [],
  });
});

test('normalizeBookmarksData preserves case while trimming', () => {
  const result = normalizeBookmarksData({
    bookmarked: ['JobA', 'joba', ' JobA '],
    hidden: [],
    hiddenCompanies: [],
  });
  assert.deepEqual(result.bookmarked, ['JobA', 'joba']);
});

test('normalizeBookmarksData ignores non-arrays', () => {
  const result = normalizeBookmarksData({
    bookmarked: 'x',
    hidden: 42,
    hiddenCompanies: { a: 1 },
  });
  assert.deepEqual(result, {
    bookmarked: [],
    hidden: [],
    hiddenCompanies: [],
  });
});
