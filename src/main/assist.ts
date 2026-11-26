// AI helpers that work on one job: tailored resume (PDF), interview prep, and drafted answers for
// application questions. Nothing here applies, submits or sends anything.
// Privacy: email/phone are stripped from resume text before it goes to the AI; contact details are
// added back locally when the PDF is rendered.
import { BrowserWindow, shell } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { z } from 'zod'
import type { Match, Prep, Profile, Tailored } from '../shared/types'
import * as db from './db'
import { parse } from './llm'
import { profileDir, slugify } from './paths'
import { resumeText } from './resume'

const scrub = (t: string): string =>
  t
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => (m.replace(/\D/g, '').length >= 10 && !/\b(19|20)\d\d\s*[-–]\s*(19|20)\d\d\b/.test(m) ? '[phone]' : m))

function job(p: Profile, jobId: string): Match {
  const m = db.listMatches(p.id, { includeFiltered: true }).find((x) => x.id === jobId)
  if (!m) throw new Error('Job not found')
  return m
}
const jobBlock = (m: Match): string => `Title: ${m.title}\nCompany: ${m.company}\nLocation: ${m.location}\n\n${(m.description || '').slice(0, 7000)}`

// ---------------------------------------------------------------- tailored resume

const TailorSchema = z.object({
  headline: z.string().describe('One line under the name, matched to this role, using only true facts'),
  summary: z.string().describe('3-4 sentence professional summary aimed at this posting'),
  skills: z.array(z.string()).describe('Skills from the resume only, most relevant to this posting first, max 18'),
  experience: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      dates: z.string().describe('Exactly as on the resume'),
      location: z.string().describe('As on the resume, or empty'),
      bullets: z.array(z.string()).describe('3-6 bullets, rewritten to stress what this posting asks for; keep every number and fact true')
    })
  ),
  education: z.array(z.string()).describe('One line per entry, as on the resume'),
  certifications: z.array(z.string()).describe('As on the resume; empty if none'),
  changes: z.array(z.string()).describe('3-6 short notes on what you changed and why, for the candidate to review')
})

