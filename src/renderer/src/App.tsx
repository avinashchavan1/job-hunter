import { ReactNode, useEffect, useState } from 'react'
import { Briefcase, History, ListChecks, Plus, Settings, UserRound } from 'lucide-react'
import type { AppSettings, Profile, SecretKey } from '@shared/types'
import { llmReady } from './components/AiEngine'
import { Matches } from './pages/Matches'
import { ProfilePage } from './pages/ProfilePage'
import { RunsPage } from './pages/RunsPage'
import { SettingsPage } from './pages/SettingsPage'
import { Onboarding } from './pages/Onboarding'
import { Spinner, cx } from './ui'

type Page = 'matches' | 'profile' | 'runs' | 'settings'

export default function App(): ReactNode {
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [secrets, setSecrets] = useState<Record<SecretKey, boolean> | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [pid, setPid] = useState<number | null>(null)
  const [page, setPage] = useState<Page>('matches')
  const [running, setRunning] = useState<Set<number>>(new Set())
  const [adding, setAdding] = useState(false)
  const [runErr, setRunErr] = useState('')

  const refresh = async (): Promise<Profile[]> => {
    const ps = await window.api.profiles.list()
    setProfiles(ps)
    return ps
  }

  useEffect(() => {
    void Promise.all([refresh(), window.api.secrets.status(), window.api.settings.get()]).then(([ps, s, st]) => {
      setSecrets(s)
      setSettings(st)
      const saved = Number(localStorage.getItem('pid'))
      setPid(ps.find((p) => p.id === saved)?.id ?? ps[0]?.id ?? null)
    })
    return window.api.run.onProgress((e) => {
      setRunning((r) => {
        const n = new Set(r)
        if (e.running) n.add(e.profileId)
        else n.delete(e.profileId)
        return n
      })
      if (e.phase === 'error') setRunErr(e.line)
    })
  }, [])
  useEffect(() => {
    if (pid) localStorage.setItem('pid', String(pid))
  }, [pid])
  // error banners are transient
  useEffect(() => {
    if (!runErr) return
    const t = setTimeout(() => setRunErr(''), 6000)
    return () => clearTimeout(t)
  }, [runErr])

  if (!profiles || !secrets || !settings) return <div className="grid h-full place-items-center text-ink-400"><Spinner size={22} /></div>

  if (adding || !profiles.length || !llmReady(settings, secrets)) {
    return (
      <Onboarding
        secrets={secrets}
        setSecrets={setSecrets}
        settings={settings}
        setSettings={setSettings}
        onCancel={adding && profiles.length ? () => setAdding(false) : undefined}
        onDone={async (p) => {
          await refresh()
          setPid(p.id)
          setPage('profile')
          setAdding(false)
        }}
      />
    )
  }

  const profile = profiles.find((p) => p.id === pid) ?? profiles[0]
  const isRunning = running.has(profile.id)
  const updateProfile = (p: Profile): void => setProfiles((ps) => ps!.map((x) => (x.id === p.id ? p : x)))
  const run = async (): Promise<void> => {
    setRunErr('')
    try {
      setRunning((r) => new Set(r).add(profile.id))
      await window.api.run.start(profile.id)
      setPage('matches')
    } catch (e: any) {
      setRunning((r) => { const n = new Set(r); n.delete(profile.id); return n })
      setRunErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const nav: { key: Page; label: string; icon: ReactNode }[] = [
    { key: 'matches', label: 'Matches', icon: <ListChecks size={16} /> },
    { key: 'profile', label: 'Profile & preferences', icon: <UserRound size={16} /> },
    { key: 'runs', label: 'Run history', icon: <History size={16} /> }
  ]

  return (
    <div className="flex h-full">
      <aside className="relative flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-ink-900/60 px-3 pb-3 pt-11">
        <div className="drag absolute inset-x-0 top-0 h-10" />
        <div className="mb-6 flex items-center gap-2.5 px-2">
          <div className="grid h-8 w-8 place-items-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/30"><Briefcase size={16} /></div>
          <div>
            <div className="text-sm font-semibold">Job Hunter</div>
            <div className="text-[11px] text-ink-400">You apply. It finds.</div>
          </div>
        </div>

        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-ink-400">Profiles</span>
          <button className="rounded-md p-1 text-ink-400 hover:bg-white/5 hover:text-ink-100" title="Add profile" onClick={() => setAdding(true)}><Plus size={14} /></button>
        </div>
        <div className="mb-5 space-y-0.5">
          {profiles.map((p) => (
            <button key={p.id} onClick={() => setPid(p.id)}
              className={cx('flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left text-sm transition', p.id === profile.id ? 'bg-white/[0.07] text-white' : 'text-ink-300 hover:bg-white/[0.04]')}>
              <span className={cx('grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold', p.id === profile.id ? 'bg-brand-600 text-white' : 'bg-ink-700 text-ink-300')}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{p.name}</span>
              {running.has(p.id) && <span className="ml-auto text-brand-400"><Spinner size={12} /></span>}
              {!p.active && <span className="ml-auto text-[10px] text-ink-400">paused</span>}
            </button>
          ))}
        </div>

        <nav className="space-y-0.5">
          {nav.map((n) => (
            <button key={n.key} onClick={() => setPage(n.key)}
              className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition', page === n.key ? 'bg-white/[0.07] text-white' : 'text-ink-300 hover:bg-white/[0.04]')}>
              {n.icon} {n.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto">
          <button onClick={() => setPage('settings')}
            className={cx('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition', page === 'settings' ? 'bg-white/[0.07] text-white' : 'text-ink-300 hover:bg-white/[0.04]')}>
            <Settings size={16} /> Settings
          </button>
        </div>
      </aside>

      <main className="relative flex-1 overflow-auto">
        <div className="drag sticky top-0 z-10 h-8 bg-gradient-to-b from-ink-950 to-transparent" />
        {runErr && (
          <div className="mx-auto mb-2 max-w-6xl px-8">
            <div className="rounded-xl bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{runErr}</div>
          </div>
        )}
        {page === 'matches' && <Matches profile={profile} running={isRunning} onRun={run} />}
        {page === 'profile' && <ProfilePage profile={profile} onChange={updateProfile} onDeleted={async () => { const ps = await refresh(); setPid(ps[0]?.id ?? null); setPage('matches') }} />}
        {page === 'runs' && <RunsPage profile={profile} running={isRunning} />}
        {page === 'settings' && <SettingsPage secrets={secrets} setSecrets={setSecrets} />}
      </main>
    </div>
  )
}
