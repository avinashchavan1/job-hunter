// Resume -> structured profile: schema, prompt and helpers shared by the desktop app and the web server.
import { z } from 'zod'
import type { Contact, ParsedProfile, Prefs } from './types'

export const ResumeSchema = z.object({
  name: z.string(),
  headline: z.string().describe('One-line professional headline'),
  current_title: z.string(),
  years_experience: z.number().describe('Professional years, excluding training/internships'),
  current_location: z.string(),
  skills: z.array(z.string()).describe('Concrete technical/functional skills, most important first'),
  tools_and_modules: z.array(z.string()).describe('Products, modules, tools, platforms'),
  domains: z.array(z.string()).describe('Industries / business domains worked in'),
  past_titles: z.array(z.string()),
  suggested_search_titles: z.array(z.string()).describe('5-8 job titles to search for, best fit first'),
  seniority: z.string().describe('junior | mid | senior | lead'),
  education: z.string(),
  highlights: z.array(z.string()).describe('3-6 strongest, quantified achievements'),
  summary: z.string().describe('3-4 sentence summary used when matching jobs')
})

export const RESUME_SYSTEM =
  'You extract a structured candidate profile from a resume. Use only facts in the resume. ' +
  'Compute years of experience from dates when not stated; count training and internships separately and do not add them. ' +
  'Do not include phone numbers or email addresses anywhere in the output.'

export const resumePrompt = (text: string): string => `Extract the candidate profile from this resume:\n\n${text}`

/** Starting preferences derived from a parsed profile. */
export function prefsFromProfile(p: ParsedProfile): Partial<Prefs> {
  const yrs = Number(p.years_experience) || 0
  return {
    target_titles: p.suggested_search_titles.slice(0, 6),
    locations: p.current_location ? [p.current_location.split(',')[0].trim()] : [],
    years_experience: yrs,
    years_min: Math.max(0, Math.floor(yrs) - 2),
    years_max: Math.floor(yrs) + 4
  }
}

/** Apply a freshly parsed resume to a profile, keeping lists the user already set. */
export function mergeParsed(cur: { name: string; prefs: Prefs }, parsed: ParsedProfile): { name: string; prefs: Prefs } {
  const prefs: Prefs = { ...cur.prefs, ...prefsFromProfile(parsed) }
  if (cur.prefs.target_titles.length) prefs.target_titles = cur.prefs.target_titles
  if (cur.prefs.locations.length) prefs.locations = cur.prefs.locations
  const name = cur.name && cur.name !== 'New profile' ? cur.name : parsed.name
  return { name, prefs }
}

/** Contact details from resume text — regex only, no AI. */
export function contactFromText(t: string, profile: ParsedProfile | null): Partial<Contact> {
  const email = (t.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) || [''])[0]
  const phone = ((t.match(/(\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/) || [''])[0] || '').replace(/[\s-]/g, '')
  const li = (t.match(/(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+/i) || [''])[0]
  return {
    full_name: profile?.name ?? '',
    email,
    phone,
    city: (profile?.current_location ?? '').split(',')[0].trim(),
    linkedin_url: li && !/^https?:/.test(li) ? `https://${li}` : li,
    current_title: profile?.current_title ?? ''
  }
}
