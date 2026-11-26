// Gmail job alerts for the web (read-only scope). Same reading logic as the desktop app's sources/gmail.ts.
// Connect: Google OAuth web flow; Google redirects to this function's /gmail-callback, which stores the
// refresh token server-side (jh_secrets, never readable by browsers) and sends the person back to the site.
import { z } from 'zod'
import type { Job, Profile } from '../src/shared/types'
import { admin, env, getSettings, secret } from './ctx'
import { Llm } from './llm'
import { kvGet, kvSet, makeJob } from './store'
import { SourceNotConfigured } from './sources'

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const ALERT_SENDERS = ['linkedin.com', 'naukri.com', 'indeed.com', 'instahyre.com', 'foundit.in', 'glassdoor.com', 'iimjobs.com', 'hirist.tech', 'cutshort.io', 'monsterindia.com', 'shine.com']
/** Sites allowed to receive the person back after Google sign-in. */
const ORIGINS = [/^https:\/\/job\.avinashchavan\.com$/, /^https:\/\/jobhunter-app\.netlify\.app$/, /^https:\/\/[\w-]+--jobhunter-app\.netlify\.app$/, /^http:\/\/localhost:\d+$/]

const redirectUri = (): string => `${env('SUPABASE_URL')}/functions/v1/jh-api/gmail-callback`

async function client(): Promise<{ id: string; secret: string }> {
  const id = await secret('GOOGLE_CLIENT_ID')
  const sec = await secret('GOOGLE_CLIENT_SECRET')
  if (!id || !sec) throw new SourceNotConfigured('Google client is not set up (JH_GOOGLE_CLIENT_ID / JH_GOOGLE_CLIENT_SECRET in Supabase secrets).')
  return { id, secret: sec }
}

// tokens and pending sign-ins live in jh_secrets (service role only)
const tokenKey = (pid: number): string => `gmail:${pid}`
async function getSecretRow(k: string): Promise<string | null> {
  const { data } = await admin().from('jh_secrets').select('v').eq('k', k).maybeSingle()
  return (data?.v as string) ?? null
}
async function putSecretRow(k: string, v: string | null): Promise<void> {
  const q = v == null ? admin().from('jh_secrets').delete().eq('k', k) : admin().from('jh_secrets').upsert({ k, v, updated_at: new Date().toISOString() })
  const { error } = await q
  if (error) throw new Error(error.message)
}

export async function gmailConnectUrl(pid: number, origin: string): Promise<string> {
  if (!ORIGINS.some((r) => r.test(origin))) throw new Error(`Gmail sign-in is not allowed from ${origin}`)
  const c = await client()
  const nonce = crypto.randomUUID()
  await putSecretRow(`gmailstate:${nonce}`, JSON.stringify({ pid, origin, exp: Date.now() + 10 * 60_000 }))
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  u.search = new URLSearchParams({ client_id: c.id, redirect_uri: redirectUri(), response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: nonce }).toString()
  return u.toString()
}

/** Handles Google's redirect. Returns where to send the browser. */
export async function gmailCallback(url: URL): Promise<string> {
  const nonce = url.searchParams.get('state') || ''
  const raw = nonce ? await getSecretRow(`gmailstate:${nonce}`) : null
  if (!raw) return 'https://job.avinashchavan.com/?gmail=error&why=expired'
  await putSecretRow(`gmailstate:${nonce}`, null)
  const st = JSON.parse(raw) as { pid: number; origin: string; exp: number }
  const back = (q: string): string => `${st.origin}/?${q}`
  if (Date.now() > st.exp) return back('gmail=error&why=expired')
  const err = url.searchParams.get('error')
  if (err) return back(`gmail=error&why=${encodeURIComponent(err)}`)
  const code = url.searchParams.get('code')
  if (!code) return back('gmail=error&why=nocode')

  const c = await client()
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri(), grant_type: 'authorization_code' })
  })
  const tok: any = await r.json()
  if (!r.ok) return back(`gmail=error&why=${encodeURIComponent(tok.error_description || tok.error || 'token')}`)
  if (!tok.refresh_token) return back('gmail=error&why=norefresh')
  await putSecretRow(tokenKey(st.pid), tok.refresh_token)
  const prof = await gmail(tok.access_token, 'profile')
  await admin().from('jh_profiles').update({ gmail_email: prof.emailAddress }).eq('id', st.pid)
  return back('gmail=connected')
}

