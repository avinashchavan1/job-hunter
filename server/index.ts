// jh-api: the one server function behind the Job Hunter website.
// Every call must come from a signed-in member (jh_members). Keys stay on the server.
import { DEFAULT_PREFS, type ParsedProfile, type Prefs } from '../src/shared/types'
import { contactFromText, mergeParsed, RESUME_SYSTEM, ResumeSchema, resumePrompt } from '../src/shared/resume'
import { admin, getSettings, HttpError, requireMember, secret, secretStatus } from './ctx'
import { RUN_BUDGET_MS, runProfile } from './runner'
import { rescoreOne, scorePending } from './matcher'
import { gmailCallback, gmailConnected, gmailConnectUrl, gmailDisconnect } from './gmail'
import { getJob, getProfile, kvGet, kvSet, listProfiles, liveRun, profilesWithUnscored, startRun } from './store'
import { Llm, LLMNotConfigured } from './llm'
import { resumeText } from './resume'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS'
}
let reqHeaders = ''
const cors = (): Record<string, string> => ({ ...CORS, ...(reqHeaders ? { 'access-control-allow-headers': reqHeaders } : {}) })
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body ?? null), { status, headers: { ...cors(), 'content-type': 'application/json' } })

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
  async 'secrets.set'() {
    throw new HttpError(403, 'Keys are set by the admin in Supabase → Edge Functions → Secrets (names start with JH_).')
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

  async 'matches.rescore'({ pid, jid }) {
    const p = await getProfile(Number(pid))
    const j = await getJob(String(jid))
    if (!p || !j) throw new HttpError(404, 'Job or profile not found')
    await rescoreOne(p, j)
    return true
  },

  // ---- Gmail job alerts
  async 'gmail.connect'({ pid, origin }) {
    return gmailConnectUrl(Number(pid), String(origin || ''))
  },
  async 'gmail.disconnect'({ pid }) {
    return gmailDisconnect(Number(pid))
  },
  async 'gmail.connected'({ pid }) {
    return gmailConnected(Number(pid))
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
  const due = s.schedule.enabled && !(s.schedule.weekdaysOnly && (now.weekday === 0 || now.weekday === 6)) && now.time >= s.schedule.time
  for (const p of due ? await listProfiles(true) : []) {
    if (!p.profile) continue
    const k = `daily:${p.id}`
    if ((await kvGet(k)) === now.day) continue
    if (await liveRun(p.id)) return { waiting: p.name }
    await kvSet(k, now.day)
    const runId = await startRun(p.id)
    EdgeRuntime.waitUntil(runProfile(p, runId))
    return { started: p.name, runId }
  }
  // nobody due: keep scoring whatever is waiting (one person per tick)
  for (const pid of await profilesWithUnscored()) {
    if (await liveRun(pid)) continue
    const p = await getProfile(pid)
    if (!p?.profile || !p.active) continue
    const lockKey = `scoring:${pid}`
    const lock = Number((await kvGet(lockKey)) || 0)
    if (Date.now() - lock < RUN_BUDGET_MS + 10_000) continue // a previous tick is still scoring
    await kvSet(lockKey, String(Date.now()))
    // keep the last tick's scoring log so problems are visible (Settings → Activity reads runs; this is the quiet background part)
    const lines: string[] = []
    const t0 = new Date().toISOString()
    EdgeRuntime.waitUntil(
      scorePending(p, Date.now() + RUN_BUDGET_MS, (l) => lines.push(l))
        .then((r) => lines.push(`done: ${r.scored} scored, ${r.score_failed} failed, ${r.left} left`))
        .catch((e) => lines.push(`stopped: ${e?.message ?? e}`))
        .finally(() => kvSet(`scoring_log:${pid}`, JSON.stringify({ at: t0, lines: lines.slice(-30) })))
    )
    return { scoring: p.name }
  }
  return { done: 'everyone checked today, nothing waiting to score' }
}

Deno.serve(async (req) => {
  // allow whatever headers the browser client asks for (newer supabase-js versions add some)
  reqHeaders = req.headers.get('access-control-request-headers') ?? ''
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors() })
  const url = new URL(req.url)
  if (req.method === 'GET' && url.pathname.endsWith('/gmail-callback')) {
    try {
      return Response.redirect(await gmailCallback(url), 302)
    } catch (e: any) {
      console.error('gmail callback', e)
      return new Response(`Gmail connection failed: ${String(e?.message ?? e).slice(0, 200)}`, { status: 500 })
    }
  }
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
