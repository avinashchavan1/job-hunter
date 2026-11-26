// jh-api: the one server function behind the Job Hunter website.
// Every call must come from a signed-in member (jh_members). Keys stay on the server.
import { DEFAULT_PREFS, type ParsedProfile, type Prefs, type SecretKey } from '../src/shared/types'
import { contactFromText, mergeParsed, RESUME_SYSTEM, ResumeSchema, resumePrompt } from '../src/shared/resume'
import { admin, getSettings, HttpError, requireMember, secret, secretStatus, setSecret } from './ctx'
import { runProfile } from './runner'
import { getProfile, kvGet, kvSet, listProfiles, liveRun, startRun } from './store'
import { Llm, LLMNotConfigured } from './llm'
import { resumeText } from './resume'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body ?? null), { status, headers: { ...CORS, 'content-type': 'application/json' } })

async function profileRow(pid: number): Promise<any> {
  const { data, error } = await admin().from('jh_profiles').select('*').eq('id', pid).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new HttpError(404, 'Profile not found')
  return data
}

async function resumeBytes(path: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const { data, error } = await admin().storage.from('jh-resumes').download(path)
  if (error || !data) throw new Error(`Could not read the uploaded resume: ${error?.message ?? 'missing'}`)
  return { bytes: new Uint8Array(await data.arrayBuffer()), ext: (path.split('.').pop() || '').toLowerCase() }
}

const b64 = (u: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}

type Handler = (args: any, who: { email: string; isAdmin: boolean }) => Promise<unknown>

const actions: Record<string, Handler> = {
  // ---- resume
  async 'resume.import'({ pid }) {
    const row = await profileRow(Number(pid))
    if (!row.resume_path) throw new HttpError(400, 'Upload a resume first')
    const { bytes, ext } = await resumeBytes(row.resume_path)
    const llm = await Llm.load()
    let parsed: ParsedProfile
    if (ext === 'pdf' && llm.engine === 'anthropic') {
      parsed = await llm.parse(RESUME_SYSTEM, { text: 'Extract the candidate profile from this resume.', pdf: b64(bytes) }, ResumeSchema, { effort: 'medium' })
    } else {
      const text = await resumeText(bytes, ext)
      if (text.trim().length < 200) throw new HttpError(422, 'Could not read text from this resume (scanned image?). Try a text-based PDF or Word file.')
      parsed = await llm.parse(RESUME_SYSTEM, { text: resumePrompt(text) }, ResumeSchema, { effort: 'medium', maxTokens: 6000 })
    }
    const prefs: Prefs = { ...DEFAULT_PREFS, ...(row.prefs ?? {}) }
    const merged = mergeParsed({ name: row.name, prefs }, parsed)
    const { error } = await admin().from('jh_profiles').update({ profile: parsed, prefs: merged.prefs, name: merged.name }).eq('id', row.id)
    if (error) throw new Error(error.message)
    return true
  },
  async 'resume.contact'({ pid }) {
    const row = await profileRow(Number(pid))
    if (!row.resume_path) throw new HttpError(400, 'Add a resume first')
    const { bytes, ext } = await resumeBytes(row.resume_path)
    return contactFromText(await resumeText(bytes, ext), row.profile)
  },

  // ---- keys (values go in, never come out)
  async 'secrets.status'() {
    return secretStatus()
  },
  async 'secrets.set'({ key, value }, who) {
    if (!who.isAdmin) throw new HttpError(403, 'Only an admin can change keys')
    await setSecret(key as SecretKey, String(value ?? ''))
    return secretStatus()
  },
  async 'secrets.test'({ which }) {
    try {
      if (which === 'llm') return { ok: true, message: await (await Llm.load()).test() }
      return { ok: false, message: 'Job search checks arrive with the next update.' }
    } catch (e: any) {
      return { ok: false, message: String(e?.message ?? e) }
    }
  },

  // ---- job checks
  async 'run.start'({ pid, only }) {
    const p = await getProfile(Number(pid))
    if (!p) throw new HttpError(404, 'Profile not found')
    if (!p.profile) throw new HttpError(400, 'Add a resume to this profile first')
    if (await liveRun(p.id)) throw new HttpError(409, 'A check is already running for this person')
    const runId = await startRun(p.id)
    EdgeRuntime.waitUntil(runProfile(p, runId, Array.isArray(only) ? only : undefined))
    return runId
  },

  // ---- AI engine
  async 'llm.models'() {
    return (await Llm.load()).models()
  },
  async 'llm.label'() {
    return (await Llm.load()).label
  }
}

// ---------------------------------------------------------------- daily schedule (called by pg_cron every 15 minutes)

const istNow = (): { day: string; time: string; weekday: number } => {
  const d = new Date(Date.now() + 5.5 * 3600_000) // India has no daylight saving
  return { day: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), weekday: d.getUTCDay() }
}

/** Starts the daily check for at most one person per tick, so each run gets the full time limit. */
async function cronTick(): Promise<unknown> {
  const s = await getSettings()
  const now = istNow()
  if (!s.schedule.enabled) return { skipped: 'schedule off' }
  if (s.schedule.weekdaysOnly && (now.weekday === 0 || now.weekday === 6)) return { skipped: 'weekend' }
  if (now.time < s.schedule.time) return { skipped: `before ${s.schedule.time} IST` }
  for (const p of await listProfiles(true)) {
    if (!p.profile) continue
    const k = `daily:${p.id}`
    if ((await kvGet(k)) === now.day) continue
    if (await liveRun(p.id)) return { waiting: p.name }
    await kvSet(k, now.day)
    const runId = await startRun(p.id)
    EdgeRuntime.waitUntil(runProfile(p, runId))
    return { started: p.name, runId }
  }
  return { done: 'everyone checked today' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
    const cron = req.headers.get('x-jh-cron')
    if (cron) {
      const token = await secret('CRON_TOKEN' as any)
      if (!token || cron !== token) throw new HttpError(401, 'bad cron token')
      return json({ data: await cronTick() })
    }
    const who = await requireMember(req)
    const { action, args } = await req.json()
    const fn = actions[action]
    if (!fn) throw new HttpError(400, `unknown action ${action}`)
    return json({ data: await fn(args ?? {}, who) })
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : e instanceof LLMNotConfigured ? 412 : 500
    if (status === 500) console.error(e)
    return json({ error: String(e?.message ?? e) }, status)
  }
})
