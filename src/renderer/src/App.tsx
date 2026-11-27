import { ReactNode, useEffect, useState } from 'react'
import logo from './assets/logo.png'
import { Inbox, KanbanSquare, Plus, Settings, UserRound } from 'lucide-react'
import { BoardPage } from './pages/BoardPage'
import type { AppSettings, Profile, SecretKey } from '@shared/types'
import { llmReady } from './components/AiEngine'
import { Matches } from './pages/Matches'
import { ProfilePage } from './pages/ProfilePage'
import { SettingsPage } from './pages/SettingsPage'
import { Onboarding } from './pages/Onboarding'
import { Spinner, cx } from './ui'

type Page = 'matches' | 'board' | 'profile' | 'settings'

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
          setPage('matches')
          setAdding(false)
        }}
      />
    )
  }

  const profile = profiles.find((p) => p.id === pid) ?? profiles[0]
  const isRunning = running.has(profile.id)
  const updateProfile = (p: Profile): void => setProfiles((ps) => ps!.map((x) => (x.id === p.id ? p : x)))
  const run = async (scoreOnly = false): Promise<void> => {
    setRunErr('')
    try {
      setRunning((r) => new Set(r).add(profile.id))
      await window.api.run.start(profile.id, scoreOnly ? [] : undefined)
      setPage('matches')
    } catch (e: any) {
      setRunning((r) => { const n = new Set(r); n.delete(profile.id); return n })
      setRunErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  const nav: { key: Page; label: string; icon: ReactNode }[] = [
    { key: 'matches', label: 'Today', icon: <Inbox size={16} /> },
    { key: 'board', label: 'Tracker', icon: <KanbanSquare size={16} /> },
    { key: 'profile', label: 'Profile', icon: <UserRound size={16} /> }
  ]

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* phones: top bar with the person switcher (the account photo sits at its right end) */}
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-sidebar py-2 pl-3 pr-14 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
        <img src={logo} alt="" className="h-6 w-6" draggable={false} />
        <select className="field min-w-0 flex-1 !py-1" value={profile.id} onChange={(e) => setPid(Number(e.target.value))} aria-label="Person">
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}{running.has(p.id) ? ' · checking…' : ''}{!p.active ? ' · paused' : ''}</option>)}
        </select>
        <button className="rounded-md p-1.5 text-ink-400 hover:bg-hover hover:text-ink-100" title="Add profile" aria-label="Add profile" onClick={() => setAdding(true)}><Plus size={18} /></button>
      </div>

      <aside className="relative hidden w-56 shrink-0 flex-col border-r border-line bg-sidebar px-2.5 pb-3 pt-12 md:flex">
        <div className="drag absolute inset-x-0 top-0 h-10" />
        <div className="mb-5 flex items-center gap-2 px-2">
          <img src={logo} alt="" className="h-6 w-6" draggable={false} />
          <div className="text-[13px] font-semibold">Job Hunter</div>
        </div>

        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-[11px] font-medium text-ink-400">People</span>
          <button className="rounded-md p-1 text-ink-400 hover:bg-hover hover:text-ink-100" title="Add profile" onClick={() => setAdding(true)}><Plus size={14} /></button>
        </div>
        <div className="mb-5 space-y-0.5">
          {profiles.map((p) => (
            <button key={p.id} onClick={() => setPid(p.id)}
              className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-1 text-left text-sm transition', p.id === profile.id ? 'bg-selected text-ink-100' : 'text-ink-300 hover:bg-hover')}>
              <span className={cx('grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold', p.id === profile.id ? 'bg-ink-100 text-ink-950' : 'bg-ink-700 text-ink-300')}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{p.name}</span>
              {running.has(p.id) && <span className="ml-auto text-ink-400"><Spinner size={12} /></span>}
              {!p.active && <span className="ml-auto text-[10px] text-ink-400">paused</span>}
            </button>
          ))}
        </div>

        <nav className="space-y-0.5">
          {nav.map((n) => (
            <button key={n.key} onClick={() => setPage(n.key)}
              className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition', page === n.key ? 'bg-selected text-ink-100' : 'text-ink-300 hover:bg-hover')}>
              {n.icon} {n.label}
            </button>
          ))}
        </nav>

        <div className="mt-auto">
          <button onClick={() => setPage('settings')}
            className={cx('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition', page === 'settings' ? 'bg-selected text-ink-100' : 'text-ink-300 hover:bg-hover')}>
            <Settings size={16} /> Settings
          </button>
        </div>
      </aside>

      <main className="relative min-h-0 flex-1 overflow-auto bg-ink-950">
        <div className="drag sticky top-0 z-10 hidden h-8 bg-ink-950/80 backdrop-blur md:block" />
        {runErr && (
          <div className="mx-auto mb-2 max-w-5xl px-4 md:px-8">
            <div className="rounded-md border border-rose-500/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">{runErr}</div>
          </div>
        )}
        {page === 'matches' && <Matches profile={profile} running={isRunning} onRun={run} />}
        {page === 'profile' && <ProfilePage profile={profile} onChange={updateProfile} onDeleted={async () => { const ps = await refresh(); setPid(ps[0]?.id ?? null); setPage('matches') }} />}
        {page === 'board' && <BoardPage profile={profile} />}
        {page === 'settings' && <SettingsPage secrets={secrets} setSecrets={setSecrets} profile={profile} running={running.size > 0} />}
      </main>

      {/* phones: tab bar at the bottom */}
      <nav className="grid shrink-0 grid-cols-4 border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
        {[...nav, { key: 'settings' as Page, label: 'Settings', icon: <Settings size={16} /> }].map((n) => (
          <button key={n.key} onClick={() => setPage(n.key)}
            className={cx('flex flex-col items-center gap-0.5 py-2 text-[11px] transition [&_svg]:h-5 [&_svg]:w-5', page === n.key ? 'text-ink-100' : 'text-ink-400')}>
            {n.icon} {n.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
