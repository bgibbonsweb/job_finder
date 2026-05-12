import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCORE_WEIGHTS,
  SCORE_WEIGHTS_STORAGE_KEY,
  RESUME_SELECTION_STORAGE_KEY,
  LAST_SEARCH_STATE_STORAGE_PREFIX,
  normalizeScoreWeights,
  readStoredScoreWeights,
  normalizeResumeSelection,
  readStoredResumeSelection,
  buildLastSearchStorageKey,
  readStoredLastSearchState,
  writeStoredLastSearchState,
  readUrlState,
} from './searchState'

function createMockStorage(seed = {}) {
  const data = new Map(Object.entries(seed))
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    setItem(key, value) {
      data.set(key, String(value))
    },
    removeItem(key) {
      data.delete(key)
    },
    dump() {
      return Object.fromEntries(data.entries())
    },
  }
}

describe('searchState utilities', () => {
  it('normalizeScoreWeights clamps and falls back', () => {
    const out = normalizeScoreWeights({ resume: 150, impact: -10, bay: 'x', fresh: 30, audit: 90 })
    expect(out).toEqual({ resume: 100, impact: 0, bay: 20, fresh: 30, audit: 90 })
  })

  it('readStoredScoreWeights returns defaults for malformed values', () => {
    const storage = createMockStorage({ [SCORE_WEIGHTS_STORAGE_KEY]: '{bad-json' })
    expect(readStoredScoreWeights(storage)).toEqual(DEFAULT_SCORE_WEIGHTS)
  })

  it('readStoredScoreWeights parses and normalizes valid values', () => {
    const storage = createMockStorage({
      [SCORE_WEIGHTS_STORAGE_KEY]: JSON.stringify({ resume: 25, impact: 30, bay: 15, fresh: 20, audit: 10 }),
    })
    expect(readStoredScoreWeights(storage)).toEqual({
      resume: 25,
      impact: 30,
      bay: 15,
      fresh: 20,
      audit: 10,
    })
  })

  it('normalizeResumeSelection dedupes and trims', () => {
    expect(normalizeResumeSelection([' a ', '', 'b', 'a', null])).toEqual(['a', 'b'])
    expect(normalizeResumeSelection('a, b, ,a')).toEqual(['a', 'b'])
  })

  it('readStoredResumeSelection falls back to URL resume when storage empty', () => {
    const storage = createMockStorage({ [RESUME_SELECTION_STORAGE_KEY]: '[]' })
    expect(readStoredResumeSelection({ storage, search: '?resume=resume-123' })).toEqual(['resume-123'])
  })

  it('readStoredResumeSelection prefers stored selection over URL fallback', () => {
    const storage = createMockStorage({ [RESUME_SELECTION_STORAGE_KEY]: JSON.stringify(['r1', 'r2']) })
    expect(readStoredResumeSelection({ storage, search: '?resume=resume-123' })).toEqual(['r1', 'r2'])
  })

  it('readStoredResumeSelection returns empty on malformed storage JSON', () => {
    const storage = createMockStorage({ [RESUME_SELECTION_STORAGE_KEY]: '{oops' })
    expect(readStoredResumeSelection({ storage, search: '?resume=resume-123' })).toEqual([])
  })

  it('buildLastSearchStorageKey returns scoped key', () => {
    expect(buildLastSearchStorageKey(' user-1 ')).toBe(`${LAST_SEARCH_STATE_STORAGE_PREFIX}user-1`)
    expect(buildLastSearchStorageKey('')).toBe('')
  })

  it('writeStoredLastSearchState and readStoredLastSearchState roundtrip normalized values', () => {
    const storage = createMockStorage()
    writeStoredLastSearchState('u1', {
      q: 'climate',
      page: 0,
      sort: 'nope',
      rankingMode: 'hybrid',
      impactMode: 'bad',
      usOnly: false,
      resumeIds: [' r1 ', 'r1', ''],
    }, storage)

    const state = readStoredLastSearchState('u1', storage)
    expect(state).toEqual({
      q: 'climate',
      page: 1,
      sort: 'total',
      rankingMode: 'hybrid',
      impactMode: 'classic',
      usOnly: false,
      resumeIds: ['r1'],
    })
  })

  it('readStoredLastSearchState returns null for malformed JSON and missing user key', () => {
    const storage = createMockStorage({
      [`${LAST_SEARCH_STATE_STORAGE_PREFIX}u1`]: '{bad-json',
    })
    expect(readStoredLastSearchState('u1', storage)).toBeNull()
    expect(readStoredLastSearchState('', storage)).toBeNull()
  })

  it('writeStoredLastSearchState no-ops for invalid inputs', () => {
    const storage = createMockStorage()
    writeStoredLastSearchState('', { q: 'x' }, storage)
    writeStoredLastSearchState('u1', null, storage)
    expect(storage.dump()).toEqual({})
  })

  it('readUrlState parses and sanitizes query params', () => {
    const state = readUrlState('?q=backend&page=2&sort=resume&rankMode=classic&impactMode=social&us=0&resume=abc')
    expect(state).toEqual({
      page: 2,
      sort: 'resume',
      rankingMode: 'classic',
      impactMode: 'social',
      q: 'backend',
      usOnly: false,
      resumeId: 'abc',
      resumeMode: 'uploaded',
      resumeIds: ['abc'],
      resumeBlend: 'average',
      resumeLabel: '',
    })
  })

  it('readUrlState handles blend resumes and explicit resumeLabel', () => {
    const state = readUrlState('?resumeIds=r1,r2&resumeMode=blend&resumeBlend=max&resumeLabel=Top+2')
    expect(state.resumeIds).toEqual(['r1', 'r2'])
    expect(state.resumeMode).toBe('blend')
    expect(state.resumeBlend).toBe('max')
    expect(state.resumeLabel).toBe('Top 2')
  })

  it('readUrlState falls back to defaults for invalid sort/page/modes', () => {
    const state = readUrlState('?page=-5&sort=invalid&rankMode=bad&impactMode=nope')
    expect(state.page).toBe(1)
    expect(state.sort).toBe('total')
    expect(state.rankingMode).toBe('hybrid')
    expect(state.impactMode).toBe('classic')
  })

  it('normalizeScoreWeights handles all boundaries', () => {
    expect(normalizeScoreWeights({ resume: -999 }).resume).toBe(0)
    expect(normalizeScoreWeights({ resume: 999 }).resume).toBe(100)
    expect(normalizeScoreWeights({ resume: 50.5 }).resume).toBe(50.5) // clamped but not rounded
  })

  it('readStoredScoreWeights returns defaults when storage unavailable', () => {
    expect(readStoredScoreWeights(null)).toEqual(DEFAULT_SCORE_WEIGHTS)
  })

  it('normalizeResumeSelection handles array and string inputs uniformly', () => {
    const fromArray = normalizeResumeSelection(['a', 'b', 'c'])
    const fromString = normalizeResumeSelection('a, b, c')
    expect(fromArray).toEqual(['a', 'b', 'c'])
    expect(fromString).toEqual(['a', 'b', 'c'])
  })

  it('readStoredResumeSelection returns empty array on storage errors', () => {
    const storage = createMockStorage()
    storage.getItem = () => { throw new Error('storage failed') }
    expect(() => readStoredResumeSelection({ storage })).not.toThrow()
  })

  it('readStoredLastSearchState normalizes all query parameters', () => {
    const storage = createMockStorage()
    writeStoredLastSearchState('user1', {
      q: 'engineer',
      page: 999,
      sort: 'invalid',
      rankingMode: 'bad',
      impactMode: 'x',
      usOnly: true,
      resumeIds: ['r1', 'r1', ''],
    }, storage)

    const state = readStoredLastSearchState('user1', storage)
    expect(state.page).toBe(999) // page clamped to Math.max(1, ...) but 999 > 1
    expect(state.sort).toBe('total')
    expect(state.rankingMode).toBe('hybrid')
    expect(state.impactMode).toBe('classic')
    expect(state.resumeIds).toEqual(['r1'])
  })

  it('buildLastSearchStorageKey handles whitespace and invalid input', () => {
    expect(buildLastSearchStorageKey('  user123  ')).toBe(`${LAST_SEARCH_STATE_STORAGE_PREFIX}user123`)
    expect(buildLastSearchStorageKey(null)).toBe('')
    expect(buildLastSearchStorageKey(undefined)).toBe('')
  })

  it('readUrlState handles encoded special characters', () => {
    const state = readUrlState('?q=climate%2Btech&resume=abc-123')
    expect(state.q).toBe('climate+tech')
    expect(state.resumeId).toBe('abc-123')
  })

  it('readUrlState infers resumeMode correctly from params', () => {
    const single = readUrlState('?resume=r1')
    expect(single.resumeMode).toBe('uploaded')

    const multiple = readUrlState('?resumeIds=r1,r2')
    expect(multiple.resumeMode).toBe('blend')

    const explicit = readUrlState('?resumeMode=custom&resume=r1')
    expect(explicit.resumeMode).toBe('custom')
  })

  it('writeStoredLastSearchState ignores invalid userId keys', () => {
    const storage = createMockStorage()
    writeStoredLastSearchState('', { q: 'test' }, storage)
    writeStoredLastSearchState(null, { q: 'test' }, storage)
    expect(Object.keys(storage.dump()).length).toBe(0)
  })

  it('normalizeScoreWeights handles non-numeric and missing keys', () => {
    const result = normalizeScoreWeights({
      resume: 'not-a-number',
      impact: null, // Number(null) = 0, which is finite and valid
      bay: undefined, // undefined returns NaN, which uses fallback
    })
    expect(result.resume).toBe(DEFAULT_SCORE_WEIGHTS.resume)
    expect(result.impact).toBe(0) // null converts to 0
    expect(result.bay).toBe(DEFAULT_SCORE_WEIGHTS.bay) // undefined -> NaN -> fallback
  })
})
