// SQLite storage (node:sqlite, built into Electron's Node — no native modules).
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'crypto'
import { DEFAULT_PREFS, Job, Match, Prefs, Profile, ProfileStats, Run, RunAlert, Status, STATUSES } from '../shared/types'
import { dbPath } from './paths'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  resume_path TEXT,
  profile_json TEXT,
  prefs_json TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  gmail_email TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  title TEXT, company TEXT, location TEXT, salary TEXT,
  url TEXT, description TEXT, source TEXT, posted_at TEXT, external_id TEXT,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS profile_jobs (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  found_at TEXT NOT NULL,
  sources TEXT NOT NULL DEFAULT '',
  filter_reason TEXT,
  PRIMARY KEY (profile_id, job_id)
);
CREATE TABLE IF NOT EXISTS scores (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  score INTEGER, reasons TEXT, red_flags TEXT, cover_note TEXT,
  model TEXT, scored_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, job_id)
);
CREATE TABLE IF NOT EXISTS applications (
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (profile_id, job_id)
);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  stats_json TEXT, alerts_json TEXT, log TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS page_budget (
  profile_id INTEGER NOT NULL, site TEXT NOT NULL, day TEXT NOT NULL, pages INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, site, day)
);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
`

let _db: DatabaseSync | null = null
export function db(): DatabaseSync {
  if (!_db) {
    _db = new DatabaseSync(dbPath())
    _db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    _db.exec(SCHEMA)
    // additive migrations
    for (const sql of ['ALTER TABLE scores ADD COLUMN matched TEXT', 'ALTER TABLE scores ADD COLUMN missing TEXT']) {
      try {
        _db.exec(sql)
      } catch {
        /* column exists */
      }
    }
  }
  return _db
}

export const now = (): string => {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 19) // local time, ISO-ish
}
export const today = (): string => now().slice(0, 10)

const norm = (s: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Stable id: same title + company + city from any source collapses to one row. */
const CITY_ALIAS: Record<string, string> = {
  bengaluru: 'bangalore', gurugram: 'gurgaon', bombay: 'mumbai', 'new delhi': 'delhi', madras: 'chennai',
  calcutta: 'kolkata', 'navi mumbai': 'mumbai', secunderabad: 'hyderabad', noida: 'noida', poona: 'pune'
}
function city(location: string): string {
  const n = norm(location)
  for (const [k, v] of Object.entries(CITY_ALIAS)) if (n === k || n.startsWith(k + ' ')) return v
  return n.split(' ')[0] || ''
}
const hashId = (title: string, company: string, c: string): string =>
  createHash('sha1').update(`${norm(title)}|${norm(company)}|${c}`).digest('hex').slice(0, 16)

/** Stable id: same title + company + city from any source collapses to one row (Bengaluru = Bangalore, etc.). */
export function jobId(j: Pick<Job, 'title' | 'company' | 'location'>): string {
  const canonical = hashId(j.title, j.company, city(j.location))
  // jobs saved before city aliases existed keep their original id, so status and scores are not lost
  const legacy = hashId(j.title, j.company, norm(j.location).split(' ')[0] || '')
  if (legacy !== canonical && !getJob(canonical) && getJob(legacy)) return legacy
  return canonical
}

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

// ---------- kv ----------
export function kvGet(k: string): string | null {
  const r = db().prepare('SELECT v FROM kv WHERE k=?').get(k) as any
  return r ? r.v : null
}
export function kvSet(k: string, v: string): void {
  db().prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, v)
}

// ---------- profiles ----------
function rowToProfile(r: any): Profile | null {
  if (!r) return null
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    resume_path: r.resume_path,
    profile: r.profile_json ? JSON.parse(r.profile_json) : null,
    prefs: { ...DEFAULT_PREFS, ...JSON.parse(r.prefs_json || '{}'), sources: { ...DEFAULT_PREFS.sources, ...(JSON.parse(r.prefs_json || '{}').sources || {}) } },
    active: !!r.active,
    created_at: r.created_at,
    gmail_email: r.gmail_email
  }
}

export function listProfiles(activeOnly = false): Profile[] {
  return (db().prepare(`SELECT * FROM profiles ${activeOnly ? 'WHERE active=1' : ''} ORDER BY id`).all() as any[]).map(
    (r) => rowToProfile(r)!
  )
}

export function getProfile(id: number): Profile | null {
  return rowToProfile(db().prepare('SELECT * FROM profiles WHERE id=?').get(id))
}

export function createProfile(slug: string, name: string): Profile {
  let s = slug
  for (let i = 2; db().prepare('SELECT 1 FROM profiles WHERE slug=?').get(s); i++) s = `${slug}-${i}`
  const r = db()
    .prepare('INSERT INTO profiles (slug, name, prefs_json, created_at) VALUES (?,?,?,?)')
    .run(s, name, JSON.stringify(DEFAULT_PREFS), now())
  return getProfile(Number(r.lastInsertRowid))!
}

export function updateProfile(
  id: number,
  f: Partial<{ name: string; resume_path: string; profile: unknown; prefs: Prefs; active: boolean; gmail_email: string | null }>
): Profile {
  const sets: string[] = []
  const vals: any[] = []
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined) continue
    if (k === 'profile' || k === 'prefs') {
      sets.push(`${k}_json=?`)
      vals.push(JSON.stringify(v))
    } else if (k === 'active') {
      sets.push('active=?')
      vals.push(v ? 1 : 0)
    } else {
      sets.push(`${k}=?`)
      vals.push(v)
    }
  }
  if (sets.length) db().prepare(`UPDATE profiles SET ${sets.join(', ')} WHERE id=?`).run(...vals, id)
  return getProfile(id)!
}

export function deleteProfile(id: number): void {
  db().prepare('DELETE FROM profiles WHERE id=?').run(id)
}

// ---------- jobs ----------
export function upsertJob(j: Job): boolean {
  const t = now()
  const ex = db().prepare('SELECT description FROM jobs WHERE id=?').get(j.id) as any
  if (!ex) {
    db()
      .prepare(
        `INSERT INTO jobs (id,title,company,location,salary,url,description,source,posted_at,external_id,first_seen,last_seen)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(j.id, j.title, j.company, j.location, j.salary, j.url, j.description, j.source, j.posted_at, j.external_id, t, t)
    return true
  }
  const desc = (j.description || '').length > (ex.description || '').length ? j.description : ex.description
  db()
    .prepare(
      `UPDATE jobs SET description=?, url=COALESCE(NULLIF(url,''), ?), salary=COALESCE(NULLIF(salary,''), ?), last_seen=? WHERE id=?`
    )
    .run(desc, j.url, j.salary, t, j.id)
  return false
}

