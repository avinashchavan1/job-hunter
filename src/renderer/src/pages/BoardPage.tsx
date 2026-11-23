import { DragEvent, ReactNode, useEffect, useMemo, useState } from 'react'
import { BellRing, Building2, ExternalLink, MapPin, StickyNote } from 'lucide-react'
import type { Match, Profile, Status } from '@shared/types'
import { ScoreRing, Spinner, cx, timeAgo } from '../ui'

const COLUMNS: { key: Status; title: string; hint: string; tone: string }[] = [
  { key: 'shortlisted', title: 'Shortlisted', hint: 'Apply to these next', tone: 'border-t-brand-500' },
  { key: 'applied', title: 'Applied', hint: 'Waiting to hear back', tone: 'border-t-sky-400' },
  { key: 'interview', title: 'Interview', hint: 'In process', tone: 'border-t-amber-400' },
  { key: 'offer', title: 'Offer', hint: '🎉', tone: 'border-t-emerald-400' },
  { key: 'rejected', title: 'Closed', hint: 'Rejected / no reply', tone: 'border-t-rose-400' }
]

const FOLLOW_UP_DAYS = 7

export function BoardPage({ profile }: { profile: Profile }): ReactNode {
  const [rows, setRows] = useState<Match[] | null>(null)
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)

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
    <div className="flex h-full flex-col px-8 py-6">
      <header className="mb-5">
        <p className="text-xs font-medium uppercase tracking-wider text-brand-400">Tracker</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Applications</h1>
        <p className="mt-1 text-sm text-ink-400">
          Drag cards between columns. Shortlist or mark jobs applied from Matches and they appear here.
          {total === 0 && ' Nothing tracked yet.'}
        </p>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-5 gap-3">
        {COLUMNS.map((c) => (
          <div
            key={c.key}
            onDragOver={(e) => { e.preventDefault(); setOver(c.key) }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => onDrop(e, c.key)}
            className={cx('flex min-h-0 flex-col rounded-2xl border border-t-2 border-white/[0.06] bg-ink-900/60 transition', c.tone, over === c.key && 'bg-brand-500/5 ring-2 ring-brand-500/30')}
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
                <Card key={m.id} m={m} onDragStart={(e) => { e.dataTransfer.setData('text/plain', m.id); setDrag(m.id) }} onNotes={(n) => move(m.id, m.status, n)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Card({ m, onDragStart, onNotes }: { m: Match; onDragStart: (e: DragEvent) => void; onNotes: (n: string) => void }): ReactNode {
  const [editing, setEditing] = useState(false)
  const [notes, setNotes] = useState(m.notes || '')
  const days = m.status_at ? (Date.now() - new Date(m.status_at).getTime()) / 86400000 : 0
  const followUp = m.status === 'applied' && days >= FOLLOW_UP_DAYS
  return (
    <div draggable onDragStart={onDragStart} className="cursor-grab rounded-xl border border-white/[0.06] bg-ink-850 p-3 shadow-sm transition hover:border-white/15 active:cursor-grabbing">
      <div className="flex items-start gap-2.5">
        <ScoreRing score={m.score} size={34} />
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-[13px] font-medium leading-snug">{m.title}</div>
          <div className="mt-1 flex items-center gap-1 truncate text-[11px] text-ink-400"><Building2 size={11} />{m.company}</div>
          {m.location && <div className="flex items-center gap-1 truncate text-[11px] text-ink-400"><MapPin size={11} />{m.location}</div>}
        </div>
      </div>
      {followUp && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-2 py-1 text-[11px] text-amber-300">
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
        <span className="flex gap-1">
          <button className="rounded p-1 hover:bg-white/5 hover:text-ink-100" title="Notes" onClick={() => setEditing(true)}><StickyNote size={13} /></button>
          {m.url && <button className="rounded p-1 hover:bg-white/5 hover:text-ink-100" title="Open posting" onClick={() => window.api.open(m.url)}><ExternalLink size={13} /></button>}
        </span>
      </div>
    </div>
  )
}
