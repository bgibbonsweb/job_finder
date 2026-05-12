import { DEFAULT_SCORE_WEIGHTS } from './searchState'

export function computeWeightedTileScore(job, scoreWeights) {
  const resumeScore = Number(job?.resumeScore ?? 0)
  const impactScore = Number(job?.impactScore ?? 0)
  const bayScore = Number(job?.bayScore ?? 0)
  const freshnessScore = Number(job?.freshnessScore ?? 0)
  const auditScore = Number(job?.auditScore ?? 0)

  const rawResume = Number(scoreWeights?.resume ?? DEFAULT_SCORE_WEIGHTS.resume)
  const rawImpact = Number(scoreWeights?.impact ?? DEFAULT_SCORE_WEIGHTS.impact)
  const rawBay = Number(scoreWeights?.bay ?? DEFAULT_SCORE_WEIGHTS.bay)
  const rawFresh = Number(scoreWeights?.fresh ?? DEFAULT_SCORE_WEIGHTS.fresh)
  const rawAudit = Number(scoreWeights?.audit ?? DEFAULT_SCORE_WEIGHTS.audit)
  const totalRaw = rawResume + rawImpact + rawBay + rawFresh + rawAudit

  if (!Number.isFinite(totalRaw) || totalRaw <= 0) {
    return Math.round((resumeScore + impactScore + bayScore + freshnessScore + auditScore) / 5)
  }

  const weighted = (
    (resumeScore * rawResume) +
    (impactScore * rawImpact) +
    (bayScore * rawBay) +
    (freshnessScore * rawFresh) +
    (auditScore * rawAudit)
  ) / totalRaw

  return Math.round(weighted)
}

export function estimateScorePercentile(score, scoreStats) {
  if (!scoreStats || !Array.isArray(scoreStats.buckets)) return null
  const buckets = scoreStats.buckets
  const count = Number(scoreStats.count)
  if (!Number.isFinite(count) || count <= 0 || buckets.length === 0) return null

  const numericScore = Number(score)
  if (!Number.isFinite(numericScore)) return null

  const clampedScore = Math.max(0, Math.min(99.999, numericScore))
  const bucketIndex = Math.max(0, Math.min(buckets.length - 1, Math.floor(clampedScore / 10)))

  let belowCount = 0
  for (let i = 0; i < bucketIndex; i += 1) {
    belowCount += Number(buckets[i] || 0)
  }

  const inBucket = Number(buckets[bucketIndex] || 0)
  const bucketStart = bucketIndex * 10
  const withinBucketRatio = Math.max(0, Math.min(1, (clampedScore - bucketStart) / 10))
  const estimatedCountAtOrBelow = belowCount + (inBucket * withinBucketRatio)
  return Math.max(0, Math.min(1, estimatedCountAtOrBelow / count))
}

export function getScoreTier(score, scoreStats) {
  const percentile = estimateScorePercentile(score, scoreStats)
  if (percentile == null) {
    return score >= 70 ? 'high' : score >= 40 ? 'mid' : 'low'
  }
  if (percentile >= 0.8) return 'high'
  if (percentile >= 0.4) return 'mid'
  return 'low'
}

export function getScoreBadgeStyle(score, scoreStats) {
  const percentile = estimateScorePercentile(score, scoreStats)
  const basis = percentile == null
    ? Math.max(0, Math.min(1, Number(score) / 100))
    : percentile
  const hue = 18 + (basis * 102)
  return {
    backgroundColor: `hsl(${hue} 85% 92%)`,
    borderColor: `hsl(${hue} 70% 68%)`,
    color: `hsl(${hue} 65% 22%)`,
    boxShadow: `0 0 0 1px hsl(${hue} 70% 68% / 0.18)`,
  }
}

export function getLoadingProgressState(elapsedMs, rankingMode, telemetry = null, previousPercent = 0) {
  const steps = [
    {
      threshold: 0,
      percent: 8,
      title: 'Connecting to the jobs backend',
      detail: 'This request starts by opening the cached job feed and applying your current filters.',
    },
    {
      threshold: 700,
      percent: 20,
      title: 'Fetching cached jobs',
      detail: 'The backend is reading the cached dataset and preparing the current page of results.',
    },
    {
      threshold: 1600,
      percent: 34,
      title: 'Scanning jobs against your resume',
      detail: 'Each job is compared with the selected resume and normalized for scoring.',
    },
    {
      threshold: 4200,
      percent: rankingMode === 'ultra' ? 66 : 60,
      title: rankingMode === 'ultra' ? 'Running the local rerank pass' : 'Scoring filtered jobs',
      detail: rankingMode === 'ultra'
        ? 'Ultra mode performs a second rerank pass on top candidates.'
        : 'Computing weighted totals for the filtered job set.',
    },
    {
      threshold: 8800,
      percent: 82,
      title: 'Finalizing the response',
      detail: 'Preparing the final page payload and metadata.',
      substeps: [
        'Loaded dataset and query filters',
        'Scanned resume relevance bounds',
        'Scored filtered jobs',
        'Serialized response payload',
      ],
    },
  ]

  const selected = [...steps].reverse().find((step) => elapsedMs >= step.threshold) || steps[0]
  const baselinePercent = Math.min(95, selected.percent + Math.min(7, elapsedMs / 3000))

  const telemetryPercent = Number(telemetry?.percent)
  const targetPercent = Number.isFinite(telemetryPercent)
    ? Math.min(99.2, Math.max(baselinePercent, telemetryPercent))
    : baselinePercent

  // Keep progress moving every ~100ms so the number does not appear frozen.
  const nextPercent = Math.min(99.2, Math.max(targetPercent, previousPercent + 0.22))

  let substeps = selected.substeps || []
  let activeSubstep = null
  let checklist = []
  if (Array.isArray(telemetry?.checklist) && telemetry.checklist.length > 0) {
    checklist = telemetry.checklist
    substeps = telemetry.checklist.map((item) => item.label)
    const activeItem = telemetry.checklist.find((item) => item.status === 'active')
    activeSubstep = activeItem ? activeItem.label : null
  } else if (selected.substeps && selected.substeps.length > 0) {
    const phaseElapsed = Math.max(0, elapsedMs - selected.threshold)
    const phaseIndex = Math.min(selected.substeps.length - 1, Math.floor(phaseElapsed / 700))
    activeSubstep = selected.substeps[phaseIndex]
    checklist = selected.substeps.map((label, index) => ({
      label,
      status: index < phaseIndex ? 'done' : index === phaseIndex ? 'active' : 'pending',
    }))
  }

  const processed = Number(telemetry?.processed)
  const total = Number(telemetry?.total)
  const hasStepStats = Number.isFinite(processed) && Number.isFinite(total) && total > 0
  const stepPercent = hasStepStats ? Math.max(0, Math.min(100, (processed / total) * 100)) : null

  return {
    percent: nextPercent,
    title: String(telemetry?.title || selected.title),
    detail: String(telemetry?.detail || selected.detail),
    substeps,
    checklist,
    activeSubstep,
    stepProcessed: hasStepStats ? processed : null,
    stepTotal: hasStepStats ? total : null,
    stepPercent,
  }
}
