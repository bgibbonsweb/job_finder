import { useEffect, useMemo, useState } from 'react'
import './App.css'

const API_TIMEOUT_MS = 90000

const SKILL_BRANCHES = [
  {
    id: 'ai-ml',
    title: 'AI / ML',
    subtitle: 'Modeling, inference, intelligence products',
    keywords: ['ai', 'ml', 'machine learning', 'llm', 'genai', 'nlp', 'computer vision', 'deep learning', 'data scientist'],
  },
  {
    id: 'software-platform',
    title: 'Software / Platform',
    subtitle: 'Backend, frontend, full-stack, infra, cloud',
    keywords: ['software engineer', 'backend', 'frontend', 'full stack', 'platform', 'infra', 'devops', 'sre', 'cloud', 'api'],
  },
  {
    id: 'climate-energy',
    title: 'Climate / Energy',
    subtitle: 'Grid, carbon, solar, battery, decarbonization',
    keywords: ['climate', 'energy', 'grid', 'battery', 'solar', 'wind', 'carbon', 'decarbon', 'sustainability'],
  },
  {
    id: 'data-analytics',
    title: 'Data / Analytics',
    subtitle: 'Data pipelines, analytics, insights, BI',
    keywords: ['data engineer', 'analytics', 'business intelligence', 'bi', 'sql', 'pipeline', 'warehouse'],
  },
  {
    id: 'product-design',
    title: 'Product / Design',
    subtitle: 'PM, UX/UI, product strategy and design',
    keywords: ['product manager', 'product design', 'ux', 'ui', 'designer', 'research'],
  },
  {
    id: 'ops-growth',
    title: 'Ops / Growth',
    subtitle: 'Operations, GTM, sales, partnerships',
    keywords: ['operations', 'business development', 'sales', 'partnership', 'customer success', 'marketing'],
  },
]

function scoreBranch(job, branch) {
  const text = [
    String(job.title || ''),
    String(job.company || ''),
    Array.isArray(job.jobTypes) ? job.jobTypes.join(' ') : '',
    String(job.jobField || ''),
  ]
    .join(' ')
    .toLowerCase()

  let score = 0
  for (const keyword of branch.keywords) {
    if (text.includes(keyword)) score += 1
  }

  if (branch.id === 'ai-ml' && job.breakdown?.ai > 0) score += 2
  if (branch.id === 'software-platform' && job.breakdown?.engineering > 0) score += 2
  if (branch.id === 'climate-energy' && job.breakdown?.climate > 0) score += 2
  if (branch.id === 'software-platform' && job.breakdown?.tech > 0) score += 1

  return score
}

function pickBranch(job) {
  let bestBranch = null
  let bestScore = 0

  for (const branch of SKILL_BRANCHES) {
    const score = scoreBranch(job, branch)
    if (score > bestScore) {
      bestScore = score
      bestBranch = branch.id
    }
  }

  return bestBranch || 'explore'
}

function SkillTreePage() {
  const [jobs, setJobs] = useState([])
  const [search, setSearch] = useState('')
  const [usOnly, setUsOnly] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadJobs() {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), API_TIMEOUT_MS)

    try {
      setIsLoading(true)
      setError('')
      const params = new URLSearchParams({
        limit: '200',
        offset: '0',
        sortBy: 'total',
        rankingMode: 'hybrid',
        impactMode: 'classic',
        usOnly: usOnly ? '1' : '0',
      })
      if (search.trim()) params.set('q', search.trim())

      const response = await fetch(`/api/jobs?${params.toString()}`, { signal: controller.signal })
      if (!response.ok) throw new Error(`Request failed (${response.status})`)
      const payload = await response.json()
      setJobs(Array.isArray(payload.jobs) ? payload.jobs : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load skill tree jobs')
      setJobs([])
    } finally {
      window.clearTimeout(timeoutId)
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadJobs()
  }, [usOnly])

  const tree = useMemo(() => {
    const buckets = {}
    for (const branch of SKILL_BRANCHES) {
      buckets[branch.id] = {
        ...branch,
        jobs: [],
      }
    }
    buckets.explore = {
      id: 'explore',
      title: 'Explore / Misc',
      subtitle: 'Roles with broad or mixed signals',
      jobs: [],
    }

    for (const job of jobs) {
      const branchId = pickBranch(job)
      buckets[branchId].jobs.push(job)
    }

    return Object.values(buckets)
      .filter((branch) => branch.jobs.length > 0)
      .sort((a, b) => b.jobs.length - a.jobs.length)
  }, [jobs])

  const totalGrouped = tree.reduce((sum, branch) => sum + branch.jobs.length, 0)

  return (
    <div className="app-shell skill-tree-page">
      <div className="skill-tree-header">
        <a className="skill-tree-back" href="/">← Back to jobs</a>
        <h1>Skill Tree</h1>
        <p className="lede">Grouped paths that cluster related roles from your current search.</p>
      </div>

      <form
        className="controls skill-tree-controls"
        onSubmit={(e) => {
          e.preventDefault()
          void loadJobs()
        }}
      >
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search and regroup roles..."
          aria-label="Search skill tree jobs"
        />
        <label className="toggle-label">
          <input
            type="checkbox"
            checked={usOnly}
            onChange={(e) => setUsOnly(e.target.checked)}
          />
          US only
        </label>
        <button type="submit">Regroup</button>
      </form>

      <p className="updated-at">
        {isLoading ? 'Building tree...' : `Grouped ${totalGrouped} jobs into ${tree.length} branches`}
      </p>

      {error ? <p className="status error">{error}</p> : null}

      <section className="skill-tree-grid" aria-live="polite">
        {tree.map((branch) => (
          <details key={branch.id} className="skill-branch" open>
            <summary>
              <span className="skill-branch-title">{branch.title}</span>
              <span className="skill-branch-count">{branch.jobs.length} roles</span>
            </summary>
            <p className="skill-branch-subtitle">{branch.subtitle}</p>
            <div className="skill-branch-jobs">
              {branch.jobs.slice(0, 12).map((job) => (
                <article key={job.id} className="skill-job-card">
                  <p className="company">{job.company}</p>
                  <h3>{job.title}</h3>
                  <p className="meta">Score: {job.score ?? '–'}</p>
                  <p className="meta">{Array.isArray(job.locations) ? job.locations.join(' · ') : 'Location not listed'}</p>
                  <a href={job.url} target="_blank" rel="noreferrer">View job</a>
                </article>
              ))}
            </div>
          </details>
        ))}
      </section>
    </div>
  )
}

export default SkillTreePage
