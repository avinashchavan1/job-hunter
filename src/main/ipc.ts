// IPC surface between renderer and main. Secrets go in, never come out.
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { copyFileSync } from 'fs'
import { basename, extname, join } from 'path'
import { AppSettings, DEFAULT_PREFS, Prefs, Profile, RunProgress, SecretKey, SourceKey, Status } from '../shared/types'
import * as db from './db'
import { cooledModels, detectFreeLLMAPI, engineLabel, listCompatModels, llmHealth, modelChain, testEngine } from './llm'
import { profileDir, slugify } from './paths'
import { parseResume, prefsFromProfile } from './resume'
import { isRunning, runProfile } from './runner'
import { rescoreOne } from './matcher'
import { nextRunAt } from './scheduler'
import { getSettings, saveSettings, secretStatus, setSecret } from './settings'
import { fetchJobs } from './sources/jobApi'
import { loginStatus, logout, openLogin, Site } from './sources/browser'
import { connectGmail, disconnectGmail, gmailConnected, probeGmail } from './sources/gmail'

export function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}
const emit = (e: RunProgress): void => broadcast('run:progress', e)

export async function runAllActive(): Promise<{ name: string; strong: number; alerts: number }[]> {
  const out: { name: string; strong: number; alerts: number }[] = []
  for (const p of db.listProfiles(true)) {
    if (!p.profile || isRunning(p.id)) continue
    const r = await runProfile(p, emit)
    out.push({ name: p.name, strong: r.stats.strong_today ?? 0, alerts: r.alerts.filter((a) => a.level !== 'info').length })
  }
  return out
}

async function importResume(pid: number, filePath?: string): Promise<ReturnType<typeof db.getProfile>> {
  const p = db.getProfile(pid)
  if (!p) throw new Error('profile not found')
  let src = filePath
  if (!src) {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Resume', extensions: ['pdf', 'docx', 'txt', 'md'] }] })
    if (r.canceled || !r.filePaths[0]) return p
    src = r.filePaths[0]
  }
  const dest = join(profileDir(p.slug), `resume${extname(src).toLowerCase()}`)
  copyFileSync(src, dest)
  const parsed = await parseResume(dest)
  const prefs: Prefs = { ...p.prefs, ...prefsFromProfile(parsed) }
  // keep user-entered lists if they already exist
  if (p.prefs.target_titles.length) prefs.target_titles = p.prefs.target_titles
  if (p.prefs.locations.length) prefs.locations = p.prefs.locations
  const name = p.name && p.name !== 'New profile' ? p.name : parsed.name
  return db.updateProfile(pid, { resume_path: dest, profile: parsed, prefs, name })
}

