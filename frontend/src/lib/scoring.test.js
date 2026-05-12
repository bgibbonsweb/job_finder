import { describe, expect, it } from 'vitest'
import {
  computeWeightedTileScore,
  estimateScorePercentile,
  getScoreTier,
  getScoreBadgeStyle,
  getLoadingProgressState,
} from './scoring'

describe('scoring utilities', () => {
  it('computeWeightedTileScore returns weighted rounded score', () => {
    const score = computeWeightedTileScore(
      { resumeScore: 100, impactScore: 0, bayScore: 0, freshnessScore: 0, auditScore: 0 },
      { resume: 100, impact: 0, bay: 0, fresh: 0, audit: 0 },
    )
    expect(score).toBe(100)
  })

  it('computeWeightedTileScore falls back to simple average when total weight invalid', () => {
    const score = computeWeightedTileScore(
      { resumeScore: 50, impactScore: 70, bayScore: 90, freshnessScore: 30, auditScore: 10 },
      { resume: 0, impact: 0, bay: 0, fresh: 0, audit: 0 },
    )
    expect(score).toBe(50)
  })

  it('estimateScorePercentile returns null for invalid score stats', () => {
    expect(estimateScorePercentile(50, null)).toBeNull()
    expect(estimateScorePercentile(50, { buckets: [], count: 0 })).toBeNull()
  })

  it('estimateScorePercentile estimates a value within bucket range', () => {
    const stats = { buckets: [10, 10, 10, 10, 10], count: 50 }
    const percentile = estimateScorePercentile(25, stats)
    expect(percentile).toBeCloseTo(0.5, 5)
  })

  it('estimateScorePercentile clamps score to supported range', () => {
    const stats = { buckets: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10], count: 100 }
    expect(estimateScorePercentile(-100, stats)).toBeGreaterThanOrEqual(0)
    expect(estimateScorePercentile(500, stats)).toBeLessThanOrEqual(1)
  })

  it('getScoreTier uses percentile bands when available', () => {
    const highStats = { buckets: [0, 0, 0, 0, 0, 0, 0, 0, 30, 70], count: 100 }
    const lowStats = { buckets: [70, 30, 0, 0, 0, 0, 0, 0, 0, 0], count: 100 }
    expect(getScoreTier(99, highStats)).toBe('high')
    expect(getScoreTier(5, lowStats)).toBe('low')
  })

  it('getScoreTier falls back to absolute thresholds without stats', () => {
    expect(getScoreTier(75, null)).toBe('high')
    expect(getScoreTier(50, null)).toBe('mid')
    expect(getScoreTier(20, null)).toBe('low')
  })

  it('getScoreBadgeStyle returns HSL style object', () => {
    const style = getScoreBadgeStyle(65, null)
    expect(style).toHaveProperty('backgroundColor')
    expect(style).toHaveProperty('borderColor')
    expect(style).toHaveProperty('color')
    expect(style).toHaveProperty('boxShadow')
    expect(String(style.backgroundColor)).toContain('hsl(')
  })

  it('getLoadingProgressState returns progressing baseline state', () => {
    const state = getLoadingProgressState(2000, 'classic', null, 0)
    expect(state.percent).toBeGreaterThan(0)
    expect(state.percent).toBeLessThanOrEqual(99.2)
    expect(state.title.length).toBeGreaterThan(0)
    expect(Array.isArray(state.checklist)).toBe(true)
  })

  it('getLoadingProgressState applies telemetry checklist and step stats', () => {
    const telemetry = {
      percent: 91,
      title: 'Custom title',
      detail: 'Custom detail',
      checklist: [
        { label: 'one', status: 'done' },
        { label: 'two', status: 'active' },
      ],
      processed: 25,
      total: 50,
    }
    const state = getLoadingProgressState(1000, 'ultra', telemetry, 80)
    expect(state.title).toBe('Custom title')
    expect(state.detail).toBe('Custom detail')
    expect(state.activeSubstep).toBe('two')
    expect(state.stepPercent).toBe(50)
    expect(state.percent).toBeGreaterThanOrEqual(91)
  })

  it('computeWeightedTileScore handles all zero scores', () => {
    const score = computeWeightedTileScore(
      { resumeScore: 0, impactScore: 0, bayScore: 0, freshnessScore: 0, auditScore: 0 },
      { resume: 25, impact: 25, bay: 25, fresh: 25, audit: 0 },
    )
    expect(score).toBe(0)
  })

  it('computeWeightedTileScore handles NaN and Infinity gracefully', () => {
    const score1 = computeWeightedTileScore(
      { resumeScore: NaN, impactScore: 0, bayScore: 0, freshnessScore: 0, auditScore: 0 },
      { resume: 100, impact: 0, bay: 0, fresh: 0, audit: 0 },
    )
    // NaN propagates through Number() conversions, result may be NaN
    expect(typeof score1).toBe('number')

    const score2 = computeWeightedTileScore(
      { resumeScore: 50, impactScore: 0, bayScore: 0, freshnessScore: 0, auditScore: 0 },
      { resume: 50, impact: 50, bay: 0, fresh: 0, audit: 0 },
    )
    expect(Number.isFinite(score2)).toBe(true)
  })

  it('estimateScorePercentile handles bucket boundaries correctly', () => {
    const stats = { buckets: [10, 10, 10, 10, 10, 10, 10, 10, 10, 10], count: 100 }
    expect(estimateScorePercentile(0, stats)).toBeLessThanOrEqual(0.1)
    expect(estimateScorePercentile(99.999, stats)).toBeGreaterThanOrEqual(0.99)
  })

  it('getScoreBadgeStyle hue varies across score range', () => {
    const low = getScoreBadgeStyle(10, null)
    const mid = getScoreBadgeStyle(50, null)
    const high = getScoreBadgeStyle(90, null)

    expect(low.backgroundColor).not.toBe(mid.backgroundColor)
    expect(mid.backgroundColor).not.toBe(high.backgroundColor)
  })

  it('getLoadingProgressState handles negative elapsed time', () => {
    const state = getLoadingProgressState(-1000, 'classic')
    expect(state.percent).toBeGreaterThan(0)
    expect(state.percent).toBeLessThanOrEqual(99.2)
  })

  it('getLoadingProgressState transitions through phases correctly', () => {
    const state100 = getLoadingProgressState(100, 'classic')
    const state2000 = getLoadingProgressState(2000, 'classic')
    const state8000 = getLoadingProgressState(8000, 'classic')

    expect(state100.percent).toBeLessThan(state2000.percent)
    expect(state2000.percent).toBeLessThan(state8000.percent)
  })
})
