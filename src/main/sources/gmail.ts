// Gmail job-alert source.
// Connect: Google OAuth "installed app" flow with a loopback redirect + PKCE, scope gmail.readonly.
// The refresh token is stored per profile, encrypted with the OS keychain (safeStorage).
// Fetch: search recent LinkedIn / Naukri alert emails, turn each into job records.
import { safeStorage, shell } from 'electron'
import { createServer } from 'http'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { AddressInfo } from 'net'
import { join } from 'path'
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import { z } from 'zod'
import { Job, Profile } from '../../shared/types'
import * as db from '../db'
import { parse } from '../llm'
import { profileDir } from '../paths'
import { getSettings, secret } from '../settings'
import { SourceNotConfigured } from './jobApi'

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

/** Job boards whose alert emails we read. */
export const ALERT_SENDERS = ['linkedin.com', 'naukri.com', 'indeed.com', 'instahyre.com', 'foundit.in', 'glassdoor.com', 'iimjobs.com', 'hirist.tech', 'cutshort.io', 'monsterindia.com', 'shine.com']
const tokenFile = (slug: string): string => join(profileDir(slug), 'gmail-token.bin')

function oauthClient(redirectUri?: string): OAuth2Client {
  const id = secret('GOOGLE_CLIENT_ID')
  const sec = secret('GOOGLE_CLIENT_SECRET')
  if (!id || !sec) throw new SourceNotConfigured('Google OAuth client is not set up. Settings → Gmail has the 5-minute guide.')
  return new OAuth2Client({ clientId: id, clientSecret: sec, redirectUri })
}

function saveToken(slug: string, refreshToken: string): void {
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(refreshToken) : Buffer.from(refreshToken)
  writeFileSync(tokenFile(slug), buf, { mode: 0o600 })
}

function loadToken(slug: string): string | null {
  if (!existsSync(tokenFile(slug))) return null
  const buf = readFileSync(tokenFile(slug))
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString()
}

const PAGE = (title: string, body: string): string =>
  `<!doctype html><meta charset=utf-8><title>${title}</title><body style="font-family:-apple-system,sans-serif;background:#0b0d12;color:#e7e9ef;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${title}</h2><p style="color:#a3aabb">${body}</p></div>`

/** Opens Google's consent page in the default browser and waits for the redirect. Returns the connected address. */
export async function connectGmail(p: Profile): Promise<string> {
  oauthClient() // fail fast if not configured
  const server = createServer()
  await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
  const port = (server.address() as AddressInfo).port
  const redirect = `http://127.0.0.1:${port}/oauth2callback`
  const client = oauthClient(redirect)
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync()
  const state = Math.random().toString(36).slice(2)
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [SCOPE],
    state,
    code_challenge_method: CodeChallengeMethod.S256,
    code_challenge: codeChallenge
  })

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for Google sign-in (5 min).'))
    }, 5 * 60_000)
    server.on('request', (req, res) => {
      const u = new URL(req.url || '/', redirect)
      if (u.pathname !== '/oauth2callback') {
        res.writeHead(404).end()
        return
      }
      const err = u.searchParams.get('error')
      const c = u.searchParams.get('code')
      if (err || !c || u.searchParams.get('state') !== state) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(PAGE('Gmail not connected', err ? `Google said: ${err}` : 'Invalid response. Close this tab and try again.'))
        clearTimeout(timer)
        server.close()
        reject(new Error(err === 'access_denied' ? 'You cancelled the Google sign-in.' : `Google sign-in failed: ${err || 'bad response'}`))
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE('Gmail connected ✓', 'You can close this tab and go back to Job Hunter.'))
      clearTimeout(timer)
      server.close()
      resolve(c)
    })
    void shell.openExternal(url)
  })

  const { tokens } = await client.getToken({ code, codeVerifier })
  if (!tokens.refresh_token) throw new Error('Google did not return a refresh token. Remove Job Hunter from your Google account permissions and connect again.')
  saveToken(p.slug, tokens.refresh_token)
  client.setCredentials(tokens)
  const email = await gmailAddress(client)
  db.updateProfile(p.id, { gmail_email: email })
  return email
}

export function disconnectGmail(p: Profile): void {
  rmSync(tokenFile(p.slug), { force: true })
  db.updateProfile(p.id, { gmail_email: null })
}

async function authed(p: Profile): Promise<OAuth2Client> {
  const rt = loadToken(p.slug)
  if (!rt) throw new SourceNotConfigured('Gmail is not connected for this profile (Profile → Sources → Connect Gmail).')
  const c = oauthClient()
  c.setCredentials({ refresh_token: rt })
  return c
}

async function api(c: OAuth2Client, path: string): Promise<any> {
  const { token } = await c.getAccessToken()
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${token}` } })
  if (r.status === 401) throw new SourceNotConfigured('Gmail access was revoked or expired — connect Gmail again.')
  if (!r.ok) throw new Error(`Gmail API HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function gmailAddress(c: OAuth2Client): Promise<string> {
  return (await api(c, 'profile')).emailAddress
}

// ---------- email -> text ----------

function b64(s: string): string {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
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

/** HTML → plain text that keeps job links visible as "text <url>". */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const t = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      return /jobs?\/view|job-listings|naukri\.com\/.+-\d{6,}|jobId=|currentJobId=|indeed\.com\/(rc\/clk|viewjob|pagead)|jk=|instahyre\.com\/job|foundit\.in\/job|glassdoor\.(com|co\.in)\/job|iimjobs\.com\/j\/|hirist\.tech\/j\/|cutshort\.io\/job/i.test(href) ? ` ${t} <${cleanUrl(href)}> ` : ` ${t} `
    })
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}