export async function gmailDisconnect(pid: number): Promise<boolean> {
  const rt = await getSecretRow(tokenKey(pid))
  if (rt) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`, { method: 'POST' }).catch(() => {})
  await putSecretRow(tokenKey(pid), null)
  await admin().from('jh_profiles').update({ gmail_email: null }).eq('id', pid)
  return true
}
export const gmailConnected = async (pid: number): Promise<boolean> => !!(await getSecretRow(tokenKey(pid)))

async function accessToken(pid: number): Promise<string> {
  const rt = await getSecretRow(tokenKey(pid))
  if (!rt) throw new SourceNotConfigured('Gmail is not connected for this person (Profile → Sources → Connect Gmail).')
  const c = await client()
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: rt, client_id: c.id, client_secret: c.secret, grant_type: 'refresh_token' })
  })
  const j: any = await r.json()
  if (!r.ok) throw new SourceNotConfigured(j.error === 'invalid_grant' ? 'Gmail access expired or was removed — connect Gmail again.' : `Google token error: ${j.error_description || j.error}`)
  return j.access_token
}

async function gmail(token: string, path: string): Promise<any> {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) })
  if (r.status === 401) throw new SourceNotConfigured('Gmail access was revoked or expired — connect Gmail again.')
  if (!r.ok) throw new Error(`Gmail API HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

// ---------------------------------------------------------------- email -> text (same as desktop)

const b64 = (s: string): string => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
function partsOf(payload: any): { html: string; text: string } {
  let html = ''
  let text = ''
  const walk = (p: any): void => {
    if (!p) return
    if (p.mimeType === 'text/html' && p.body?.data) html += b64(p.body.data)
    else if (p.mimeType === 'text/plain' && p.body?.data) text += b64(p.body.data)
    for (const c of p.parts ?? []) walk(c)
  }
  walk(payload)
  return { html, text }
}
function cleanUrl(href: string): string {
  const h = href.replace(/&amp;/g, '&')
  const li = h.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i) || h.match(/currentJobId=(\d+)/i)
  if (li) return `https://www.linkedin.com/jobs/view/${li[1]}/`
  try {
    const u = new URL(h)
    if (/naukri\.com$/i.test(u.hostname)) return `${u.origin}${u.pathname}`
  } catch {
    /* keep */
  }
  return h
}
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const t = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return /jobs?\/view|job-listings|naukri\.com\/.+-\d{6,}|jobId=|currentJobId=|indeed\.com\/(rc\/clk|viewjob|pagead)|jk=|instahyre\.com\/job|foundit\.in\/job|glassdoor\.(com|co\.in)\/job|iimjobs\.com\/j\/|hirist\.tech\/j\/|cutshort\.io\/job/i.test(href) ? ` ${t} <${cleanUrl(href)}> ` : ` ${t} `
    })
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}

const Extracted = z.object({
  jobs: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string().describe('City / "Remote" / empty if not shown'),
      url: z.string().describe('The job link exactly as given in <...>, or empty'),
      salary: z.string().describe('As shown, or empty'),
      experience: z.string().describe('Years asked, as shown, or empty')
    })
  )
})
const SYSTEM =
  'You extract job postings from a job-alert email (LinkedIn, Naukri, Indeed, Instahyre, Foundit, etc.). Return every distinct job listed. ' +
  'Copy title, company, location exactly. For url use the link shown in angle brackets next to that job. ' +
  'Ignore ads, "people also viewed", courses, community posts, company reviews and settings links. Only include items that have a job link. If the email lists no jobs, return an empty list.'

/** Reads unread-by-us alert emails until `deadline`; the rest wait for the next check. */
export async function fetchGmailJobs(p: Profile, log: (s: string) => void, deadline: number): Promise<Job[]> {
  const token = await accessToken(p.id)
  const s = (await getSettings()).gmail
  const senders = ALERT_SENDERS.map((d) => `from:${d}`).join(' OR ')
  const q = `newer_than:${s.lookbackDays}d (${senders}) -from:messages-noreply@linkedin.com -from:invitations@linkedin.com`
  const list = await gmail(token, `messages?maxResults=${s.maxMessages}&q=${encodeURIComponent(q)}`)
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id)
  const fresh: string[] = []
  for (const id of ids) if (!(await kvGet(`gmail_seen:${p.id}:${id}`))) fresh.push(id)
  log(`gmail: ${ids.length} alert emails in last ${s.lookbackDays}d, ${fresh.length} not read yet`)
  const llm = await Llm.load()
  const jobs: Job[] = []
  let left = fresh.length
  for (const id of fresh) {
    if (Date.now() > deadline) {
      log(`gmail: ${left} emails left for the next check (time limit)`)
      break
    }
    left--
    const m = await gmail(token, `messages/${id}?format=full`)
    const headers: Record<string, string> = Object.fromEntries((m.payload?.headers ?? []).map((h: any) => [h.name.toLowerCase(), h.value]))
    const from = headers.from || ''
    const subject = headers.subject || ''
    const date = headers.date ? new Date(headers.date).toISOString().slice(0, 10) : ''
    const site = (ALERT_SENDERS.find((d) => from.toLowerCase().includes(d)) || 'other').split('.')[0]
    const { html, text } = partsOf(m.payload)
    const body = (html ? htmlToText(html) : text).slice(0, 14000)
    const hasJobLink = html ? /<https?:\/\/[^>]+>/.test(body) : /https?:\/\/\S*(jobs?\/view|job-listings|viewjob|jk=)/i.test(body)
    if (!hasJobLink || !/job|hiring|opening|vacanc|role|position/i.test(subject + ' ' + body.slice(0, 2000))) {
      await kvSet(`gmail_seen:${p.id}:${id}`, '1')
      continue
    }
    try {
      const out = await llm.parse(SYSTEM, { text: `From: ${from}\nSubject: ${subject}\n\n${body}` }, Extracted, { effort: 'low', maxTokens: 6000 })
      for (const j of out.jobs) {
        if (!j.title || !j.company || !/^https?:\/\//.test(j.url || '')) continue
        jobs.push(
          makeJob({
            title: j.title, company: j.company, location: j.location, salary: j.salary, url: cleanUrl(j.url),
            description: [j.experience && `Experience: ${j.experience}`, `From a ${site} job alert: "${subject}"`].filter(Boolean).join('\n'),
            source: `gmail-${site}`, posted_at: date, external_id: (j.url.match(/(\d{6,})/) || [])[1] || ''
          })
        )
      }
      log(`gmail: "${subject.slice(0, 70)}" → ${out.jobs.length} jobs`)
      await kvSet(`gmail_seen:${p.id}:${id}`, '1')
    } catch (e: any) {
      log(`gmail: could not read "${subject.slice(0, 60)}": ${e?.message ?? e}`)
    }
  }
  return jobs
}
