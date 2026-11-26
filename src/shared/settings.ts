import type { AppSettings } from './types'

export const DEFAULT_SETTINGS: AppSettings = {
  llm: { provider: 'anthropic', baseUrl: '', model: 'auto', fallbackModels: [], concurrency: 1 },
  model: 'claude-opus-5-5',
  effort: 'low',
  jobApi: { provider: 'jsearch', resultsPerQuery: 50, maxQueriesPerRun: 12, datePosted: 'week' },
  gmail: { lookbackDays: 3, maxMessages: 60 },
  browser: { pagesPerSitePerDay: 40, minDelayS: 5, maxDelayS: 20, showWindow: false },
  scoring: { maxJobsPerRun: 60 },
  schedule: { enabled: true, time: '08:30', weekdaysOnly: true },
  autofill: { linkedin: false, aiAnswers: true },
  notify: true,
  openAtLogin: false
}

export function deepMerge<T>(base: T, over: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') out[k] = deepMerge(out[k], v as any)
    else if (v !== undefined) out[k] = v
  }
  return out
}
