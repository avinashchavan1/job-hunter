// Score a job against a profile with Claude and write a tailored cover note.
import { z } from 'zod'
import { Job, Profile } from '../shared/types'
import * as db from './db'
import { engine, LLMNotConfigured, model, parse } from './llm'
import { getSettings } from './settings'

const MatchSchema = z.object({
  score: z.number().int().describe('0-100 fit score'),
  reasons: z.array(z.string()).describe('2-4 short reasons it fits, citing concrete overlap'),
  red_flags: z.array(z.string()).describe('0-3 concerns: gaps, seniority mismatch, location, shift, thin posting'),
  matched_skills: z.array(z.string()).describe('Up to 8 requirements of the posting the candidate clearly has (short labels)'),
  missing_skills: z.array(z.string()).describe('Up to 6 requirements of the posting the candidate lacks or does not show (short labels); empty if none'),
  cover_note: z.string().describe('Tailored note, 90-140 words, first person, plain text, no placeholders')
})

const SYSTEM = `You screen job postings for one candidate and write a short note they can paste into an application.

Scoring guide:
- 85-100: role, core skills, seniority and location all line up; candidate could interview tomorrow.
- 65-84: strong overlap with one or two gaps.
- 45-64: adjacent role or partial skill overlap.
- 0-44: different function, seniority far off, or mostly unrelated skills.
Judge on the posting's actual requirements, not its title alone. If the description is very short, score on what is there and add a red flag that the posting is thin.
Salary below the candidate's expectation is a red flag, never by itself a reason to lower the score.

Cover note: first person, specific to this posting, 2-3 directly relevant facts from the candidate profile, no greeting or sign-off, no invented facts, no placeholders like [Company].`

function candidateBlock(p: Profile): string {
  const pr = p.profile!
  return JSON.stringify(
    {
      name: pr.name,
      headline: pr.headline,
      current_title: pr.current_title,
      years_experience: pr.years_experience,
      current_location: pr.current_location,
      skills: pr.skills,
      tools_and_modules: pr.tools_and_modules,
      domains: pr.domains,
      past_titles: pr.past_titles,
      highlights: pr.highlights,
      summary: pr.summary,
      preferences: {
        target_titles: p.prefs.target_titles,
        locations: p.prefs.locations,
        remote_ok: p.prefs.remote_ok,
        min_salary_lpa: p.prefs.min_salary_lpa
      }
    },
    null,
    1
  )
}

export async function scoreJob(p: Profile, j: Job): Promise<z.infer<typeof MatchSchema>> {
  const system = [
    { text: SYSTEM },
    // identical for every job in a run -> cached prefix on Claude
    { text: 'CANDIDATE PROFILE\n' + candidateBlock(p), cache: true }
  ]
  const posting =
    `Title: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location || '-'}\n` +
    `Salary: ${j.salary || 'not listed'}\nPosted: ${j.posted_at || '-'}\n\n` +
    `Description:\n${(j.description || '(none provided)').slice(0, 12000)}`
  return parse(system, { text: posting }, MatchSchema, { maxTokens: 4000 })
}

export async function scorePending(p: Profile, limit: number, log: (s: string) => void): Promise<{ scored: number; score_failed: number }> {
  if (!p.profile) throw new Error('profile has no parsed resume yet')
  // best-first: cheap keyword relevance so slow models reach the likeliest matches early
  const jobs = db
    .unscoredJobs(p.id, limit * 4)
    .map((j) => ({ j, r: relevance(p, j) }))
    .sort((a, b) => b.r - a.r)
    .slice(0, limit)
    .map((x) => x.j)
  let scored = 0
  let failed = 0
  // small concurrency: fast enough, gentle on rate limits
  const queue = [...jobs]
  async function worker(): Promise<void> {
    for (let j = queue.shift(); j; j = queue.shift()) {
      try {
        const m = await scoreJob(p, j)
        db.saveScore(p.id, j.id, Math.max(0, Math.min(100, m.score)), m.reasons, m.red_flags, m.cover_note, model(), m.matched_skills.slice(0, 8), m.missing_skills.slice(0, 6))
        scored++
        log(`scored ${String(m.score).padStart(3)}  ${j.title.slice(0, 60)} @ ${j.company.slice(0, 30)}`)
      } catch (e: any) {
        if (e instanceof LLMNotConfigured) throw e
        failed++
        log(`score failed for "${j.title}": ${e?.message ?? e}`)
      }
    }
  }
  const n = engine() === 'anthropic' ? 3 : Math.max(1, getSettings().llm.concurrency)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return { scored, score_failed: failed }
}

/** Keyword overlap between a posting and the profile (0..1). No LLM. */
export function relevance(p: Profile, j: Job): number {
  const words = (t: string): string[] => t.toLowerCase().split(/[^a-z0-9/+#.]+/).filter((w) => w.length > 2)
  const title = new Set(words(j.title))
  const body = new Set(words(`${j.title} ${j.description}`))
  const titleTerms = new Set(p.prefs.target_titles.flatMap(words))
  const skillTerms = new Set([...(p.profile?.skills ?? []), ...(p.profile?.tools_and_modules ?? [])].flatMap(words))
  const hit = (set: Set<string>, terms: Set<string>): number => (terms.size ? [...terms].filter((t) => set.has(t)).length / terms.size : 0)
  return 0.6 * hit(title, titleTerms) + 0.4 * hit(body, skillTerms)
}

export async function rescoreOne(p: Profile, jobId: string): Promise<void> {
  const j = db.getJob(jobId)
  if (!j || !p.profile) throw new Error('job or profile not found')
  const m = await scoreJob(p, j)
  db.saveScore(p.id, j.id, Math.max(0, Math.min(100, m.score)), m.reasons, m.red_flags, m.cover_note, model(), m.matched_skills.slice(0, 8), m.missing_skills.slice(0, 6))
}
