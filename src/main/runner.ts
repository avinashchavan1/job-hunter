// One "run" = collect from every enabled source, dedupe, filter, score, record.
import { Job, Profile, RunAlert, RunProgress, SourceKey } from '../shared/types'
import * as db from './db'
import { check } from './filters'
import { LLMNotConfigured } from './llm'
import { scorePending } from './matcher'
import { getSettings } from './settings'
import { fetchJobs as apiJobs, SourceNotConfigured } from './sources/jobApi'
import { fetchGmailJobs } from './sources/gmail'

export class StopSource extends Error {
  // raised by browser sources on CAPTCHA / login wall / unusual-activity pages
}

type Fetcher = (p: Profile, log: (s: string) => void, alert: (a: RunAlert) => void) => Promise<Job[]>

const registry: Partial<Record<SourceKey, Fetcher>> = {
  job_api: (p, log) => apiJobs(p, log),
  gmail: (p, log) => fetchGmailJobs(p, log)
}

export function registerSource(key: SourceKey, f: Fetcher): void {
  registry[key] = f
}

let running = new Set<number>()
export const isRunning = (pid?: number): boolean => (pid == null ? running.size > 0 : running.has(pid))

export async function runProfile(
  p: Profile,
  emit: (e: RunProgress) => void,
  only?: SourceKey[]
): Promise<{ stats: Record<string, number>; alerts: RunAlert[]; status: string }> {
  if (running.has(p.id)) throw new Error('a run is already in progress for this profile')
  running.add(p.id)
  const runId = db.startRun(p.id)
  const lines: string[] = []
  const alerts: RunAlert[] = []
  const stats: Record<string, number> = { fetched: 0, new: 0, filtered: 0, scored: 0, score_failed: 0 }
  const log = (line: string, phase = 'run'): void => {
    lines.push(`${db.now().slice(11)} ${line}`)
    emit({ profileId: p.id, phase, line, running: true })
  }
  const alert = (a: RunAlert): void => {
    alerts.push(a)
    log(`[${a.level}] ${a.source}: ${a.message}`, a.source)
  }
  let status: 'ok' | 'partial' | 'error' = 'ok'

  try {
    log(`Run started for ${p.name}`)
    for (const key of Object.keys(registry) as SourceKey[]) {
      if (only && !only.includes(key)) continue
      if (!p.prefs.sources[key]) continue
      const fetcher = registry[key]!
      log(`— ${key}`, key)
      try {
        const jobs = await fetcher(p, (s) => log(s, key), alert)
        let fresh = 0
        for (const j of jobs) {
          if (!j.title || !j.company) continue
          db.upsertJob(j)
          if (db.linkProfileJob(p.id, j.id, j.source.split(':')[0])) {
            fresh++
            const reason = check(j, p.prefs)
            if (reason) {
              db.setFilterReason(p.id, j.id, reason)
              stats.filtered++
            }
          }
        }
        stats.fetched += jobs.length
        stats.new += fresh
        stats[`src_${key}`] = jobs.length
        log(`${key}: ${jobs.length} fetched, ${fresh} new`, key)
      } catch (e: any) {
        status = 'partial'
        if (e instanceof SourceNotConfigured) alert({ level: 'warn', source: key, message: e.message })
        else if (e instanceof StopSource) alert({ level: 'stop', source: key, message: e.message })
        else alert({ level: 'warn', source: key, message: `failed: ${e?.message ?? e}` })
      }
    }

    log('— scoring', 'score')
    try {
      const r = await scorePending(db.getProfile(p.id)!, getSettings().scoring.maxJobsPerRun, (s) => log(s, 'score'))
      stats.scored = r.scored
      stats.score_failed = r.score_failed
    } catch (e: any) {
      status = 'partial'
      alert({ level: e instanceof LLMNotConfigured ? 'warn' : 'warn', source: 'scoring', message: e?.message ?? String(e) })
    }
    const strong = db.listMatches(p.id).filter((m) => (m.score ?? 0) >= p.prefs.min_score && m.found_at >= db.today()).length
    stats.strong_today = strong
    log(`Done: ${stats.new} new, ${stats.filtered} filtered, ${stats.scored} scored, ${strong} at or above ${p.prefs.min_score} today`)
  } catch (e: any) {
    status = 'error'
    alert({ level: 'stop', source: 'run', message: e?.message ?? String(e) })
  } finally {
    db.finishRun(runId, status, stats, alerts, lines.join('\n'))
    running.delete(p.id)
    emit({ profileId: p.id, phase: 'done', line: '', running: false })
  }
  return { stats, alerts, status }
}
