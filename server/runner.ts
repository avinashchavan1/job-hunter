// One "run" for one person: collect from every enabled source, dedupe, filter, save, record.
import type { Profile, RunAlert, SourceKey } from '../src/shared/types'
import { getSettings } from './ctx'
import { fetchApis, fetchBoards, SourceNotConfigured } from './sources'
import { saveFound, writeRun } from './store'
import { scorePending } from './matcher'
import { fetchGmailJobs } from './gmail'
import { LLMNotConfigured } from './llm'

const IST = (): string => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })

/** Free plan: ~150 s per invocation. Leave headroom to write the final log. */
export const RUN_BUDGET_MS = 140_000

export async function runProfile(p: Profile, runId: number, only?: SourceKey[]): Promise<void> {
  const started = Date.now()
  const s = await getSettings()
  const lines: string[] = []
  const alerts: RunAlert[] = []
  const stats: Record<string, number> = { fetched: 0, new: 0, filtered: 0, scored: 0, score_failed: 0 }
  let status: 'ok' | 'partial' | 'error' = 'ok'
  let lastFlush = 0
  const flush = async (force = false): Promise<void> => {
    if (!force && Date.now() - lastFlush < 1500) return
    lastFlush = Date.now()
    await writeRun(runId, { log: lines.join('\n') }).catch(() => {})
  }
  const log = (line: string): void => {
    lines.push(`${IST()} ${line}`)
    void flush()
  }
  const alert = (a: RunAlert): void => {
    alerts.push(a)
    log(`[${a.level}] ${a.source}: ${a.message}`)
  }

  const sources: [SourceKey, () => Promise<import('../src/shared/types').Job[]>][] = [
    ['job_api', () => fetchApis(p, s, log)],
    ['careers', () => fetchBoards(p, log)],
    ['gmail', () => fetchGmailJobs(p, log, started + 105_000)]
  ]
  try {
    log(`Run started for ${p.name}`)
    for (const [key, fetcher] of sources) {
      if (only && !only.includes(key)) continue
      if (!p.prefs.sources[key]) continue
      log(`— ${key}`)
      try {
        const jobs = await fetcher()
        const r = await saveFound(p, jobs)
        stats.fetched += jobs.length
        stats.new += r.fresh
        stats.filtered += r.filtered
        stats[`src_${key}`] = jobs.length
        log(`${key}: ${jobs.length} fetched, ${r.fresh} new`)
      } catch (e: any) {
        status = 'partial'
        alert({ level: 'warn', source: key, message: e instanceof SourceNotConfigured ? e.message : `failed: ${e?.message ?? e}` })
      }
    }
    log('— scoring')
    let strong = 0
    try {
      const r = await scorePending(p, started + RUN_BUDGET_MS, (l) => {
        if (/^scored\s+(\d+)/.test(l) && Number(l.match(/^scored\s+(\d+)/)![1]) >= p.prefs.min_score) strong++
        log(l)
      })
      stats.scored = r.scored
      stats.score_failed = r.score_failed
      if (r.left) log(`${r.left} more to score — they're scored in the background over the next few minutes`)
    } catch (e: any) {
      status = 'partial'
      alert({ level: 'warn', source: 'scoring', message: e instanceof LLMNotConfigured ? e.message : e?.message ?? String(e) })
    }
    stats.strong_today = strong
    log(`Done: ${stats.new} new, ${stats.filtered} filtered out, ${stats.scored} scored, ${strong} at or above ${p.prefs.min_score}`)
  } catch (e: any) {
    status = 'error'
    alert({ level: 'stop', source: 'run', message: e?.message ?? String(e) })
  } finally {
    await writeRun(runId, { log: lines.join('\n'), status, stats, alerts, finished: true })
  }
}
