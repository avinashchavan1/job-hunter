// window.api for the website: same shape as the desktop app's preload bridge (src/preload/index.ts),
// backed by Supabase (tables + storage, protected by row security) and the jh-api server function.
// Features that arrive in later steps answer with empty data or a clear "not yet" message.
import type { Api } from '../../src/preload/index'
import { DEFAULT_PREFS, type AppSettings, type Contact, type Prefs, type Profile, type ProfileStats, type SecretKey } from '@shared/types'
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
  await call('resume.import', { pid: id })
  return (await getProfile(id))!
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

  // ---- arrive in steps 3–5
  matches: {
    list: async () => [],
    setStatus: async () => NOT_YET('The tracker'),
    rescore: async () => NOT_YET('Re-scoring')
  },
  stats: async () => EMPTY_STATS,
  runs: async () => [],
  run: {
    start: async () => NOT_YET('Checking for jobs'),
    all: async () => false,
    status: async () => ({ running: false, nextRunAt: null }),
    onProgress: () => () => {}
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
    connect: async () => NOT_YET('Gmail'),
    disconnect: async () => false,
    connected: async () => false,
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
    open: async (_pid, _jid) => false
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
