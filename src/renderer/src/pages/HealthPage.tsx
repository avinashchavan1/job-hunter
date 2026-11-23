import { ReactNode, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Cpu, Mail, Search, XCircle } from 'lucide-react'
import { Chip, Section, Spinner, cx, timeAgo } from '../ui'

type Health = Awaited<ReturnType<typeof window.api.health>>

function Dot({ tone }: { tone: 'ok' | 'warn' | 'bad' | 'off' }): ReactNode {
  const c = { ok: 'bg-emerald-400', warn: 'bg-amber-400', bad: 'bg-rose-400', off: 'bg-ink-600' }[tone]
  return <span className={cx('inline-block h-2 w-2 rounded-full', c)} />
}

export function HealthPage({ running }: { running: boolean }): ReactNode {
  const [h, setH] = useState<Health | null>(null)
  useEffect(() => {
    const load = (): void => void window.api.health().then(setH)
    load()
    const t = setInterval(load, 10_000)
    return () => clearInterval(t)
  }, [running])
  if (!h) return <div className="grid place-items-center py-20 text-ink-400"><Spinner size={22} /></div>

  const llmTone = h.llm.failAt && (!h.llm.okAt || h.llm.failAt > h.llm.okAt) ? 'bad' : h.llm.okAt ? 'ok' : 'off'
  const q = h.jobApi
  const used = q.limit && q.remaining != null ? q.limit - q.remaining : q.usedThisMonth
  const limit = q.limit ?? (q.provider === 'jsearch' ? 200 : null)
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const runsLeft = limit ? Math.floor((limit - used) / Math.max(1, q.perRun * Math.max(1, h.profiles.filter((p: any) => p.active).length))) : null

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-brand-400">Status</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Health & quotas</h1>
        <p className="mt-1 text-sm text-ink-400">Everything the daily run depends on, at a glance. Refreshes every 10 seconds.</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm font-medium"><Cpu size={16} className="text-brand-400" /> AI engine <span className="ml-auto"><Dot tone={llmTone} /></span></div>
          <p className="mt-2 truncate text-xs text-ink-400" title={h.llm.label}>{h.llm.label}</p>
          <div className="mt-3 space-y-1.5 text-xs">
            {h.llm.okAt && <p className="text-emerald-300">Last success {timeAgo(h.llm.okAt)}{h.llm.okVia ? ` · ${h.llm.okVia}` : ''}</p>}
            {h.llm.failAt && <p className="text-rose-300" title={h.llm.failMsg}>Last failure {timeAgo(h.llm.failAt)}</p>}
            {!h.llm.okAt && !h.llm.failAt && <p className="text-ink-400">No calls since the app started.</p>}
          </div>
          {h.llm.chain.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {h.llm.chain.map((m: string, i: number) => (
                <Chip key={m} tone={h.llm.cooled.includes(m) ? 'warn' : i === 0 ? 'brand' : 'default'}>{i + 1}. {m.split('/').pop()}{h.llm.cooled.includes(m) ? ' · resting' : ''}</Chip>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm font-medium"><Search size={16} className="text-brand-400" /> Job search API <span className="ml-auto"><Dot tone={!q.keySet ? 'bad' : pct > 85 ? 'warn' : 'ok'} /></span></div>
          <p className="mt-2 text-xs text-ink-400">{q.provider === 'jsearch' ? 'JSearch (RapidAPI) · free Basic' : 'Adzuna'}</p>
          {q.provider === 'jsearch' && (
            <>
              <div className="mt-3 flex items-baseline gap-1"><span className="text-2xl font-semibold tabular-nums">{used}</span><span className="text-sm text-ink-400">/ {limit ?? '?'} requests</span></div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-700">
                <div className={cx('h-full rounded-full', pct > 85 ? 'bg-amber-400' : 'bg-brand-500')} style={{ width: `${pct}%` }} />
              </div>
              <p className="mt-2 text-xs text-ink-400">{runsLeft != null ? `≈ ${runsLeft} daily runs left this month` : ''}</p>
            </>
          )}
          {!q.keySet && <p className="mt-2 text-xs text-rose-300">No key set — Settings → Job search API.</p>}
        </div>

        <div className="card p-5">
          <div className="flex items-center gap-2 text-sm font-medium"><Clock size={16} className="text-brand-400" /> Schedule <span className="ml-auto"><Dot tone={h.schedule.enabled ? 'ok' : 'off'} /></span></div>
          <p className="mt-2 text-xs text-ink-400">{h.schedule.enabled ? `Daily at ${h.schedule.time}${h.schedule.weekdaysOnly ? ', weekdays' : ''}` : 'Off'}</p>
          {h.schedule.nextRunAt && (
            <p className="mt-3 text-sm">Next: {new Date(h.schedule.nextRunAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}</p>
          )}
          <p className="mt-2 text-xs text-ink-400">Runs while Job Hunter is open (menu bar).</p>
        </div>
      </div>

      <Section title="Profiles & sources" desc="Last run result and which sources are ready for each person.">
        <div className="divide-y divide-white/[0.06]">
          {h.profiles.map((p: any) => {
            const r = p.lastRun
            const RIcon = !r ? CircleDashed : r.status === 'ok' ? CheckCircle2 : r.status === 'running' ? Spinner : r.status === 'partial' ? AlertTriangle : XCircle
            const rTone = !r ? 'text-ink-400' : { ok: 'text-emerald-300', partial: 'text-amber-300', error: 'text-rose-300', running: 'text-brand-400' }[r.status as string]
            return (
              <div key={p.id} className="flex items-start gap-4 py-3">
                <div className="w-44 shrink-0">
                  <div className="text-sm font-medium">{p.name}</div>
                  <div className="text-xs text-ink-400">{p.active ? 'in daily run' : 'paused'}</div>
                </div>
                <div className="flex flex-1 flex-wrap gap-1.5">
                  <Chip tone={p.sources.job_api ? (q.keySet ? 'good' : 'bad') : 'default'}>Job API {p.sources.job_api ? (q.keySet ? '✓' : '· no key') : '· off'}</Chip>
                  <Chip tone={p.sources.gmail ? (p.gmailConnected ? 'good' : 'bad') : 'default'}>
                    <Mail size={11} /> Gmail {p.sources.gmail ? (p.gmailConnected ? '✓' : '· not connected') : '· off'}
                  </Chip>
                  <Chip tone={p.sources.naukri ? 'good' : 'default'}>Naukri {p.sources.naukri ? `· ${p.naukriPages}/${p.pageCap} pages today` : '· off'}</Chip>
                  <Chip tone={p.sources.linkedin ? 'good' : 'default'}>LinkedIn {p.sources.linkedin ? `· ${p.linkedinPages}/${p.pageCap} pages today` : '· off'}</Chip>
                </div>
                <div className={cx('w-56 shrink-0 text-right text-xs', rTone)}>
                  <span className="inline-flex items-center gap-1.5"><RIcon size={13} /> {r ? `${r.status} · ${timeAgo(r.started_at)}` : 'never run'}</span>
                  {r && <div className="text-ink-400">{r.stats.new ?? 0} new · {r.stats.scored ?? 0} scored{r.alerts?.length ? ` · ${r.alerts.length} alert(s)` : ''}</div>}
                </div>
              </div>
            )
          })}
        </div>
      </Section>
    </div>
  )
}
