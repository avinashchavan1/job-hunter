// App settings (plain JSON) and secrets (encrypted with the OS keychain via safeStorage).
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AppSettings, SECRET_KEYS, SecretKey } from '../shared/types'
import { dataDir } from './paths'

export const DEFAULT_SETTINGS: AppSettings = {
  llm: { provider: 'anthropic', baseUrl: '', model: 'auto', fallbackModels: [], concurrency: 1 },
  model: 'claude-opus-5-5',
  effort: 'low',
  jobApi: { provider: 'jsearch', resultsPerQuery: 20, maxQueriesPerRun: 6, datePosted: 'week' },
  gmail: { lookbackDays: 3, maxMessages: 60 },
  browser: { pagesPerSitePerDay: 40, minDelayS: 5, maxDelayS: 20, showWindow: false },
  scoring: { maxJobsPerRun: 60 },
  schedule: { enabled: true, time: '08:30', weekdaysOnly: true },
  autofill: { linkedin: false },
  notify: true,
  openAtLogin: false
}

const settingsFile = (): string => join(dataDir(), 'settings.json')
const secretsFile = (): string => join(dataDir(), 'secrets.bin')

function deepMerge<T>(base: T, over: Partial<T>): T {
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base }
  for (const [k, v] of Object.entries(over ?? {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object') out[k] = deepMerge(out[k], v as any)
    else if (v !== undefined) out[k] = v
  }
  return out
}

export function getSettings(): AppSettings {
  if (!existsSync(settingsFile())) return DEFAULT_SETTINGS
  try {
    return deepMerge(DEFAULT_SETTINGS, JSON.parse(readFileSync(settingsFile(), 'utf8')))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = deepMerge(getSettings(), patch)
  writeFileSync(settingsFile(), JSON.stringify(next, null, 2))
  return next
}

// ---- secrets ----

function readSecrets(): Partial<Record<SecretKey, string>> {
  if (!existsSync(secretsFile())) return {}
  try {
    const buf = readFileSync(secretsFile())
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8')
    return JSON.parse(txt)
  } catch {
    return {}
  }
}

function writeSecrets(s: Partial<Record<SecretKey, string>>): void {
  const txt = JSON.stringify(s)
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8')
  writeFileSync(secretsFile(), buf, { mode: 0o600 })
}

/** Secret value for main-process use only. Env var wins (handy for dev). Never send to the renderer. */
export function secret(key: SecretKey): string {
  return (process.env[key] || readSecrets()[key] || '').trim()
}

export function setSecret(key: SecretKey, value: string): void {
  if (!SECRET_KEYS.includes(key)) throw new Error('unknown key')
  const s = readSecrets()
  if (value.trim()) s[key] = value.trim()
  else delete s[key]
  writeSecrets(s)
}

/** Which secrets are set — booleans only. */
export function secretStatus(): Record<SecretKey, boolean> {
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, !!secret(k)])) as Record<SecretKey, boolean>
}
