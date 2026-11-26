// "Today": the one screen people use every day. Best unreviewed jobs first; open one to see why it
// fits, get a tailored resume / cover note / interview prep, and Apply (opens with Fill form).
import { ReactNode, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, EyeOff, ExternalLink, Play, RefreshCw, Search, Star, Undo2, X } from 'lucide-react'
import type { Match, Prefs, Profile, ProfileStats, Status } from '@shared/types'
import { checkTrust, Trust } from '@shared/trust'
import { QuickAnswers, withDefaults } from '../components/Answers'
import { InterviewPrep, TailoredResume } from '../components/Assist'
import { CopyButton, ScoreRing, Spinner, cx, timeAgo } from '../ui'
import { RunLog } from '../components/RunLog'

type View = 'review' | 'shortlisted' | 'all' | 'hidden'
const DONE: Status[] = ['applied', 'interview', 'offer', 'rejected', 'skipped']
const clean = (e: any): string => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export function Matches({ profile, running, onRun }: { profile: Profile; running: boolean; onRun: (scoreOnly?: boolean) => void }): ReactNode {
  const [rows, setRows] = useState<Match[]>([])
  const [filtered, setFiltered] = useState<Match[]>([])
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [view, setView] = useState<View>('review')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastRun, setLastRun] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    const [m, all, s, runs] = await Promise.all([
      window.api.matches.list(profile.id),
      window.api.matches.list(profile.id, { includeFiltered: true }),
      window.api.stats(profile.id),
      window.api.runs(profile.id)
    ])
    setRows(m)
    setFiltered(all.filter((x) => x.filter_reason))
    setStats(s)
    setLastRun(runs[0]?.started_at ?? null)
    setLoading(false)
  }
  useEffect(() => {
    setLoading(true)
    setOpen(null)
    void load()
  }, [profile.id])
  useEffect(() => {
    if (!running) void load()
  }, [running])

  const min = profile.prefs.min_score
  const trust = useMemo(() => new Map([...rows, ...filtered].map((r) => [r.id, checkTrust(r)])), [rows, filtered])
  const lists = useMemo(() => {
    const review = rows.filter((r) => (r.score ?? -1) >= min && !DONE.includes(r.status) && r.status !== 'shortlisted')
    return {
      review,
      shortlisted: rows.filter((r) => r.status === 'shortlisted'),
      all: rows,
      hidden: [...rows.filter((r) => r.status === 'skipped' || r.status === 'rejected'), ...filtered]
    }
  }, [rows, filtered, min])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    const l = lists[view]
    return s ? l.filter((r) => `${r.title} ${r.company} ${r.location}`.toLowerCase().includes(s)) : l
  }, [lists, view, q])

  const setStatus = async (m: Match, status: Status): Promise<void> => {
    await window.api.matches.setStatus(profile.id, m.id, status)
    setRows((rs) => rs.map((r) => (r.id === m.id ? { ...r, status, status_at: new Date().toISOString() } : r)))
  }

  const first = profile.name.split(' ')[0]
  const newToday = lists.review.filter((r) => r.found_at >= new Date().toISOString().slice(0, 10)).length
  const views: { key: View; label: string }[] = [
    { key: 'review', label: 'To review' },
    { key: 'shortlisted', label: 'Shortlisted' },
    { key: 'all', label: 'All' },
    { key: 'hidden', label: 'Hidden' }
  ]

  return (
    <div className="mx-auto max-w-5xl px-8 pb-10 pt-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="h-page">{greeting()}, {first}</h1>
          <p className="mt-1 text-sm text-ink-400">
            {lists.review.length ? `${lists.review.length} job${lists.review.length === 1 ? '' : 's'} worth a look` : 'Nothing new to review'}
            {newToday ? ` · ${newToday} new today` : ''}
            {lastRun ? ` · checked ${timeAgo(lastRun)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!!stats?.unscored && !running && (
            <button className="btn btn-ghost" onClick={() => onRun(true)} title="Score jobs that were found but not scored yet">
              <RefreshCw size={14} /> Score {stats.unscored} more
            </button>
          )}
          <button className="btn btn-primary" onClick={() => onRun()} disabled={running}>
            {running ? <Spinner size={14} /> : <Play size={14} />} {running ? 'Checking…' : 'Check for jobs'}
          </button>
        </div>
      </header>

      <div className="mt-4"><RunLog profileId={profile.id} running={running} /></div>

      <div className="mt-5 flex items-center justify-between gap-3 border-b border-line">
        <nav className="-mb-px flex gap-5">
          {views.map((v) => (
            <button key={v.key} onClick={() => { setView(v.key); setOpen(null) }}
              className={cx('border-b-2 pb-2 text-[13px] transition', view === v.key ? 'border-ink-100 font-medium text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-100')}>
              {v.label} <span className="tabular-nums text-ink-400">{lists[v.key].length}</span>
            </button>
          ))}
        </nav>
        <div className="relative mb-1.5 w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <input className="field !py-1 !pl-7 text-[13px]" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20 text-ink-400"><Spinner size={20} /></div>
      ) : list.length === 0 ? (
        <Empty view={view} hasAny={rows.length > 0} onRun={() => onRun()} running={running} min={min} />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((m) => (
            <JobRow key={m.id} m={m} trust={trust.get(m.id)!} profile={profile} open={open === m.id}
              onToggle={() => setOpen(open === m.id ? null : m.id)} onStatus={(s) => setStatus(m, s)}
              onRescored={(u) => setRows((rs) => rs.map((r) => (r.id === u.id ? { ...r, ...u } : r)))} />
          ))}
        </ul>
      )}
    </div>
  )
}

function Empty({ view, hasAny, onRun, running, min }: { view: View; hasAny: boolean; onRun: () => void; running: boolean; min: number }): ReactNode {
  const text = !hasAny
    ? 'No jobs yet. Check for jobs to pull fresh postings and score them against the resume.'
    : view === 'review'
      ? `You're through everything scoring ${min} or more. New jobs show up here after the next check.`
      : view === 'shortlisted' ? 'Star a job to keep it here.' : 'Nothing here.'
  return (
    <div className="py-16 text-center">
      <p className="mx-auto max-w-sm text-sm text-ink-400">{text}</p>
      {!hasAny && (
        <button className="btn btn-primary mt-4" onClick={onRun} disabled={running}>{running ? <Spinner size={14} /> : <Play size={14} />} Check for jobs</button>
      )}
    </div>
  )
}

function TrustTag({ t }: { t: Trust }): ReactNode {
  if (t.level === 'direct' || t.level === 'ok') return null
  const tone = t.level === 'risky' ? 'text-rose-700 dark:text-rose-400' : 'text-amber-700 dark:text-amber-400'
  return <span className={cx('text-xs font-medium', tone)} title={t.reasons.join(' ')}>{t.label}</span>
}

function JobRow({ m, trust, profile, open, onToggle, onStatus, onRescored }: {
  m: Match; trust: Trust; profile: Profile; open: boolean; onToggle: () => void; onStatus: (s: Status) => void; onRescored: (m: Match) => void
}): ReactNode {
  const [opening, setOpening] = useState(false)
  const [err, setErr] = useState('')
  const apply = async (): Promise<void> => {
    setErr('')
    setOpening(true)
    try {
      await window.api.autofill.open(profile.id, m.id)
    } catch (e) {
      setErr(clean(e))
    }
    setTimeout(() => setOpening(false), 1500)
  }
  const starred = m.status === 'shortlisted'
  const hidden = m.status === 'skipped' || m.status === 'rejected' || !!m.filter_reason
  const meta = [m.company, m.location, m.salary, m.posted_at ? timeAgo(m.posted_at) : `found ${timeAgo(m.found_at)}`].filter(Boolean)

  return (
    <li className={cx(open && 'bg-ink-900 -mx-3 rounded-lg px-3 ring-1 ring-line')}>
      <div className="group flex items-center gap-4 py-3">
        <ScoreRing score={m.score} />
        <button className="min-w-0 flex-1 text-left" onClick={onToggle}>
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium">{m.title}</span>
            {m.status === 'applied' && <span className="text-xs text-emerald-700 dark:text-emerald-400">Applied</span>}
            <TrustTag t={trust} />
          </div>
          <div className="mt-0.5 truncate text-xs text-ink-400">{meta.join(' · ')}</div>
        </button>
        <div className="flex items-center gap-1">
          <button className={cx('rounded-md p-1.5 hover:bg-hover', starred ? 'text-amber-500' : 'text-ink-400 opacity-0 group-hover:opacity-100', open && 'opacity-100')}
            title={starred ? 'Remove from shortlist' : 'Shortlist'} onClick={() => onStatus(starred ? 'new' : 'shortlisted')}>
            <Star size={15} fill={starred ? 'currentColor' : 'none'} />
          </button>
          <button className={cx('rounded-md p-1.5 text-ink-400 hover:bg-hover hover:text-ink-100', !open && 'opacity-0 group-hover:opacity-100')}
            title={hidden ? 'Bring back' : 'Hide — not interested'} onClick={() => onStatus(hidden ? 'new' : 'skipped')}>
            {hidden ? <Undo2 size={15} /> : <EyeOff size={15} />}
          </button>
          {m.url && (
            <button className="btn btn-outline ml-1 !py-1" onClick={apply} disabled={opening} title="Opens the posting in Job Hunter's Chrome window, with a Fill form button for the application">
              {opening ? <Spinner size={13} /> : null} Apply
            </button>
          )}
          <button className="rounded-md p-1.5 text-ink-400 hover:bg-hover" onClick={onToggle} title={open ? 'Close' : 'Details'}>
            <ChevronRight size={16} className={cx('transition', open && 'rotate-90')} />
          </button>
        </div>
      </div>
      {err && <p className="-mt-1 pb-2 pl-16 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
      {open && <JobDetail m={m} trust={trust} profile={profile} onStatus={onStatus} onRescored={onRescored} />}
    </li>
  )
}

type Tool = 'note' | 'resume' | 'prep' | 'answers' | 'posting'

function JobDetail({ m, trust, profile, onStatus, onRescored }: { m: Match; trust: Trust; profile: Profile; onStatus: (s: Status) => void; onRescored: (m: Match) => void }): ReactNode {
  const [tool, setTool] = useState<Tool>(m.status === 'interview' ? 'prep' : 'note')
  const [rescoring, setRescoring] = useState(false)
  const [err, setErr] = useState('')
  const answers: Prefs['answers'] = withDefaults(profile.prefs.answers ?? [], profile)
  const tools: { key: Tool; label: string }[] = [
    { key: 'note', label: 'Cover note' },
    { key: 'resume', label: 'Tailored resume' },
    { key: 'prep', label: 'Interview prep' },
    { key: 'answers', label: 'Saved answers' },
    { key: 'posting', label: 'Posting' }
  ]
  const rescore = async (): Promise<void> => {
    setErr('')
    setRescoring(true)
    try {
      const u = await window.api.matches.rescore(profile.id, m.id)
      if (u) onRescored(u)
    } catch (e) {
      setErr(clean(e))
    }
    setRescoring(false)
  }

  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-8 border-t border-line pb-5 pt-4">
      <div className="space-y-4 text-sm">
        {m.filter_reason && <p className="text-xs text-rose-700 dark:text-rose-300">Hidden by your filters: {m.filter_reason}</p>}
        {trust.level !== 'direct' && trust.level !== 'ok' && (
          <div className={cx('border-l-2 pl-3', trust.level === 'risky' ? 'border-rose-500' : 'border-amber-500')}>
            <div className="font-medium">{trust.label}</div>
            <p className="text-xs text-ink-300">{trust.reasons.join(' ')}</p>
            {trust.findOriginal && (
              <button className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-ink-100 underline underline-offset-2" onClick={() => window.api.open(trust.findOriginal!)}>
                Find it on the company’s site <ExternalLink size={11} />
              </button>
            )}
          </div>
        )}
        {m.matched.length + m.missing.length > 0 && (
          <div>
            <h4 className="label">Requirements — has {m.matched.length} of {m.matched.length + m.missing.length}</h4>
            <ul className="space-y-0.5">
              {m.matched.map((x) => <li key={'y' + x} className="flex gap-2 text-ink-300"><Check size={14} className="mt-0.5 shrink-0 text-emerald-600" />{x}</li>)}
              {m.missing.map((x) => <li key={'n' + x} className="flex gap-2 text-ink-400"><X size={14} className="mt-0.5 shrink-0 text-rose-500" />{x}</li>)}
            </ul>
          </div>
        )}
        {m.reasons.length > 0 && (
          <div>
            <h4 className="label">Why it fits</h4>
            <ul className="list-disc space-y-1 pl-4 text-ink-300">{m.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}
        {m.red_flags.length > 0 && (
          <div>
            <h4 className="label">Watch out</h4>
            <ul className="list-disc space-y-1 pl-4 text-ink-300">{m.red_flags.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {m.status !== 'applied' ? (
            <button className="btn btn-outline !py-1 text-xs" onClick={() => onStatus('applied')}><Check size={13} /> I applied</button>
          ) : (
            <button className="btn btn-outline !py-1 text-xs" onClick={() => onStatus('new')}><Undo2 size={13} /> Not applied</button>
          )}
          {m.url && <button className="btn btn-ghost !py-1 text-xs" onClick={() => window.api.open(m.url)}>Open in my browser <ExternalLink size={12} /></button>}
          <button className="btn btn-ghost !py-1 text-xs" onClick={rescore} disabled={rescoring}>{rescoring ? <Spinner size={13} /> : <RefreshCw size={13} />} {m.score == null ? 'Score' : 'Re-score'}</button>
        </div>
        {err && <p className="text-xs text-rose-700 dark:text-rose-300">{err}</p>}
      </div>

      <div className="min-w-0">
        <div className="mb-3 flex gap-1 border-b border-line">
          {tools.map((t) => (
            <button key={t.key} onClick={() => setTool(t.key)}
              className={cx('-mb-px border-b-2 px-2 pb-1.5 text-xs transition', tool === t.key ? 'border-ink-100 font-medium text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-100')}>
              {t.label}
            </button>
          ))}
        </div>
        {tool === 'note' && (
          m.cover_note ? (
            <div>
              <p className="selectable whitespace-pre-wrap text-sm leading-relaxed text-ink-100">{m.cover_note}</p>
              <div className="mt-3"><CopyButton text={m.cover_note} /></div>
            </div>
          ) : <p className="text-sm text-ink-400">Score this job to get a cover note.</p>
        )}
        {tool === 'resume' && <TailoredResume profileId={profile.id} jobId={m.id} />}
        {tool === 'prep' && <InterviewPrep profileId={profile.id} jobId={m.id} />}
        {tool === 'answers' && (answers.some((a) => a.value.trim()) ? <QuickAnswers answers={answers} /> : <p className="text-sm text-ink-400">Add answers to common questions in Profile.</p>)}
        {tool === 'posting' && (
          m.description ? <p className="selectable max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-ink-300">{m.description}</p> : <p className="text-sm text-ink-400">No description was captured. Open the posting.</p>
        )}
      </div>
    </div>
  )
}
