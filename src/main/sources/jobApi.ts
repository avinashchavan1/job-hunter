// Job-search APIs that allow automated use: JSearch (RapidAPI) or Adzuna.
import { Job, Profile } from '../../shared/types'
import { kvGet, kvSet, listProfiles, makeJob } from '../db'
import { fetchRemotive, jooble } from './boards'
import { getSettings, secret } from '../settings'

import { SourceNotConfigured } from './errors'
export { SourceNotConfigured }

function queries(p: Profile, max: number, offset = 0): { title: string; location: string }[] {
  const titles = p.prefs.target_titles.length ? p.prefs.target_titles : p.profile?.suggested_search_titles ?? []
  const locs = p.prefs.locations.length ? p.prefs.locations : ['India']
  const out: { title: string; location: string }[] = []
  // interleave so a small cap still covers every city with the top titles
  for (const t of titles) for (const l of locs) out.push({ title: t, location: l })
  if (p.prefs.remote_ok && titles[0]) out.splice(locs.length, 0, { title: titles[0], location: 'Remote' })
  if (!out.length) return []
  // rotate: each run starts where the last one stopped, so over a few days every title × city is searched
  const start = offset % out.length
  return [...out.slice(start), ...out.slice(0, start)].slice(0, Math.min(max, out.length))
}

function lpa(min?: number | null, max?: number | null, currency?: string, period?: string): string {
  if (!min && !max) return ''
  const mult = period === 'MONTH' ? 12 : period === 'HOUR' ? 2000 : 1
  const f = (n?: number | null): string => (n ? (currency === 'INR' || !currency ? `${Math.round((n * mult) / 100000)}` : `${Math.round(n * mult)}`) : '?')
  return currency && currency !== 'INR' ? `${currency} ${f(min)}–${f(max)}/yr` : `${f(min)}–${f(max)} LPA`
}

// JSearch has renamed its search path before; try known variants and remember the one that works.
const JSEARCH_PATHS = ['/search', '/search-v2', '/v2/search', '/search-jobs', '/job-search']
let jsearchPath: string | null = null