/** Strip tracking: keep a canonical LinkedIn /jobs/view/<id> or the Naukri listing URL. */
function cleanUrl(href: string): string {
  const h = href.replace(/&amp;/g, '&')
  const li = h.match(/linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/i) || h.match(/currentJobId=(\d+)/i)
  if (li) return `https://www.linkedin.com/jobs/view/${li[1]}/`
  try {
    const u = new URL(h)
    if (/naukri\.com$/i.test(u.hostname)) return `${u.origin}${u.pathname}`
  } catch {
    /* keep as is */
  }
  return h
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
  'Ignore ads, "people also viewed", courses, and settings links. If the email lists no jobs, return an empty list.'

export async function fetchGmailJobs(p: Profile, log: (s: string) => void): Promise<Job[]> {
  const c = await authed(p)
  const s = getSettings().gmail
  const senders = ALERT_SENDERS.map((d) => `from:${d}`).join(' OR ')
  const q = `newer_than:${s.lookbackDays}d (${senders}) -from:messages-noreply@linkedin.com -from:invitations@linkedin.com`
  const list = await api(c, `messages?maxResults=${s.maxMessages}&q=${encodeURIComponent(q)}`)
  const ids: string[] = (list.messages ?? []).map((m: any) => m.id)
  const fresh = ids.filter((id) => !db.kvGet(`gmail_seen:${p.id}:${id}`))
  log(`gmail: ${ids.length} alert emails in last ${s.lookbackDays}d, ${fresh.length} not read yet`)
  const jobs: Job[] = []
  for (const id of fresh) {
    const m = await api(c, `messages/${id}?format=full`)
    const headers: Record<string, string> = Object.fromEntries((m.payload?.headers ?? []).map((h: any) => [h.name.toLowerCase(), h.value]))
    const from = headers.from || ''
    const subject = headers.subject || ''
    const date = headers.date ? new Date(headers.date).toISOString().slice(0, 10) : ''
    const site = (ALERT_SENDERS.find((d) => from.toLowerCase().includes(d)) || 'other').split('.')[0]
    const { html, text } = partsOf(m.payload)
    const body = (html ? htmlToText(html) : text).slice(0, 14000)
    // skip non-alert mail (connection requests, newsletters) cheaply
    if (!/job|hiring|opening|vacanc|role|position/i.test(subject + ' ' + body.slice(0, 2000))) {
      db.kvSet(`gmail_seen:${p.id}:${id}`, '1')
      continue
    }
    try {
      const out = await parse(SYSTEM, { text: `From: ${from}\nSubject: ${subject}\n\n${body}` }, Extracted, { effort: 'low', maxTokens: 6000 })
      for (const j of out.jobs) {
        if (!j.title || !j.company) continue
        jobs.push(
          db.makeJob({
            title: j.title,
            company: j.company,
            location: j.location,
            salary: j.salary,
            url: j.url && /^https?:\/\//.test(j.url) ? cleanUrl(j.url) : '',
            description: [j.experience && `Experience: ${j.experience}`, `From a ${site} job alert: "${subject}"`]
              .filter(Boolean)
              .join('\n'),
            source: `gmail-${site}`,
            posted_at: date,
            external_id: (j.url.match(/(\d{6,})/) || [])[1] || ''
          })
        )
      }
      log(`gmail: "${subject.slice(0, 70)}" → ${out.jobs.length} jobs`)
      db.kvSet(`gmail_seen:${p.id}:${id}`, '1')
    } catch (e: any) {
      log(`gmail: could not read "${subject.slice(0, 60)}": ${e?.message ?? e}`)
    }
  }
  return jobs
}

export function gmailConnected(p: Profile): boolean {
  return existsSync(tokenFile(p.slug))
}

/** Diagnostics for the settings screen: how many alert-like emails exist, grouped by sender domain. No bodies read. */
export async function probeGmail(p: Profile): Promise<{ query: string; count: number }[] & { domains?: Record<string, number> }> {
  const c = await authed(p)
  const queries = [
    'newer_than:30d from:linkedin.com',
    'newer_than:30d from:naukri.com',
    'newer_than:30d (subject:job OR subject:jobs OR subject:hiring OR subject:"job alert")'
  ]
  const out: any = []
  for (const q of queries) {
    const r = await api(c, `messages?maxResults=100&q=${encodeURIComponent(q)}`)
    out.push({ query: q, count: r.resultSizeEstimate ?? (r.messages ?? []).length })
  }
  // sender domains of the job-subject query (metadata only)
  const r = await api(c, `messages?maxResults=25&q=${encodeURIComponent(queries[2])}`)
  const domains: Record<string, number> = {}
  for (const m of r.messages ?? []) {
    const d = await api(c, `messages/${m.id}?format=metadata&metadataHeaders=From`)
    const from = d.payload?.headers?.find((h: any) => h.name === 'From')?.value || ''
    const dom = (from.match(/@([^>\s]+)/) || [])[1]?.toLowerCase() || '?'
    domains[dom] = (domains[dom] || 0) + 1
  }
  out.domains = domains
  return out
}
