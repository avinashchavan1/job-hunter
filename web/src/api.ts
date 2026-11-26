// window.api for the website: same shape as the desktop app's preload bridge (src/preload/index.ts),
// backed by Supabase (tables + storage, protected by row security) and the jh-api server function.
// Features that arrive in later steps answer with empty data or a clear "not yet" message.
import type { Api } from '../../src/preload/index'
import { DEFAULT_PREFS, STATUSES, type AppSettings, type Contact, type Match, type Prefs, type Profile, type ProfileStats, type Run, type RunProgress, type SecretKey } from '@shared/types'
import { DEFAULT_SETTINGS, deepMerge } from '@shared/settings'
import { sb } from './supabase'

const NOT_YET = (what: string): never => {
  throw new Error(`${what} isn’t in the web version yet — coming in the next update.`)
}

/** Calls the jh-api server function and unwraps { data } / { error }. */
async function call<T>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb.functions.invoke('jh-api', { body: { action, args } })
  if (error) {
    let msg = error.message
    const res = (error as { context?: Response }).context
    if (res && typeof res.json === 'function') {
      try {
        msg = (await res.json()).error ?? msg
      } catch {
        /* not json */
      }
    }
    throw new Error(msg)
  }
  return (data as { data: T }).data
}

const must = <T>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

// ---------------------------------------------------------------- profiles

function mergePrefs(saved: Partial<Prefs> | null): Prefs {
  const s = saved ?? {}
  return { ...DEFAULT_PREFS, ...s, sources: { ...DEFAULT_PREFS.sources, ...(s.sources || {}) }, contact: { ...DEFAULT_PREFS.contact, ...(s.contact || {}) } }
}
const toProfile = (r: any): Profile => ({
  id: Number(r.id),
  slug: r.slug,
  name: r.name,
  resume_path: r.resume_path,
  profile: r.profile ?? null,
  prefs: mergePrefs(r.prefs),
  active: !!r.active,
  created_at: r.created_at,
  gmail_email: r.gmail_email
})
const slugify = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'profile'

async function getProfile(id: number): Promise<Profile | null> {
  const r = must(await sb.from('jh_profiles').select('*').eq('id', id).maybeSingle())
  return r ? toProfile(r) : null
}

// Files chosen in the browser, referenced by a token (the desktop app passes file paths instead).
const picked = new Map<string, File>()
const keep = (f: File): string => {
  const t = `file:${crypto.randomUUID()}`
  picked.set(t, f)
  return t
}
const ACCEPT = '.pdf,.docx,.txt,.md'
function pickFile(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = ACCEPT
    input.onchange = () => resolve(input.files?.[0] ? keep(input.files[0]) : null)
    input.addEventListener('cancel', () => resolve(null))
    input.click()
  })
}

async function importResume(id: number, token?: string): Promise<Profile> {
  const p = await getProfile(id)
  if (!p) throw new Error('profile not found')
  const t = token ?? (await pickFile())
  const file = t ? picked.get(t) : undefined
  if (!file) return p // picker cancelled
  picked.delete(t!)
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  if (!['pdf', 'docx', 'txt', 'md'].includes(ext)) throw new Error('Use a PDF or Word (.docx) resume.')
  if (file.size > 10 * 1024 * 1024) throw new Error('That file is over 10 MB.')
  const path = `${p.slug}/resume.${ext}`
  // remove older resume files with another extension
  const old = must(await sb.storage.from('jh-resumes').list(p.slug)) ?? []
  const stale = old.map((o) => `${p.slug}/${o.name}`).filter((k) => k !== path)
  if (stale.length) await sb.storage.from('jh-resumes').remove(stale)
  must(await sb.storage.from('jh-resumes').upload(path, file, { upsert: true, contentType: file.type || undefined }))
  // keep the original file name for display
  must(await sb.from('jh_profiles').update({ resume_path: path }).eq('id', id))
  localStorage.setItem(`resumeName:${id}`, file.name)
  // Free AI models can be slow; if the connection drops while the server is still working,
  // watch the profile itself and finish as soon as the new reading lands.
  const before = JSON.stringify(p.profile)
  const changed = async (): Promise<Profile | null> => {
    const now = await getProfile(id)
    return now && now.profile && JSON.stringify(now.profile) !== before ? now : null
  }
  let done = false
  const watcher = (async (): Promise<Profile> => {
    for (let i = 0; i < 60 && !done; i++) {
      await new Promise((r) => setTimeout(r, 5000))
      const now = await changed().catch(() => null)
      if (now) return now
    }
    throw new Error('Reading the resume is taking too long. Reload the page in a minute to see if it finished.')
  })()
  const direct = call('resume.import', { pid: id }).then(
    async () => (await getProfile(id))!,
    async (e) => (await changed()) ?? Promise.reject(e)
  )
  try {
    return await Promise.race([direct, watcher])
  } finally {
    done = true
  }
}