const TAILOR_SYSTEM = `You tailor a candidate's resume to one job posting.
Hard rules:
- Use only facts in the resume. Never invent employers, titles, dates, tools, certifications, numbers or projects.
- Keep every employer, title and date exactly as written. Keep all roles, most recent first.
- You may reorder skills and bullets, merge or split bullets, and reword them to use the posting's terms when the resume shows the same thing.
- If the posting asks for something the resume does not show, leave it out and mention it in "changes".
- Plain, specific language. No buzzwords like "results-driven", "dynamic", "passionate", "synergy".`

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function resumeHtml(p: Profile, t: z.infer<typeof TailorSchema>): string {
  const c = p.prefs.contact
  const name = c.full_name || p.profile?.name || p.name
  const contact = [c.email, c.phone, c.city || p.profile?.current_location, c.linkedin_url?.replace(/^https?:\/\/(www\.)?/, '')].filter((x): x is string => !!x).map(esc).join('  ·  ')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 16mm 16mm 14mm; }
  body { font: 10.2pt/1.42 -apple-system, "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; }
  h1 { font-size: 20pt; margin: 0; letter-spacing: -0.2pt; }
  .hl { font-size: 11pt; color: #444; margin-top: 2pt; }
  .ct { font-size: 9pt; color: #555; margin-top: 4pt; }
  h2 { font-size: 9pt; text-transform: uppercase; letter-spacing: 1pt; color: #555; border-bottom: 0.6pt solid #bbb; padding-bottom: 2pt; margin: 13pt 0 6pt; }
  p { margin: 0; }
  .role { margin-bottom: 8pt; page-break-inside: avoid; }
  .rh { display: flex; justify-content: space-between; font-weight: 600; }
  .rs { color: #555; font-size: 9.4pt; }
  ul { margin: 3pt 0 0 14pt; padding: 0; } li { margin: 1.5pt 0; }
  .sk { columns: 1; }
  </style></head><body>
  <h1>${esc(name)}</h1><div class="hl">${esc(t.headline)}</div><div class="ct">${contact}</div>
  <h2>Summary</h2><p>${esc(t.summary)}</p>
  <h2>Skills</h2><p class="sk">${t.skills.map(esc).join('  ·  ')}</p>
  <h2>Experience</h2>
  ${t.experience
    .map(
      (r) => `<div class="role"><div class="rh"><span>${esc(r.title)} — ${esc(r.company)}</span><span class="rs">${esc(r.dates)}</span></div>
    ${r.location ? `<div class="rs">${esc(r.location)}</div>` : ''}<ul>${r.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`
    )
    .join('')}
  ${t.education.length ? `<h2>Education</h2>${t.education.map((e) => `<p>${esc(e)}</p>`).join('')}` : ''}
  ${t.certifications.length ? `<h2>Certifications</h2>${t.certifications.map((e) => `<p>${esc(e)}</p>`).join('')}` : ''}
  </body></html>`
}

async function renderPdf(html: string, out: string): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } })
    writeFileSync(out, pdf)
  } finally {
    win.destroy()
  }
}

export async function tailorResume(p: Profile, jobId: string): Promise<Tailored> {
  if (!p.resume_path) throw new Error('Add a resume to this profile first.')
  const m = job(p, jobId)
  if ((m.description || '').length < 200) throw new Error('This posting has almost no description, so there is nothing to tailor to. Open it and check the full posting.')
  const text = scrub(await resumeText(p.resume_path))
  if (text.trim().length < 200) throw new Error('Could not read text from the resume (scanned image?).')
  const t = await parse(TAILOR_SYSTEM, { text: `RESUME:\n${text}\n\nJOB POSTING:\n${jobBlock(m)}` }, TailorSchema, { effort: 'medium', maxTokens: 8000 })
  const dir = join(profileDir(p.slug), 'tailored')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${slugify(p.name)}-${slugify(m.company).slice(0, 30)}-${slugify(m.title).slice(0, 40)}.pdf`)
  await renderPdf(resumeHtml(p, t), file)
  const out: Tailored = { ...t, pdf: file, created_at: db.now() }
  db.kvSet(`tailored:${p.id}:${jobId}`, JSON.stringify(out))
  return out
}

export function getTailored(pid: number, jobId: string): Tailored | null {
  const v = db.kvGet(`tailored:${pid}:${jobId}`)
  return v ? (JSON.parse(v) as Tailored) : null
}

export function revealFile(path: string, open = false): void {
  if (open) void shell.openPath(path)
  else shell.showItemInFolder(path)
}

// ---------------------------------------------------------------- interview prep

const PrepSchema = z.object({
  questions: z
    .array(
      z.object({
        q: z.string().describe('A question this interviewer is likely to ask'),
        why: z.string().describe('One line: what they are checking'),
        points: z.array(z.string()).describe('2-4 talking points drawn from the candidate’s real experience')
      })
    )
    .describe('8-10 questions: mostly technical/role-specific, a few behavioural'),
  revise: z.array(z.string()).describe('4-8 topics to brush up on, from the posting, esp. gaps'),
  ask_them: z.array(z.string()).describe('3-5 sharp questions the candidate can ask the interviewer')
})

export async function interviewPrep(p: Profile, jobId: string): Promise<Prep> {
  const m = job(p, jobId)
  const pr = p.profile
  if (!pr) throw new Error('Add a resume to this profile first.')
  const cand = JSON.stringify({ headline: pr.headline, current_title: pr.current_title, years: pr.years_experience, skills: pr.skills, tools: pr.tools_and_modules, domains: pr.domains, highlights: pr.highlights, summary: pr.summary })
  const r = await parse(
    'You prepare a candidate for an interview for one specific job. Base talking points only on the candidate profile; if they lack something, say how to address the gap honestly. Be concrete and brief.',
    { text: `CANDIDATE:\n${cand}\n\nJOB:\n${jobBlock(m)}` },
    PrepSchema,
    { effort: 'medium', maxTokens: 6000 }
  )
  const out: Prep = { ...r, created_at: db.now() }
  db.kvSet(`prep:${p.id}:${jobId}`, JSON.stringify(out))
  return out
}

export function getPrep(pid: number, jobId: string): Prep | null {
  const v = db.kvGet(`prep:${pid}:${jobId}`)
  return v ? (JSON.parse(v) as Prep) : null
}

// ---------------------------------------------------------------- answers for application forms

export interface FormQuestion {
  i: number
  label: string
  options?: string[]
  long?: boolean
}

// Questions we never answer for the person: legally protected or personal.
const SENSITIVE = /gender|sex\b|religio|caste|categor(y|ies)\b.*(sc|st|obc)|disab|veteran|race|ethnic|date of birth|\bdob\b|\bage\b|marital|pregnan|nationality|passport|aadhaar|\bpan\b|social security|criminal|convict|bank|salary slip|password/i

const AnswerSchema = z.object({
  answers: z.array(z.object({ i: z.number(), value: z.string().describe('Answer, or empty string if the facts are not available') }))
})

export async function answerQuestions(p: Profile, jobId: string | null, qs: FormQuestion[]): Promise<{ i: number; value: string }[]> {
  const pr = p.profile
  if (!pr) return []
  const safe = qs.filter((q) => q.label.trim().length > 3 && !SENSITIVE.test(q.label)).slice(0, 15)
  if (!safe.length) return []
  const m = jobId ? db.listMatches(p.id, { includeFiltered: true }).find((x) => x.id === jobId) : null
  const facts = JSON.stringify({
    headline: pr.headline, current_title: p.prefs.contact.current_title || pr.current_title, current_company: p.prefs.contact.current_company,
    years_experience: p.prefs.years_experience || pr.years_experience, city: p.prefs.contact.city || pr.current_location,
    preferred_locations: p.prefs.locations, skills: pr.skills, tools: pr.tools_and_modules, domains: pr.domains, education: pr.education,
    highlights: pr.highlights, saved_answers: p.prefs.answers.filter((a) => a.value.trim())
  })
  const r = await parse(
    `You draft answers to job application form questions for one candidate. Use only the facts given. If a question needs a fact you do not have (a specific yes/no about visas, relocation, willingness, a number not given), return an empty string — the candidate will answer it. For multiple choice, return one option exactly as written. Short fields: a few words. Long fields: 2-4 plain sentences, first person, no buzzwords.`,
    { text: `FACTS:\n${facts}\n\n${m ? `JOB: ${m.title} at ${m.company}\n\n` : ''}QUESTIONS:\n${JSON.stringify(safe)}` },
    AnswerSchema,
    { effort: 'low', maxTokens: 3000 }
  )
  const ok = new Set(safe.map((q) => q.i))
  return r.answers.filter((a) => ok.has(a.i) && a.value.trim())
}
