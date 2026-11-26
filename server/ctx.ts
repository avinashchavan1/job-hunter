// Request context for the jh-api edge function: who is calling, settings, and server-only secrets.
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { AppSettings, SecretKey } from '../src/shared/types'
import { SECRET_KEYS } from '../src/shared/types'
import { DEFAULT_SETTINGS, deepMerge } from '../src/shared/settings'

export const env = (k: string): string => Deno.env.get(k) ?? ''

let _admin: SupabaseClient | null = null
/** Service-role client: bypasses row security. Only used after the caller is checked to be a member. */
export function admin(): SupabaseClient {
  if (!_admin) _admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })
  return _admin
}

export class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg)
  }
}

/** Checks the caller's session token and that their email is on jh_members. */
export async function requireMember(req: Request): Promise<{ email: string; isAdmin: boolean }> {
  const auth = req.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+/.test(auth)) throw new HttpError(401, 'Not signed in')
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } }
  })
  const { data: u, error } = await userClient.auth.getUser(auth.replace(/^Bearer\s+/, ''))
  if (error || !u.user?.email) throw new HttpError(401, 'Session expired — sign in again')
  const email = u.user.email.toLowerCase()
  const { data: m } = await admin().from('jh_members').select('is_admin').eq('email', email).maybeSingle()
  if (!m) throw new HttpError(403, 'Your email is not on the list')
  return { email, isAdmin: !!m.is_admin }
}

export async function getSettings(): Promise<AppSettings> {
  const { data } = await admin().from('jh_settings').select('data').eq('id', 1).maybeSingle()
  return deepMerge(DEFAULT_SETTINGS, (data?.data ?? {}) as Partial<AppSettings>)
}

let _secrets: Partial<Record<SecretKey, string>> | null = null
let _secretsAt = 0
export async function secrets(): Promise<Partial<Record<SecretKey, string>>> {
  if (_secrets && Date.now() - _secretsAt < 30_000) return _secrets
  const { data, error } = await admin().from('jh_secrets').select('k, v')
  if (error) throw new Error(`secrets: ${error.message}`)
  const fresh: Partial<Record<SecretKey, string>> = Object.fromEntries((data ?? []).map((r) => [r.k, r.v]))
  _secrets = fresh
  _secretsAt = Date.now()
  return fresh
}
/** Key saved from the app (jh_secrets), else a Supabase function secret named JH_<KEY> (set in the dashboard). */
export async function secret(k: SecretKey): Promise<string> {
  return ((await secrets())[k] ?? '').trim() || env(`JH_${k}`).trim()
}
export async function setSecret(k: SecretKey, v: string): Promise<void> {
  if (!SECRET_KEYS.includes(k)) throw new HttpError(400, 'unknown key')
  const val = v.trim()
  const q = val ? admin().from('jh_secrets').upsert({ k, v: val, updated_at: new Date().toISOString() }) : admin().from('jh_secrets').delete().eq('k', k)
  const { error } = await q
  if (error) throw new Error(error.message)
  _secrets = null
}
export async function secretStatus(): Promise<Record<SecretKey, boolean>> {
  const s = await secrets()
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, !!((s[k] ?? '').trim() || env(`JH_${k}`).trim())])) as Record<SecretKey, boolean>
}
