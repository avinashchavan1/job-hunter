import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, Match, Prefs, Profile, ProfileStats, Run, RunProgress, SecretKey, SourceKey, Status } from '../shared/types'

const inv = <T>(ch: string, ...a: unknown[]): Promise<T> => ipcRenderer.invoke(ch, ...a) as Promise<T>

const api = {
  profiles: {
    list: () => inv<Profile[]>('profiles:list'),
    get: (id: number) => inv<Profile | null>('profiles:get', id),
    create: (name: string) => inv<Profile>('profiles:create', name),
    update: (id: number, patch: Partial<{ name: string; prefs: Prefs; active: boolean }>) => inv<Profile>('profiles:update', id, patch),
    remove: (id: number) => inv<void>('profiles:delete', id),
    importResume: (id: number, path?: string) => inv<Profile>('profiles:importResume', id, path),
    resumeName: (id: number) => inv<string | null>('profiles:resumeName', id)
  },
  matches: {
    list: (pid: number, opts?: { includeFiltered?: boolean; status?: Status }) => inv<Match[]>('matches:list', pid, opts),
    setStatus: (pid: number, jid: string, status: Status, notes?: string) => inv<void>('matches:setStatus', pid, jid, status, notes),
    rescore: (pid: number, jid: string) => inv<Match | null>('matches:rescore', pid, jid)
  },
  stats: (pid: number) => inv<ProfileStats>('stats', pid),
  runs: (pid: number) => inv<Run[]>('runs:list', pid),
  run: {
    start: (pid: number, only?: SourceKey[]) => inv<boolean>('run:start', pid, only),
    all: () => inv<boolean>('run:all'),
    status: () => inv<{ running: boolean; nextRunAt: string | null }>('run:status'),
    onProgress: (cb: (e: RunProgress) => void) => {
      const f = (_: unknown, e: RunProgress): void => cb(e)
      ipcRenderer.on('run:progress', f)
      return (): void => {
        ipcRenderer.removeListener('run:progress', f)
      }
    }
  },
  settings: {
    get: () => inv<AppSettings>('settings:get'),
    save: (patch: Partial<AppSettings>) => inv<AppSettings>('settings:save', patch),
    setOpenAtLogin: (open: boolean) => inv<AppSettings>('app:setOpenAtLogin', open)
  },
  secrets: {
    status: () => inv<Record<SecretKey, boolean>>('secrets:status'),
    set: (key: SecretKey, value: string) => inv<Record<SecretKey, boolean>>('secrets:set', key, value),
    test: (which: 'llm' | 'job_api') => inv<{ ok: boolean; message: string }>('secrets:test', which)
  },
  llm: {
    detect: () => inv<string | null>('llm:detect'),
    models: () => inv<string[]>('llm:models'),
    label: () => inv<string>('llm:label')
  },
  gmail: {
    connect: (pid: number) => inv<string>('gmail:connect', pid),
    disconnect: (pid: number) => inv<boolean>('gmail:disconnect', pid),
    connected: (pid: number) => inv<boolean>('gmail:connected', pid),
    probe: (pid: number) => inv<{ counts: { query: string; count: number }[]; domains: Record<string, number> }>('gmail:probe', pid)
  },
  health: () => inv<any>('health'),
  browser: {
    status: (pid: number) => inv<{ naukri: boolean; linkedin: boolean }>('browser:status', pid),
    login: (pid: number, site: 'naukri' | 'linkedin') => inv<boolean>('browser:login', pid, site),
    logout: (pid: number, site: 'naukri' | 'linkedin') => inv<boolean>('browser:logout', pid, site)
  },
  open: (url: string) => inv<void>('shell:open', url)
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
