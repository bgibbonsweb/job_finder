import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  DEFAULT_SCORE_WEIGHTS,
  SCORE_WEIGHTS_STORAGE_KEY,
  RESUME_SELECTION_STORAGE_KEY,
  readStoredScoreWeights,
  normalizeResumeSelection,
  readStoredResumeSelection,
  readStoredLastSearchState,
  writeStoredLastSearchState,
  readUrlState,
} from './lib/searchState'
import {
  computeWeightedTileScore,
  estimateScorePercentile,
  getScoreTier,
  getScoreBadgeStyle,
  getLoadingProgressState,
} from './lib/scoring'

const PAGE_SIZE = 25

const JOBS_API_TIMEOUT_MS = 8 * 60 * 1000
const STATS_API_TIMEOUT_MS = 2 * 60 * 1000
const ONBOARDING_COMPLETE_STORAGE_KEY = 'jobFinder.onboardingComplete'
const ONBOARDING_JOB_OPTIONS = [
  {
    id: 'software-engineering',
    label: 'Software Engineering',
    query: 'software engineer full stack backend frontend platform',
  },
  {
    id: 'data-analytics',
    label: 'Data / Analytics',
    query: 'data scientist data analyst machine learning ai',
  },
  {
    id: 'machine-learning',
    label: 'ML / AI Engineering',
    query: 'ml engineer ai engineer llm applied scientist machine learning',
  },
  {
    id: 'product-design',
    label: 'Product / Design',
    query: 'product manager ux designer ui design researcher',
  },
  {
    id: 'project-program',
    label: 'Program / Project Management',
    query: 'program manager project manager implementation delivery',
  },
  {
    id: 'operations',
    label: 'Operations / Strategy',
    query: 'operations strategy chief of staff business operations',
  },
  {
    id: 'sales-partnerships',
    label: 'Sales / Partnerships',
    query: 'account executive business development partnerships sales',
  },
  {
    id: 'marketing-comms',
    label: 'Marketing / Communications',
    query: 'marketing growth communications content brand',
  },
  {
    id: 'customer-success',
    label: 'Customer Success / Support',
    query: 'customer success support solutions consultant implementation',
  },
  {
    id: 'climate-science',
    label: 'Climate / Energy',
    query: 'climate energy carbon sustainability renewable',
  },
  {
    id: 'hardware-manufacturing',
    label: 'Hardware / Manufacturing',
    query: 'hardware manufacturing mechanical electrical systems',
  },
  {
    id: 'supply-chain',
    label: 'Supply Chain / Procurement',
    query: 'supply chain procurement sourcing logistics',
  },
  {
    id: 'research-science',
    label: 'Research / Science',
    query: 'research scientist r&d chemistry materials biology',
  },
  {
    id: 'policy-finance',
    label: 'Policy / Finance',
    query: 'policy finance climate finance carbon markets',
  },
  {
    id: 'people-talent',
    label: 'People / Talent',
    query: 'recruiter talent people operations hr',
  },
  {
    id: 'legal-compliance',
    label: 'Legal / Compliance',
    query: 'legal compliance risk regulatory counsel',
  },
]

function normalizeResumeCatalog(value) {
  const items = Array.isArray(value) ? value : []
  return items
    .map((item) => {
      const id = String(item?.id || '').trim()
      if (!id) return null
      return {
        id,
        name: String(item?.name || id).trim() || id,
        sourceName: String(item?.sourceName || 'Upload').trim() || 'Upload',
        createdAt: item?.createdAt || null,
        updatedAt: item?.updatedAt || null,
        type: 'uploaded',
      }
    })
    .filter(Boolean)
}

function readStoredResumeCatalog() {
  return []
}

function readStoredGoogleUser() {
  return null
}

