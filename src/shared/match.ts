// Job scoring rules shared by the desktop app and the web server: schema, prompt, candidate block, keyword ranking.
import { z } from 'zod'
import type { Job, Profile } from './types'

export const MatchSchema = z.object({
  score: z.number().int().describe('0-100 fit score'),
  reasons: z.array(z.string()).describe('2-4 short reasons it fits, citing concrete overlap'),
  red_flags: z.array(z.string()).describe('0-3 concerns: gaps, seniority mismatch, location, shift, thin posting'),
  matched_skills: z.array(z.string()).describe('Up to 8 requirements of the posting the candidate clearly has (short labels)'),
  missing_skills: z.array(z.string()).describe('Up to 6 requirements of the posting the candidate lacks or does not show (short labels); empty if none'),
  cover_note: z.string().describe('Tailored note, 90-140 words, first person, plain text, no placeholders')
})

export const MATCH_SYSTEM = `You screen job postings for one candidate and write a short note they can paste into an application.

Scoring guide:
- 85-100: role, core skills, seniority and location all line up; candidate could interview tomorrow.
- 65-84: strong overlap with one or two gaps.
- 45-64: adjacent role or partial skill overlap.
- 0-44: different function, seniority far off, or mostly unrelated skills.
Judge on the posting's actual requirements, not its title alone. If the description is very short, score on what is there and add a red flag that the posting is thin.
Salary below the candidate's expectation is a red flag, never by itself a reason to lower the score.

Cover note: first person, specific to this posting, 2-3 directly relevant facts from the candidate profile, no greeting or sign-off, no invented facts, no placeholders like [Company].`

export function candidateBlock(p: Profile): string {
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

export type MatchResult = z.infer<typeof MatchSchema>

export const postingText = (j: Job): string =>
  `Title: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location || '-'}\n` +
  `Salary: ${j.salary || 'not listed'}\nPosted: ${j.posted_at || '-'}\n\n` +
  `Description:\n${(j.description || '(none provided)').slice(0, 12000)}`

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

