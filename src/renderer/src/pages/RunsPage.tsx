import { ReactNode, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, OctagonAlert, XCircle } from 'lucide-react'
import type { Profile, Run } from '@shared/types'
import { Chip, Spinner, cx, timeAgo } from '../ui'

export function RunsPage({ profile, running }: { profile: Profile; running: boolean }): ReactNode {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    void window.api.runs(profile.id).then(setRuns)
  }, [profile.id, running])

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-8 py-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-brand-400">History</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Runs</h1>
      </header>
      {!runs ? <Spinner /> : runs.length === 0 ? <p className="text-sm text-ink-400">No runs yet.</p> : (
        <div className="space-y-2">
          {runs.map((r) => {
            const Icon = r.status === 'running' ? Spinner : r.status === 'ok' ? CheckCircle2 : r.status === 'partial' ? AlertTriangle : XCircle
            const tone = { ok: 'text-emerald-300', partial: 'text-amber-300', error: 'text-rose-300', running: 'text-brand-400' }[r.status]
            return (
              <div key={r.id} className="card overflow-hidden">
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <span className={tone}><Icon size={16} /></span>
                  <span className="text-sm font-medium">{new Date(r.started_at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-xs text-ink-400">{timeAgo(r.started_at)}</span>
                  <div className="ml-auto flex gap-1.5">
                    <Chip>{r.stats.new ?? 0} new</Chip>
                    <Chip>{r.stats.scored ?? 0} scored</Chip>
                    {(r.stats.strong_today ?? 0) > 0 && <Chip tone="good">{r.stats.strong_today} strong</Chip>}
                    {r.alerts.length > 0 && <Chip tone={r.alerts.some((a) => a.level === 'stop') ? 'bad' : 'warn'}>{r.alerts.length} alert{r.alerts.length > 1 ? 's' : ''}</Chip>}
                  </div>
                  <ChevronDown size={16} className={cx('text-ink-400 transition', open === r.id && 'rotate-180')} />
                </button>
                {open === r.id && (
                  <div className="space-y-3 border-t border-white/[0.06] px-4 py-3">
                    {r.alerts.map((a, i) => (
                      <div key={i} className={cx('flex gap-2 rounded-xl px-3 py-2 text-xs', a.level === 'stop' ? 'bg-rose-400/10 text-rose-300' : 'bg-amber-400/10 text-amber-300')}>
                        {a.level === 'stop' ? <OctagonAlert size={14} /> : <AlertTriangle size={14} />}
                        <b className="font-medium">{a.source}</b> {a.message}
                      </div>
                    ))}
                    <pre className="selectable max-h-80 overflow-auto rounded-xl bg-ink-950/70 p-3 font-mono text-[11px] leading-5 text-ink-300">{r.log || '(no log)'}</pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