function readStoredOnboardingComplete() {
  try {
    return window.localStorage.getItem(ONBOARDING_COMPLETE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}


function buildOnboardingSearchQuery(selectedOptionIds, customText) {
  const presetQuery = selectedOptionIds
    .map((id) => ONBOARDING_JOB_OPTIONS.find((item) => item.id === id)?.query)
    .filter(Boolean)
    .join(' ')
    .trim()
  const customQuery = String(customText || '').trim()
  return [presetQuery, customQuery].filter(Boolean).join(' ').trim()
}

function formatResumeSelectionLabel(ids, catalogById) {
  const selected = normalizeResumeSelection(ids)
  if (selected.length === 0) return 'Resume: select one'
  if (selected.length === 1) {
    return `Resume: ${catalogById.get(selected[0])?.name || selected[0]}`
  }
  const names = selected.slice(0, 3).map((id) => catalogById.get(id)?.name || id)
  const suffix = selected.length > 3 ? ` +${selected.length - 3} more` : ''
  return `Resume Blend: ${names.join(' + ')}${suffix}`
}

function buildResumeRequestParams(selectedResumeIds, catalogById) {
  const ids = normalizeResumeSelection(selectedResumeIds)
  const primaryId = ids[0]
  if (ids.length > 1) {
    return {
      resumeMode: 'blend',
      resumeIds: ids.join(','),
      resumeBlend: 'average',
      resumeLabel: formatResumeSelectionLabel(ids, catalogById).replace(/^Resume Blend:\s*/i, ''),
      resumeId: primaryId,
    }
  }

  if (!primaryId) {
    return null // No resume selected
  }

  return { resumeMode: 'uploaded', resumeId: primaryId }
}

const SOURCE_LABELS = {
  climatebase: 'Climatebase',
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  ashby: 'Ashby',
  breezy: 'Breezy HR',
  bamboo: 'BambooHR',
  builtin: 'Built In',
  terra: 'Terra.do',
  eightyk: '80,000 Hours',
  remoteok: 'RemoteOK',
}

const JOB_FIELD_LABELS = {
  climate: 'Climate',
  medical: 'Medical',
  edtech: 'Education Tech',
  mentalhealth: 'Mental Health',
  agtech: 'AgTech / Food Security',
  globalhealth: 'Global Health',
}

const COMPANY_SIZE_ORDER = ['startup', 'small', 'medium', 'large', 'very-large']
const COMPANY_SIZE_LABELS = {
  startup: 'Startup',
  small: 'Small',
  medium: 'Mid-size',
  large: 'Large',
  'very-large': 'Very Large',
}

const END_PRODUCT_LABELS = {
  'autonomous-vehicles': 'End Product: Driverless Cars / AV',
  'virtual-power-plants': 'End Product: Virtual Power Plants',
  'battery-storage': 'End Product: Batteries / Energy Storage',
  'building-design-cad': 'End Product: Building CAD / Optimization',
  'advanced-manufacturing': 'End Product: 3D Fabrication / Manufacturing',
  'grid-software': 'End Product: Grid Software',
  'robotics-drones': 'End Product: Robotics / Drones',
  'carbon-software': 'End Product: Carbon Accounting / MRV',
  'mobility-platforms': 'End Product: Mobility / Transportation Platforms',
  'climate-intelligence': 'End Product: Climate Data / Forecasting',
  'enterprise-ai-software': 'End Product: Enterprise AI / Software Platforms',
  'software-infrastructure-platforms': 'End Product: Core Software / Infrastructure',
  'health-biotech-platforms': 'End Product: Health / Biotech Platforms',
  'mental-health-tech': 'End Product: Mental Health Tech',
  'edtech-learning-platforms': 'End Product: EdTech / Learning Platforms',
  'agri-food-systems': 'End Product: Agri / Food Systems',
  'energy-marketplaces-finance': 'End Product: Energy Markets / Finance',
  other: 'End Product: Other / General',
}

const END_PRODUCT_ORDER = [
  'autonomous-vehicles',
  'virtual-power-plants',
  'battery-storage',
  'building-design-cad',
  'advanced-manufacturing',
  'grid-software',
  'robotics-drones',
  'carbon-software',
  'mobility-platforms',
  'climate-intelligence',
  'enterprise-ai-software',
  'software-infrastructure-platforms',
  'health-biotech-platforms',
  'mental-health-tech',
  'edtech-learning-platforms',
  'agri-food-systems',
  'energy-marketplaces-finance',
  'other',
]

function normalizedSource(job) {
  return String(job?.source || 'climatebase').toLowerCase()
}

function normalizeJobType(value) {
  return String(value || '').trim().toLowerCase()
}

function formatJobType(value) {
  const text = String(value || '').trim()
  if (!text) return 'Unknown'
  return text
    .split(/[-\s/]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatJobField(value) {
  return JOB_FIELD_LABELS[String(value || '').trim().toLowerCase()] || String(value || '').trim()
}

function formatEndProductCategory(value) {
  return END_PRODUCT_LABELS[String(value || '').trim().toLowerCase()] || `End Product: ${String(value || '').trim()}`
}

function formatEndProductBadge(value) {
  return formatEndProductCategory(value).replace(/^End Product:\s*/i, '')
}

function App() {
  const initial = readUrlState()
  const [jobs, setJobs] = useState([])
  const [usOnly, setUsOnly] = useState(initial.usOnly)
  const [search, setSearch] = useState(initial.q)
  const [resumeId, setResumeId] = useState(initial.resumeId)
  const [isLoading, setIsLoading] = useState(true)
  const [loadingProgress, setLoadingProgress] = useState(() => getLoadingProgressState(0, initial.rankingMode))
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState('')
  const [sourceUrl, setSourceUrl] = useState('https://climatebase.org/jobs')
  const [cacheMeta, setCacheMeta] = useState({ fromCache: false, stale: false })
  const [sweAvailable, setSweAvailable] = useState(null)
  const [totalAvailable, setTotalAvailable] = useState(null)
  const [filteredAvailable, setFilteredAvailable] = useState(null)
  const [currentPage, setCurrentPage] = useState(initial.page)
  const [pageInputValue, setPageInputValue] = useState(String(initial.page))
  const [sortBy, setSortBy] = useState(initial.sort)
  const [rankingMode, setRankingMode] = useState(initial.rankingMode)
  const [impactMode, setImpactMode] = useState(initial.impactMode)
  const [selectedLocation, setSelectedLocation] = useState(null)
  const [selectedLocationLabel, setSelectedLocationLabel] = useState('Select a location')
  const [selectedLocationCoords, setSelectedLocationCoords] = useState(null)
  const [isLocationDropdownOpen, setIsLocationDropdownOpen] = useState(false)
  const [locationSearchQuery, setLocationSearchQuery] = useState('')
  const [locationSearchResults, setLocationSearchResults] = useState([])
  const [locationSearchLoading, setLocationSearchLoading] = useState(false)
  const latestRequestRef = useRef(0)
  const loadingTelemetryRef = useRef(null)
  const loadingPercentRef = useRef(0)
  const [resumeCatalog, setResumeCatalog] = useState(() => readStoredResumeCatalog())
  const [isResumeMenuOpen, setIsResumeMenuOpen] = useState(false)
  const [hasLoadedResumeCatalog, setHasLoadedResumeCatalog] = useState(false)
  const [sourceCounts, setSourceCounts] = useState({})
  const [jobTypeCounts, setJobTypeCounts] = useState({})
  const [jobFieldCounts, setJobFieldCounts] = useState({})
  const [companySizeCounts, setCompanySizeCounts] = useState({})
  const [endProductCounts, setEndProductCounts] = useState({})
  const [selectedResumeIds, setSelectedResumeIds] = useState(() => readStoredResumeSelection())
  const [resumeUploadStatus, setResumeUploadStatus] = useState('')
  const [resumeUploadProgress, setResumeUploadProgress] = useState(null)
  const [resumeUploadBreakdownPreview, setResumeUploadBreakdownPreview] = useState(null)
  const [resumeUploadBreakdownLoading, setResumeUploadBreakdownLoading] = useState(false)
  const [resumeUploadBreakdownError, setResumeUploadBreakdownError] = useState('')
  // Bookmarking and hiding
  const [bookmarkedJobs, setBookmarkedJobs] = useState(new Set())
  const [hiddenJobs, setHiddenJobs] = useState(new Set())
  const [hiddenCompanies, setHiddenCompanies] = useState(new Set())
  const [bookmarkFilter, setBookmarkFilter] = useState('all')
  // null = all selected
  const [selectedSources, setSelectedSources] = useState(null)
  const [selectedJobTypes, setSelectedJobTypes] = useState(null)
  const [selectedJobFields, setSelectedJobFields] = useState(null)
  const [selectedCompanySizes, setSelectedCompanySizes] = useState(null)
  const [endProductCategory, setEndProductCategory] = useState('all')
  const [companyAudits, setCompanyAudits] = useState({})
  const [openTotalScoreJobId, setOpenTotalScoreJobId] = useState(null)
  const [openResumeScoreJobId, setOpenResumeScoreJobId] = useState(null)
  const [openImpactScoreJobId, setOpenImpactScoreJobId] = useState(null)
  const [openLocationScoreJobId, setOpenLocationScoreJobId] = useState(null)
  const [openFreshScoreJobId, setOpenFreshScoreJobId] = useState(null)
  const [openAuditJobId, setOpenAuditJobId] = useState(null)
  const [openJobMenuId, setOpenJobMenuId] = useState(null)
  const [openDistributionModal, setOpenDistributionModal] = useState(false)
  const [scoreStats, setScoreStats] = useState(null)
  const [scoreWeights, setScoreWeights] = useState(() => readStoredScoreWeights())
  const auditPopoverRef = useRef(null)
  const scoreWeightsMenuRef = useRef(null)
  const advancedSettingsMenuRef = useRef(null)
  const locationSelectorRef = useRef(null)
  const breakdownRequestRef = useRef(0)
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false)
  const [breakdownData, setBreakdownData] = useState(null)
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownError, setBreakdownError] = useState('')
  const [googleUser, setGoogleUser] = useState(() => readStoredGoogleUser())
  const [authMode, setAuthMode] = useState('register')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [isAuthResolved, setIsAuthResolved] = useState(false)
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false)
  const [onboardingPage, setOnboardingPage] = useState(1)
  const [selectedOnboardingJobOptions, setSelectedOnboardingJobOptions] = useState([])
  const [onboardingCustomQuery, setOnboardingCustomQuery] = useState('')
  const [isOnboardingLocationConfirmed, setIsOnboardingLocationConfirmed] = useState(false)
  const [onboardingError, setOnboardingError] = useState('')
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() => !readStoredOnboardingComplete())
  const [isOnboardingLaunching, setIsOnboardingLaunching] = useState(false)
  const hasLoadedInitialJobsRef = useRef(false)
  const hasResolvedOnboardingLandingRef = useRef(false)
  const resumeCatalogById = useMemo(() => new Map(resumeCatalog.map((item) => [item.id, item])), [resumeCatalog])
  const resumeSelectionLabel = useMemo(
    () => formatResumeSelectionLabel(selectedResumeIds, resumeCatalogById),
    [selectedResumeIds, resumeCatalogById],
  )
  const selectedOnboardingResumeNames = useMemo(
    () => normalizeResumeSelection(selectedResumeIds)
      .map((id) => resumeCatalogById.get(id)?.name || id)
      .filter(Boolean),
    [selectedResumeIds, resumeCatalogById],
  )
  const onboardingStep = useMemo(() => {
    if (!googleUser) return 1
    if (selectedOnboardingResumeNames.length === 0) return 2
    if (!isOnboardingLocationConfirmed) return 3
    if (selectedOnboardingJobOptions.length === 0 && !onboardingCustomQuery.trim()) return 4
    return 5
  }, [googleUser, selectedOnboardingResumeNames.length, isOnboardingLocationConfirmed, selectedOnboardingJobOptions.length, onboardingCustomQuery])
  const onboardingSearchQuery = useMemo(
    () => buildOnboardingSearchQuery(selectedOnboardingJobOptions, onboardingCustomQuery),
    [selectedOnboardingJobOptions, onboardingCustomQuery],
  )
  const onboardingLocationSummary = selectedLocation && selectedLocationLabel
    ? selectedLocationLabel
    : 'Any location'

  useEffect(() => {
    window.localStorage.setItem(SCORE_WEIGHTS_STORAGE_KEY, JSON.stringify(scoreWeights))
  }, [scoreWeights])

  useEffect(() => {
    window.localStorage.setItem(RESUME_SELECTION_STORAGE_KEY, JSON.stringify(selectedResumeIds))
  }, [selectedResumeIds])

  useEffect(() => {
    if (selectedResumeIds.length > 0) {
      setResumeId(selectedResumeIds[0])
    } else {
      setResumeId('')
    }
  }, [selectedResumeIds])

  useEffect(() => {
    if (!isOnboardingOpen && hasLoadedResumeCatalog) {
      setIsResumeMenuOpen(resumeCatalog.length === 0)
    }
  }, [isOnboardingOpen, resumeCatalog.length, hasLoadedResumeCatalog])

  useEffect(() => {
    if (!isOnboardingOpen || hasResolvedOnboardingLandingRef.current) return
    setOnboardingPage(googleUser ? 2 : 1)
    hasResolvedOnboardingLandingRef.current = true
  }, [isOnboardingOpen, resumeCatalog.length, googleUser])

  useEffect(() => {
    if (!isOnboardingOpen) return
    setIsOnboardingLocationConfirmed(Boolean(selectedLocation))
  }, [isOnboardingOpen])

  useEffect(() => {
    let canceled = false
    fetch('/api/session')
      .then(async (res) => {
        if (res.status === 401) return null
        if (!res.ok) throw new Error(`Session request failed (${res.status})`)
        const payload = await res.json()
        return payload?.user || null
      })
      .then((user) => {
        if (canceled) return
        setGoogleUser(user)
        if (user) {
          setOnboardingError('')
        } else {
          setIsOnboardingOpen(true)
          setOnboardingPage(1)
        }
      })
      .catch((err) => {
        if (!canceled) {
          console.error('Failed to load session:', err)
          setGoogleUser(null)
          window.localStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY)
          setIsOnboardingOpen(true)
          setOnboardingPage(1)
          setOnboardingError('')
        }
      })
      .finally(() => {
        if (!canceled) {
          setIsAuthResolved(true)
        }
      })

    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    if (!isAuthResolved) return
    if (googleUser) return
    window.localStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY)
    setIsOnboardingOpen(true)
    setOnboardingPage(1)
    setOnboardingError('')
  }, [isAuthResolved, googleUser])

  useEffect(() => {
    if (!googleUser) {
      setResumeCatalog([])
      setSelectedResumeIds([])
      setResumeId('')
      setHasLoadedResumeCatalog(false)
      setIsResumeMenuOpen(false)
      return
    }

    let canceled = false
    fetch('/api/resumes')
      .then((res) => {
        if (!res.ok) throw new Error(`Resume library request failed (${res.status})`)
        return res.json()
      })
      .then((payload) => {
        if (canceled) return
        const uploadedResumes = Array.isArray(payload?.uploadedResumes) ? payload.uploadedResumes : []
        setResumeCatalog(uploadedResumes)
        setHasLoadedResumeCatalog(true)
        
        // Get the URL-specified resume (if any)
        const p = new URLSearchParams(window.location.search)
        const urlResumeId = String(p.get('resume') || '').trim()
        
        const availableIds = new Set(uploadedResumes.map((item) => item.id))
        const normalizedPrevious = normalizeResumeSelection(selectedResumeIds).filter((id) => availableIds.has(id))
        const baselineSelection = urlResumeId
          ? [urlResumeId]
          : normalizedPrevious.length > 0
            ? normalizedPrevious
            : uploadedResumes.length > 0
              ? [uploadedResumes[0].id]
              : []

        const savedSearch = readStoredLastSearchState(googleUser?.id)
        const savedResumeIds = normalizeResumeSelection(savedSearch?.resumeIds).filter((id) => availableIds.has(id))
        const effectiveSelection = savedResumeIds.length > 0 ? savedResumeIds : baselineSelection

        setSelectedResumeIds(effectiveSelection)

        if (uploadedResumes.length > 0) {
          // Returning users with resumes should bypass onboarding and resume where they left off.
          window.localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, '1')
          setIsOnboardingOpen(false)
          setOnboardingError('')
          hasResolvedOnboardingLandingRef.current = true

          if (savedSearch) {
            setSearch(savedSearch.q)
            setSortBy(savedSearch.sort)
            setRankingMode(savedSearch.rankingMode)
            setImpactMode(savedSearch.impactMode)
            setUsOnly(savedSearch.usOnly)
            hasLoadedInitialJobsRef.current = true
            loadJobs(
              savedSearch.q,
              savedSearch.page,
              savedSearch.sort,
              savedSearch.rankingMode,
              {},
              effectiveSelection[0] || '',
              savedSearch.impactMode,
              savedSearch.usOnly,
              scoreWeights,
              effectiveSelection,
            )
          }
        }

        // First-load guard: no uploaded resumes means onboarding must be visible.
        if (uploadedResumes.length === 0) {
          window.localStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY)
          setIsOnboardingOpen(true)
          setOnboardingPage(2)
          setOnboardingError('')
          hasResolvedOnboardingLandingRef.current = true
        }
      })
      .catch((err) => {
        if (!canceled) {
          console.error('Failed to load resume library:', err)
        }
      })
    return () => {
      canceled = true
    }
  }, [googleUser])

  useEffect(() => {
    if (!isLocationDropdownOpen) return
    const handleClickOutside = (event) => {
      if (locationSelectorRef.current && !locationSelectorRef.current.contains(event.target)) {
        setIsLocationDropdownOpen(false)
        setLocationSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isLocationDropdownOpen])

  // Fetch worldwide locations from Geonames API
  useEffect(() => {
    if (!locationSearchQuery.trim() || locationSearchQuery.length < 2) {
      setLocationSearchResults([])
      return
    }

    let canceled = false
    setLocationSearchLoading(true)

    const fetchLocations = async () => {
      const parseLocationPayload = (payload) => {
        if (Array.isArray(payload)) return payload
        if (Array.isArray(payload?.locations)) return payload.locations
        if (Array.isArray(payload?.results)) return payload.results
        return []
      }

      const requestWithTimeout = async (url) => {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), 5000)
        try {
          const response = await fetch(url, { signal: controller.signal })
          if (!response.ok) throw new Error(`Location search failed (${response.status})`)
          return response.json()
        } finally {
          window.clearTimeout(timeoutId)
        }
      }

      try {
        const params = new URLSearchParams({
          q: locationSearchQuery.trim(),
          limit: '10',
        })

        let data
        try {
          data = await requestWithTimeout(`/api/locations?${params}`)
        } catch (proxyErr) {
          console.warn('[locations] Proxy search failed, retrying direct backend:', proxyErr)
          data = await requestWithTimeout(`http://localhost:3006/api/locations?${params}`)
        }

        if (!canceled) {
          setLocationSearchResults(parseLocationPayload(data))
        }
      } catch (err) {
        if (!canceled) {
          console.error('[locations] Search failed:', err)
          setLocationSearchResults([])
        }
      } finally {
        if (!canceled) {
          setLocationSearchLoading(false)
        }
      }
    }

    const debounceTimer = setTimeout(fetchLocations, 300)
    return () => {
      canceled = true
      clearTimeout(debounceTimer)
    }
  }, [locationSearchQuery])

  // Fetch distribution stats based on current filters
  useEffect(() => {
    if (!googleUser || selectedResumeIds.length === 0) {
      setScoreStats(null)
      return
    }

    const fetchDistributionStats = async () => {
      try {
        if (selectedResumeIds.length === 0) {
          setScoreStats(null)
          return
        }
        const resumeRequest = buildResumeRequestParams(selectedResumeIds, resumeCatalogById)
        if (!resumeRequest) {
          setScoreStats(null)
          return
        }
        const params = new URLSearchParams({
          q: search || '',
          sortBy: sortBy || 'total',
          rankingMode: rankingMode || 'classic',
          impactMode: impactMode || 'classic',
          usOnly: usOnly ? '1' : '0',
          bookmarkFilter: 'all',
        })
        Object.entries(resumeRequest).forEach(([key, value]) => {
          if (value != null && value !== '') {
            params.set(key, value)
          }
        })
        if (selectedSources && selectedSources.size > 0) {
          params.set('sources', Array.from(selectedSources).join(','))
        }
        if (selectedJobTypes && selectedJobTypes.size > 0) {
          params.set('jobTypes', Array.from(selectedJobTypes).join(','))
        }
        if (selectedJobFields && selectedJobFields.size > 0) {
          params.set('jobFields', Array.from(selectedJobFields).join(','))
        }
        if (selectedCompanySizes && selectedCompanySizes.size > 0) {
          params.set('companySizes', Array.from(selectedCompanySizes).join(','))
        }
        if (endProductCategory !== 'all') {
          params.set('endProductCategory', endProductCategory)
        }
        params.set('scoreResumeWeight', String(scoreWeights.resume))
        params.set('scoreImpactWeight', String(scoreWeights.impact))
        params.set('scoreBayWeight', String(scoreWeights.bay))
        params.set('scoreFreshWeight', String(scoreWeights.fresh))
        params.set('scoreAuditWeight', String(scoreWeights.audit))
        const statsLocationParam = selectedLocationLabel && !LOCATION_OPTIONS.find((loc) => loc.value === selectedLocation)
          ? selectedLocationLabel.toLowerCase()
          : selectedLocation
        params.set('location', statsLocationParam)
        params.set('locationLabel', selectedLocationLabel || statsLocationParam)
        if (selectedLocationCoords && Number.isFinite(selectedLocationCoords.lat) && Number.isFinite(selectedLocationCoords.lng)) {
          params.set('locationLat', String(selectedLocationCoords.lat))
          params.set('locationLng', String(selectedLocationCoords.lng))
        }
        const res = await fetch(`/api/distribution-stats?${params}`, {
          signal: AbortSignal.timeout(STATS_API_TIMEOUT_MS),
        })
        if (res.ok) {
          const data = await res.json()
          setScoreStats(data)
        }
      } catch (err) {
        console.error('[distribution-stats] Fetch failed:', err)
      }
    }
    fetchDistributionStats()
  }, [search, selectedResumeIds, resumeCatalogById, sortBy, rankingMode, impactMode, usOnly, selectedSources, selectedJobTypes, selectedJobFields, selectedCompanySizes, endProductCategory, scoreWeights, selectedLocation, selectedLocationLabel, selectedLocationCoords])

  const availableSources = useMemo(() => Object.keys(sourceCounts).sort(), [sourceCounts])
  const availableJobTypes = useMemo(() => Object.keys(jobTypeCounts).sort(), [jobTypeCounts])
  const availableJobFields = useMemo(() => Object.keys(jobFieldCounts).sort(), [jobFieldCounts])
  const availableCompanySizes = useMemo(
    () => COMPANY_SIZE_ORDER.filter((s) => companySizeCounts[s] > 0),
    [companySizeCounts],
  )
  const availableEndProductCategories = useMemo(
    () => END_PRODUCT_ORDER.filter((category) => endProductCounts[category] > 0),
    [endProductCounts],
  )

  const LOCATION_OPTIONS = [
    { value: 'san-francisco-bay-area', label: 'Bay Area', description: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
    { value: 'new-york-city', label: 'New York City', description: 'New York, NY', lat: 40.7128, lng: -74.006 },
    { value: 'seattle', label: 'Seattle', description: 'Washington, USA', lat: 47.6062, lng: -122.3321 },
    { value: 'austin', label: 'Austin', description: 'Texas, USA', lat: 30.2672, lng: -97.7431 },
    { value: 'boston', label: 'Boston', description: 'Massachusetts, USA', lat: 42.3601, lng: -71.0589 },
    { value: 'london', label: 'London', description: 'England, UK', lat: 51.5074, lng: -0.1278 },
    { value: 'berlin', label: 'Berlin', description: 'Germany', lat: 52.52, lng: 13.405 },
    { value: 'toronto', label: 'Toronto', description: 'Ontario, Canada', lat: 43.6532, lng: -79.3832 },
    { value: 'sydney', label: 'Sydney', description: 'New South Wales, Australia', lat: -33.8688, lng: 151.2093 },
    { value: 'singapore', label: 'Singapore', description: 'Singapore', lat: 1.3521, lng: 103.8198 },
  ]

  const filteredLocationOptions = useMemo(() => {
    const query = locationSearchQuery.toLowerCase().trim()
    
    if (!query) {
      // Show quick picks when search is empty
      return LOCATION_OPTIONS
    }
    
    // Search through quick picks first
    const matchingQuickPicks = LOCATION_OPTIONS.filter(
      (loc) => loc.label.toLowerCase().includes(query) || loc.description.toLowerCase().includes(query)
    )
    
    // Transform Geonames results to our format
    const geonamesOptions = locationSearchResults.map((result) => ({
      value: result.value,
      label: result.label,
      description: result.displayLabel,
      category: 'worldwide',
      country: result.country,
      displayLabel: result.displayLabel,
      lat: result.lat,
      lng: result.lng,
    }))
    
    // Combine results: quick picks first, then worldwide (removing duplicates)
    const combined = [...matchingQuickPicks, ...geonamesOptions]
    const seen = new Set()
    const deduped = combined.filter((item) => {
      if (seen.has(item.value)) return false
      seen.add(item.value)
      return true
    })

    // Keep onboarding useful when live search fails by showing familiar suggestions.
    if (deduped.length === 0) {
      return LOCATION_OPTIONS.slice(0, 8)
    }

    return deduped
  }, [locationSearchQuery, locationSearchResults])

  const visibleJobs = useMemo(
    () => jobs.map((job) => ({ ...job, score: computeWeightedTileScore(job, scoreWeights) })),
    [jobs, scoreWeights],
  )

  const remoteCount = useMemo(() => {
    return visibleJobs.filter((job) =>
      job.remotePreferences.some((pref) => pref.toLowerCase().includes('remote')),
    ).length
  }, [visibleJobs])

  const topMatch = useMemo(() => {
    if (!visibleJobs.length) return null
    return visibleJobs[0].score ?? null
  }, [visibleJobs])

  const totalPages = useMemo(() => {
    if (!filteredAvailable || filteredAvailable < 1) return 1
    return Math.max(1, Math.ceil(filteredAvailable / PAGE_SIZE))
  }, [filteredAvailable])

  useEffect(() => {
    setPageInputValue(String(currentPage))
  }, [currentPage])

  function pushUrlState(queryText, page, sortMode, rankMode, usOnlyVal = usOnly, resumeVal = resumeId, impactModeVal = impactMode, resumeRequest = {}) {
    const p = new URLSearchParams()
    if (queryText.trim()) p.set('q', queryText.trim())
    if (page !== 1) p.set('page', String(page))
    if (sortMode !== 'total') p.set('sort', sortMode)
    if (rankMode !== 'hybrid') p.set('rankMode', rankMode)
    if (!usOnlyVal) p.set('us', '0')
    if (resumeVal) p.set('resume', resumeVal)
    if (impactModeVal !== 'classic') p.set('impactMode', impactModeVal)
    if (resumeRequest.resumeMode && resumeRequest.resumeMode !== 'uploaded') p.set('resumeMode', resumeRequest.resumeMode)
    if (resumeRequest.resumeIds) p.set('resumeIds', resumeRequest.resumeIds)
    if (resumeRequest.resumeBlend && resumeRequest.resumeBlend !== 'average') p.set('resumeBlend', resumeRequest.resumeBlend)
    if (resumeRequest.resumeLabel) p.set('resumeLabel', resumeRequest.resumeLabel)
    const qs = p.toString()
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.pushState({ page, sort: sortMode, q: queryText, us: usOnlyVal, impactMode: impactModeVal }, '', newUrl)
  }

  async function loadJobs(
    queryText = '',
    page = 1,
    sortMode = sortBy,
    rankMode = rankingMode,
    filterOverrides = {},
    resume = resumeId,
    impact = impactMode,
    usOnlyOverride = usOnly,
    scoreWeightsOverride = scoreWeights,
    resumeSelectionOverride = null,
  ) {
    const requestId = latestRequestRef.current + 1
    latestRequestRef.current = requestId
    const controller = new AbortController()
    const progressStart = performance.now()
    let progressTimer = null
    let progressPollTimer = null
    let timedOut = false
    const progressRequestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    let remainingTimeoutMs = JOBS_API_TIMEOUT_MS
    let timeoutStartedAt = 0
    let timeoutId = null
    const triggerTimeout = () => {
      timedOut = true
      controller.abort()
    }
    const armTimeout = () => {
      timeoutStartedAt = Date.now()
      timeoutId = window.setTimeout(triggerTimeout, Math.max(1, remainingTimeoutMs))
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId)
          timeoutId = null
          remainingTimeoutMs -= Date.now() - timeoutStartedAt
        }
        return
      }

      if (timeoutId === null && !timedOut && remainingTimeoutMs > 0) {
        armTimeout()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    armTimeout()

    try {
      setIsLoading(true)
      setError('')
      loadingTelemetryRef.current = null
      loadingPercentRef.current = 0
      setLoadingProgress(getLoadingProgressState(0, rankMode, null, 0))
      progressTimer = window.setInterval(() => {
        if (requestId !== latestRequestRef.current) return
        const elapsedMs = performance.now() - progressStart
        const next = getLoadingProgressState(elapsedMs, rankMode, loadingTelemetryRef.current, loadingPercentRef.current)
        loadingPercentRef.current = next.percent
        setLoadingProgress(next)
      }, 90)
      progressPollTimer = window.setInterval(async () => {
        if (requestId !== latestRequestRef.current) return
        try {
          const progressRes = await fetch(`/api/request-progress?requestId=${encodeURIComponent(progressRequestId)}`)
          if (!progressRes.ok) return
          const telemetry = await progressRes.json()
          loadingTelemetryRef.current = telemetry
        } catch {
          // Ignore transient progress polling failures.
        }
      }, 100)
      const activeResumeIds = normalizeResumeSelection(resumeSelectionOverride || selectedResumeIds)
      
      // If no resume selected, check if one is specified in the URL
      let finalResumeIds = activeResumeIds
      if (finalResumeIds.length === 0) {
        const p = new URLSearchParams(window.location.search)
        const urlResumeId = String(p.get('resume') || '').trim()
        if (urlResumeId) {
          finalResumeIds = [urlResumeId]
        }
      }
      
      if (finalResumeIds.length === 0) {
        setError('Please upload and select a resume to search.')
        setIsLoading(false)
        return false
      }
      const resumeRequest = buildResumeRequestParams(finalResumeIds, resumeCatalogById)
      if (!resumeRequest) {
        setError('Invalid resume selection.')
        setIsLoading(false)
        return false
      }
      pushUrlState(queryText, page, sortMode, rankMode, usOnlyOverride, resumeRequest.resumeId || resume, impact, resumeRequest)

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String((page - 1) * PAGE_SIZE),
      })

      if (queryText.trim()) {
        params.set('q', queryText.trim())
      }
      params.set('sortBy', sortMode)
      params.set('rankingMode', rankMode)
      Object.entries(resumeRequest).forEach(([key, value]) => {
        if (value != null && value !== '') {
          params.set(key, value)
        }
      })
      params.set('impactMode', impact)
      params.set('usOnly', usOnlyOverride ? '1' : '0')
      const activeBookmarkFilter = Object.prototype.hasOwnProperty.call(filterOverrides, 'bookmarkFilter')
        ? filterOverrides.bookmarkFilter
        : bookmarkFilter
      params.set('bookmarkFilter', activeBookmarkFilter)

      // Pass source filter to server if not all sources selected
      const activeSources = Object.prototype.hasOwnProperty.call(filterOverrides, 'sources')
        ? filterOverrides.sources
        : selectedSources
      if (activeSources !== null && availableSources.length > 0 && activeSources.length < availableSources.length) {
        params.set('sources', activeSources.join(','))
      }

      const activeJobTypes = Object.prototype.hasOwnProperty.call(filterOverrides, 'jobTypes')
        ? filterOverrides.jobTypes
        : selectedJobTypes
      if (activeJobTypes !== null && availableJobTypes.length > 0 && activeJobTypes.length < availableJobTypes.length) {
        params.set('jobTypes', activeJobTypes.join(','))
      }

      const activeJobFields = Object.prototype.hasOwnProperty.call(filterOverrides, 'jobFields')
        ? filterOverrides.jobFields
        : selectedJobFields
      if (activeJobFields !== null && availableJobFields.length > 0 && activeJobFields.length < availableJobFields.length) {
        params.set('jobFields', activeJobFields.join(','))
      }

      const activeCompanySizes = Object.prototype.hasOwnProperty.call(filterOverrides, 'companySizes')
        ? filterOverrides.companySizes
        : selectedCompanySizes
      if (activeCompanySizes !== null && availableCompanySizes.length > 0 && activeCompanySizes.length < availableCompanySizes.length) {
        params.set('companySizes', activeCompanySizes.join(','))
      }

      const activeEndProductCategory = Object.prototype.hasOwnProperty.call(filterOverrides, 'endProductCategory')
        ? filterOverrides.endProductCategory
        : endProductCategory
      if (activeEndProductCategory && activeEndProductCategory !== 'all') {
        params.set('endProductCategory', activeEndProductCategory)
      }

      params.set('scoreResumeWeight', String(scoreWeightsOverride.resume))
      params.set('scoreImpactWeight', String(scoreWeightsOverride.impact))
      params.set('scoreBayWeight', String(scoreWeightsOverride.bay))
      params.set('scoreFreshWeight', String(scoreWeightsOverride.fresh))
      params.set('scoreAuditWeight', String(scoreWeightsOverride.audit))
      const locationOverride = Object.prototype.hasOwnProperty.call(filterOverrides, 'location')
        ? filterOverrides.location
        : {
            value: selectedLocation,
            label: selectedLocationLabel,
            coords: selectedLocationCoords,
          }
      // For worldwide locations (Geonames), send the label for scoring; for predefined, send the value
      const locationParam = locationOverride?.label && !LOCATION_OPTIONS.find((loc) => loc.value === locationOverride?.value)
        ? String(locationOverride.label).toLowerCase()
        : String(locationOverride?.value || selectedLocation)
      params.set('location', locationParam)
      params.set('locationLabel', String(locationOverride?.label || selectedLocationLabel || locationParam))
      if (locationOverride?.coords && Number.isFinite(locationOverride.coords.lat) && Number.isFinite(locationOverride.coords.lng)) {
        params.set('locationLat', String(locationOverride.coords.lat))
        params.set('locationLng', String(locationOverride.coords.lng))
      }
  params.set('requestId', progressRequestId)

      const response = await fetch(`/api/jobs?${params.toString()}`, { signal: controller.signal })

      if (!response.ok) {
        throw new Error(`Request failed (${response.status})`)
      }

      const payload = await response.json()
      if (requestId !== latestRequestRef.current) return
      loadingTelemetryRef.current = null
      loadingPercentRef.current = 100
      setLoadingProgress({
        percent: 100,
        title: 'Jobs loaded',
        detail: 'The page is ready.',
        substeps: ['Loaded page data', 'Applied filters', 'Rendered cards'],
        checklist: [
          { label: 'Loaded page data', status: 'done' },
          { label: 'Applied filters', status: 'done' },
          { label: 'Rendered cards', status: 'done' },
        ],
        activeSubstep: null,
        stepProcessed: null,
        stepTotal: null,
        stepPercent: null,
      })

      setJobs(Array.isArray(payload.jobs) ? payload.jobs : [])
      if (payload.sourceCounts && typeof payload.sourceCounts === 'object') {
        setSourceCounts(payload.sourceCounts)
      }
      if (payload.jobTypeCounts && typeof payload.jobTypeCounts === 'object') {
        setJobTypeCounts(payload.jobTypeCounts)
      }
      if (payload.jobFieldCounts && typeof payload.jobFieldCounts === 'object') {
        setJobFieldCounts(payload.jobFieldCounts)
      }
      if (payload.companySizeCounts && typeof payload.companySizeCounts === 'object') {
        setCompanySizeCounts(payload.companySizeCounts)
      }
      if (payload.endProductCounts && typeof payload.endProductCounts === 'object') {
        setEndProductCounts(payload.endProductCounts)
      }
      setSourceUrl(payload.source || 'https://climatebase.org/jobs')
      setCacheMeta(payload.cache || { fromCache: false, stale: false })
      setLastUpdated(payload.cache?.updatedAt || new Date().toISOString())
      setSweAvailable(payload.sweAvailable ?? null)
      setTotalAvailable(payload.totalAvailable ?? null)
      setFilteredAvailable(payload.filteredAvailable ?? payload.sweAvailable ?? null)
      setCurrentPage(page)
      setSortBy(payload.sortBy ?? sortMode)
      setRankingMode(payload.rankingMode ?? rankMode)
      setImpactMode(payload.impactMode ?? impact)
      setUsOnly(usOnlyOverride)
      if (googleUser?.id) {
        writeStoredLastSearchState(googleUser.id, {
          q: queryText,
          page,
          sort: payload.sortBy ?? sortMode,
          rankingMode: payload.rankingMode ?? rankMode,
          impactMode: payload.impactMode ?? impact,
          usOnly: usOnlyOverride,
          resumeIds: finalResumeIds,
        })
      }
      if (payload.scoreWeights && typeof payload.scoreWeights === 'object') {
        setScoreWeights((prev) => ({
          ...prev,
          resume: Number.isFinite(Number(payload.scoreWeights.resume)) ? Number(payload.scoreWeights.resume) : prev.resume,
          impact: Number.isFinite(Number(payload.scoreWeights.impact)) ? Number(payload.scoreWeights.impact) : prev.impact,
          bay: Number.isFinite(Number(payload.scoreWeights.bay)) ? Number(payload.scoreWeights.bay) : prev.bay,
          fresh: Number.isFinite(Number(payload.scoreWeights.fresh)) ? Number(payload.scoreWeights.fresh) : prev.fresh,
          audit: Number.isFinite(Number(payload.scoreWeights.audit)) ? Number(payload.scoreWeights.audit) : prev.audit,
        }))
      }
      return true
    } catch (err) {
      if (requestId !== latestRequestRef.current) return

      if (err instanceof Error && err.name === 'AbortError') {
        if (timedOut) {
          setError('Loading timed out. Please click Refresh to try again.')
        }
        return false
      }

      setError(err instanceof Error ? err.message : 'Could not load jobs')
      setJobs([])
      return false
    } finally {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (progressTimer) {
        window.clearInterval(progressTimer)
      }
      if (progressPollTimer) {
        window.clearInterval(progressPollTimer)
      }
      if (requestId === latestRequestRef.current) {
        setIsLoading(false)
      }
    }
  }

  // Load bookmarks and hidden jobs from server
  useEffect(() => {
    if (!googleUser) {
      setBookmarkedJobs(new Set())
      setHiddenJobs(new Set())
      setHiddenCompanies(new Set())
      return
    }

    fetch('/api/bookmarks')
      .then((res) => res.json())
      .then((data) => {
        if (data && Array.isArray(data.bookmarked)) {
          setBookmarkedJobs(new Set(data.bookmarked))
          setHiddenJobs(new Set(data.hidden || []))
          setHiddenCompanies(new Set(data.hiddenCompanies || []))
        }
      })
      .catch((err) => console.error('Failed to load bookmarks from server:', err))
  }, [googleUser])

  async function applyBookmarkAction(action, payload = {}) {
    const response = await fetch('/api/bookmarks/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    })

    if (!response.ok) {
      throw new Error(`Bookmark action failed (${response.status})`)
    }

    const result = await response.json()
    const data = result?.data
    if (data && Array.isArray(data.bookmarked) && Array.isArray(data.hidden) && Array.isArray(data.hiddenCompanies)) {
      setBookmarkedJobs(new Set(data.bookmarked))
      setHiddenJobs(new Set(data.hidden))
      setHiddenCompanies(new Set(data.hiddenCompanies))
    }
  }

  useEffect(() => {
    const companies = [...new Set(visibleJobs.map((job) => String(job.company || '').trim()).filter(Boolean))].slice(0, 20)
    if (companies.length === 0) return

    let canceled = false
    fetch('/api/company-audits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Audit request failed (${res.status})`)
        return res.json()
      })
      .then((payload) => {
        if (canceled) return
        const audits = payload?.audits && typeof payload.audits === 'object' ? payload.audits : {}
        setCompanyAudits((prev) => ({ ...prev, ...audits }))
      })
      .catch((err) => {
        console.error('Failed to load company audits:', err)
      })

    return () => {
      canceled = true
    }
  }, [visibleJobs])

  useEffect(() => {
    if (!isAuthResolved || isOnboardingOpen || hasLoadedInitialJobsRef.current) return
    hasLoadedInitialJobsRef.current = true
    loadJobs(initial.q, initial.page, initial.sort, initial.rankingMode)
  }, [initial.page, initial.q, initial.rankingMode, initial.sort, isAuthResolved, isOnboardingOpen])

  useEffect(() => {
    function onPopState() {
      const s = readUrlState()
      setSearch(s.q)
      setSortBy(s.sort)
      setRankingMode(s.rankingMode)
      setImpactMode(s.impactMode)
      setUsOnly(s.usOnly)
      setResumeId(s.resumeId)
      setSelectedResumeIds([s.resumeId])
      loadJobs(s.q, s.page, s.sort, s.rankingMode, {}, s.resumeId, s.impactMode, s.usOnly, scoreWeights, [s.resumeId])
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [scoreWeights])

  useEffect(() => {
    // No longer needed with inline positioning
  }, [])

  function handleSubmit(event) {
    event.preventDefault()
    loadJobs(search, 1, sortBy, rankingMode)
  }

  function handlePrevPage() {
    if (currentPage <= 1 || isLoading) return
    loadJobs(search, currentPage - 1, sortBy, rankingMode)
  }

  function handleNextPage() {
    if (currentPage >= totalPages || isLoading) return
    loadJobs(search, currentPage + 1, sortBy, rankingMode)
  }

  function commitPageInput() {
    const rawValue = String(pageInputValue || '').trim()
    if (!rawValue) {
      setPageInputValue(String(currentPage))
      return
    }
    const page = Math.max(1, Math.min(Number(rawValue) || 1, totalPages))
    if (page !== currentPage) {
      loadJobs(search, page, sortBy, rankingMode)
      return
    }
    setPageInputValue(String(page))
  }

  function handlePageInputChange(e) {
    setPageInputValue(e.target.value)
  }

  function handlePageInputKeyDown(e) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    commitPageInput()
  }

  function handleSortChange(event) {
    const newSort = event.target.value
    setSortBy(newSort)
    loadJobs(search, 1, newSort, rankingMode)
  }

  function handleRankingModeChange(event) {
    const newMode = event.target.value
    setRankingMode(newMode)
    loadJobs(search, 1, sortBy, newMode)
  }

  function handleResumeChange(event) {
    const newResume = event.target.value
    setResumeId(newResume)
    setSelectedResumeIds([newResume])
    loadJobs(search, 1, sortBy, rankingMode, {}, newResume, impactMode, usOnly, scoreWeights, [newResume])
  }

  async function loadResumeBreakdownPreview(resumeIdValue) {
    const targetId = String(resumeIdValue || '').trim()
    if (!targetId) return null

    const breakdownUrl = `/api/resume-breakdown?resumeId=${encodeURIComponent(targetId)}`
    const attempts = [{ url: breakdownUrl, timeoutMs: 5000 }]

    for (const attempt of attempts) {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => controller.abort(), attempt.timeoutMs)
      try {
        const response = await fetch(attempt.url, { signal: controller.signal })
        if (!response.ok) continue
        const data = await response.json()
        return data
      } catch {
        // Try the next endpoint.
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    throw new Error('Could not load resume keyword breakdown')
  }

  function toggleResumeSelection(resumeIdValue) {
    const current = normalizeResumeSelection(selectedResumeIds)
    const next = current.includes(resumeIdValue)
      ? current.filter((id) => id !== resumeIdValue)
      : [...current, resumeIdValue]
    setSelectedResumeIds(next)
    if (next.length > 0) {
      setResumeId(next[0])
      loadJobs(search, 1, sortBy, rankingMode, {}, next[0], impactMode, usOnly, scoreWeights, next)
    } else {
      setResumeId('')
    }
  }

  async function handleResumeUpload(event) {
    const files = Array.from(event.target.files || [])
    if (files.length === 0) return
    setResumeUploadBreakdownPreview(null)
    setResumeUploadBreakdownError('')
    setResumeUploadBreakdownLoading(false)
    setResumeUploadProgress({ percent: 3, stage: 'Preparing upload', detail: 'Validating selected files...' })
    setResumeUploadStatus(`Uploading ${files.length} resume${files.length > 1 ? 's' : ''}...`)
    try {
      const uploadedIds = []
      for (const [index, file] of files.entries()) {
        const startBase = Math.round((index / files.length) * 70)
        const endBase = Math.round(((index + 1) / files.length) * 70)
        setResumeUploadProgress({
          percent: Math.max(5, startBase + 5),
          stage: `Processing file ${index + 1} of ${files.length}`,
          detail: `Reading ${file.name}...`,
        })
        const rawText = String(await file.text())
        setResumeUploadProgress({
          percent: Math.max(10, Math.min(78, endBase - 4)),
          stage: `Uploading file ${index + 1} of ${files.length}`,
          detail: `Uploading ${file.name} to resume library...`,
        })
        const response = await fetch('/api/resumes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: rawText,
            name: file.name.replace(/\.[^.]+$/, ''),
            fileName: file.name,
            sourceName: file.type || 'Upload',
          }),
        })
        if (!response.ok) {
          throw new Error(`Upload failed for ${file.name} (${response.status})`)
        }
        const payload = await response.json()
        if (payload?.resume?.id) uploadedIds.push(payload.resume.id)
        setResumeUploadProgress({
          percent: Math.max(12, Math.min(82, endBase)),
          stage: `Uploaded file ${index + 1} of ${files.length}`,
          detail: `${file.name} uploaded successfully.`,
        })
      }

      setResumeUploadProgress({ percent: 86, stage: 'Syncing resume list', detail: 'Refreshing uploaded resumes...' })
      const libraryResponse = await fetch('/api/resumes')
      if (libraryResponse.ok) {
        const payload = await libraryResponse.json()
        const uploadedResumes = Array.isArray(payload?.uploadedResumes) ? payload.uploadedResumes : []
        setResumeCatalog(uploadedResumes)
      }

      if (uploadedIds.length > 0) {
        setResumeUploadProgress({ percent: 94, stage: 'Applying selection', detail: 'Selecting uploaded resumes and refreshing jobs...' })
        const nextSelection = normalizeResumeSelection(uploadedIds)
        setSelectedResumeIds(nextSelection)
        setResumeId(nextSelection[0])
        loadJobs(search, 1, sortBy, rankingMode, {}, nextSelection[0], impactMode, usOnly, scoreWeights, nextSelection)

        setResumeUploadProgress({ percent: 97, stage: 'Extracting keyword breakdown', detail: 'Loading resume keywords and weighted signals...' })
        setResumeUploadBreakdownLoading(true)
        try {
          const preview = await loadResumeBreakdownPreview(nextSelection[0])
          setResumeUploadBreakdownPreview(preview)
          setResumeUploadBreakdownError('')
        } catch (previewErr) {
          setResumeUploadBreakdownPreview(null)
          setResumeUploadBreakdownError(previewErr instanceof Error ? previewErr.message : 'Could not load resume keyword breakdown')
        } finally {
          setResumeUploadBreakdownLoading(false)
        }
      }
      setResumeUploadProgress({ percent: 100, stage: 'Upload complete', detail: 'Resume upload and processing finished.' })
      setResumeUploadStatus(`Uploaded ${uploadedIds.length} resume${uploadedIds.length === 1 ? '' : 's'}`)
      window.setTimeout(() => {
        setResumeUploadProgress(null)
      }, 1500)
    } catch (err) {
      setResumeUploadProgress({ percent: 100, stage: 'Upload failed', detail: err instanceof Error ? err.message : 'Could not upload resume' })
      setResumeUploadStatus(err instanceof Error ? err.message : 'Could not upload resume')
      setError(err instanceof Error ? err.message : 'Could not upload resume')
    } finally {
      event.target.value = ''
    }
  }

  function closeAllDropdowns() {
    setOpenTotalScoreJobId(null)
    setOpenResumeScoreJobId(null)
    setOpenImpactScoreJobId(null)
    setOpenLocationScoreJobId(null)
    setOpenFreshScoreJobId(null)
    setOpenAuditJobId(null)
    setOpenJobMenuId(null)
  }

  function closeAdvancedSettings() {
    if (advancedSettingsMenuRef.current) {
      advancedSettingsMenuRef.current.open = false
    }
  }

  function handleAuthFieldChange(field, value) {
    setAuthForm((prev) => ({ ...prev, [field]: value }))
  }

  async function submitAuthForm(mode) {
    setIsAuthSubmitting(true)
    try {
      const response = await fetch(mode === 'register' ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authForm.name,
          email: authForm.email,
          password: authForm.password,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload?.error || `${mode === 'register' ? 'Sign up' : 'Sign in'} failed (${response.status})`)
      }
      setGoogleUser(payload?.user || null)
      setOnboardingError('')
      setOnboardingPage(2)
      setAuthForm((prev) => ({ ...prev, password: '' }))
    } catch (err) {
      setOnboardingError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setIsAuthSubmitting(false)
    }
  }

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (err) {
      console.error('Failed to log out:', err)
    }
    setGoogleUser(null)
    setResumeCatalog([])
    setSelectedResumeIds([])
    setResumeId('')
    setBookmarkedJobs(new Set())
    setHiddenJobs(new Set())
    setHiddenCompanies(new Set())
    setOnboardingError('')
    setOnboardingPage(1)
    setIsOnboardingOpen(true)
    window.localStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY)
  }

  function canAdvanceOnboarding(page = onboardingPage) {
    if (page === 1) return Boolean(googleUser)
    if (page === 2) return selectedResumeIds.length > 0
    if (page === 3) return isOnboardingLocationConfirmed
    if (page === 4) return Boolean(onboardingSearchQuery)
    return true
  }

  function handleOnboardingNext() {
    if (!canAdvanceOnboarding()) {
      if (onboardingPage === 1) setOnboardingError('Please create an account or sign in to continue.')
      if (onboardingPage === 2) setOnboardingError('Please upload and select at least one resume.')
      if (onboardingPage === 3) setOnboardingError('Please select a location or choose "Search all locations" to continue.')
      if (onboardingPage === 4) setOnboardingError('Pick one or more job types, or enter a custom search.')
      return
    }
    setOnboardingError('')
    setOnboardingPage((prev) => Math.min(5, prev + 1))
  }

  function handleOnboardingBack() {
    setOnboardingError('')
    setOnboardingPage((prev) => Math.max(1, prev - 1))
  }

  function toggleOnboardingJobOption(optionId) {
    setSelectedOnboardingJobOptions((prev) => (
      prev.includes(optionId)
        ? prev.filter((id) => id !== optionId)
        : [...prev, optionId]
    ))
  }

  async function launchOnboardingSearch() {
    if (!googleUser) {
      setOnboardingError('Please create an account or sign in to continue.')
      return
    }
    if (selectedResumeIds.length === 0) {
      setOnboardingError('Please upload and select at least one resume.')
      return
    }
    if (!onboardingSearchQuery) {
      setOnboardingError('Pick at least one job type, or enter a custom search.')
      return
    }

    setOnboardingError('')
    setIsOnboardingLaunching(true)
    window.localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, '1')
    // Explicitly persist the selected resume IDs before async loadJobs
    window.localStorage.setItem(RESUME_SELECTION_STORAGE_KEY, JSON.stringify(selectedResumeIds))
    setIsOnboardingOpen(false)
    setSearch(onboardingSearchQuery)
    const ok = await loadJobs(onboardingSearchQuery, 1, sortBy, rankingMode)
    setIsOnboardingLaunching(false)
    if (!ok) {
      return
    }
  }

  async function handleResumeDelete(resumeIdToDelete) {
    const targetId = String(resumeIdToDelete || '').trim()
    if (!targetId) return

    const previousCatalog = [...resumeCatalog]
    const previousSelection = normalizeResumeSelection(selectedResumeIds)
    const nextCatalog = previousCatalog.filter((item) => item.id !== targetId)
    const nextSelection = previousSelection.filter((id) => id !== targetId)

    // Update UI immediately so delete actions feel responsive even if backend is slow.
    setResumeCatalog(nextCatalog)
    setSelectedResumeIds(nextSelection)

    if (nextSelection.length > 0) {
      setResumeId(nextSelection[0])
    } else {
      setResumeId('')
      setJobs([])
      setFilteredAvailable(0)
      setTotalAvailable(0)
    }

    setResumeUploadStatus('Deleting resume...')

    try {
      const response = await fetch(`/api/resumes?resumeId=${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
        signal: AbortSignal.timeout(12000),
      })
      if (!response.ok) {
        throw new Error(`Delete failed (${response.status})`)
      }

      if (nextSelection.length > 0) {
        const nextPrimary = nextSelection[0]
        setResumeId(nextPrimary)
        setResumeUploadStatus('Resume deleted.')
        loadJobs(search, 1, sortBy, rankingMode, {}, nextPrimary, impactMode, usOnly, scoreWeights, nextSelection)
      } else {
        setResumeUploadStatus('Resume deleted. Upload or select a resume to search.')
        window.localStorage.removeItem(ONBOARDING_COMPLETE_STORAGE_KEY)
        setIsOnboardingOpen(true)
        setOnboardingPage(2)
        setOnboardingError('')
      }
    } catch (err) {
      // Restore previous UI if backend delete fails.
      setResumeCatalog(previousCatalog)
      setSelectedResumeIds(previousSelection)
      setResumeId(previousSelection[0] || '')
      setError(err instanceof Error ? err.message : 'Could not delete resume')
      setResumeUploadStatus('Could not delete resume')
    }
  }

  function handleImpactModeChange(event) {
    const newImpactMode = event.target.value
    setImpactMode(newImpactMode)
    loadJobs(search, 1, sortBy, rankingMode, {}, resumeId, newImpactMode)
  }

  async function handleBookmarkJob(jobId) {
    try {
      await applyBookmarkAction('toggle-bookmark-job', { jobId })
      loadJobs(search, currentPage, sortBy, rankingMode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update bookmark')
    }
  }

  async function handleBookmarkCompany(company) {
    try {
      await applyBookmarkAction('bookmark-company-all', { company })
      loadJobs(search, currentPage, sortBy, rankingMode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not bookmark company jobs')
    }
  }

  async function handleHideJob(jobId) {
    try {
      await applyBookmarkAction('toggle-hide-job', { jobId })
      loadJobs(search, currentPage, sortBy, rankingMode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update hidden jobs')
    }
  }

  async function handleHideCompany(company) {
    try {
      await applyBookmarkAction('toggle-hide-company', { company })
      loadJobs(search, currentPage, sortBy, rankingMode)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update hidden companies')
    }
  }

  function handleBookmarkFilter(value) {
    setBookmarkFilter(value)
    loadJobs(search, 1, sortBy, rankingMode, { bookmarkFilter: value })
  }

  async function loadBreakdown(resumeId) {
    const requestId = breakdownRequestRef.current + 1
    breakdownRequestRef.current = requestId
    const uiFailsafeTimeoutId = window.setTimeout(() => {
      if (requestId === breakdownRequestRef.current) {
        setBreakdownError('Resume breakdown timed out. Please try again.')
        setBreakdownLoading(false)
      }
    }, 18000)

    const withTimeout = (promise, timeoutMs) => new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        const timeoutError = new Error('Timed out')
        timeoutError.name = 'TimeoutError'
        reject(timeoutError)
      }, timeoutMs)
      promise
        .then((value) => {
          window.clearTimeout(timeoutId)
          resolve(value)
        })
        .catch((error) => {
          window.clearTimeout(timeoutId)
          reject(error)
        })
    })

    const fetchWithTimeout = async (url, timeoutMs) => {
      const controller = new AbortController()
      const timeoutId = window.setTimeout(() => {
        controller.abort()
      }, timeoutMs)
      try {
        return await withTimeout(fetch(url, { signal: controller.signal }), timeoutMs + 200)
      } finally {
        window.clearTimeout(timeoutId)
      }
    }

    setBreakdownModalOpen(true)
    setBreakdownLoading(true)
    setBreakdownError('')
    setBreakdownData(null)
    try {
      const breakdownUrl = `/api/resume-breakdown?resumeId=${encodeURIComponent(resumeId)}`
      const attempts = [{ url: breakdownUrl, timeoutMs: 5000 }]

      let response = null
      let lastError = null
      for (const attempt of attempts) {
        try {
          response = await fetchWithTimeout(attempt.url, attempt.timeoutMs)
          break
        } catch (err) {
          lastError = err
        }
      }

      if (!response) {
        throw lastError || new Error('Could not load breakdown')
      }

      if (requestId !== breakdownRequestRef.current) return

      if (response.ok) {
        const data = await withTimeout(response.json(), 5000)
        if (requestId !== breakdownRequestRef.current) return
        setBreakdownData(data)
      } else {
        setBreakdownError(`Could not load breakdown (${response.status}).`)
      }
    } catch (err) {
      if (requestId !== breakdownRequestRef.current) return
      console.error('Error loading breakdown:', err)
      if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
        setBreakdownError('Resume breakdown timed out. Please try again.')
      } else {
        setBreakdownError('Could not load breakdown. Please try again.')
      }
    } finally {
      window.clearTimeout(uiFailsafeTimeoutId)
      if (requestId === breakdownRequestRef.current) {
        setBreakdownLoading(false)
      }
    }
  }

  function handleEndProductCategoryChange(value) {
    setEndProductCategory(value)
    loadJobs(search, 1, sortBy, rankingMode, { endProductCategory: value })
  }

  function toggleSource(source) {
    setSelectedSources((prev) => {
      const current = prev === null ? [...availableSources] : prev
      const next = current.includes(source)
        ? current.filter((s) => s !== source)
        : [...current, source].sort()
      loadJobs(search, 1, sortBy, rankingMode, { sources: next })
      return next
    })
  }

  function toggleJobType(jobType) {
    setSelectedJobTypes((prev) => {
      const current = prev === null ? [...availableJobTypes] : prev
      const next = current.includes(jobType)
        ? current.filter((t) => t !== jobType)
        : [...current, jobType].sort()
      loadJobs(search, 1, sortBy, rankingMode, { jobTypes: next })
      return next
    })
  }

  function toggleJobField(jobField) {
    setSelectedJobFields((prev) => {
      const current = prev === null ? [...availableJobFields] : prev
      const next = current.includes(jobField)
        ? current.filter((field) => field !== jobField)
        : [...current, jobField].sort()
      loadJobs(search, 1, sortBy, rankingMode, { jobFields: next })
      return next
    })
  }

  function toggleCompanySize(size) {
    setSelectedCompanySizes((prev) => {
      const current = prev === null ? [...availableCompanySizes] : prev
      const next = current.includes(size)
        ? current.filter((s) => s !== size)
        : [...current, size]
      loadJobs(search, 1, sortBy, rankingMode, { companySizes: next })
      return next
    })
  }

  function sourceLabel(source) {
    return SOURCE_LABELS[source] || source
  }

  function handleScoreWeightChange(key, value) {
    const nextValue = Math.max(0, Math.min(100, Number(value) || 0))
    const nextWeights = { ...scoreWeights, [key]: nextValue }
    setScoreWeights(nextWeights)
    loadJobs(search, 1, sortBy, rankingMode, {}, resumeId, impactMode, usOnly, nextWeights)
  }

  return (
    <div className="app-shell">
      {isOnboardingOpen ? (
        <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-label="New user onboarding">
          <section className="onboarding-panel">
            <div className="onboarding-header">
              <div>
                <h2>Welcome to Job Finder</h2>
                <p className="onboarding-intro">Complete these steps once and we will launch your first tailored search.</p>
              </div>
              <div className="onboarding-nav">
                {onboardingPage > 1 ? (
                  <button type="button" className="ghost" onClick={handleOnboardingBack}>Back</button>
                ) : <span />}
                {onboardingPage < 5 ? (
                  <button type="button" onClick={handleOnboardingNext} disabled={!canAdvanceOnboarding()}>Continue</button>
                ) : (
                  <button
                    type="button"
                    onClick={launchOnboardingSearch}
                    disabled={isOnboardingLaunching}
                  >
                    {isOnboardingLaunching ? 'Starting search…' : 'Start my search'}
                  </button>
                )}
              </div>
            </div>
            <ol className="onboarding-steps">
              <li className={onboardingPage === 1 ? 'active' : onboardingStep > 1 ? 'done' : ''}>Create account</li>
              <li className={onboardingPage === 2 ? 'active' : onboardingStep > 2 ? 'done' : ''}>Upload resume</li>
              <li className={onboardingPage === 3 ? 'active' : onboardingStep > 3 ? 'done' : ''}>Select location</li>
              <li className={onboardingPage === 4 ? 'active' : onboardingStep > 4 ? 'done' : ''}>Pick job targets</li>
              <li className={onboardingPage === 5 ? 'active' : onboardingStep > 5 ? 'done' : ''}>Start search</li>
            </ol>

            {onboardingPage === 1 ? (
              <div className="onboarding-section onboarding-page">
                <h3>1. Sign in securely</h3>
                <p className="onboarding-meta">Create an account on this server or sign in with your existing email and password. Your resumes and bookmarks stay on the backend.</p>
                {googleUser ? (
                  <div className="onboarding-google-pill onboarding-account-pill">
                    <span>{googleUser.name}{googleUser.email ? ` · ${googleUser.email}` : ''}</span>
                    <button type="button" className="ghost-link" onClick={handleLogout}>Log out</button>
                  </div>
                ) : (
                  <div className="onboarding-auth-card">
                    <div className="onboarding-auth-toggle" role="tablist" aria-label="Authentication mode">
                      <button
                        type="button"
                        className={authMode === 'register' ? 'active' : ''}
                        onClick={() => setAuthMode('register')}
                      >
                        Create account
                      </button>
                      <button
                        type="button"
                        className={authMode === 'login' ? 'active' : ''}
                        onClick={() => setAuthMode('login')}
                      >
                        Sign in
                      </button>
                    </div>
                    <div className="onboarding-auth-grid">
                      {authMode === 'register' ? (
                        <label>
                          <span>Name</span>
                          <input
                            type="text"
                            value={authForm.name}
                            onChange={(event) => handleAuthFieldChange('name', event.target.value)}
                            placeholder="Your name"
                            autoComplete="name"
                          />
                        </label>
                      ) : null}
                      <label>
                        <span>Email</span>
                        <input
                          type="email"
                          value={authForm.email}
                          onChange={(event) => handleAuthFieldChange('email', event.target.value)}
                          placeholder="you@example.com"
                          autoComplete="email"
                        />
                      </label>
                      <label>
                        <span>Password</span>
                        <input
                          type="password"
                          value={authForm.password}
                          onChange={(event) => handleAuthFieldChange('password', event.target.value)}
                          placeholder="At least 8 characters"
                          autoComplete={authMode === 'register' ? 'new-password' : 'current-password'}
                        />
                      </label>
                    </div>
                    <div className="onboarding-auth-actions">
                      <button
                        type="button"
                        onClick={() => submitAuthForm(authMode)}
                        disabled={isAuthSubmitting || !authForm.email.trim() || !authForm.password || (authMode === 'register' && !authForm.name.trim())}
                      >
                        {isAuthSubmitting ? 'Submitting…' : authMode === 'register' ? 'Create account' : 'Sign in'}
                      </button>
                      <p>{authMode === 'register' ? 'We create your encrypted account on this server and keep your session in an HttpOnly cookie.' : 'Use the account you already created on this server.'}</p>
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {onboardingPage === 2 ? (
              <div className="onboarding-section onboarding-page">
                <h3>2. Upload resume</h3>
                <p className="onboarding-meta">Upload one or more resumes. The selected resume will drive ranking and search quality.</p>
                <label className="resume-upload-btn onboarding-upload-btn">
                  <span>Upload resume files</span>
                  <input
                    type="file"
                    accept=".txt,.md,text/plain,text/markdown"
                    multiple
                    onChange={handleResumeUpload}
                  />
                </label>
                {resumeUploadProgress ? (
                  <div className="resume-upload-progress onboarding-upload-progress" role="status" aria-live="polite">
                    <div className="resume-upload-progress-header">
                      <strong>{resumeUploadProgress.stage}</strong>
                      <span>{Math.round(resumeUploadProgress.percent)}%</span>
                    </div>
                    <div className="loading-progress-track resume-upload-progress-track" aria-label="Resume upload progress">
                      <div
                        className="loading-progress-fill"
                        style={{ width: `${Math.max(0, Math.min(100, resumeUploadProgress.percent))}%` }}
                      />
                    </div>
                    <p className="resume-upload-progress-detail">{resumeUploadProgress.detail}</p>
                  </div>
                ) : null}
                {selectedOnboardingResumeNames.length > 0 ? (
                  <p className="onboarding-meta">Selected: {selectedOnboardingResumeNames.join(', ')}</p>
                ) : (
                  <p className="onboarding-meta">Upload at least one resume to continue.</p>
                )}
                {resumeUploadStatus ? <p className="onboarding-meta">{resumeUploadStatus}</p> : null}
                {resumeUploadBreakdownLoading ? (
                  <p className="onboarding-meta">Building keyword breakdown...</p>
                ) : null}
                {resumeUploadBreakdownError ? (
                  <p className="onboarding-error">{resumeUploadBreakdownError}</p>
                ) : null}
                {resumeUploadBreakdownPreview?.breakdown ? (
                  <div className="resume-breakdown-preview">
                    <div className="resume-breakdown-preview-header">
                      <div>
                        <strong>{resumeUploadBreakdownPreview.resumeName}</strong>
                        <p>{resumeUploadBreakdownPreview.breakdown.scoringMethod}</p>
                      </div>
                    </div>
                    <p className="resume-breakdown-preview-summary">{resumeUploadBreakdownPreview.breakdown.aiSummary}</p>
                    {Array.isArray(resumeUploadBreakdownPreview.breakdown.topKeywords) && resumeUploadBreakdownPreview.breakdown.topKeywords.length > 0 ? (
                      <div>
                        <p className="resume-breakdown-preview-label">Top weighted keywords</p>
                        <div className="resume-breakdown-preview-grid">
                          {resumeUploadBreakdownPreview.breakdown.topKeywords.slice(0, 8).map((keyword) => (
                            <div key={keyword.term} className="resume-breakdown-preview-chip">
                              <span>{keyword.term}</span>
                              <strong>{keyword.weight}</strong>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {Array.isArray(resumeUploadBreakdownPreview.breakdown.skills) && resumeUploadBreakdownPreview.breakdown.skills.length > 0 ? (
                      <div>
                        <p className="resume-breakdown-preview-label">Detected skills</p>
                        <div className="resume-breakdown-preview-skills">
                          {resumeUploadBreakdownPreview.breakdown.skills.slice(0, 10).map((skill) => (
                            <span key={skill} className="resume-breakdown-preview-skill">{skill}</span>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}

            {onboardingPage === 3 ? (
              <div className="onboarding-section onboarding-page">
                <h3>3. Select location</h3>
                <p className="onboarding-meta">Pick a location so proximity scoring can prioritize nearby roles. You can skip this and search everywhere.</p>
                <div className="onboarding-location-pane">
                  <input
                    type="text"
                    className="location-search-input"
                    placeholder="Search locations..."
                    value={locationSearchQuery}
                    onChange={(event) => setLocationSearchQuery(event.target.value)}
                    aria-label="Search locations"
                  />
                  {locationSearchLoading ? (
                    <div className="location-search-loading" role="status" aria-live="polite">
                      <span className="location-search-spinner" aria-hidden="true" />
                      <span>Searching locations...</span>
                    </div>
                  ) : null}
                  <div className="location-popover onboarding-location-popover">
                    <div className="location-list">
                      {filteredLocationOptions.length > 0 ? (
                        filteredLocationOptions.map((location) => (
                          <div
                            key={location.value}
                            className={`location-item ${selectedLocation === location.value ? 'selected' : ''}`}
                            onClick={() => {
                              const nextCoords = Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))
                                ? { lat: Number(location.lat), lng: Number(location.lng) }
                                : null
                              setSelectedLocation(location.value)
                              setSelectedLocationLabel(location.label)
                              setSelectedLocationCoords(nextCoords)
                              setIsOnboardingLocationConfirmed(true)
                              setOnboardingError('')
                            }}
                          >
                            <div className="location-item-label">{location.label}</div>
                            <div className="location-item-description">
                              {location.description || location.displayLabel || location.region}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="location-item-empty">Type at least 2 letters to search locations</div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="onboarding-location-skip"
                    onClick={() => {
                      setSelectedLocation(null)
                      setSelectedLocationLabel('Select a location')
                      setSelectedLocationCoords(null)
                      setLocationSearchQuery('')
                      setIsOnboardingLocationConfirmed(true)
                      setOnboardingError('')
                    }}
                  >
                    Search all locations
                  </button>
                  <p className="onboarding-meta">Current selection: {onboardingLocationSummary}</p>
                </div>
              </div>
            ) : null}

            {onboardingPage === 4 ? (
              <div className="onboarding-section onboarding-page">
                <h3>4. What jobs should we search for?</h3>
                <p className="onboarding-meta">Choose any number of presets, then add your own search terms if you want something more specific.</p>
                <div className="onboarding-job-grid onboarding-job-grid-wide">
                  {ONBOARDING_JOB_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`onboarding-job-option ${selectedOnboardingJobOptions.includes(option.id) ? 'selected' : ''}`}
                      onClick={() => toggleOnboardingJobOption(option.id)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label className="onboarding-custom-query">
                  <span>Custom search</span>
                  <textarea
                    value={onboardingCustomQuery}
                    onChange={(event) => setOnboardingCustomQuery(event.target.value)}
                    placeholder="Example: staff machine learning engineer climate risk remote"
                    rows="3"
                  />
                </label>
              </div>
            ) : null}

            {onboardingPage === 5 ? (
              <div className="onboarding-section onboarding-page">
                <h3>5. Start your search</h3>
                <p className="onboarding-meta">We’ll launch a search with your selected resume and the role focus below.</p>
                <div className="onboarding-summary">
                  <p><strong>Signed in:</strong> {googleUser?.name || 'Not signed in'}</p>
                  <p><strong>Resume:</strong> {selectedOnboardingResumeNames.join(', ') || 'None selected'}</p>
                  <p><strong>Location:</strong> {onboardingLocationSummary}</p>
                  <p><strong>Search query:</strong> {onboardingSearchQuery || 'No job target selected yet'}</p>
                </div>
              </div>
            ) : null}

            <div className="onboarding-actions">
              {onboardingError ? <p className="onboarding-error">{onboardingError}</p> : null}
            </div>
          </section>
        </div>
      ) : null}
      {!isOnboardingOpen ? (
      <>
      <form className="controls" onSubmit={handleSubmit}>
        <div className="controls-row controls-row-primary">
          <div className="search-group">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search roles, companies, locations..."
            aria-label="Search climate jobs"
          />
          <button
            type="submit"
            className="execute-search-btn"
            title="Execute search"
          >
            🔍
          </button>
          </div>
          <details
            className="source-menu resume-menu"
            open={isResumeMenuOpen}
            onToggle={(event) => setIsResumeMenuOpen(event.currentTarget.open)}
          >
            <summary>
              <span className="dropdown-indicator" style={{ display: 'inline-block', marginRight: '8px', transform: isResumeMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s ease' }}>▼</span>
              {resumeSelectionLabel}
            </summary>
            <div className="source-options resume-options" aria-label="Resume library">
              <label className="resume-upload-btn">
                <span>Upload resumes</span>
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  multiple
                  onChange={handleResumeUpload}
                />
              </label>
              {resumeUploadProgress ? (
                <div className="resume-upload-progress" role="status" aria-live="polite">
                  <div className="resume-upload-progress-header">
                    <strong>{resumeUploadProgress.stage}</strong>
                    <span>{Math.round(resumeUploadProgress.percent)}%</span>
                  </div>
                  <div className="loading-progress-track resume-upload-progress-track" aria-label="Resume upload progress">
                    <div
                      className="loading-progress-fill"
                      style={{ width: `${Math.max(0, Math.min(100, resumeUploadProgress.percent))}%` }}
                    />
                  </div>
                  <p className="resume-upload-progress-detail">{resumeUploadProgress.detail}</p>
                </div>
              ) : null}
              <p className="source-empty">
                Select one resume to swap instantly or check multiple resumes to average their signals.
              </p>
              <div className="resume-list">
                {resumeCatalog.map((item) => (
                  <div key={item.id} className="source-option resume-option">
                    <label className="resume-option-label">
                      <input
                        type="checkbox"
                        checked={selectedResumeIds.includes(item.id)}
                        onChange={() => toggleResumeSelection(item.id)}
                      />
                      <span className="resume-option-copy">
                        <span className="resume-option-name">{item.name}</span>
                        <span className="source-count resume-option-meta">
                          {item.sourceName || 'Uploaded'}
                        </span>
                      </span>
                    </label>
                    <div className="resume-option-actions">
                      <button
                        type="button"
                        className="resume-delete-btn"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          void handleResumeDelete(item.id)
                        }}
                        title={`Delete ${item.name}`}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="resume-breakdown-btn"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          void loadBreakdown(item.id)
                        }}
                        title="Show how this resume is scored against jobs"
                      >
                        How this scores
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {resumeUploadStatus ? <p className="source-empty">{resumeUploadStatus}</p> : null}
            </div>
          </details>
          <div className="location-selector-wrapper" style={{ position: 'relative' }} ref={locationSelectorRef}>
            <button
              type="button"
              className="location-selector-btn"
              onClick={() => setIsLocationDropdownOpen(!isLocationDropdownOpen)}
              title="Select proximity filter"
            >
              <span className="location-selector-label">
                {selectedLocationLabel || LOCATION_OPTIONS.find((loc) => loc.value === selectedLocation)?.label || 'Select'}
              </span>
              <span className="location-selector-icon">{isLocationDropdownOpen ? '▲' : '▼'}</span>
            </button>
            {isLocationDropdownOpen ? (
              <div className={`location-popover ${locationSearchLoading ? 'searching' : ''}`}>
                <input
                  type="text"
                  className="location-search-input"
                  placeholder="Search locations..."
                  value={locationSearchQuery}
                  onChange={(e) => setLocationSearchQuery(e.target.value)}
                  autoFocus
                  aria-label="Search locations"
                />
                {locationSearchLoading ? (
                  <div className="location-search-loading" role="status" aria-live="polite">
                    <span className="location-search-spinner" aria-hidden="true" />
                    <span>Searching locations...</span>
                  </div>
                ) : null}
                <div className="location-list">
                  {filteredLocationOptions.length > 0 ? (
                    filteredLocationOptions.map((location, idx) => (
                      <div
                        key={location.value}
                        className={`location-item ${selectedLocation === location.value ? 'selected' : ''}`}
                        onClick={() => {
                          const nextCoords = Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng))
                            ? { lat: Number(location.lat), lng: Number(location.lng) }
                            : null
                          setSelectedLocation(location.value)
                          setSelectedLocationLabel(location.label)
                          setSelectedLocationCoords(nextCoords)
                          setIsLocationDropdownOpen(false)
                          setLocationSearchQuery('')
                          loadJobs(search, 1, sortBy, rankingMode, {
                            location: {
                              value: location.value,
                              label: location.label,
                              coords: nextCoords,
                            },
                          })
                        }}
                      >
                        <div className="location-item-label">{location.label}</div>
                        <div className="location-item-description">
                          {location.description || location.displayLabel || location.region}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="location-item-empty">No locations match your search</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <details 
            className="source-menu advanced-settings-menu" 
            ref={advancedSettingsMenuRef}
            onToggle={(e) => {
              if (e.currentTarget.open && scoreWeightsMenuRef.current) {
                scoreWeightsMenuRef.current.open = true
              }
            }}
          >
            <summary>
              Advanced settings
            </summary>
            <div className="source-options advanced-settings-options" aria-label="Advanced search settings">
              <button className="advanced-settings-close-btn" onClick={closeAdvancedSettings} aria-label="Close advanced settings">
                ✕
              </button>
              <div className="advanced-settings-grid">
                <select value={sortBy} onChange={handleSortChange} aria-label="Sort jobs">
                  <option value="total">Sort: Total</option>
                  <option value="resume">Sort: Resume</option>
                  <option value="impact">Sort: Impact</option>
                  <option value="bay">Sort: Bay Area</option>
                  <option value="fresh">Sort: Fresh</option>
                </select>
                <select value={rankingMode} onChange={handleRankingModeChange} aria-label="Ranking method">
                  <option value="ultra">Ranking: Ultra (Most Sophisticated)</option>
                  <option value="hybrid">Ranking: Hybrid (New)</option>
                  <option value="classic">Ranking: Classic (Previous)</option>
                </select>
                <select value={impactMode} onChange={handleImpactModeChange} aria-label="Impact calculation">
                  <option value="classic">Impact: Classic</option>
                  <option value="ultra">Impact: Ultra (Most Sophisticated)</option>
                  <option value="social">Impact: Social (Health/Education/Mental Health)</option>
                </select>
                <label className="toggle-label advanced-toggle-label">
                  <input
                    type="checkbox"
                    checked={usOnly}
                    onChange={(e) => {
                      const val = e.target.checked
                      setUsOnly(val)
                      loadJobs(search, 1, sortBy, rankingMode, {}, resumeId, impactMode, val)
                    }}
                  />
                  US only
                </label>
                <select value={bookmarkFilter} onChange={(e) => handleBookmarkFilter(e.target.value)} aria-label="Bookmark filter">
                  <option value="all">Bookmarks: Show all</option>
                  <option value="bookmarked-only">Bookmarks: Show only bookmarked</option>
                  <option value="hide-bookmarked">Bookmarks: Hide bookmarked</option>
                </select>
                <select value={endProductCategory} onChange={(e) => handleEndProductCategoryChange(e.target.value)} aria-label="End product filter">
                  <option value="all">End Product: All</option>
                  {availableEndProductCategories.map((category) => (
                    <option key={category} value={category}>
                      {formatEndProductCategory(category)} ({endProductCounts[category] ?? 0})
                    </option>
                  ))}
                </select>
              </div>

              <details className="source-menu score-weights-menu advanced-nested-menu" ref={scoreWeightsMenuRef}>
                <summary>
                  Score Weights ({scoreWeights.resume}/{scoreWeights.impact}/{scoreWeights.bay}/{scoreWeights.fresh}/{scoreWeights.audit})
                </summary>
                <div className="source-options score-weights-options" aria-label="Score weight sliders">
                  <div className="score-sliders">
                    <p className="score-sliders-title">Score Weights</p>
                    <label className="score-slider-row">
                      <span>Resume</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={scoreWeights.resume}
                        onChange={(e) => handleScoreWeightChange('resume', e.target.value)}
                      />
                      <strong>{scoreWeights.resume}</strong>
                    </label>
                    <label className="score-slider-row">
                      <span>Impact</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={scoreWeights.impact}
                        onChange={(e) => handleScoreWeightChange('impact', e.target.value)}
                      />
                      <strong>{scoreWeights.impact}</strong>
                    </label>
                    <label className="score-slider-row">
                      <span>Location nearby</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={scoreWeights.bay}
                        onChange={(e) => handleScoreWeightChange('bay', e.target.value)}
                      />
                      <strong>{scoreWeights.bay}</strong>
                    </label>
                    <label className="score-slider-row">
                      <span>Fresh</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={scoreWeights.fresh}
                        onChange={(e) => handleScoreWeightChange('fresh', e.target.value)}
                      />
                      <strong>{scoreWeights.fresh}</strong>
                    </label>
                    <label className="score-slider-row">
                      <span>Audit</span>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={scoreWeights.audit}
                        onChange={(e) => handleScoreWeightChange('audit', e.target.value)}
                      />
                      <strong>{scoreWeights.audit}</strong>
                    </label>
                  </div>
                </div>
              </details>

              <div className="advanced-filters-row">
                <details className="source-menu advanced-nested-menu">
                  <summary>
                    Sources ({selectedSources === null ? availableSources.length : selectedSources.length}/{availableSources.length || 0})
                  </summary>
                  <div className="source-options">
                    {availableSources.length > 0 && (
                      <button
                        type="button"
                        className="select-all-btn"
                        onClick={() => {
                          const allSelected = selectedSources === null || selectedSources.length === availableSources.length
                          const next = allSelected ? [] : [...availableSources]
                          setSelectedSources(next)
                          loadJobs(search, 1, sortBy, rankingMode, { sources: next })
                        }}
                      >
                        {selectedSources === null || selectedSources.length === availableSources.length ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                    {availableSources.length === 0 ? (
                      <p className="source-empty">No sources in this page yet</p>
                    ) : (
                      availableSources.map((source) => (
                        <label key={source} className="source-option">
                          <input
                            type="checkbox"
                            checked={selectedSources === null ? true : selectedSources.includes(source)}
                            onChange={() => toggleSource(source)}
                          />
                          {sourceLabel(source)}
                        </label>
                      ))
                    )}
                  </div>
                </details>

                <details className="source-menu advanced-nested-menu">
                  <summary>
                    Job types ({selectedJobTypes === null ? availableJobTypes.length : selectedJobTypes.length}/{availableJobTypes.length || 0})
                  </summary>
                  <div className="source-options">
                    {availableJobTypes.length > 0 && (
                      <button
                        type="button"
                        className="select-all-btn"
                        onClick={() => {
                          const allSelected = selectedJobTypes === null || selectedJobTypes.length === availableJobTypes.length
                          const next = allSelected ? [] : [...availableJobTypes]
                          setSelectedJobTypes(next)
                          loadJobs(search, 1, sortBy, rankingMode, { jobTypes: next })
                        }}
                      >
                        {selectedJobTypes === null || selectedJobTypes.length === availableJobTypes.length ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                    {availableJobTypes.length === 0 ? (
                      <p className="source-empty">No job types in this page yet</p>
                    ) : (
                      availableJobTypes.map((jobType) => (
                        <label key={jobType} className="source-option">
                          <input
                            type="checkbox"
                            checked={selectedJobTypes === null ? true : selectedJobTypes.includes(jobType)}
                            onChange={() => toggleJobType(jobType)}
                          />
                          {formatJobType(jobType)}
                        </label>
                      ))
                    )}
                  </div>
                </details>

                <details className="source-menu advanced-nested-menu">
                  <summary>
                    Job fields ({selectedJobFields === null ? availableJobFields.length : selectedJobFields.length}/{availableJobFields.length || 0})
                  </summary>
                  <div className="source-options">
                    {availableJobFields.length > 0 && (
                      <button
                        type="button"
                        className="select-all-btn"
                        onClick={() => {
                          const allSelected = selectedJobFields === null || selectedJobFields.length === availableJobFields.length
                          const next = allSelected ? [] : [...availableJobFields]
                          setSelectedJobFields(next)
                          loadJobs(search, 1, sortBy, rankingMode, { jobFields: next })
                        }}
                      >
                        {selectedJobFields === null || selectedJobFields.length === availableJobFields.length ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                    {availableJobFields.length === 0 ? (
                      <p className="source-empty">No job fields in this page yet</p>
                    ) : (
                      availableJobFields.map((jobField) => (
                        <label key={jobField} className="source-option">
                          <input
                            type="checkbox"
                            checked={selectedJobFields === null ? true : selectedJobFields.includes(jobField)}
                            onChange={() => toggleJobField(jobField)}
                          />
                          {formatJobField(jobField)}
                        </label>
                      ))
                    )}
                  </div>
                </details>

                <details className="source-menu advanced-nested-menu">
                  <summary>
                    Company size ({selectedCompanySizes === null ? availableCompanySizes.length : selectedCompanySizes.length}/{availableCompanySizes.length || 0})
                  </summary>
                  <div className="source-options">
                    {availableCompanySizes.length > 0 && (
                      <button
                        type="button"
                        className="select-all-btn"
                        onClick={() => {
                          const allSelected = selectedCompanySizes === null || selectedCompanySizes.length === availableCompanySizes.length
                          const next = allSelected ? [] : [...availableCompanySizes]
                          setSelectedCompanySizes(next)
                          loadJobs(search, 1, sortBy, rankingMode, { companySizes: next })
                        }}
                      >
                        {selectedCompanySizes === null || selectedCompanySizes.length === availableCompanySizes.length ? 'Deselect all' : 'Select all'}
                      </button>
                    )}
                    {availableCompanySizes.length === 0 ? (
                      <p className="source-empty">No company sizes yet</p>
                    ) : (
                      availableCompanySizes.map((size) => (
                        <label key={size} className="source-option">
                          <input
                            type="checkbox"
                            checked={selectedCompanySizes === null ? true : selectedCompanySizes.includes(size)}
                            onChange={() => toggleCompanySize(size)}
                          />
                          {COMPANY_SIZE_LABELS[size] || size}{' '}
                          <span className="source-count">({companySizeCounts[size] ?? 0})</span>
                        </label>
                      ))
                    )}
                  </div>
                </details>
              </div>
            </div>
          </details>
        </div>
      </form>

      <div className="pager">
        <button type="button" className="ghost arrow" onClick={handlePrevPage} disabled={isLoading || currentPage <= 1}>
          ←
        </button>
        <input
          type="number"
          className="page-input"
          min="1"
          max={totalPages}
          value={pageInputValue}
          onChange={handlePageInputChange}
          onKeyDown={handlePageInputKeyDown}
          onBlur={() => setPageInputValue(String(currentPage))}
          aria-label="Current page"
          disabled={isLoading}
        />
        <span className="pager-info">
          <span className="pager-total">of {totalPages}</span>
          {filteredAvailable ? <span className="pager-matches">{filteredAvailable.toLocaleString()} matches</span> : null}
        </span>
        <button type="button" className="ghost arrow" onClick={handleNextPage} disabled={isLoading || currentPage >= totalPages}>
          →
        </button>
      </div>

      <p className="updated-at">
        Last sync: {lastUpdated ? new Date(lastUpdated).toLocaleString() : 'Pending'}
        {' · '}
        <strong>{cacheMeta.stale ? 'Stale cache' : cacheMeta.fromCache ? 'Cached' : 'Fresh'}</strong>
      </p>

      {isLoading ? (
        <div className="status loading-status" aria-live="polite">
          <div className="loading-status-header">
            <strong>{loadingProgress.title}</strong>
            <span>{Number(loadingProgress.percent || 0).toFixed(1)}%</span>
          </div>
          <div
            className="loading-progress-track"
            role="progressbar"
            aria-label={loadingProgress.title}
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={Math.round(Number(loadingProgress.percent || 0))}
          >
            <div className="loading-progress-fill" style={{ width: `${loadingProgress.percent}%` }} />
          </div>
          <p className="loading-status-detail">{loadingProgress.detail}</p>
          {loadingProgress.stepPercent != null ? (
            <div className="loading-step-progress" aria-label="Current step progress">
              <div className="loading-step-progress-header">
                <strong>
                  Step progress: {Math.round(loadingProgress.stepProcessed || 0)} / {Math.round(loadingProgress.stepTotal || 0)} jobs
                </strong>
                <span>{Number(loadingProgress.stepPercent).toFixed(1)}%</span>
              </div>
              <div className="loading-progress-track loading-step-progress-track">
                <div className="loading-progress-fill" style={{ width: `${Math.max(0, Math.min(100, loadingProgress.stepPercent))}%` }} />
              </div>
            </div>
          ) : null}
          {Array.isArray(loadingProgress.substeps) && loadingProgress.substeps.length > 0 ? (
            <div className="loading-substeps" aria-label="Current backend substeps">
              {loadingProgress.substeps.map((step) => (
                <div
                  key={step}
                  className={`loading-substep${loadingProgress.activeSubstep === step ? ' active' : ''}${Array.isArray(loadingProgress.checklist) && loadingProgress.checklist.find((item) => item.label === step)?.status === 'done' ? ' done' : ''}`}
                >
                  <span className="loading-substep-dot" aria-hidden="true" />
                  <span>{step}</span>
                </div>
              ))}
            </div>
          ) : null}
          <p className="loading-status-note">
            Most of the wait is spent scoring each job against the selected resume and then applying ranking or rerank steps.
            If Ultra mode is on, a local rerank pass can add extra time.
          </p>
        </div>
      ) : null}
      {error ? <p className="status error">{error}</p> : null}

      {!isLoading && !error ? (
        <>
          <section className="jobs-grid" aria-live="polite">
          {visibleJobs.length === 0 ? (
            <div className="status">
              <strong>No roles match your current filters.</strong>
              <p style={{margin:'0.4rem 0 0', fontSize:'0.9rem'}}>
                We ingested {totalAvailable ?? '?'} total jobs and found {sweAvailable ?? 0} searchable
                roles. Try widening Source/US/Search filters or refresh to pull a newer snapshot.
              </p>
            </div>
          ) : (
            visibleJobs.map((job) => (
              <article 
                className="job-card" 
                key={job.id}
                onClick={() => { window.open(job.url, '_blank') }}
                style={{ cursor: 'pointer' }}
              >
                <div className="job-card-copy">
                  <div className="job-title-row">
                    <h2>{job.title}</h2>
                    <div className="job-menu-container" onClick={(e) => e.stopPropagation()}>
                      <details 
                        className="job-menu"
                        open={openJobMenuId === job.id}
                        onToggle={(e) => {
                          if (e.currentTarget.open) {
                            if (openJobMenuId !== job.id) {
                              closeAllDropdowns()
                              setOpenJobMenuId(job.id)
                            }
                          } else {
                            setOpenJobMenuId(null)
                          }
                        }}
                      >
                        <summary>⋮</summary>
                        <div className="job-menu-items">
                          <button
                            type="button"
                            className="job-menu-btn"
                            onClick={() => handleBookmarkJob(job.id)}
                          >
                            {bookmarkedJobs.has(job.id) ? '★ Unbookmark this job' : '☆ Bookmark this job'}
                          </button>
                          <button
                            type="button"
                            className="job-menu-btn"
                            onClick={() => handleBookmarkCompany(job.company)}
                          >
                            ★ Bookmark all from {job.company.split(' ')[0]}
                          </button>
                          <button
                            type="button"
                            className="job-menu-btn"
                            onClick={() => handleHideJob(job.id)}
                          >
                            {hiddenJobs.has(job.id) ? '✓ Unhide this job' : '✗ Hide this job'}
                          </button>
                          <button
                            type="button"
                            className="job-menu-btn"
                            onClick={() => handleHideCompany(job.company)}
                          >
                            ✗ Hide all from {job.company.split(' ')[0]}
                          </button>
                        </div>
                      </details>
                    </div>
                  </div>
                  <p className="company">{job.company}</p>
                  <div className="job-meta-grid">
                    <div className="job-meta-item">
                      <span className="job-meta-label">Location:</span>
                      <span className="job-meta-value">{job.locations.join(' · ') || 'Location not listed'}</span>
                    </div>
                    <div className="job-meta-item">
                      <span className="job-meta-label">Remote:</span>
                      <span className="job-meta-value">
                        {job.remotePreferences.join(' · ') || 'Remote preference not listed'}
                      </span>
                    </div>
                    <div className="job-meta-item">
                      <span className="job-meta-label">Type:</span>
                      <span className="job-meta-value">{job.jobTypes.join(' · ') || 'Type not listed'}</span>
                    </div>
                    <div className="job-meta-item">
                      <span className="job-meta-label">Source:</span>
                      <span className="job-meta-value">{sourceLabel(String(job.source || 'climatebase').toLowerCase())}</span>
                    </div>
                    {job.datePosted ? (
                      <div className="job-meta-item job-meta-item-wide">
                        <span className="job-meta-label">Posted:</span>
                        <span className="job-meta-value">{new Date(job.datePosted).toLocaleDateString()}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
                {/* Sub-score row */}
                <div className="sub-scores">
                  <div className="sub-score total-score total-sub-score" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="total-score-button"
                      title="Composite score (resume · impact · location · freshness · audit, slider-weighted). Click to view breakdown."
                      onClick={(e) => { 
                        e.stopPropagation()
                        if (openTotalScoreJobId === job.id) {
                          setOpenTotalScoreJobId(null)
                        } else {
                          closeAllDropdowns()
                          setOpenTotalScoreJobId(job.id)
                        }
                      }}
                    >
                      <span className="sub-label">Total</span>
                      <span className="sub-val total">{job.score ?? '–'}</span>
                    </button>
                    {openTotalScoreJobId === job.id ? (() => {
                      const values = {
                        resume: Number(job.resumeScore ?? 0),
                        impact: Number(job.impactScore ?? 0),
                        location: Number(job.bayScore ?? 0),
                        fresh: Number(job.freshnessScore ?? 0),
                        audit: Number(job.auditScore ?? 0),
                      }
                      const weights = {
                        resume: Number(scoreWeights.resume ?? 0),
                        impact: Number(scoreWeights.impact ?? 0),
                        location: Number(scoreWeights.bay ?? 0),
                        fresh: Number(scoreWeights.fresh ?? 0),
                        audit: Number(scoreWeights.audit ?? 0),
                      }
                      const totalWeight = Object.values(weights).reduce((sum, v) => sum + v, 0) || 1
                      const contribution = (scoreKey) => Math.round((values[scoreKey] * weights[scoreKey]) / totalWeight)

                      return (
                        <div className="total-score-popover">
                          <p className="total-score-popover-title">Total Score Breakdown</p>
                          <p className="total-score-popover-text">
                            Final total: <strong>{job.score ?? '–'}</strong>
                          </p>
                          <p className="total-score-popover-text">Weighted components:</p>
                          <ul className="total-score-popover-list">
                            <li>Resume: {values.resume} × {weights.resume}% → ~{contribution('resume')}</li>
                            <li>Impact: {values.impact} × {weights.impact}% → ~{contribution('impact')}</li>
                            <li>Location: {values.location} × {weights.location}% → ~{contribution('location')}</li>
                            <li>Fresh: {values.fresh} × {weights.fresh}% → ~{contribution('fresh')}</li>
                            <li>Audit: {values.audit} × {weights.audit}% → ~{contribution('audit')}</li>
                          </ul>
                          <p className="total-score-popover-text">
                            Formula: total = (resume×{weights.resume} + impact×{weights.impact} + location×{weights.location} + fresh×{weights.fresh} + audit×{weights.audit}) / {totalWeight}
                          </p>
                        </div>
                      )
                    })() : null}
                  </div>
                  <div className="sub-score resume-sub-score" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="resume-score-button"
                      title="Show resume score keyword match details"
                      onClick={(e) => { 
                        e.stopPropagation()
                        if (openResumeScoreJobId === job.id) {
                          setOpenResumeScoreJobId(null)
                        } else {
                          closeAllDropdowns()
                          setOpenResumeScoreJobId(job.id)
                        }
                      }}
                    >
                      <span className="sub-label">Resume</span>
                      <span className="sub-val">{job.resumeScore ?? '–'}</span>
                    </button>
                    {openResumeScoreJobId === job.id ? (
                      <div className="resume-score-popover">
                        <p className="resume-score-popover-title">Resume Score Breakdown</p>
                        <p className="resume-score-popover-text">
                          Resume score: <strong>{job.resumeScore ?? '–'}</strong>
                          {' · '}
                          Matched keywords: <strong>{job.resumeKeywordBreakdown?.matchedCount ?? 0}</strong>
                        </p>
                        {Array.isArray(job.resumeKeywordBreakdown?.keywords) && job.resumeKeywordBreakdown.keywords.length > 0 ? (
                          <div className="resume-score-keyword-list">
                            {job.resumeKeywordBreakdown.keywords.map((item) => (
                              <div className="resume-score-keyword-item" key={`${job.id}-${item.term}`}>
                                <div className="resume-score-keyword-row">
                                  <span className="resume-score-keyword-term">{item.term}</span>
                                  <span className={`resume-score-strength strength-${String(item.strength || '').toLowerCase()}`}>
                                    {item.strength}
                                  </span>
                                </div>
                                <p className="resume-score-popover-text resume-score-keyword-meta">
                                  weight {item.weight}
                                  {Array.isArray(item.where) && item.where.length > 0
                                    ? ` · matched in ${item.where.join(', ')}`
                                    : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="resume-score-popover-text">No weighted keyword matches were detected for this job.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="sub-score impact-sub-score" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="impact-score-button"
                      title={`Impact: ${job.impactLabel}. Click for keyword/signal breakdown.`}
                      onClick={(e) => { 
                        e.stopPropagation()
                        if (openImpactScoreJobId === job.id) {
                          setOpenImpactScoreJobId(null)
                        } else {
                          closeAllDropdowns()
                          setOpenImpactScoreJobId(job.id)
                        }
                      }}
                    >
                      <span className="sub-label">Impact</span>
                      <span className="sub-val impact">{job.impactScore ?? '–'}</span>
                    </button>
                    {openImpactScoreJobId === job.id ? (
                      <div className="impact-score-popover">
                        <p className="impact-score-popover-title">Impact Score Breakdown</p>
                        <p className="impact-score-popover-text">
                          Impact score: <strong>{job.impactScore ?? '–'}</strong>
                          {' · '}
                          Label: <strong>{job.impactLabel || 'General'}</strong>
                          {' · '}
                          Matched signals: <strong>{job.impactKeywordBreakdown?.matchedCount ?? 0}</strong>
                        </p>
                        {Array.isArray(job.impactKeywordBreakdown?.notes) && job.impactKeywordBreakdown.notes.length > 0 ? (
                          <div className="impact-score-notes">
                            {job.impactKeywordBreakdown.notes.slice(0, 4).map((note) => (
                              <p key={`${job.id}-${note}`} className="impact-score-popover-text impact-score-note">{note}</p>
                            ))}
                          </div>
                        ) : null}
                        {Array.isArray(job.impactKeywordBreakdown?.keywords) && job.impactKeywordBreakdown.keywords.length > 0 ? (
                          <div className="impact-score-keyword-list">
                            {job.impactKeywordBreakdown.keywords.map((item) => (
                              <div className="impact-score-keyword-item" key={`${job.id}-${item.term}`}>
                                <div className="impact-score-keyword-row">
                                  <span className="impact-score-keyword-term">{item.term}</span>
                                  <span className={`impact-score-strength strength-${String(item.strength || '').toLowerCase()}`}>
                                    {item.strength}
                                  </span>
                                </div>
                                <p className="impact-score-popover-text impact-score-keyword-meta">
                                  {item.signal || 'signal'}
                                  {item.points != null ? ` · weight ${item.points}` : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="impact-score-popover-text">No impact keywords or signals were matched for this role.</p>
                        )}
                      </div>
                    ) : null}
                  </div>
                  <div className="sub-score location-sub-score" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="location-score-button"
                      title={`Location score: ${job.bayLabel || 'Distant/International'}. Click to view scoring details.`}
                      onClick={(e) => { 
                        e.stopPropagation()
                        if (openLocationScoreJobId === job.id) {
                          setOpenLocationScoreJobId(null)
                        } else {
                          closeAllDropdowns()
                          setOpenLocationScoreJobId(job.id)
                        }
                      }}
                    >
                      <span className="sub-label">Location</span>
                      <span className="sub-val bay">{job.bayScore ?? '–'}</span>
                    </button>
                    {openLocationScoreJobId === job.id ? (
                      <div className="location-score-popover">
                        <p className="location-score-popover-title">Location Score Breakdown</p>
                        <p className="location-score-popover-text">
                          Current target location: <strong>{selectedLocationLabel || 'Bay Area'}</strong>
                          {' · '}
                          Job location label: <strong>{job.bayLabel || 'Distant/International'}</strong>
                        </p>
                        <p className="location-score-popover-text">
                          Current location score: <strong>{job.bayScore ?? '–'}</strong>
                        </p>
                        <p className="location-score-popover-text">How this score is calculated:</p>
                        <ul className="location-score-popover-list">
                          <li>100: &lt;= 10 km</li>
                          <li>96: &lt;= 25 km (Bay Area preference, close to SF/SJ/Oakland)</li>
                          <li>90: &lt;= 50 km), 82 (&lt;= 100 km), 70 (&lt;= 250 km)</li>
                          <li>55: &lt;= 500 km, 40: &lt;= 1000 km, 25: &lt;= 2500 km, 10: &gt; 2500 km</li>
                          <li>Remote jobs keep at least 50. Hybrid jobs receive a small distance penalty.</li>
                          <li>If coordinates are unavailable, keyword-based fallback scoring is used.</li>
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="sub-score fresh-sub-score" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="fresh-score-button"
                      title={`Freshness: ${job.freshnessLabel || 'Unknown'}. Click to view scoring details.`}
                      onClick={(e) => { 
                        e.stopPropagation()
                        if (openFreshScoreJobId === job.id) {
                          setOpenFreshScoreJobId(null)
                        } else {
                          closeAllDropdowns()
                          setOpenFreshScoreJobId(job.id)
                        }
                      }}
                    >
                      <span className="sub-label">Fresh</span>
                      <span className="sub-val fresh">{job.freshnessScore ?? '–'}</span>
                    </button>
                    {openFreshScoreJobId === job.id ? (
                      <div className="fresh-score-popover">
                        <p className="fresh-score-popover-title">Freshness Score Breakdown</p>
                        <p className="fresh-score-popover-text">
                          Posted date: <strong>{job.datePosted ? new Date(job.datePosted).toLocaleDateString() : 'Unknown'}</strong>
                          {' · '}
                          Label: <strong>{job.freshnessLabel || 'Unknown'}</strong>
                        </p>
                        <p className="fresh-score-popover-text">
                          Current freshness score: <strong>{job.freshnessScore ?? '–'}</strong>
                        </p>
                        <p className="fresh-score-popover-text">How this score is calculated:</p>
                        <ul className="fresh-score-popover-list">
                          <li>100: Today (&lt; 24 hours)</li>
                          <li>82: This week (&lt; 7 days)</li>
                          <li>68: &lt; 2 weeks</li>
                          <li>50: This month (&lt; 30 days)</li>
                          <li>30: &gt; 30 days old or unknown post date</li>
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="sub-score audit-sub-score" style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="audit-button"
                      onClick={(e) => { 
                        e.stopPropagation()
                        if (openAuditJobId === job.id) {
                          setOpenAuditJobId(null)
                        } else {
                          closeAllDropdowns()
                          setOpenAuditJobId(job.id)
                        }
                      }}
                      title="Company audit score from external public sources. Click to view breakdown."
                    >
                      <span className="sub-label">Audit</span>
                      <span className="sub-val">{job.auditScore ?? companyAudits[job.company]?.overall ?? '–'}</span>
                    </button>
                    {openAuditJobId === job.id && (() => {
                      const audit = companyAudits[job.company]
                      const sourceLinks = Array.isArray(audit?.sourceLinks) ? audit.sourceLinks : []
                      const breakdownNotes = Array.isArray(audit?.scoreBreakdown?.notes) ? audit.scoreBreakdown.notes : []
                      const methodsUsed = Array.isArray(audit?.methodsUsed) ? audit.methodsUsed : []
                      const overallWeights = audit?.scoreBreakdown?.overallWeights || null
                      const categoryDetails = audit?.scoreBreakdown?.categoryDetails || null
                      const scoreComponents = job?.scoreComponents || null
                      const redditData = audit?.internetResearch?.reddit || null
                      const perplexityData = audit?.internetResearch?.perplexity || null
                      return (
                        <div className="audit-popover" ref={auditPopoverRef}>
                          <p className="audit-popover-title">Audit Breakdown</p>
                          {scoreComponents ? (
                            <p className="audit-popover-text">
                              Final score mix: Resume {scoreComponents.values?.resumeScore ?? '–'} · Impact {scoreComponents.values?.impactScore ?? '–'} · Bay {scoreComponents.values?.bayScore ?? '–'} · Fresh {scoreComponents.values?.freshnessScore ?? '–'} · Audit {scoreComponents.values?.auditScore ?? '–'}
                            </p>
                          ) : null}
                          {scoreComponents?.formula ? <p className="audit-popover-text">{scoreComponents.formula}</p> : null}
                          {overallWeights ? (
                            <p className="audit-popover-text">
                              Audit formula weights: Quality {Math.round(overallWeights.companyQuality * 100)}% · Financial {Math.round(overallWeights.financialHealth * 100)}% · Product {Math.round(overallWeights.productLegitimacy * 100)}% · Culture {Math.round(overallWeights.cultureQuality * 100)}%
                            </p>
                          ) : null}
                          {breakdownNotes.map((note) => (
                            <p className="audit-popover-text" key={note}>{note}</p>
                          ))}
                          {audit ? (
                            <p className="audit-popover-text">
                              Overall: {audit.overall}/100 · Quality {audit.companyQuality} · Financial {audit.financialHealth} · Product {audit.productLegitimacy} · Culture {audit.cultureQuality}
                            </p>
                          ) : null}
                          {categoryDetails ? (
                            <div className="audit-category-details">
                              {Object.entries(categoryDetails).map(([key, detail]) => (
                                <div className="audit-category" key={key}>
                                  <p className="audit-popover-text audit-category-title">
                                    {key}: {detail?.total ?? '–'}
                                  </p>
                                  {Array.isArray(detail?.explanation)
                                    ? detail.explanation.map((line) => (
                                      <p className="audit-popover-text audit-popover-subline" key={`${key}-${line}`}>{line}</p>
                                    ))
                                    : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {audit ? (
                            <p className="audit-popover-text">
                              Confidence: {audit.confidence} · Source coverage: {audit.sourceCoverage}
                            </p>
                          ) : null}
                          {methodsUsed.length > 0 ? (
                            <div className="audit-methods-used">
                              <p className="audit-popover-text audit-methods-title">Endpoint Methods Called:</p>
                              {methodsUsed.map((method, idx) => (
                                <p key={idx} className="audit-popover-text audit-method-item">
                                  {method.success ? '✓' : '✗'} {method.provider}: {method.endpoint}
                                </p>
                              ))}
                            </div>
                          ) : null}
                          {(redditData || perplexityData) ? (
                            <div className="audit-internet-research">
                              <p className="audit-popover-text audit-methods-title">Internet Research:</p>
                              {redditData ? (
                                <div className="audit-internet-source">
                                  <p className="audit-popover-text audit-internet-label">Reddit ({redditData.postsFound} posts found)</p>
                                  {redditData.topSubreddits?.length > 0 && (
                                    <p className="audit-popover-text audit-popover-subline">Subreddits: {redditData.topSubreddits.join(', ')}</p>
                                  )}
                                  <p className="audit-popover-text audit-popover-subline">
                                    <span className="audit-sentiment-pos">↑ {redditData.positiveMentions} positive</span>
                                    {' · '}
                                    <span className="audit-sentiment-neg">↓ {redditData.negativeMentions} negative</span>
                                  </p>
                                </div>
                              ) : null}
                              {perplexityData ? (
                                <div className="audit-internet-source">
                                  <p className="audit-popover-text audit-internet-label">
                                    Perplexity AI{perplexityData.glassdoorRating ? ` · Glassdoor ${perplexityData.glassdoorRating}/5` : ''}
                                    {perplexityData.glassdoorReviews ? ` (${perplexityData.glassdoorReviews} reviews)` : ''}
                                  </p>
                                  {perplexityData.employeeReviewSummary ? (
                                    <p className="audit-popover-text audit-popover-subline">{perplexityData.employeeReviewSummary}</p>
                                  ) : null}
                                  {Array.isArray(perplexityData.keyPositives) && perplexityData.keyPositives.length > 0 ? (
                                    <p className="audit-popover-text audit-popover-subline">
                                      <span className="audit-sentiment-pos">✓ {perplexityData.keyPositives.join(' · ')}</span>
                                    </p>
                                  ) : null}
                                  {Array.isArray(perplexityData.keyConcerns) && perplexityData.keyConcerns.length > 0 ? (
                                    <p className="audit-popover-text audit-popover-subline">
                                      <span className="audit-sentiment-neg">⚠ {perplexityData.keyConcerns.join(' · ')}</span>
                                    </p>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {sourceLinks.length > 0 ? (
                            <div className="audit-source-links">
                              {sourceLinks.map((source) => (
                                <a key={source.key} href={source.url} target="_blank" rel="noreferrer">
                                  {source.label}{source.available ? '' : ' (search)'}
                                </a>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )
                    })()}
                  </div>
                </div>

                {/* Category pills */}
                <div className="match-cats" onClick={(e) => e.stopPropagation()}>
                  {job.breakdown?.ai > 0 && <span className="match-cat ai">AI</span>}
                  {job.breakdown?.engineering > 0 && <span className="match-cat eng">Engineering</span>}
                  {job.breakdown?.climate > 0 && <span className="match-cat climate">Climate</span>}
                  {job.breakdown?.tech > 0 && <span className="match-cat tech">Tech</span>}
                  {job.impactLabel && job.impactLabel !== 'General' && (
                    <span className="match-cat impact-pill">{job.impactLabel}</span>
                  )}
                  {job.bayLabel && job.bayLabel !== 'Distant' && (
                    <span className="match-cat bay-pill">{job.bayLabel}</span>
                  )}
                  {job.freshnessLabel && job.freshnessLabel !== 'Older' && (
                    <span className="match-cat fresh-pill">{job.freshnessLabel}</span>
                  )}
                  <span className="end-product-badge" title={formatEndProductCategory(job.endProductCategory || 'other')}>
                    {formatEndProductBadge(job.endProductCategory || 'other')}
                  </span>
                </div>
              </article>
            ))
          )}
        </section>
          {scoreStats ? (
            <div className="score-distribution-widget">
              <div className="distribution-hero-label">Resume score distribution</div>
              <button
                className="distribution-button"
                onClick={() => setOpenDistributionModal(true)}
                title={`Score distribution: Avg ${scoreStats.mean}, Median ${scoreStats.median}`}
              >
                <div className="distribution-label">Distribution ({scoreStats.count} jobs)</div>
                <div className="distribution-chart-small">
                  {scoreStats.buckets.map((count, idx) => (
                    <div
                      key={idx}
                      className="distribution-bar-small"
                      style={{
                        height: `${scoreStats.maxBucketCount > 0 ? (count / scoreStats.maxBucketCount) * 100 : 0}%`,
                        backgroundColor: `hsl(${120 + (idx * 3)}, 70%, 50%)`,
                      }}
                      title={`${idx * 10}-${idx * 10 + 9}: ${count} jobs`}
                    />
                  ))}
                </div>
                <div className="distribution-stats-small">
                  Avg: {scoreStats.mean} | Med: {scoreStats.median}
                </div>
              </button>
            </div>
          ) : null}
          {openDistributionModal && scoreStats ? (
            <div className="distribution-modal-overlay" onClick={() => setOpenDistributionModal(false)}>
              <div className="distribution-modal" onClick={(e) => e.stopPropagation()}>
                <button
                  className="modal-close"
                  onClick={() => setOpenDistributionModal(false)}
                  aria-label="Close distribution modal"
                >
                  ✕
                </button>
                <h2>Score Distribution</h2>
                <div className="distribution-stats-row">
                  <div className="stat-item">
                    <div className="stat-label">Count</div>
                    <div className="stat-value">{scoreStats.count}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">Average</div>
                    <div className="stat-value">{scoreStats.mean}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">Median</div>
                    <div className="stat-value">{scoreStats.median}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">Min</div>
                    <div className="stat-value">{scoreStats.min}</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-label">Max</div>
                    <div className="stat-value">{scoreStats.max}</div>
                  </div>
                </div>
                <div className="distribution-chart-large">
                  <div className="chart-bars">
                    {scoreStats.buckets.map((count, idx) => (
                      <div key={idx} className="distribution-bar-container">
                        <div
                          className="distribution-bar-large"
                          style={{
                            height: `${scoreStats.maxBucketCount > 0 ? (count / scoreStats.maxBucketCount) * 300 : 0}px`,
                            backgroundColor: `hsl(${120 + (idx * 3)}, 70%, 50%)`,
                          }}
                        />
                        <div className="bar-label">{idx * 10}</div>
                        <div className="bar-count">{count}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <footer className="footer-note">
        Source: <a href={sourceUrl}>{sourceUrl}</a>
      </footer>

          {breakdownModalOpen ? (
            <div className="breakdown-modal" onClick={() => setBreakdownModalOpen(false)}>
              <div className="breakdown-modal-content" onClick={(e) => e.stopPropagation()}>
                <button className="breakdown-modal-close" onClick={() => setBreakdownModalOpen(false)}>✕</button>
                {breakdownLoading ? (
                  <div className="breakdown-section">
                    <h3>Loading resume breakdown...</h3>
                    <p className="scoring-note">Building keyword weights, facets, anchors, and signals for this resume.</p>
                  </div>
                ) : null}

                {!breakdownLoading && breakdownError ? (
                  <div className="breakdown-section">
                    <h3>Resume breakdown unavailable</h3>
                    <p className="scoring-note">{breakdownError}</p>
                  </div>
                ) : null}

                {!breakdownLoading && !breakdownError && breakdownData ? (
                  <>
                    <h2>{breakdownData.resumeName}</h2>
                    <p style={{ fontSize: '0.9rem', color: 'var(--text-soft)', marginBottom: '1.5rem' }}>
                      {breakdownData.resumeSource} • Created {new Date(breakdownData.createdAt).toLocaleDateString()}
                    </p>

                    <div className="breakdown-section">
                      <h3>AI / Weights / Keywords</h3>
                      <div className="scoring-note" style={{ marginTop: 0 }}>
                        <strong>AI:</strong> {breakdownData.breakdown.aiSummary}
                      </div>
                      <div className="scoring-note">
                        <strong>Weights:</strong> {breakdownData.breakdown.scoringMethod}
                      </div>
                    </div>

                    <div className="breakdown-section">
                      <h3>Resume Core</h3>
                      <div className="extracted-text-box">
                        {breakdownData.breakdown.extractedText}...
                      </div>
                    </div>

                    <div className="breakdown-section">
                      <h3>Top Weighted Keywords</h3>
                      <div className="keywords-grid">
                        {breakdownData.breakdown.topKeywords.map((kw) => (
                          <div key={kw.term} className="keyword-tag">
                            <div>{kw.term}</div>
                            <div className="keyword-weight">{kw.weight}</div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {breakdownData.breakdown.skills.length > 0 ? (
                      <div className="breakdown-section">
                        <h3>Extracted Skills</h3>
                        <div className="keywords-grid">
                          {breakdownData.breakdown.skills.map((skill) => (
                            <div key={skill} className="keyword-tag" style={{ background: 'rgba(100, 170, 200, 0.15)', borderColor: 'rgba(100, 170, 200, 0.3)' }}>
                              {skill}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {breakdownData.breakdown.facets.length > 0 ? (
                      <div className="breakdown-section">
                        <h3>Keywords by Facet</h3>
                        <div className="facets-list">
                          {breakdownData.breakdown.facets.map((facet) => (
                            <div key={facet.facet} className="facet-item">
                              <div className="facet-name">{facet.facet}</div>
                              <div className="facet-keywords">
                                {facet.keywords.map((kw) => (
                                  <div key={kw} className="facet-keyword">{kw}</div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {breakdownData.breakdown.anchors.length > 0 ? (
                      <div className="breakdown-section">
                        <h3>Anchor Phrases</h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.6rem' }}>
                          {breakdownData.breakdown.anchors.map((anchor) => (
                            <div key={anchor} className="keyword-tag" style={{ background: 'rgba(150, 150, 200, 0.15)', borderColor: 'rgba(150, 150, 200, 0.3)' }}>
                              {anchor}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {breakdownData.breakdown.signalPhrases.length > 0 ? (
                      <div className="breakdown-section">
                        <h3>High-Impact Phrases</h3>
                        <div className="phrases-list">
                          {breakdownData.breakdown.signalPhrases.map((signal) => (
                            <div key={signal.phrase} className="phrase-item">
                              <span className="phrase-text">{signal.phrase}</span>
                              <span className="phrase-impact">Impact: {signal.impact}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {!breakdownLoading && !breakdownError && !breakdownData ? (
                  <div className="breakdown-section">
                    <h3>Resume breakdown unavailable</h3>
                    <p className="scoring-note">No breakdown data was returned for this resume.</p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
      </>
      ) : null}
    </div>
  )
}

export default App