// ---------------------------------------------------------------- settings

async function getSettings(): Promise<AppSettings> {
  const r: any = must(await sb.from("jh_settings").select("data").eq("id", 1).maybeSingle())
  return deepMerge(DEFAULT_SETTINGS, (r?.data ?? {}) as Partial<AppSettings>)
}
async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = deepMerge(await getSettings(), patch)
  must(await sb.from('jh_settings').update({ data: next, updated_at: new Date().toISOString() }).eq('id', 1))
  return next
}

// ---------------------------------------------------------------- run progress: poll the runs table while a check is going

const jobUrls = new Map<string, string>()
const listeners = new Set<(e: RunProgress) => void>()
const seen = new Map<number, { pid: number; lines: number }>() // run id -> lines already sent
let timer: ReturnType<typeof setTimeout> | null = null

async function liveRuns(): Promise<any[]> {
  const since = new Date(Date.now() - 4 * 60_000).toISOString()
  return must(await sb.from('jh_runs').select('id, profile_id, status, log').eq('status', 'running').gte('started_at', since)) as any[]
}

async function poll(): Promise<void> {
  timer = null
  try {
    const live = await liveRuns()
    const ids = new Set(live.map((r) => Number(r.id)))
    // finished since last poll: fetch final log once
    const ended = [...seen.keys()].filter((id) => !ids.has(id))
    const finals = ended.length ? ((must(await sb.from('jh_runs').select('id, profile_id, status, log').in('id', ended)) as any[]) ?? []) : []
    for (const r of [...live, ...finals]) {
      const id = Number(r.id)
      const pid = Number(r.profile_id)
      const lines = String(r.log || '').split('\n').filter(Boolean)
      const s = seen.get(id) ?? { pid, lines: 0 }
      for (const line of lines.slice(s.lines)) listeners.forEach((cb) => cb({ profileId: pid, phase: 'run', line: line.replace(/^\d\d:\d\d:\d\d /, ''), running: true }))
      s.lines = lines.length
      if (r.status === 'running') seen.set(id, s)
      else {
        seen.delete(id)
        listeners.forEach((cb) => cb({ profileId: pid, phase: 'done', line: '', running: false }))
      }
    }
    if (live.length) timer = setTimeout(poll, 2000)
  } catch {
    timer = setTimeout(poll, 5000)
  }
}
const watch = (): void => {
  if (!timer) timer = setTimeout(poll, 300)
}

/** Next daily check in India time, shown in Settings. */
async function nextRunAt(): Promise<string | null> {
  const s = (await getSettings()).schedule
  if (!s.enabled) return null
  const [h, m] = s.time.split(':').map(Number)
  const ist = (d: Date): Date => new Date(d.getTime() + 5.5 * 3600_000)
  for (let i = 0; i < 8; i++) {
    const day = ist(new Date(Date.now() + i * 86400_000))
    const t = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), h, m) - 5.5 * 3600_000)
    if (t.getTime() <= Date.now()) continue
    const wd = day.getUTCDay()
    if (s.weekdaysOnly && (wd === 0 || wd === 6)) continue
    return t.toISOString()
  }
  return null
}

const EMPTY_STATS: ProfileStats = { total: 0, filtered: 0, scored: 0, avg_score: 0, new_today: 0, unscored: 0, by_status: {}, by_source: {} }

// ---------------------------------------------------------------- the bridge

