// Types shared by main, preload and renderer.

export type SourceKey = 'job_api' | 'careers' | 'gmail' | 'linkedin' | 'naukri'
export type Status = 'new' | 'shortlisted' | 'applied' | 'interview' | 'offer' | 'rejected' | 'skipped'
export const STATUSES: Status[] = ['new', 'shortlisted', 'applied', 'interview', 'offer', 'rejected', 'skipped']

export interface Job {
  id: string
  title: string
  company: string
  location: string
  salary: string
  url: string
  description: string
  source: string
  posted_at: string
  external_id: string
}

export interface ParsedProfile {
  name: string
  headline: string
  current_title: string
  years_experience: number
  current_location: string
  skills: string[]
  tools_and_modules: string[]
  domains: string[]
  past_titles: string[]
  suggested_search_titles: string[]
  seniority: string
  education: string
  highlights: string[]
  summary: string
}

/** Details an application form asks for. Stored only on this computer; never sent to the AI. */
export interface Contact {
  full_name: string
  email: string
  phone: string
  city: string
  linkedin_url: string
  portfolio_url: string
  current_company: string
  current_title: string
}
export const EMPTY_CONTACT: Contact = { full_name: '', email: '', phone: '', city: '', linkedin_url: '', portfolio_url: '', current_company: '', current_title: '' }

export interface Prefs {
  target_titles: string[]
  locations: string[]
  remote_ok: boolean
  years_experience: number
  years_min: number
  years_max: number
  min_salary_lpa: number
  drop_below_min_salary: boolean
  keep_unknown_salary: boolean
  exclude_companies: string[]
  exclude_keywords: string[]
  min_score: number
  sources: Record<SourceKey, boolean>
  answers: { label: string; value: string }[]
  contact: Contact
  /** Company career-board links to check every run (Greenhouse, Lever, Ashby, SmartRecruiters). */
  watch_companies: string[]
}

export const DEFAULT_PREFS: Prefs = {
  target_titles: [],
  locations: [],
  remote_ok: true,
  years_experience: 0,
  years_min: 0,
  years_max: 99,
  min_salary_lpa: 0,
  drop_below_min_salary: false,
  keep_unknown_salary: true,
  exclude_companies: [],
  exclude_keywords: [],
  min_score: 50,
  sources: { job_api: true, careers: true, gmail: false, linkedin: false, naukri: false },
  answers: [
    { label: 'Notice period', value: '' },
    { label: 'Current CTC', value: '' },
    { label: 'Expected CTC', value: '' },
    { label: 'Total experience', value: '' },
    { label: 'Preferred locations', value: '' },
    { label: 'Why are you looking for a change?', value: '' }
  ],
  contact: EMPTY_CONTACT,
  watch_companies: []
}

export interface Profile {
  id: number
  slug: string
  name: string
  resume_path: string | null
  profile: ParsedProfile | null
  prefs: Prefs
  active: boolean
  created_at: string
  gmail_email?: string | null
}

export interface Match extends Job {
  found_at: string
  sources: string
  filter_reason: string | null
  score: number | null
  reasons: string[]
  red_flags: string[]
  matched: string[]
  missing: string[]
  cover_note: string | null
  scored_at: string | null
  status: Status
  notes: string | null
  status_at: string | null
}

export interface ProfileStats {
  total: number
  filtered: number
  scored: number
  avg_score: number
  new_today: number
  unscored?: number
  by_status: Partial<Record<Status, number>>
  by_source: Record<string, number>
}

export interface RunAlert {
  level: 'info' | 'warn' | 'stop'
  source: string
  message: string
}

export interface Run {
  id: number
  profile_id: number
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'partial' | 'error'
  stats: Record<string, number>
  alerts: RunAlert[]
  log: string
}

export type LlmProvider = 'anthropic' | 'openai_compat'

export interface AppSettings {
  llm: { provider: LlmProvider; baseUrl: string; model: string; fallbackModels: string[]; concurrency: number }
  model: string
  effort: 'low' | 'medium' | 'high'
  jobApi: { provider: 'jsearch' | 'adzuna'; resultsPerQuery: number; maxQueriesPerRun: number; datePosted: 'all' | 'today' | '3days' | 'week' | 'month' }
  gmail: { lookbackDays: number; maxMessages: number }
  browser: { pagesPerSitePerDay: number; minDelayS: number; maxDelayS: number; showWindow: boolean }
  scoring: { maxJobsPerRun: number }
  schedule: { enabled: boolean; time: string; weekdaysOnly: boolean }
  autofill: { linkedin: boolean; aiAnswers: boolean }
  notify: boolean
  openAtLogin: boolean
}

export const SECRET_KEYS = [
  'ANTHROPIC_API_KEY',
  'LLM_API_KEY',
  'RAPIDAPI_KEY',
  'ADZUNA_APP_ID',
  'ADZUNA_APP_KEY',
  'JOOBLE_API_KEY',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET'
] as const
export type SecretKey = (typeof SECRET_KEYS)[number]

export interface RunProgress {
  profileId: number
  phase: string
  line: string
  running: boolean
}

export interface Tailored {
  headline: string
  summary: string
  skills: string[]
  experience: { title: string; company: string; dates: string; location: string; bullets: string[] }[]
  education: string[]
  certifications: string[]
  changes: string[]
  pdf: string
  created_at: string
}

export interface Prep {
  questions: { q: string; why: string; points: string[] }[]
  revise: string[]
  ask_them: string[]
  created_at: string
}