export function registerIpc(): void {
  const h = (ch: string, fn: (...a: any[]) => any): void => {
    ipcMain.handle(ch, async (_e, ...args) => fn(...args))
  }

  // profiles
  h('profiles:list', () => db.listProfiles())
  h('profiles:get', (id: number) => db.getProfile(id))
  h('profiles:create', (name: string) => db.createProfile(slugify(name || 'profile'), name || 'New profile'))
  h('profiles:update', (id: number, patch: any) => db.updateProfile(id, patch))
  h('profiles:delete', (id: number) => db.deleteProfile(id))
  h('profiles:importResume', (id: number, path?: string) => importResume(id, path))
  h('profiles:resumeName', (id: number) => {
    const p = db.getProfile(id)
    return p?.resume_path ? basename(p.resume_path) : null
  })

  // matches
  h('matches:list', (pid: number, opts?: { includeFiltered?: boolean; status?: Status }) => db.listMatches(pid, opts))
  h('matches:setStatus', (pid: number, jid: string, status: Status, notes?: string) => db.setStatus(pid, jid, status, notes))
  h('stats', (pid: number) => ({ ...db.stats(pid), unscored: db.unscoredCount(pid) }))
  h('matches:rescore', async (pid: number, jid: string) => {
    const p = db.getProfile(pid)
    if (!p) throw new Error('profile not found')
    await rescoreOne(p, jid)
    return db.listMatches(pid, { includeFiltered: true }).find((m) => m.id === jid) ?? null
  })
  h('runs:list', (pid: number) => db.listRuns(pid))

  // running
  h('run:start', (pid: number, only?: SourceKey[]) => {
    const p = db.getProfile(pid)
    if (!p) throw new Error('profile not found')
    if (!p.profile) throw new Error('Add a resume to this profile first')
    void runProfile(p, emit, only).catch((e) => emit({ profileId: pid, phase: 'error', line: String(e?.message ?? e), running: false }))
    return true
  })
  h('run:status', () => ({ running: isRunning(), nextRunAt: nextRunAt() }))

  // settings & secrets
  h('settings:get', () => getSettings())
  h('settings:save', (patch: Partial<AppSettings>) => saveSettings(patch))
  h('secrets:status', () => secretStatus())
  h('secrets:set', (key: SecretKey, value: string) => {
    setSecret(key, value)
    return secretStatus()
  })
  h('llm:detect', () => detectFreeLLMAPI())
  h('llm:models', async () => {
    try {
      return await listCompatModels()
    } catch {
      return []
    }
  })
  h('llm:label', () => engineLabel())
  h('secrets:test', async (which: 'llm' | 'job_api') => {
    try {
      if (which === 'llm') return { ok: true, message: await testEngine() }
      // one-query probe, no DB writes
      const probe: Profile = {
        id: 0, slug: 'probe', name: 'probe', resume_path: null, profile: null, active: true, created_at: '',
        prefs: { ...DEFAULT_PREFS, target_titles: ['Software Engineer'], locations: ['Bangalore'], remote_ok: false }
      }
      const jobs = await fetchJobs(probe, () => {})
      return { ok: true, message: `Job API works — ${jobs.length} sample results.` }
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) }
    }
  })

  // gmail
  h('gmail:connect', async (pid: number) => {
    const p = db.getProfile(pid)
    if (!p) throw new Error('profile not found')
    const email = await connectGmail(p)
    db.updateProfile(pid, { prefs: { ...p.prefs, sources: { ...p.prefs.sources, gmail: true } } })
    return email
  })
  h('gmail:disconnect', (pid: number) => {
    const p = db.getProfile(pid)
    if (p) disconnectGmail(p)
    return true
  })
  h('gmail:probe', async (pid: number) => {
    const p = db.getProfile(pid)
    const r = await probeGmail(p!)
    return { counts: [...r], domains: r.domains }
  })
  h('gmail:connected', (pid: number) => {
    const p = db.getProfile(pid)
    return p ? gmailConnected(p) : false
  })

  // browser sources
  h('browser:status', async (pid: number) => loginStatus(db.getProfile(pid)!))
  h('browser:login', async (pid: number, site: Site) => {
    const p = db.getProfile(pid)!
    const ok = await openLogin(p, site)
    if (ok) db.updateProfile(pid, { prefs: { ...p.prefs, sources: { ...p.prefs.sources, [site]: true } } })
    return ok
  })
  h('browser:logout', async (pid: number, site: Site) => {
    await logout(db.getProfile(pid)!, site)
    return true
  })

  // health
  h('health', () => {
    const st = getSettings()
    const month = new Date().toISOString().slice(0, 7)
    return {
      llm: { label: engineLabel(), chain: st.llm.provider === 'anthropic' ? [st.model] : modelChain(), cooled: cooledModels(), ...llmHealth },
      jobApi: {
        provider: st.jobApi.provider,
        keySet: st.jobApi.provider === 'jsearch' ? secretStatus().RAPIDAPI_KEY : secretStatus().ADZUNA_APP_KEY,
        usedThisMonth: Number(db.kvGet(`quota:jsearch:${month}`) || 0),
        limit: Number(db.kvGet('jsearch_limit') || 0) || null,
        remaining: db.kvGet('jsearch_remaining') != null ? Number(db.kvGet('jsearch_remaining')) : null,
        perRun: st.jobApi.maxQueriesPerRun
      },
      googleReady: secretStatus().GOOGLE_CLIENT_ID && secretStatus().GOOGLE_CLIENT_SECRET,
      schedule: { ...st.schedule, nextRunAt: nextRunAt() },
      profiles: db.listProfiles().map((p) => {
        const last = db.listRuns(p.id, 1)[0] ?? null
        return { id: p.id, name: p.name, active: p.active, sources: p.prefs.sources, gmail: p.gmail_email ?? null, gmailConnected: gmailConnected(p), naukriPages: db.pagesUsed(p.id, 'naukri'), linkedinPages: db.pagesUsed(p.id, 'linkedin'), pageCap: st.browser.pagesPerSitePerDay, lastRun: last }
      })
    }
  })

  // misc
  h('shell:open', (url: string) => {
    if (!/^https?:\/\//.test(url)) throw new Error('only http(s) links')
    return shell.openExternal(url)
  })
}
