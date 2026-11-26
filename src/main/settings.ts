// App settings (plain JSON) and secrets (encrypted with the OS keychain via safeStorage).
import { safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AppSettings, SECRET_KEYS, SecretKey } from '../shared/types'
import { DEFAULT_SETTINGS, deepMerge } from '../shared/settings'
import { dataDir } from './paths'

export { DEFAULT_SETTINGS }

const settingsFile = (): string => join(dataDir(), 'settings.json')
const secretsFile = (): string => join(dataDir(), 'secrets.bin')

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