async function jsearchGet(params: URLSearchParams, key: string): Promise<any> {
  const paths = jsearchPath ? [jsearchPath] : JSEARCH_PATHS
  let last = ''
  for (const p of paths) {
    const url = `https://jsearch.p.rapidapi.com${p}?${params}`
    const r = await fetch(url, { headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' } })
    const text = await r.text()
    if (r.status === 404 && /does not exist/i.test(text)) {
      last = text
      continue
    }
    if (r.status === 401 || r.status === 403)
      throw new SourceNotConfigured(`JSearch rejected the key (HTTP ${r.status}): ${text.slice(0, 160)}. Make sure you subscribed to the free Basic plan.`)
    if (r.status === 429) throw new Error('JSearch quota/rate limit reached (HTTP 429)')
    if (!r.ok) throw new Error(`JSearch HTTP ${r.status}: ${text.slice(0, 200)}`)
    jsearchPath = p
    // RapidAPI reports the plan quota on every response
    const month = new Date().toISOString().slice(0, 7)
    kvSet(`quota:jsearch:${month}`, String(Number(kvGet(`quota:jsearch:${month}`) || 0) + 1))
    const lim = r.headers.get('x-ratelimit-requests-limit')
    const rem = r.headers.get('x-ratelimit-requests-remaining')
    if (lim) kvSet('jsearch_limit', lim)
    if (rem) kvSet('jsearch_remaining', rem)
    return JSON.parse(text)
  }
  throw new Error(`JSearch: no known search endpoint responded (${last.slice(0, 120)})`)
}

async function jsearch(q: { title: string; location: string }): Promise<Job[]> {
  const key = secret('RAPIDAPI_KEY')
  if (!key) throw new SourceNotConfigured('RapidAPI key not set')
  const s = getSettings().jobApi
  const params = new URLSearchParams({
    query: q.location === 'Remote' ? `${q.title} remote` : `${q.title} in ${q.location}`,
    page: '1',
    num_pages: '1',
    country: 'in',
    date_posted: s.datePosted
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

async function adzuna(q: { title: string; location: string }): Promise<Job[]> {
  const id = secret('ADZUNA_APP_ID')
  const key = secret('ADZUNA_APP_KEY')
  if (!id || !key) throw new SourceNotConfigured('Adzuna app id/key not set')
  const s = getSettings().jobApi
  const url = new URL('https://api.adzuna.com/v1/api/jobs/in/search/1')
  url.searchParams.set('app_id', id)
  url.searchParams.set('app_key', key)
  url.searchParams.set('results_per_page', String(s.resultsPerQuery))
  url.searchParams.set('what', q.title)
  if (q.location !== 'Remote') url.searchParams.set('where', q.location)
  else url.searchParams.set('what', `${q.title} remote`)
  url.searchParams.set('max_days_old', String({ all: 60, today: 1, '3days': 3, week: 7, month: 30 }[s.datePosted]))
  url.searchParams.set('content-type', 'application/json')
  const r = await fetch(url)
  if (r.status === 401 || r.status === 403) throw new SourceNotConfigured(`Adzuna rejected the credentials (HTTP ${r.status})`)
  if (!r.ok) throw new Error(`Adzuna HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const body: any = await r.json()
  return (body.results ?? []).map((d: any) =>
    makeJob({
      title: d.title?.replace(/<[^>]+>/g, ''),
      company: d.company?.display_name || '',
      location: d.location?.display_name || '',
      salary: d.salary_is_predicted === '1' ? '' : lpa(d.salary_min, d.salary_max, 'INR', 'YEAR'),
      url: d.redirect_url || '',
      description: (d.description || '').replace(/<[^>]+>/g, ''),
      source: 'adzuna',
      posted_at: (d.created || '').slice(0, 10),
      external_id: String(d.id || '')
    })
  )
}

/** JSearch free plan is a monthly quota: spread what is left over the runs left this month. */
function jsearchBudget(cap: number): { n: number; why: string } {
  const month = new Date().toISOString().slice(0, 7)
  const limit = Number(kvGet('jsearch_limit')) || 200
  const used = Number(kvGet(`quota:jsearch:${month}`) || 0)
  const reported = kvGet('jsearch_remaining')
  const remaining = Math.max(0, reported != null ? Math.min(Number(reported), limit - used) : limit - used)
  const st = getSettings().schedule
  const d = new Date()
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  let runs = 0
  for (let day = d.getDate(); day <= last; day++) {
    const wd = new Date(d.getFullYear(), d.getMonth(), day).getDay()
    if (!st.weekdaysOnly || (wd !== 0 && wd !== 6)) runs++
  }
  const people = Math.max(1, listProfiles(true).filter((p) => p.prefs.sources.job_api).length)
  const fair = Math.floor(remaining / Math.max(1, runs * people))
  const n = Math.max(remaining > 0 ? 1 : 0, Math.min(cap, fair))
  return { n, why: `${remaining} of ${limit} left this month, ~${runs} runs to go` }
}

export async function fetchJobs(p: Profile, log: (s: string) => void): Promise<Job[]> {
  const s = getSettings().jobApi
  const all: Job[] = []
  const used: string[] = []
  const run = async (name: string, fn: (q: { title: string; location: string }) => Promise<Job[]>, n: number): Promise<void> => {
    used.push(name)
    const ck = `qcursor:${name}:${p.id}`
    const offset = Number(kvGet(ck) || 0)
    kvSet(ck, String(offset + n))
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
  // every API that has a key runs; duplicates collapse later (same title + company + city)
  if (secret('RAPIDAPI_KEY')) {
    const b = jsearchBudget(s.maxQueriesPerRun)
    log(`jsearch: ${b.n} searches this run (${b.why})`)
    if (b.n > 0) await run('jsearch', jsearch, b.n)
  }
  if (secret('ADZUNA_APP_ID') && secret('ADZUNA_APP_KEY')) await run('adzuna', adzuna, s.maxQueriesPerRun)
  if (secret('JOOBLE_API_KEY')) await run('jooble', jooble, s.maxQueriesPerRun)
  try {
    const r = await fetchRemotive(p, log)
    if (r.length) used.push('remotive')
    all.push(...r)
  } catch (e: any) {
    log(`remotive failed — ${e?.message ?? e}`)
  }
  if (!used.length) throw new SourceNotConfigured('No job search API key yet. Add a free JSearch, Adzuna or Jooble key in Settings → Job sources.')
  return all
}
