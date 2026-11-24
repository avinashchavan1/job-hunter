import { ReactNode, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Ban, Briefcase, Building2, CheckCircle2, ChevronDown, Clock, ExternalLink, IndianRupee, MapPin, Play, Search,
  RefreshCw, Sparkles, Star, ThumbsDown, Undo2, Wand2
} from 'lucide-react'
import type { Match, Prefs, Profile, ProfileStats, Status } from '@shared/types'
import { QuickAnswers, withDefaults } from '../components/Answers'
import { Chip, CopyButton, ScoreRing, Spinner, Stat, cx, timeAgo } from '../ui'
import { RunLog } from '../components/RunLog'

type Tab = 'strong' | 'all' | 'shortlisted' | 'applied' | 'skipped' | 'filtered'

const SOURCE_LABEL: Record<string, string> = {
  jsearch: 'JSearch', adzuna: 'Adzuna', gmail: 'Gmail', 'gmail-linkedin': 'LinkedIn alert', 'gmail-naukri': 'Naukri alert', 'gmail-indeed': 'Indeed alert', 'gmail-instahyre': 'Instahyre alert', 'gmail-foundit': 'Foundit alert', 'gmail-glassdoor': 'Glassdoor alert', 'gmail-iimjobs': 'iimjobs alert', 'gmail-hirist': 'Hirist alert', 'gmail-cutshort': 'Cutshort alert', linkedin: 'LinkedIn', naukri: 'Naukri'
}

