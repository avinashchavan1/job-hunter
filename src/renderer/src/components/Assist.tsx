import { ReactNode, useEffect, useState } from 'react'
import { FileText, FolderOpen, RefreshCw } from 'lucide-react'
import type { Prep, Tailored } from '@shared/types'
import { Spinner, timeAgo } from '../ui'

const clean = (e: any): string => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function TailoredResume({ profileId, jobId }: { profileId: number; jobId: string }): ReactNode {
  const [t, setT] = useState<Tailored | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    setT(null)
    void window.api.assist.tailored(profileId, jobId).then(setT)
  }, [profileId, jobId])

  const make = async (): Promise<void> => {
    setErr('')
    setBusy(true)
    try {
      setT(await window.api.assist.tailor(profileId, jobId))
    } catch (e) {
      setErr(clean(e))
    }
    setBusy(false)
  }

  if (!t)
    return (
      <div>
        <p className="text-sm text-ink-300">A copy of the resume reworded for this posting: same jobs, dates and facts, with the most relevant skills and results first. Saved as a PDF, and Fill form attaches it instead of the original.</p>
        <button className="btn btn-outline mt-3" onClick={make} disabled={busy}>
          {busy ? <Spinner size={14} /> : <FileText size={14} />} {busy ? 'Writing… (about 30 s)' : 'Make tailored resume'}
        </button>
        {err && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
      </div>
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" onClick={() => window.api.reveal(t.pdf, true)}><FileText size={14} /> Open PDF</button>
        <button className="btn btn-outline" onClick={() => window.api.reveal(t.pdf)}><FolderOpen size={14} /> Show in folder</button>
        <button className="btn btn-ghost" onClick={make} disabled={busy}>{busy ? <Spinner size={14} /> : <RefreshCw size={14} />} Redo</button>
        <span className="text-xs text-ink-400">made {timeAgo(t.created_at)}</span>
      </div>
      <div>
        <h4 className="label">What changed — check before you use it</h4>
        <ul className="list-disc space-y-1 pl-4 text-sm text-ink-300">
          {t.changes.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </div>
      <details>
        <summary className="label cursor-pointer">New summary</summary>
        <p className="selectable text-sm text-ink-300">{t.summary}</p>
      </details>
      {err && <p className="text-xs text-rose-700 dark:text-rose-300">{err}</p>}
    </div>
  )
}

export function InterviewPrep({ profileId, jobId }: { profileId: number; jobId: string }): ReactNode {
  const [p, setP] = useState<Prep | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => {
    setP(null)
    void window.api.assist.getPrep(profileId, jobId).then(setP)
  }, [profileId, jobId])

  const make = async (): Promise<void> => {
    setErr('')
    setBusy(true)
    try {
      setP(await window.api.assist.prep(profileId, jobId))
    } catch (e) {
      setErr(clean(e))
    }
    setBusy(false)
  }

  if (!p)
    return (
      <div>
        <p className="text-sm text-ink-300">Likely questions for this role, with talking points from the resume, topics to revise, and good questions to ask them.</p>
        <button className="btn btn-outline mt-3" onClick={make} disabled={busy}>
          {busy ? <Spinner size={14} /> : <RefreshCw size={14} />} {busy ? 'Preparing… (about 20 s)' : 'Prepare for interview'}
        </button>
        {err && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
      </div>
    )

  return (
    <div className="selectable space-y-4 text-sm">
      <ol className="space-y-3">
        {p.questions.map((q, i) => (
          <li key={i}>
            <div className="font-medium text-ink-100">{i + 1}. {q.q}</div>
            <div className="text-xs text-ink-400">{q.why}</div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-300">{q.points.map((x, j) => <li key={j}>{x}</li>)}</ul>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 gap-5">
        <div>
          <h4 className="label">Brush up on</h4>
          <ul className="list-disc space-y-0.5 pl-4 text-ink-300">{p.revise.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
        <div>
          <h4 className="label">Ask them</h4>
          <ul className="list-disc space-y-0.5 pl-4 text-ink-300">{p.ask_them.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      </div>
      <button className="btn btn-ghost !px-2 text-xs" onClick={make} disabled={busy}>{busy ? <Spinner size={13} /> : <RefreshCw size={13} />} Redo</button>
    </div>
  )
}
