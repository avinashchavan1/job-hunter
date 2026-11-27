import { DragEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { BellRing, ExternalLink, GraduationCap, StickyNote, X } from 'lucide-react'
import { InterviewPrep } from '../components/Assist'
import type { Match, Profile, Status } from '@shared/types'
import { ScoreRing, Spinner, cx, timeAgo } from '../ui'

const COLUMNS: { key: Status; title: string; hint: string; tone: string }[] = [
  { key: 'shortlisted', title: 'Shortlisted', hint: 'Apply to these next', tone: '' },
  { key: 'applied', title: 'Applied', hint: 'Waiting to hear back', tone: '' },
  { key: 'interview', title: 'Interview', hint: 'In process', tone: '' },
  { key: 'offer', title: 'Offer', hint: 'Congratulations', tone: '' },
  { key: 'rejected', title: 'Closed', hint: 'Rejected / no reply', tone: '' }
]

const FOLLOW_UP_DAYS = 7

export function BoardPage({ profile }: { profile: Profile }): ReactNode {
  const [rows, setRows] = useState<Match[] | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)
  const [prep, setPrep] = useState<Match | null>(null)

  useEffect(() => {
    setRows(null)
    void window.api.matches.list(profile.id).then(setRows)
  }, [profile.id])

  const byCol = useMemo(() => {
    const m: Record<string, Match[]> = {}
    for (const c of COLUMNS) m[c.key] = []
    for (const r of rows ?? []) if (m[r.status]) m[r.status].push(r)
    for (const k of Object.keys(m)) m[k].sort((a, b) => (b.status_at || '').localeCompare(a.status_at || ''))
    return m
  }, [rows])

  const move = async (id: string, status: Status, notes?: string): Promise<void> => {
    await window.api.matches.setStatus(profile.id, id, status, notes)
    const now = new Date().toISOString()
    setRows((rs) => rs!.map((r) => (r.id === id ? { ...r, status, status_at: r.status === status ? r.status_at : now, notes: notes ?? r.notes } : r)))
  }

  const onDrop = (e: DragEvent, col: Status): void => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || drag
    setOver(null)
    setDrag(null)
    if (id) void move(id, col)
  }

  if (!rows) return <div className="grid place-items-center py-20 text-ink-400"><Spinner size={22} /></div>
  const total = COLUMNS.reduce((a, c) => a + byCol[c.key].length, 0)

  return (
    <div className="flex h-full flex-col px-4 py-4 md:px-8 md:py-6">
      <header className="mb-5">
        <h1 className="h-page">Tracker</h1>
        <p className="mt-1 text-sm text-ink-400">
          <span className="hidden md:inline">Drag cards between columns.</span><span className="md:hidden">Swipe across columns; change a status from the card.</span> Shortlist or mark jobs applied from Matches and they appear here.
          {total === 0 && ' Nothing tracked yet.'}
        </p>
      </header>
      <div className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
        {COLUMNS.map((c) => (
          <div
            key={c.key}
            onDragOver={(e) => { e.preventDefault(); setOver(c.key) }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => onDrop(e, c.key)}
            className={cx('flex min-h-0 w-[80vw] max-w-xs shrink-0 snap-start flex-col rounded-lg bg-ink-850/60 md:w-auto md:max-w-none transition', over === c.key && 'ring-2 ring-ink-400/40')}
          >
            <div className="flex items-baseline justify-between px-3 pb-2 pt-3">
              <div>
                <div className="text-sm font-semibold">{c.title}</div>
                <div className="text-[11px] text-ink-400">{c.hint}</div>
              </div>
              <span className="text-xs tabular-nums text-ink-400">{byCol[c.key].length}</span>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto px-2 pb-3">
              {byCol[c.key].map((m) => (
                <Card key={m.id} m={m} onPrep={() => setPrep(m)} onDragStart={(e) => { e.dataTransfer.setData('text/plain', m.id); setDrag(m.id) }} onNotes={(n) => move(m.id, m.status, n)} onMove={(s) => move(m.id, s)} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {prep && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-3 md:p-8" onClick={() => setPrep(null)}>
          <div className="card max-h-full w-full max-w-2xl overflow-auto p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold">Interview prep</h2>
                <p className="text-xs text-ink-400">{prep.title} · {prep.company}</p>
              </div>
              <button className="rounded-md p-1 text-ink-400 hover:bg-hover" onClick={() => setPrep(null)}><X size={16} /></button>
            </div>
            <InterviewPrep profileId={profile.id} jobId={prep.id} />
          </div>
        </div>
      )}
    </div>
  )
}

function Card({ m, onDragStart, onNotes, onPrep, onMove }: { m: Match; onDragStart: (e: DragEvent) => void; onNotes: (n: string) => void; onPrep: () => void; onMove: (s: Status) => void }): ReactNode {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(m.notes || '')
  const days = m.status_at ? (Date.now() - new Date(m.status_at).getTime()) / 86400000 : 0
  const followUp = m.status === 'applied' && days >= FOLLOW_UP_DAYS
  return (
    <div draggable onDragStart={onDragStart} className="cursor-grab rounded-md border border-line bg-ink-900 p-2.5 transition hover:border-line-strong active:cursor-grabbing">
      <div className="flex items-start gap-2.5">
        <ScoreRing score={m.score} size={30} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-medium leading-snug">{m.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-ink-400">{[m.company, m.location].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      {followUp && (
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/30 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-300">
          <BellRing size={12} /> Applied {Math.floor(days)}d ago — follow up?
        </div>
      )}
      {editing ? (
        <textarea
          autoFocus
          className="field mt-2 !p-2 text-xs"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => { setEditing(false); if (notes !== (m.notes || '')) onNotes(notes) }}
          placeholder="Recruiter name, interview date, salary discussed…"
        />
      ) : (
        m.notes && <p className="selectable mt-2 whitespace-pre-wrap rounded-lg bg-ink-900 px-2 py-1.5 text-[11px] text-ink-300">{m.notes}</p>
      )}
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-400">
        <span>{m.status_at ? timeAgo(m.status_at) : ''}</span>
        <select className="rounded border border-line bg-field px-1 py-0.5 text-[12px] text-ink-100 md:hidden" value={m.status} onChange={(e) => onMove(e.target.value as Status)} aria-label="Move to">
          {COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.title}</option>)}
        </select>
        <span className="flex gap-1">
          {(m.status === 'interview' || m.status === 'applied') && <button className="rounded p-1 hover:bg-hover hover:text-ink-100" title="Interview prep" onClick={onPrep}><GraduationCap size={13} /></button>}
          <button className="rounded p-1 hover:bg-hover hover:text-ink-100" title="Notes" onClick={() => setEditing(true)}><StickyNote size={13} /></button>
          {m.url && <button className="rounded p-1 hover:bg-hover hover:text-ink-100" title="Open posting" onClick={() => window.api.open(m.url)}><ExternalLink size={13} /></button>}
        </span>
      </div>
    </div>
  )
}
