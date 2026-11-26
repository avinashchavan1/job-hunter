// Free, official sources that need no account or only a free key:
//  - company career boards on Greenhouse / Lever / Ashby / SmartRecruiters (public posting APIs)
//  - Remotive (remote jobs, public API — asks for light use, so one request per run)
//  - Jooble (free API key, covers India)
import { Job, Profile } from '../../shared/types'
import { makeJob } from '../db'
import { secret } from '../settings'

const strip = (h: string): string =>
  (h || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim()

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers || {}) }, signal: AbortSignal.timeout(25_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ---------------------------------------------------------------- relevance filter for whole-company boards

const STOP = new Set(['senior', 'junior', 'lead', 'principal', 'staff', 'consultant', 'specialist', 'manager', 'engineer', 'analyst', 'associate', 'and', 'the', 'for', 'with', 'sr', 'jr', 'ii', 'iii'])
export function titleWords(p: Profile): string[] {
  const titles = p.prefs.target_titles.length ? p.prefs.target_titles : p.profile?.suggested_search_titles ?? []
  const skills = (p.profile?.tools_and_modules ?? []).slice(0, 10) // module/tool names only — generic skills like "Excel" match too much
  const words = [...titles, ...skills]
    .join(' ')
    .toLowerCase()
    .split(/[^a-z0-9+#/]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w))
  return [...new Set(words)]
}
const relevant = (title: string, words: string[]): boolean => {
  const t = ` ${title.toLowerCase().replace(/[^a-z0-9+#/]+/g, ' ')} `
  return words.some((w) => t.includes(` ${w} `))
}

// ---------------------------------------------------------------- company boards

export type Board = { ats: 'greenhouse' | 'lever' | 'ashby' | 'smartrecruiters'; id: string }

/** Accepts a careers URL (boards.greenhouse.io/x, jobs.lever.co/x, jobs.ashbyhq.com/x, careers.smartrecruiters.com/x) or "ats:id". */
export function parseBoard(s: string): Board | null {
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

export async function fetchBoards(p: Profile, log: (s: string) => void): Promise<Job[]> {
  const words = titleWords(p)
  const titles = p.prefs.target_titles.length ? p.prefs.target_titles : p.profile?.suggested_search_titles ?? []
  const query = (titles[0] || '').split(/\s+/).filter((w) => !STOP.has(w.toLowerCase())).slice(0, 2).join(' ')
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

// ---------------------------------------------------------------- Remotive (remote only)

export async function fetchRemotive(p: Profile, log: (s: string) => void): Promise<Job[]> {
  if (!p.prefs.remote_ok) return []
  const titles = p.prefs.target_titles.length ? p.prefs.target_titles : p.profile?.suggested_search_titles ?? []
  const term = titles[0]?.split(/\s+/).slice(0, 3).join(' ')
  if (!term) return []
  const body = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=50`)
  const words = titleWords(p)
  const rows = (body.jobs ?? []).filter((d: any) => relevant(d.title, words))
  log(`remotive: "${term}" → ${rows.length}`)
  return rows.map((d: any) =>
    makeJob({ title: d.title, company: d.company_name, location: `Remote (${d.candidate_required_location || 'anywhere'})`, salary: d.salary || '', url: d.url, description: strip(d.description || ''), source: 'remotive', posted_at: (d.publication_date || '').slice(0, 10), external_id: String(d.id) })
  )
}

// ---------------------------------------------------------------- Jooble

const JOOBLE_CITY: Record<string, string> = { bangalore: 'Bengaluru', bengaluru: 'Bengaluru', gurgaon: 'Gurugram', bombay: 'Mumbai', calcutta: 'Kolkata', madras: 'Chennai' }

async function joobleOnce(key: string, keywords: string, location: string): Promise<any[]> {
  const body = await getJson(`https://jooble.org/api/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords, location, page: '1' })
  })
  return body.jobs ?? []
}

export async function jooble(q: { title: string; location: string }): Promise<Job[]> {
  const key = secret('JOOBLE_API_KEY')
  if (!key) return []
  let rows: any[]
  if (q.location === 'Remote') rows = await joobleOnce(key, `${q.title} remote`, 'India')
  else {
    const city = JOOBLE_CITY[q.location.toLowerCase()] ?? q.location
    rows = await joobleOnce(key, q.title, city)
    // Jooble matches keywords strictly; retry once with the core words if nothing came back
    if (!rows.length) {
      const core = q.title.replace(/\b(senior|junior|lead|functional|consultant|specialist|analyst)\b/gi, ' ').replace(/\s+/g, ' ').trim()
      if (core && core !== q.title) rows = await joobleOnce(key, core, city)
    }
  }
  return rows.map((d: any) =>
    makeJob({ title: strip(d.title || ''), company: d.company || '', location: d.location || '', salary: d.salary || '', url: d.link || '', description: strip(d.snippet || ''), source: `jooble${d.source ? ':' + String(d.source).toLowerCase() : ''}`, posted_at: (d.updated || '').slice(0, 10), external_id: String(d.id || '') })
  )
}
