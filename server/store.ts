// Job storage for the server (same rules as the desktop app's db.ts), batched for the network.
import { createHash } from 'node:crypto'
import type { Job, Prefs, Profile, RunAlert } from '../src/shared/types'
import { DEFAULT_PREFS } from '../src/shared/types'
import { check } from '../src/shared/filters'
import { admin } from './ctx'

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`)
  return r.data as T
}

// ---------------------------------------------------------------- ids (identical to the desktop app, so data can move over)

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const CITY_ALIAS: Record<string, string> = {
  bengaluru: 'bangalore', gurugram: 'gurgaon', bombay: 'mumbai', 'new delhi': 'delhi', madras: 'chennai',
  calcutta: 'kolkata', 'navi mumbai': 'mumbai', secunderabad: 'hyderabad', noida: 'noida', poona: 'pune'
}
function city(location: string): string {
  const n = norm(location)
  for (const [k, v] of Object.entries(CITY_ALIAS)) if (n === k || n.startsWith(k + ' ')) return v
  return n.split(' ')[0] || ''
}
export const jobId = (j: Pick<Job, 'title' | 'company' | 'location'>): string =>
  createHash('sha1').update(`${norm(j.title)}|${norm(j.company)}|${city(j.location)}`).digest('hex').slice(0, 16)

export function makeJob(p: Partial<Job> & { title: string; company: string }): Job {
  const j: Job = {
    id: '',
    title: (p.title || '').trim(),
    company: (p.company || '').trim(),
    location: (p.location || '').trim(),
    salary: (p.salary || '').trim(),
    url: p.url || '',
    description: p.description || '',
    source: p.source || '',
    posted_at: p.posted_at || '',
    external_id: p.external_id || ''
  }
  j.id = p.id || jobId(j)
  return j
}

// ---------------------------------------------------------------- kv

export async function kvGet(k: string): Promise<string | null> {
  const r = must(await admin().from('jh_kv').select('v').eq('k', k).maybeSingle(), 'kv')
  return r ? String((r as any).v) : null
}
export async function kvSet(k: string, v: string): Promise<void> {
  must(await admin().from('jh_kv').upsert({ k, v }), 'kv')
}

// ---------------------------------------------------------------- profiles

export function mergePrefs(saved: Partial<Prefs> | null): Prefs {
  const s = saved ?? {}
  return { ...DEFAULT_PREFS, ...s, sources: { ...DEFAULT_PREFS.sources, ...(s.sources || {}) }, contact: { ...DEFAULT_PREFS.contact, ...(s.contact || {}) } }
}
export const toProfile = (r: any): Profile => ({
  id: Number(r.id), slug: r.slug, name: r.name, resume_path: r.resume_path, profile: r.profile ?? null,
  prefs: mergePrefs(r.prefs), active: !!r.active, created_at: r.created_at, gmail_email: r.gmail_email
})
export async function getProfile(id: number): Promise<Profile | null> {
  const r = must(await admin().from('jh_profiles').select('*').eq('id', id).maybeSingle(), 'profile')
  return r ? toProfile(r) : null
}
export async function listProfiles(activeOnly = false): Promise<Profile[]> {
  let q = admin().from('jh_profiles').select('*').order('id')
  if (activeOnly) q = q.eq('active', true)
  return must(await q, 'profiles').map(toProfile)
}

// ---------------------------------------------------------------- saving a batch of found jobs

const chunks = <T>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n))

/** Upserts jobs, links them to the profile and applies the hard filters. Returns counts. */
export async function saveFound(p: Profile, jobs: Job[]): Promise<{ fresh: number; filtered: number }> {
  // collapse duplicates within the batch, keeping the longest description
  const byId = new Map<string, Job>()
  for (const j of jobs) {
    if (!j.title || !j.company) continue
    const ex = byId.get(j.id)
    if (!ex) byId.set(j.id, j)
    else if ((j.description || '').length > (ex.description || '').length) byId.set(j.id, { ...j, url: ex.url || j.url, salary: ex.salary || j.salary })
  }
  const ids = [...byId.keys()]
  if (!ids.length) return { fresh: 0, filtered: 0 }
  const now = new Date().toISOString()

  const existing = new Map<string, any>()
  for (const c of chunks(ids, 200))
    for (const r of must(await admin().from('jh_jobs').select('id, description, url, salary').in('id', c), 'jobs')) existing.set((r as any).id, r)

  const fresh: any[] = []
  const update: any[] = []
  for (const j of byId.values()) {
    const ex = existing.get(j.id)
    const row = { id: j.id, title: j.title, company: j.company, location: j.location, salary: j.salary, url: j.url, description: j.description, source: j.source, posted_at: j.posted_at, external_id: j.external_id }
    if (!ex) fresh.push({ ...row, first_seen: now, last_seen: now })
    else
      update.push({
        ...row,
        description: (j.description || '').length > (ex.description || '').length ? j.description : ex.description,
        url: ex.url || j.url,
        salary: ex.salary || j.salary,
        last_seen: now
      })
  }
  for (const c of chunks(fresh, 200)) must(await admin().from('jh_jobs').insert(c), 'insert jobs')
  for (const c of chunks(update, 200)) must(await admin().from('jh_jobs').upsert(c), 'update jobs')

  // link to this profile
  const linked = new Map<string, string>()
  for (const c of chunks(ids, 200))
    for (const r of must(await admin().from('jh_profile_jobs').select('job_id, sources').eq('profile_id', p.id).in('job_id', c), 'links'))
      linked.set((r as any).job_id, (r as any).sources)

  const links: any[] = []
  let filtered = 0
  for (const j of byId.values()) {
    const src = j.source.split(':')[0]
    const cur = linked.get(j.id)
    if (cur === undefined) {
      const reason = check(j, p.prefs)
      if (reason) filtered++
      links.push({ profile_id: p.id, job_id: j.id, found_at: now, sources: src, filter_reason: reason })
    } else if (!cur.split(',').includes(src)) {
      const s = [...new Set([...cur.split(',').filter(Boolean), src])].sort().join(',')
      must(await admin().from('jh_profile_jobs').update({ sources: s }).eq('profile_id', p.id).eq('job_id', j.id), 'link sources')
    }
  }
  for (const c of chunks(links, 200)) {
    must(await admin().from('jh_profile_jobs').insert(c), 'insert links')
    must(
      await admin()
        .from('jh_applications')
        .upsert(c.map((l) => ({ profile_id: p.id, job_id: l.job_id, status: 'new', updated_at: now })), { onConflict: 'profile_id,job_id', ignoreDuplicates: true }),
      'applications'
    )
  }
  return { fresh: links.length, filtered }
}

// ---------------------------------------------------------------- runs

export async function startRun(pid: number): Promise<number> {
  return Number((must(await admin().from('jh_runs').insert({ profile_id: pid }).select('id').single(), 'start run') as any).id)
}
export async function writeRun(id: number, f: { log?: string; status?: string; stats?: Record<string, number>; alerts?: RunAlert[]; finished?: boolean }): Promise<void> {
  const row: any = {}
  if (f.log !== undefined) row.log = f.log
  if (f.status) row.status = f.status
  if (f.stats) row.stats = f.stats
  if (f.alerts) row.alerts = f.alerts
  if (f.finished) row.finished_at = new Date().toISOString()
  must(await admin().from('jh_runs').update(row).eq('id', id), 'run')
}
/** A run counts as live for 10 minutes; older "running" rows were cut off by the platform. */
export async function liveRun(pid: number): Promise<number | null> {
  const since = new Date(Date.now() - 10 * 60_000).toISOString()
  const r = must(await admin().from('jh_runs').select('id').eq('profile_id', pid).eq('status', 'running').gte('started_at', since).limit(1), 'runs')
  return r.length ? Number((r[0] as any).id) : null
}
