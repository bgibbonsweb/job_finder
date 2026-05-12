export const VALID_SORT = new Set(['total', 'resume', 'impact', 'bay', 'fresh'])
export const VALID_RANKING_MODE = new Set(['hybrid', 'classic', 'ultra'])
export const VALID_IMPACT_MODE = new Set(['classic', 'ultra', 'social'])

export const SCORE_WEIGHTS_STORAGE_KEY = 'jobFinder.scoreWeights'
export const RESUME_SELECTION_STORAGE_KEY = 'jobFinder.resumeSelection'
export const LAST_SEARCH_STATE_STORAGE_PREFIX = 'jobFinder.lastSearchState.'

export const DEFAULT_SCORE_WEIGHTS = {
  resume: 20,
  impact: 20,
  bay: 20,
  fresh: 20,
  audit: 20,
}

function clampScoreWeight(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

export function normalizeScoreWeights(value) {
  const obj = value && typeof value === 'object' ? value : {}
  return {
    resume: clampScoreWeight(obj.resume, DEFAULT_SCORE_WEIGHTS.resume),
    impact: clampScoreWeight(obj.impact, DEFAULT_SCORE_WEIGHTS.impact),
    bay: clampScoreWeight(obj.bay, DEFAULT_SCORE_WEIGHTS.bay),
    fresh: clampScoreWeight(obj.fresh, DEFAULT_SCORE_WEIGHTS.fresh),
    audit: clampScoreWeight(obj.audit, DEFAULT_SCORE_WEIGHTS.audit),
  }
}

function getStorage(storage) {
  if (storage) return storage
  return globalThis?.window?.localStorage ?? null
}

export function readStoredScoreWeights(storage) {
  const localStorage = getStorage(storage)
  if (!localStorage) return DEFAULT_SCORE_WEIGHTS
  try {
    const raw = localStorage.getItem(SCORE_WEIGHTS_STORAGE_KEY)
    if (!raw) return DEFAULT_SCORE_WEIGHTS
    return normalizeScoreWeights(JSON.parse(raw))
  } catch {
    return DEFAULT_SCORE_WEIGHTS
  }
}

export function normalizeResumeSelection(value) {
  const ids = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : []
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))]
}

export function readStoredResumeSelection(options = {}) {
  const localStorage = getStorage(options.storage)
  const search = typeof options.search === 'string'
    ? options.search
    : globalThis?.window?.location?.search ?? ''

  if (!localStorage) return []

  try {
    const raw = localStorage.getItem(RESUME_SELECTION_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    const ids = normalizeResumeSelection(parsed)

    if (ids.length === 0) {
      const p = new URLSearchParams(search)
      const resumeId = String(p.get('resume') || '').trim()
      if (resumeId) return [resumeId]
    }

    return ids
  } catch {
    return []
  }
}

export function buildLastSearchStorageKey(userId) {
  const id = String(userId || '').trim()
  return id ? `${LAST_SEARCH_STATE_STORAGE_PREFIX}${id}` : ''
}

export function readStoredLastSearchState(userId, storage) {
  const localStorage = getStorage(storage)
  if (!localStorage) return null

  try {
    const key = buildLastSearchStorageKey(userId)
    if (!key) return null
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const sort = VALID_SORT.has(parsed.sort) ? parsed.sort : 'total'
    const rankingMode = VALID_RANKING_MODE.has(parsed.rankingMode) ? parsed.rankingMode : 'hybrid'
    const impactMode = VALID_IMPACT_MODE.has(parsed.impactMode) ? parsed.impactMode : 'classic'
    const page = Math.max(1, Number(parsed.page) || 1)
    const q = String(parsed.q || '')
    const usOnly = parsed.usOnly !== false
    const resumeIds = normalizeResumeSelection(parsed.resumeIds)
    return { q, page, sort, rankingMode, impactMode, usOnly, resumeIds }
  } catch {
    return null
  }
}

export function writeStoredLastSearchState(userId, value, storage) {
  const localStorage = getStorage(storage)
  if (!localStorage) return

  try {
    const key = buildLastSearchStorageKey(userId)
    if (!key || !value || typeof value !== 'object') return
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore localStorage write failures.
  }
}

export function readUrlState(search = globalThis?.window?.location?.search ?? '') {
  const p = new URLSearchParams(search)
  const page = Math.max(1, Number(p.get('page')) || 1)
  const sort = VALID_SORT.has(p.get('sort')) ? p.get('sort') : 'total'
  const rankingMode = VALID_RANKING_MODE.has(p.get('rankMode')) ? p.get('rankMode') : 'hybrid'
  const impactMode = VALID_IMPACT_MODE.has(p.get('impactMode')) ? p.get('impactMode') : 'classic'
  const q = p.get('q') || ''
  const usOnly = p.get('us') !== '0'
  const resumeId = String(p.get('resume') || '').trim()
  const resumeMode = String(p.get('resumeMode') || (p.get('resumeIds') ? 'blend' : 'uploaded')).trim() || 'uploaded'
  const resumeIds = normalizeResumeSelection(p.get('resumeIds') || (resumeId ? [resumeId] : []))
  const resumeBlend = String(p.get('resumeBlend') || 'average').trim() || 'average'
  const resumeLabel = String(p.get('resumeLabel') || '').trim()
  return { page, sort, rankingMode, impactMode, q, usOnly, resumeId, resumeMode, resumeIds, resumeBlend, resumeLabel }
}
