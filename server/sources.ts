// Job sources for the server — same behaviour as the desktop app (src/main/sources/jobApi.ts + boards.ts):
// JSearch, Adzuna, Jooble (keys), Remotive (remote only), company career boards (Greenhouse/Lever/Ashby/SmartRecruiters).
import type { AppSettings, Job, Profile } from '../src/shared/types'
import { secret } from './ctx'
import { kvGet, kvSet, listProfiles, makeJob } from './store'

export class SourceNotConfigured extends Error {}

type Q = { title: string; location: string }
type Log = (s: string) => void

const strip = (h: string): string =>
  (h || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim()

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(25_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const titlesOf = (p: Profile): string[] => (p.prefs.target_titles.length ? p.prefs.target_titles : p.profile?.suggested_search_titles ?? [])

// ---------------------------------------------------------------- relevance filter for whole-company boards

const STOP = new Set(['senior', 'junior', 'lead', 'principal', 'staff', 'consultant', 'specialist', 'manager', 'engineer', 'analyst', 'associate', 'and', 'the', 'for', 'with', 'sr', 'jr', 'ii', 'iii'])
function titleWords(p: Profile): string[] {
  const skills = (p.profile?.tools_and_modules ?? []).slice(0, 10)
  const words = [...titlesOf(p), ...skills].join(' ').toLowerCase().split(/[^a-z0-9+#/]+/).filter((w) => w.length >= 2 && !STOP.has(w))
  return [...new Set(words)]
}
const relevant = (title: string, words: string[]): boolean => {
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9+#/]+/g, ' ')} `
  return words.some((w) => t.includes(` ${w} `))
}

// ---------------------------------------------------------------- search APIs

function queries(p: Profile, max: number, offset = 0): Q[] {
  const titles = titlesOf(p)
  const locs = p.prefs.locations.length ? p.prefs.locations : ['India']
  const out: Q[] = []
  for (const t of titles) for (const l of locs) out.push({ title: t, location: l })
  if (p.prefs.remote_ok && titles[0]) out.splice(locs.length, 0, { title: titles[0], location: 'Remote' })
  if (!out.length) return []
  const start = offset % out.length
  return [...out.slice(start), ...out.slice(0, start)].slice(0, Math.min(max, out.length))
}

function lpa(min?: number | null, max?: number | null, currency?: string, period?: string): string {
  if (!min && !max) return ''
  const mult = period === 'MONTH' ? 12 : period === 'HOUR' ? 2000 : 1
  const f = (n?: number | null): string => (n ? (currency === 'INR' || !currency ? `${Math.round((n * mult) / 100000)}` : `${Math.round(n * mult)}`) : '?')
  return currency && currency !== 'INR' ? `${currency} ${f(min)}–${f(max)}/yr` : `${f(min)}–${f(max)} LPA`
}

const JSEARCH_PATHS = ['/search', '/search-v2', '/v2/search', '/search-jobs', '/job-search']
let jsearchPath: string | null = null

async function jsearchGet(params: URLSearchParams, key: string): Promise<any> {
  const paths = jsearchPath ? [jsearchPath] : JSEARCH_PATHS
  let last = ''
  for (const path of paths) {
    const r = await fetch(`https://jsearch.p.rapidapi.com${path}?${params}`, {
      headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
      signal: AbortSignal.timeout(30_000)
    })
    const text = await r.text()
    if (r.status === 404 && /does not exist/i.test(text)) {
      last = text
      continue
    }
    if (r.status === 401 || r.status === 403)
      throw new SourceNotConfigured(`JSearch rejected the key (HTTP ${r.status}): ${text.slice(0, 160)}. Make sure you subscribed to the free Basic plan.`)
    if (r.status === 429) throw new Error('JSearch quota/rate limit reached (HTTP 429)')
    if (!r.ok) throw new Error(`JSearch HTTP ${r.status}: ${text.slice(0, 200)}`)
    jsearchPath = path
    const month = new Date().toISOString().slice(0, 7)
    await kvSet(`quota:jsearch:${month}`, String(Number((await kvGet(`quota:jsearch:${month}`)) || 0) + 1))
    const lim = r.headers.get('x-ratelimit-requests-limit')
    const rem = r.headers.get('x-ratelimit-requests-remaining')
    if (lim) await kvSet('jsearch_limit', lim)
    if (rem) await kvSet('jsearch_remaining', rem)
    return JSON.parse(text)
  }
  throw new Error(`JSearch: no known search endpoint responded (${last.slice(0, 120)})`)
}

const jsearch = (key: string, s: AppSettings['jobApi']) => async (q: Q): Promise<Job[]> => {
  const params = new URLSearchParams({
    query: q.location === 'Remote' ? `${q.title} remote` : `${q.title} in ${q.location}`,
    page: '1', num_pages: '1', country: 'in', date_posted: s.datePosted
  })
  if (q.location === 'Remote') params.set('work_from_home', 'true')
  const body = await jsearchGet(params, key)
  const rows: any[] = Array.isArray(body.data) ? body.data : body.data?.jobs ?? body.jobs ?? []
  return rows.map((d: any) =>
    makeJob({
      title: d.job_title,
      company: d.employer_name,
      location: [d.job_city, d.job_state].filter(Boolean).join(', ') || d.job_location || (d.job_is_remote ? 'Remote' : d.job_country || ''),
      salary: lpa(d.job_min_salary, d.job_max_salary, d.job_salary_currency, d.job_salary_period),
      url: d.job_apply_link || d.job_google_link || '',
      description: d.job_description || '',
      source: `jsearch${d.job_publisher ? ':' + String(d.job_publisher).toLowerCase() : ''}`,
      posted_at: (d.job_posted_at_datetime_utc || '').slice(0, 10),
      external_id: d.job_id || ''
    })
  )
}

const adzuna = (id: string, key: string, s: AppSettings['jobApi']) => async (q: Q): Promise<Job[]> => {
  const url = new URL('https://api.adzuna.com/v1/api/jobs/in/search/1')
  url.searchParams.set('app_id', id)
  url.searchParams.set('app_key', key)
  url.searchParams.set('results_per_page', String(s.resultsPerQuery))
  url.searchParams.set('what', q.location === 'Remote' ? `${q.title} remote` : q.title)
  if (q.location !== 'Remote') url.searchParams.set('where', q.location)
  url.searchParams.set('max_days_old', String({ all: 60, today: 1, '3days': 3, week: 7, month: 30 }[s.datePosted]))
  url.searchParams.set('content-type', 'application/json')
  const r = await fetch(url, { signal: AbortSignal.timeout(25_000) })
  if (r.status === 401 || r.status === 403) throw new SourceNotConfigured(`Adzuna rejected the credentials (HTTP ${r.status})`)
  if (!r.ok) throw new Error(`Adzuna HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const body: any = await r.json()
  return (body.results ?? []).map((d: any) =>
    makeJob({
      title: d.title?.replace(/<[^>]+>/g, ''), company: d.company?.display_name || '', location: d.location?.display_name || '',
      salary: d.salary_is_predicted === '1' ? '' : lpa(d.salary_min, d.salary_max, 'INR', 'YEAR'),
      url: d.redirect_url || '', description: (d.description || '').replace(/<[^>]+>/g, ''), source: 'adzuna',
      posted_at: (d.created || '').slice(0, 10), external_id: String(d.id || '')
    })
  )
}

const JOOBLE_CITY: Record<string, string> = { bangalore: 'Bengaluru', bengaluru: 'Bengaluru', gurgaon: 'Gurugram', bombay: 'Mumbai', calcutta: 'Kolkata', madras: 'Chennai' }
async function joobleOnce(key: string, keywords: string, location: string): Promise<any[]> {
  const body = await getJson(`https://jooble.org/api/${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords, location, page: '1' })
  })
  return body.jobs ?? []
}
const jooble = (key: string) => async (q: Q): Promise<Job[]> => {
  let rows: any[]
  if (q.location === 'Remote') rows = await joobleOnce(key, `${q.title} remote`, 'India')
  else {
    const c = JOOBLE_CITY[q.location.toLowerCase()] ?? q.location
    rows = await joobleOnce(key, q.title, c)
    if (!rows.length) {
      const core = q.title.replace(/\b(senior|junior|lead|functional|consultant|specialist|analyst)\b/gi, ' ').replace(/\s+/g, ' ').trim()
      if (core && core !== q.title) rows = await joobleOnce(key, core, c)
    }
  }
  return rows.map((d: any) =>
    makeJob({
      title: strip(d.title || ''), company: d.company || '', location: d.location || '', salary: d.salary || '', url: d.link || '',
      description: strip(d.snippet || ''), source: `jooble${d.source ? ':' + String(d.source).toLowerCase() : ''}`,
      posted_at: (d.updated || '').slice(0, 10), external_id: String(d.id || '')
    })
  )
}

async function fetchRemotive(p: Profile, log: Log): Promise<Job[]> {
  if (!p.prefs.remote_ok) return []
  const term = titlesOf(p)[0]?.split(/\s+/).slice(0, 3).join(' ')
  if (!term) return []
  const body = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=50`)
  const words = titleWords(p)
  const rows = (body.jobs ?? []).filter((d: any) => relevant(d.title, words))
  log(`remotive: "${term}" → ${rows.length}`)
  return rows.map((d: any) =>
    makeJob({
      title: d.title, company: d.company_name, location: `Remote (${d.candidate_required_location || 'anywhere'})`, salary: d.salary || '',
      url: d.url, description: strip(d.description || ''), source: 'remotive', posted_at: (d.publication_date || '').slice(0, 10), external_id: String(d.id)
    })
  )
}

/** JSearch free plan is a monthly quota: spread what is left over the runs left this month. */
async function jsearchBudget(cap: number, schedule: AppSettings['schedule']): Promise<{ n: number; why: string }> {
  const month = new Date().toISOString().slice(0, 7)
  const limit = Number(await kvGet('jsearch_limit')) || 200
  const used = Number((await kvGet(`quota:jsearch:${month}`)) || 0)
  const reported = await kvGet('jsearch_remaining')
  const remaining = Math.max(0, reported != null ? Math.min(Number(reported), limit - used) : limit - used)
  const d = new Date()
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  let runs = 0
  for (let day = d.getDate(); day <= last; day++) {
    const wd = new Date(d.getFullYear(), d.getMonth(), day).getDay()
    if (!schedule.weekdaysOnly || (wd !== 0 && wd !== 6)) runs++
  }
  const people = Math.max(1, (await listProfiles(true)).filter((p) => p.prefs.sources.job_api).length)
  const fair = Math.floor(remaining / Math.max(1, runs * people))
  return { n: Math.max(remaining > 0 ? 1 : 0, Math.min(cap, fair)), why: `${remaining} of ${limit} left this month, ~${runs} runs to go` }
}

export async function fetchApis(p: Profile, s: AppSettings, log: Log): Promise<Job[]> {
  const all: Job[] = []
  const used: string[] = []
  const run = async (name: string, fn: (q: Q) => Promise<Job[]>, n: number): Promise<void> => {
    used.push(name)
    const ck = `qcursor:${name}:${p.id}`
    const offset = Number((await kvGet(ck)) || 0)
    await kvSet(ck, String(offset + n))
    for (const q of queries(p, n, offset)) {
      try {
        const got = await fn(q)
        log(`${name}: "${q.title}" / ${q.location} → ${got.length}`)
        all.push(...got)
      } catch (e: any) {
        if (e instanceof SourceNotConfigured) throw e
        log(`${name}: "${q.title}" / ${q.location} failed — ${e?.message ?? e}`)
        if (/429|quota/i.test(String(e?.message))) break
      }
    }
  }
  const rapid = await secret('RAPIDAPI_KEY')
  if (rapid) {
    const b = await jsearchBudget(s.jobApi.maxQueriesPerRun, s.schedule)
    log(`jsearch: ${b.n} searches this run (${b.why})`)
    if (b.n > 0) await run('jsearch', jsearch(rapid, s.jobApi), b.n)
  }
  const [azId, azKey] = [await secret('ADZUNA_APP_ID'), await secret('ADZUNA_APP_KEY')]
  if (azId && azKey) await run('adzuna', adzuna(azId, azKey, s.jobApi), s.jobApi.maxQueriesPerRun)
  const jk = await secret('JOOBLE_API_KEY')
  if (jk) await run('jooble', jooble(jk), s.jobApi.maxQueriesPerRun)
  try {
    const r = await fetchRemotive(p, log)
    if (r.length) used.push('remotive')
    all.push(...r)
  } catch (e: any) {
    log(`remotive failed — ${e?.message ?? e}`)
  }
  if (!used.length) throw new SourceNotConfigured('No job search API key yet. Add a free JSearch, Jooble or Adzuna key in Settings → Job sources.')
  return all
}

// ---------------------------------------------------------------- company boards

type Board = { ats: 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'; id: string }
function parseBoard(s: string): Board | null {
  const v = s.trim()
  const direct = v.match(/^(greenhouse|lever|ashby|smartrecruiters):([\w.%-]+)$/i)
  if (direct) return { ats: direct[1].toLowerCase() as Board['ats'], id: decodeURIComponent(direct[2]) }
  const rules: [Board['ats'], RegExp][] = [
    ['greenhouse', /greenhouse\.io\/(?:embed\/job_board\?for=)?([\w.-]+)/i],
    ['lever', /jobs\.lever\.co\/([\w.-]+)/i],
    ['ashby', /jobs\.ashbyhq\.com\/([\w.%-]+)/i],
    ['smartrecruiters', /(?:careers|jobs)\.smartrecruiters\.com\/([\w.-]+)/i]
  ]
  for (const [ats, re] of rules) {
    const m = v.match(re)
    if (m) return { ats, id: decodeURIComponent(m[1]) }
  }
  return null
}
const nice = (id: string): string => id.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

async function boardJobs(b: Board, words: string[], query: string): Promise<Job[]> {
  const out: Job[] = []
  if (b.ats === 'greenhouse') {
    const body = await getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(b.id)}/jobs?content=true`)
    for (const d of body.jobs ?? []) {
      if (!relevant(d.title, words)) continue
      out.push(makeJob({ title: d.title, company: d.company_name || nice(b.id), location: d.location?.name || '', url: d.absolute_url, description: strip(d.content || ''), source: 'board:greenhouse', posted_at: (d.updated_at || '').slice(0, 10), external_id: String(d.id) }))
    }
  } else if (b.ats === 'lever') {
    const rows = await getJson(`https://api.lever.co/v0/postings/${encodeURIComponent(b.id)}?mode=json`)
    for (const d of rows ?? []) {
      if (!relevant(d.text, words)) continue
      out.push(makeJob({ title: d.text, company: nice(b.id), location: d.categories?.location || (d.workplaceType === 'remote' ? 'Remote' : ''), url: d.hostedUrl, description: d.descriptionPlain || strip(d.description || ''), source: 'board:lever', posted_at: d.createdAt ? new Date(d.createdAt).toISOString().slice(0, 10) : '', external_id: d.id }))
    }
  } else if (b.ats === 'ashby') {
    const body = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(b.id)}`)
    for (const d of body.jobs ?? []) {
      if (!relevant(d.title, words)) continue
      out.push(makeJob({ title: d.title, company: nice(b.id), location: d.location || (d.isRemote ? 'Remote' : ''), url: d.jobUrl, description: d.descriptionPlain || '', source: 'board:ashby', posted_at: (d.publishedAt || '').slice(0, 10), external_id: d.id || d.jobUrl }))
    }
  } else {
    const body = await getJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(b.id)}/postings?limit=100&q=${encodeURIComponent(query)}`)
    for (const d of body.content ?? []) {
      if (!relevant(d.name, words)) continue
      const loc = [d.location?.city, d.location?.region].filter(Boolean).join(', ') || (d.location?.remote ? 'Remote' : '')
      out.push(makeJob({ title: d.name, company: d.company?.name || nice(b.id), location: loc, url: `https://jobs.smartrecruiters.com/${encodeURIComponent(b.id)}/${d.id}`, description: [d.department?.label, d.function?.label, d.experienceLevel?.label].filter(Boolean).join(' · '), source: 'board:smartrecruiters', posted_at: (d.releasedDate || '').slice(0, 10), external_id: d.id }))
    }
  }
  return out
}

export async function fetchBoards(p: Profile, log: Log): Promise<Job[]> {
  const words = titleWords(p)
  const query = (titlesOf(p)[0] || '').split(/\s+/).filter((w) => !STOP.has(w.toLowerCase())).slice(0, 2).join(' ')
  const all: Job[] = []
  for (const raw of p.prefs.watch_companies ?? []) {
    const b = parseBoard(raw)
    if (!b) {
      log(`careers: can't read "${raw}" — paste the company's Greenhouse, Lever, Ashby or SmartRecruiters jobs link`)
      continue
    }
    try {
      const got = await boardJobs(b, words, query)
      log(`careers: ${b.id} (${b.ats}) → ${got.length} matching openings`)
      all.push(...got)
    } catch (e: any) {
      log(`careers: ${b.id} (${b.ats}) failed: ${e?.message ?? e}`)
    }
  }
  return all
}
