// One "run" for one person: collect from every enabled source, dedupe, filter, save, record.
// Scoring is added in the next step.
import type { Profile, RunAlert, SourceKey } from '../src/shared/types'
import { getSettings } from './ctx'
import { fetchApis, fetchBoards, SourceNotConfigured } from './sources'
import { saveFound, writeRun } from './store'

const IST = (): string => new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false })

export async function runProfile(p: Profile, runId: number, only?: SourceKey[]): Promise<void> {
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
    ['careers', () => fetchBoards(p, log)]
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
    log(`Done: ${stats.new} new, ${stats.filtered} filtered out`)
  } catch (e: any) {
    status = 'error'
    alert({ level: 'stop', source: 'run', message: e?.message ?? String(e) })
  } finally {
    await writeRun(runId, { log: lines.join('\n'), status, stats, alerts, finished: true })
  }
}
