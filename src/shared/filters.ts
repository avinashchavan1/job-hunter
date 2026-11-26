// Cheap hard filters applied before any Claude call.
import { Job, Prefs } from './types'

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const has = (text: string, phrase: string): boolean => new RegExp(`\\b${esc(phrase.toLowerCase())}\\b`).test(text)

export function yearsRequired(text: string): [number, number] | null {
  let m = text.match(/(\d{1,2})\s*(?:-|to|–)\s*(\d{1,2})\s*\+?\s*(?:years|yrs)/)
  if (m) return [Number(m[1]), Number(m[2])]
  m = text.match(/(?:minimum|min\.?|at least)\s*(?:of\s*)?(\d{1,2})\s*\+?\s*(?:years|yrs)/) || text.match(/(\d{1,2})\s*\+\s*(?:years|yrs)/)
  if (m) return [Number(m[1]), Number(m[1])]
  return null
}

/** Upper bound of an Indian salary string, in lakhs per annum. */
export function salaryLpa(s: string): number | null {
  const t = (s || '').toLowerCase().replace(/,/g, '')
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*(?:lpa|lacs?|lakhs?)/)
  if (m) return Number(m[2])
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:lpa|lacs?|lakhs?)/)
  if (m) return Number(m[1])
  m = t.match(/(?:₹|inr|rs\.?)\s*(\d{5,8})/)
  if (m) return Number(m[1]) / 100000
  return null
}

/** Returns a reason if the job should be dropped, else null. */
export function check(job: Job, prefs: Prefs): string | null {
  const title = job.title.toLowerCase()
  const company = job.company.toLowerCase()
  const loc = (job.location || '').toLowerCase()
  const blob = [title, company, loc, (job.description || '').toLowerCase()].join(' ')

  for (const c of prefs.exclude_companies) if (c && company.includes(c.toLowerCase())) return `excluded company: ${c}`
  for (const k of prefs.exclude_keywords) if (k && has(blob, k)) return `excluded keyword: ${k}`

  const yrs = yearsRequired(blob)
  if (yrs && yrs[0] > prefs.years_max) return `needs ${yrs[0]}+ yrs (max ${prefs.years_max})`

  if (prefs.drop_below_min_salary && prefs.min_salary_lpa) {
    const lpa = salaryLpa(job.salary)
    if (lpa == null && !prefs.keep_unknown_salary) return 'salary not listed'
    if (lpa != null && lpa < prefs.min_salary_lpa) return `salary ${lpa} LPA < ${prefs.min_salary_lpa}`
  }

  const locs = prefs.locations.map((l) => l.toLowerCase()).filter(Boolean)
  if (locs.length && loc) {
    const aliases: Record<string, string[]> = { bangalore: ['bengaluru'], bengaluru: ['bangalore'], gurgaon: ['gurugram'], gurugram: ['gurgaon'] }
    const want = locs.flatMap((l) => [l, ...(aliases[l] || [])])
    const remote = /remote|work from home|wfh|anywhere/.test(loc + ' ' + title)
    const pan = /^india$|pan india|multiple locations|across india/.test(loc.trim())
    if (!want.some((l) => loc.includes(l)) && !(remote && prefs.remote_ok) && !pan) return `location: ${job.location}`
  }
  return null
}