export function Matches({ profile, running, onRun }: { profile: Profile; running: boolean; onRun: (scoreOnly?: boolean) => void }): ReactNode {
  const [rows, setRows] = useState<Match[]>([])
  const [filtered, setFiltered] = useState<Match[]>([])
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [tab, setTab] = useState<Tab>('strong')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async (): Promise<void> => {
    const [m, all, s] = await Promise.all([
      window.api.matches.list(profile.id),
      window.api.matches.list(profile.id, { includeFiltered: true }),
      window.api.stats(profile.id)
    ])
    setRows(m)
    setFiltered(all.filter((x) => x.filter_reason))
    setStats(s)
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    void load()
  }, [profile.id])
  useEffect(() => {
    if (!running) void load()
  }, [running])
  useEffect(() => window.api.run.onProgress((e) => e.profileId === profile.id && e.line.startsWith('scored') && void load()), [profile.id])

  const min = profile.prefs.min_score
  const counts = useMemo(
    () => ({
      strong: rows.filter((r) => (r.score ?? -1) >= min && !['applied', 'interview', 'offer', 'skipped', 'rejected'].includes(r.status)).length,
      all: rows.length,
      shortlisted: rows.filter((r) => r.status === 'shortlisted').length,
      applied: rows.filter((r) => ['applied', 'interview', 'offer'].includes(r.status)).length,
      skipped: rows.filter((r) => r.status === 'skipped' || r.status === 'rejected').length,
      filtered: filtered.length
    }),
    [rows, filtered, min]
  )

  const list = useMemo(() => {
    let l: Match[]
    switch (tab) {
      case 'strong': l = rows.filter((r) => (r.score ?? -1) >= min && !['applied', 'interview', 'offer', 'skipped', 'rejected'].includes(r.status)); break
      case 'shortlisted': l = rows.filter((r) => r.status === 'shortlisted'); break
      case 'applied': l = rows.filter((r) => ['applied', 'interview', 'offer'].includes(r.status)); break
      case 'skipped': l = rows.filter((r) => r.status === 'skipped' || r.status === 'rejected'); break
      case 'filtered': l = filtered; break
      default: l = rows
    }
    const s = q.trim().toLowerCase()
    return s ? l.filter((r) => `${r.title} ${r.company} ${r.location}`.toLowerCase().includes(s)) : l
  }, [rows, filtered, tab, q, min])

  const setStatus = async (m: Match, status: Status): Promise<void> => {
    await window.api.matches.setStatus(profile.id, m.id, status)
    setRows((rs) => rs.map((r) => (r.id === m.id ? { ...r, status } : r)))
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'strong', label: `Strong (≥${min})` },
    { key: 'all', label: 'All scored' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'applied', label: 'Applied' },
    { key: 'skipped', label: 'Skipped' },
    { key: 'filtered', label: 'Filtered out' }
  ]

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-8 py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-600 dark:text-brand-400">Today’s matches</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{profile.name}</h1>
          <p className="mt-1 text-sm text-ink-400">{profile.profile?.headline}</p>
        </div>
        <div className="flex gap-2">
          {!!stats?.unscored && !running && (
            <button className="btn btn-outline" onClick={() => onRun(true)}>
              <RefreshCw size={15} /> Score {stats.unscored} pending
            </button>
          )}
          <button className="btn btn-primary" onClick={() => onRun()} disabled={running}>
            {running ? <Spinner /> : <Play size={16} />} {running ? 'Running…' : 'Find jobs now'}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="New today" value={stats?.new_today ?? '–'} icon={<Sparkles size={14} className="text-brand-600 dark:text-brand-400" />} />
        <Stat label="Strong matches" value={counts.strong} sub={`score ≥ ${min}`} icon={<Star size={14} className="text-emerald-700 dark:text-emerald-300" />} />
        <Stat label="Applied" value={stats?.by_status.applied ?? 0} icon={<CheckCircle2 size={14} className="text-emerald-700 dark:text-emerald-300" />} />
        <Stat label="Avg score" value={stats?.avg_score || '–'} sub={`${stats?.scored ?? 0} scored · ${stats?.filtered ?? 0} filtered`} icon={<Briefcase size={14} className="text-ink-400" />} />
      </div>

      <RunLog profileId={profile.id} running={running} />

      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-ink-900 p-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cx('rounded-lg px-3 py-1.5 text-xs font-medium transition', tab === t.key ? 'bg-ink-900 text-ink-100 shadow-sm' : 'text-ink-400 hover:text-ink-100')}
            >
              {t.label} <span className="ml-1 tabular-nums text-ink-400">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="field !pl-8" placeholder="Search title, company, city" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20 text-ink-400"><Spinner size={22} /></div>
      ) : list.length === 0 ? (
        <Empty tab={tab} hasAny={rows.length > 0} onRun={() => onRun()} running={running} />
      ) : (
        <div className="space-y-2.5">
          {list.map((m) => (
            <MatchCard key={m.id} m={m} answers={withDefaults(profile.prefs.answers ?? [], profile)} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} onStatus={(s) => setStatus(m, s)} profileId={profile.id}
              onRescore={async () => {
                const u = await window.api.matches.rescore(profile.id, m.id)
                if (u) setRows((rs) => rs.map((r) => (r.id === m.id ? { ...r, ...u } : r)))
              }} />
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ tab, hasAny, onRun, running }: { tab: Tab; hasAny: boolean; onRun: () => void; running: boolean }): ReactNode {
  return (
    <div className="card grid place-items-center px-6 py-16 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/10 text-brand-600 dark:text-brand-400"><Briefcase size={22} /></div>
      <h3 className="mt-4 font-semibold">{hasAny ? 'Nothing in this view' : 'No jobs yet'}</h3>
      <p className="mt-1 max-w-sm text-sm text-ink-400">
        {hasAny
          ? tab === 'strong' ? 'No unapplied jobs at or above your minimum score. Check “All scored”, or lower the minimum in Profile.' : 'Try another tab.'
          : 'Run a search to pull fresh postings from your sources and score them against the resume.'}
      </p>
      {!hasAny && (
        <button className="btn btn-primary mt-5" onClick={onRun} disabled={running}>
          {running ? <Spinner /> : <Play size={16} />} Find jobs now
        </button>
      )}
    </div>
  )
}

function MatchCard({ m, answers, open, onToggle, onStatus, onRescore, profileId }: { m: Match; answers: Prefs['answers']; open: boolean; onToggle: () => void; onStatus: (s: Status) => void; onRescore: () => Promise<void>; profileId: number }): ReactNode {
  const [rescoring, setRescoring] = useState(false)
  const [af, setAf] = useState<'' | 'busy' | 'open'>('')
  const [afErr, setAfErr] = useState('')
  const autofill = async (): Promise<void> => {
    setAfErr('')
    setAf('busy')
    try {
      await window.api.autofill.open(profileId, m.id)
      setAf('open')
      setTimeout(() => setAf(''), 4000)
    } catch (e: any) {
      setAf('')
      setAfErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  const [rerr, setRerr] = useState('')
  const srcs = (m.sources || m.source || '').split(',').filter(Boolean)
  const done = m.status === 'applied'
  return (
    <article className={cx('card overflow-hidden transition', open ? 'border-brand-500/25 bg-ink-900' : 'hover:border-line-strong', done && 'opacity-70')}>
      <div className="flex cursor-pointer items-center gap-4 px-4 py-3.5" onClick={onToggle}>
        <ScoreRing score={m.score} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{m.title}</h3>
            {m.status !== 'new' && <StatusPill s={m.status} />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-400">
            <span className="inline-flex items-center gap-1"><Building2 size={12} />{m.company}</span>
            {m.location && <span className="inline-flex items-center gap-1"><MapPin size={12} />{m.location}</span>}
            {m.salary && <span className="inline-flex items-center gap-1"><IndianRupee size={12} />{m.salary}</span>}
            <span className="inline-flex items-center gap-1"><Clock size={12} />{m.posted_at ? `posted ${timeAgo(m.posted_at)}` : `found ${timeAgo(m.found_at)}`}</span>
          </div>
        </div>
        <div className="hidden gap-1 md:flex">
          {m.matched.length + m.missing.length > 0 && (
            <Chip tone={m.missing.length <= 1 ? 'good' : m.missing.length <= 3 ? 'warn' : 'bad'}>
              {m.matched.length}/{m.matched.length + m.missing.length} reqs
            </Chip>
          )}
          {srcs.map((s) => <Chip key={s}>{SOURCE_LABEL[s] ?? s}</Chip>)}
        </div>
        {m.url && (
          <button
            className="btn btn-outline !py-1.5"
            title="Opens in Job Hunter's Chrome window with an Autofill button. It fills the form — you check and submit."
            disabled={af === 'busy'}
            onClick={(e) => {
              e.stopPropagation()
              void autofill()
            }}
          >
            {af === 'busy' ? <Spinner size={14} /> : <Wand2 size={14} />} {af === 'open' ? 'Opened in Chrome' : 'Autofill'}
          </button>
        )}
        {m.url && (
          <button
            className="btn btn-primary !py-1.5"
            onClick={(e) => {
              e.stopPropagation()
              void window.api.open(m.url)
            }}
          >
            Apply <ExternalLink size={14} />
          </button>
        )}
        <ChevronDown size={18} className={cx('text-ink-400 transition', open && 'rotate-180')} />
      </div>
      {afErr && <p className="-mt-1 px-4 pb-3 text-xs text-rose-700 dark:text-rose-300">{afErr}</p>}

      {open && (
        <div className="grid grid-cols-5 gap-5 border-t border-line px-4 py-4">
          <div className="col-span-2 space-y-4">
            {m.filter_reason && (
              <div className="rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">Filtered out: {m.filter_reason}</div>
            )}
            {m.matched.length + m.missing.length > 0 && (
              <div>
                <h4 className="label">Requirements · {m.matched.length} of {m.matched.length + m.missing.length}</h4>
                <div className="flex flex-wrap gap-1.5">
                  {m.matched.map((x) => <Chip key={'y' + x} tone="good">✓ {x}</Chip>)}
                  {m.missing.map((x) => <Chip key={'n' + x} tone="bad">✕ {x}</Chip>)}
                </div>
              </div>
            )}
            {m.reasons.length > 0 && (
              <div>
                <h4 className="label">Why it fits</h4>
                <ul className="space-y-1.5 text-sm text-ink-300">
                  {m.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2"><CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {m.red_flags.length > 0 && (
              <div>
                <h4 className="label">Watch out</h4>
                <ul className="space-y-1.5 text-sm text-ink-300">
                  {m.red_flags.map((r, i) => (
                    <li key={i} className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />{r}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {m.status !== 'applied' ? (
                <button className="btn btn-outline !py-1.5 text-xs" onClick={() => onStatus('applied')}><CheckCircle2 size={14} /> Mark applied</button>
              ) : (
                <button className="btn btn-outline !py-1.5 text-xs" onClick={() => onStatus('new')}><Undo2 size={14} /> Undo applied</button>
              )}
              {m.status !== 'shortlisted' && m.status !== 'applied' && (
                <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => onStatus('shortlisted')}><Star size={14} /> Shortlist</button>
              )}
              {m.status !== 'skipped' && (
                <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => onStatus('skipped')}><Ban size={14} /> Skip</button>
              )}
              {m.status !== 'rejected' && (
                <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => onStatus('rejected')}><ThumbsDown size={14} /> Rejected</button>
              )}
              <button className="btn btn-ghost !py-1.5 text-xs" disabled={rescoring}
                onClick={async () => { setRerr(''); setRescoring(true); try { await onRescore() } catch (e: any) { setRerr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) } setRescoring(false) }}>
                {rescoring ? <Spinner size={14} /> : <RefreshCw size={14} />} {m.score == null ? 'Score now' : 'Re-score'}
              </button>
            </div>
            {rerr && <p className="text-xs text-rose-700 dark:text-rose-300">{rerr}</p>}
          </div>
          <div className="col-span-3 space-y-4">
            {m.cover_note && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="label !mb-0">Tailored cover note</h4>
                  <CopyButton text={m.cover_note} />
                </div>
                <p className="selectable whitespace-pre-wrap rounded-xl bg-ink-850 p-3.5 text-sm leading-relaxed text-ink-100">{m.cover_note}</p>
              </div>
            )}
            <QuickAnswers answers={answers} />
            {m.description && (
              <details className="group">
                <summary className="label cursor-pointer list-none hover:text-ink-300">Job description ▸</summary>
                <p className="selectable mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-ink-850 p-3.5 text-xs leading-relaxed text-ink-300">{m.description}</p>
              </details>
            )}
          </div>
        </div>
      )}
    </article>
  )
}

function StatusPill({ s }: { s: Status }): ReactNode {
  const map: Record<Status, [string, 'good' | 'brand' | 'default' | 'bad' | 'warn']> = {
    applied: ['Applied', 'good'], interview: ['Interview', 'good'], offer: ['Offer 🎉', 'good'], shortlisted: ['Shortlisted', 'brand'], skipped: ['Skipped', 'default'], rejected: ['Rejected', 'bad'], new: ['New', 'default']
  }
  return <Chip tone={map[s][1]}>{map[s][0]}</Chip>
}