export const webApi: Api = {
  profiles: {
    list: async () => must(await sb.from('jh_profiles').select('*').order('id')).map(toProfile),
    get: getProfile,
    create: async (name) => {
      const base = slugify(name || 'profile')
      const taken = new Set(must(await sb.from('jh_profiles').select('slug').like('slug', `${base}%`)).map((r: any) => r.slug))
      let slug = base
      for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`
      return toProfile(must(await sb.from('jh_profiles').insert({ slug, name: name || 'New profile', prefs: DEFAULT_PREFS }).select('*').single()))
    },
    update: async (id, patch) => toProfile(must(await sb.from('jh_profiles').update(patch).eq('id', id).select('*').single())),
    remove: async (id) => {
      const p = await getProfile(id)
      if (p) {
        const files = must(await sb.storage.from('jh-resumes').list(p.slug)) ?? []
        if (files.length) await sb.storage.from('jh-resumes').remove(files.map((f) => `${p.slug}/${f.name}`))
      }
      must(await sb.from('jh_profiles').delete().eq('id', id))
    },
    importResume,
    resumeName: async (id) => {
      const p = await getProfile(id)
      return p?.resume_path ? localStorage.getItem(`resumeName:${id}`) || p.resume_path.split('/').pop() || null : null
    },
    contactFromResume: (id) => call<Partial<Contact>>('resume.contact', { pid: id })
  },

  matches: {
    list: async (pid, opts) => {
      let q = sb.from('jh_matches').select('*').eq('profile_id', pid)
      if (!opts?.includeFiltered) q = q.is('filter_reason', null)
      if (opts?.status) q = q.eq('status', opts.status)
      const rows = must(await q.order('score', { ascending: false, nullsFirst: false }).order('found_at', { ascending: false }).limit(1000)) as any[]
      for (const r of rows) jobUrls.set(r.id, r.url)
      return rows.map(({ profile_id: _p, first_seen: _f, last_seen: _l, ...r }) => r) as Match[]
    },
    setStatus: async (pid, jid, status, notes) => {
      if (!STATUSES.includes(status)) throw new Error(`status must be one of ${STATUSES.join(', ')}`)
      const row: Record<string, unknown> = { profile_id: pid, job_id: jid, status, updated_at: new Date().toISOString() }
      if (notes !== undefined) row.notes = notes
      must(await sb.from('jh_applications').upsert(row))
    },
    rescore: async (pid, jid) => {
      await call('matches.rescore', { pid, jid })
      const r = must(await sb.from('jh_matches').select('*').eq('profile_id', pid).eq('id', jid).maybeSingle()) as any
      if (!r) return null
      const { profile_id: _p, first_seen: _f, last_seen: _l, ...m } = r
      return m as Match
    }
  },
  stats: async (pid) => {
    const midnight = new Date()
    midnight.setHours(0, 0, 0, 0)
    return { ...EMPTY_STATS, ...(must(await sb.rpc('jh_stats', { pid, since: midnight.toISOString() })) as ProfileStats) }
  },
  runs: async (pid) =>
    (must(await sb.from('jh_runs').select('*').eq('profile_id', pid).order('id', { ascending: false }).limit(20)) as any[]).map((r) => ({
      ...r, id: Number(r.id), profile_id: Number(r.profile_id), stats: r.stats ?? {}, alerts: r.alerts ?? []
    })) as Run[],
  run: {
    start: async (pid, only) => {
      await call<number>('run.start', { pid, only })
      watch()
      return true
    },
    all: async () => false,
    status: async () => ({ running: (await liveRuns()).length > 0, nextRunAt: await nextRunAt() }),
    onProgress: (cb) => {
      listeners.add(cb)
      watch()
      return () => void listeners.delete(cb)
    }
  },

  settings: {
    get: getSettings,
    save: saveSettings,
    setOpenAtLogin: async () => getSettings()
  },
  secrets: {
    status: () => call<Record<SecretKey, boolean>>('secrets.status'),
    set: (key, value) => call<Record<SecretKey, boolean>>('secrets.set', { key, value }),
    test: (which) => call<{ ok: boolean; message: string }>('secrets.test', { which })
  },
  llm: {
    detect: async () => null,
    models: () => call<string[]>('llm.models'),
    label: () => call<string>('llm.label')
  },
  gmail: {
    // leaves the site for Google's consent page; Google sends the person back with ?gmail=connected
    connect: async (pid) => {
      location.href = await call<string>('gmail.connect', { pid, origin: location.origin })
      return new Promise<string>(() => {})
    },
    disconnect: (pid) => call<boolean>('gmail.disconnect', { pid }),
    connected: (pid) => call<boolean>('gmail.connected', { pid }),
    probe: async () => ({ counts: [], domains: {} })
  },
  health: async () => ({
    llm: { label: await call<string>('llm.label').catch(() => 'not set up'), chain: [], cooled: [] },
    jobApi: { provider: 'jsearch', keySet: false, usedThisMonth: 0, limit: null, remaining: null, perRun: 0 },
    googleReady: false,
    schedule: { ...(await getSettings()).schedule, nextRunAt: null },
    profiles: []
  }),
  browser: {
    status: async () => ({ naukri: false, linkedin: false }),
    login: async () => NOT_YET('Naukri / LinkedIn sign-in'),
    logout: async () => false
  },
  autofill: {
    // no form filling on the web: Apply opens the posting in a new tab (synchronously, so pop-up blockers allow it)
    open: async (_pid, jid) => {
      const url = jobUrls.get(jid)
      if (!url) throw new Error('This job has no link.')
      window.open(url, '_blank', 'noopener,noreferrer')
      return true
    }
  },
  assist: {
    tailor: async () => NOT_YET('Tailored resume'),
    tailored: async () => null,
    prep: async () => NOT_YET('Interview prep'),
    getPrep: async () => null
  },
  reveal: async () => {},
  pathForFile: (f: File) => keep(f),
  pickResume: pickFile,
  open: async (url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error('only http(s) links')
    window.open(url, '_blank', 'noopener,noreferrer')
  },
  isWeb: true
}