export function getJob(id: string): Job | null {
  return (db().prepare('SELECT * FROM jobs WHERE id=?').get(id) as any) ?? null
}

/** Record that a profile's search found this job. Returns true the first time. */
export function linkProfileJob(pid: number, jobIdStr: string, source: string): boolean {
  const r = db().prepare('SELECT sources FROM profile_jobs WHERE profile_id=? AND job_id=?').get(pid, jobIdStr) as any
  if (!r) {
    db().prepare('INSERT INTO profile_jobs (profile_id, job_id, found_at, sources) VALUES (?,?,?,?)').run(pid, jobIdStr, now(), source)
    db()
      .prepare(`INSERT OR IGNORE INTO applications (profile_id, job_id, status, updated_at) VALUES (?,?, 'new', ?)`)
      .run(pid, jobIdStr, now())
    return true
  }
  const srcs = new Set((r.sources as string).split(',').filter(Boolean))
  if (!srcs.has(source)) {
    srcs.add(source)
    db().prepare('UPDATE profile_jobs SET sources=? WHERE profile_id=? AND job_id=?').run([...srcs].sort().join(','), pid, jobIdStr)
  }
  return false
}

export function setFilterReason(pid: number, jobIdStr: string, reason: string | null): void {
  db().prepare('UPDATE profile_jobs SET filter_reason=? WHERE profile_id=? AND job_id=?').run(reason, pid, jobIdStr)
}

export function unscoredJobs(pid: number, limit: number): Job[] {
  return db()
    .prepare(
      `SELECT j.* FROM profile_jobs pj JOIN jobs j ON j.id = pj.job_id
       LEFT JOIN scores s ON s.profile_id = pj.profile_id AND s.job_id = pj.job_id
       WHERE pj.profile_id=? AND pj.filter_reason IS NULL AND s.job_id IS NULL
       ORDER BY pj.found_at DESC LIMIT ?`
    )
    .all(pid, limit) as any[]
}

export function saveScore(
  pid: number, jid: string, score: number, reasons: string[], flags: string[], note: string, model: string,
  matched: string[] = [], missing: string[] = []
): void {
  db()
    .prepare(
      `INSERT OR REPLACE INTO scores (profile_id, job_id, score, reasons, red_flags, cover_note, model, scored_at, matched, missing) VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(pid, jid, score, JSON.stringify(reasons), JSON.stringify(flags), note, model, now(), JSON.stringify(matched), JSON.stringify(missing))
}

export function unscoredCount(pid: number): number {
  return (db()
    .prepare(
      `SELECT COUNT(*) n FROM profile_jobs pj LEFT JOIN scores s ON s.profile_id = pj.profile_id AND s.job_id = pj.job_id
       WHERE pj.profile_id=? AND pj.filter_reason IS NULL AND s.job_id IS NULL`
    )
    .get(pid) as any).n
}

export function setStatus(pid: number, jid: string, status: Status, notes?: string): void {
  if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`)
  db()
    .prepare(
      `INSERT INTO applications (profile_id, job_id, status, notes, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(profile_id, job_id) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at
       ${notes !== undefined ? ', notes=excluded.notes' : ''}`
    )
    .run(pid, jid, status, notes ?? '', now())
}

