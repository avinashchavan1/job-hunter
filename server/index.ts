// jh-api: the one server function behind the Job Hunter website.
// Every call must come from a signed-in member (jh_members). Keys stay on the server.
import { DEFAULT_PREFS, type ParsedProfile, type Prefs, type SecretKey } from '../src/shared/types'
import { contactFromText, mergeParsed, RESUME_SYSTEM, ResumeSchema, resumePrompt } from '../src/shared/resume'
import { admin, HttpError, requireMember, secretStatus, setSecret } from './ctx'
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

  // ---- AI engine
  async 'llm.models'() {
    return (await Llm.load()).models()
  },
  async 'llm.label'() {
    return (await Llm.load()).label
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  try {
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