export function listMatches(pid: number, opts: { includeFiltered?: boolean; status?: Status } = {}): Match[] {
  const where = ['pj.profile_id = ?']
  const vals: any[] = [pid]
  if (!opts.includeFiltered) where.push('pj.filter_reason IS NULL')
  if (opts.status) {
    where.push('a.status = ?')
    vals.push(opts.status)
  }
  const rows = db()
    .prepare(
      `SELECT j.*, pj.found_at, pj.sources, pj.filter_reason,
              s.score, s.reasons, s.red_flags, s.cover_note, s.scored_at, s.matched, s.missing,
              COALESCE(a.status,'new') AS status, a.notes, a.updated_at AS status_at
       FROM profile_jobs pj JOIN jobs j ON j.id = pj.job_id
       LEFT JOIN scores s ON s.profile_id = pj.profile_id AND s.job_id = pj.job_id
       LEFT JOIN applications a ON a.profile_id = pj.profile_id AND a.job_id = pj.job_id
       WHERE ${where.join(' AND ')}
       ORDER BY (s.score IS NULL), s.score DESC, pj.found_at DESC`
    )
    .all(...vals) as any[]
  const arr = (v: string | null): string[] => (v ? JSON.parse(v) : [])
  return rows.map((r) => ({ ...r, reasons: arr(r.reasons), red_flags: arr(r.red_flags), matched: arr(r.matched), missing: arr(r.missing) }))
}

export function stats(pid: number): ProfileStats {
  const d = db()
  const by_status: any = {}
  for (const r of d.prepare('SELECT status, COUNT(*) n FROM applications WHERE profile_id=? GROUP BY status').all(pid) as any[])
    by_status[r.status] = r.n
  const by_source: Record<string, number> = {}
  for (const r of d
    .prepare('SELECT j.source, COUNT(*) n FROM profile_jobs pj JOIN jobs j ON j.id=pj.job_id WHERE pj.profile_id=? GROUP BY j.source')
    .all(pid) as any[])
    by_source[r.source] = r.n
  const one = (q: string, ...a: any[]): any => d.prepare(q).get(...a) as any
  const sc = one('SELECT COUNT(*) n, AVG(score) a FROM scores WHERE profile_id=?', pid)
  return {
    total: one('SELECT COUNT(*) n FROM profile_jobs WHERE profile_id=?', pid).n,
    filtered: one('SELECT COUNT(*) n FROM profile_jobs WHERE profile_id=? AND filter_reason IS NOT NULL', pid).n,
    scored: sc.n,
    avg_score: Math.round((sc.a || 0) * 10) / 10,
    new_today: one('SELECT COUNT(*) n FROM profile_jobs WHERE profile_id=? AND found_at >= ?', pid, today()).n,
    by_status,
    by_source
  }
}

// ---------- runs ----------
export function startRun(pid: number): number {
  return Number(db().prepare('INSERT INTO runs (profile_id, started_at) VALUES (?,?)').run(pid, now()).lastInsertRowid)
}

export function finishRun(id: number, status: Run['status'], st: Record<string, number>, alerts: RunAlert[], log: string): void {
  db()
    .prepare('UPDATE runs SET finished_at=?, status=?, stats_json=?, alerts_json=?, log=? WHERE id=?')
    .run(now(), status, JSON.stringify(st), JSON.stringify(alerts), log, id)
}

export function listRuns(pid: number, limit = 20): Run[] {
  return (db().prepare('SELECT * FROM runs WHERE profile_id=? ORDER BY id DESC LIMIT ?').all(pid, limit) as any[]).map((r) => ({
    ...r,
    stats: JSON.parse(r.stats_json || '{}'),
    alerts: JSON.parse(r.alerts_json || '[]')
  }))
}

// ---------- browser page budget ----------
export function pagesUsed(pid: number, site: string): number {
  const r = db().prepare('SELECT pages FROM page_budget WHERE profile_id=? AND site=? AND day=?').get(pid, site, today()) as any
  return r ? r.pages : 0
}

export function addPage(pid: number, site: string): void {
  db()
    .prepare(
      `INSERT INTO page_budget (profile_id, site, day, pages) VALUES (?,?,?,1)
       ON CONFLICT(profile_id, site, day) DO UPDATE SET pages = pages + 1`
    )
    .run(pid, site, today())
}
