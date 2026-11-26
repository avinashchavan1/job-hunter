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

// Cities that job sites name differently. Each group counts as one place.
const CITY_GROUPS: string[][] = [
  ['bangalore', 'bengaluru'],
  ['hyderabad', 'secunderabad', 'cyberabad', 'hitec city', 'gachibowli'],
  ['gurgaon', 'gurugram'],
  ['delhi', 'new delhi', 'delhi ncr', 'ncr'],
  ['mumbai', 'bombay', 'navi mumbai', 'thane'],
  ['chennai', 'madras'],
  ['kolkata', 'calcutta'],
  ['pune', 'poona', 'pimpri', 'hinjewadi']
]
const sameCity = (want: string): string[] => CITY_GROUPS.find((g) => g.includes(want)) ?? [want]

/** Regions, for "close enough" places that aren't on the list (shown amber, never hidden). */
const REGIONS: Record<string, string[]> = {
  'South India': ['bangalore', 'bengaluru', 'hyderabad', 'secunderabad', 'chennai', 'madras', 'kochi', 'cochin', 'ernakulam', 'trivandrum', 'thiruvananthapuram', 'coimbatore', 'mysore', 'mysuru', 'mangalore', 'mangaluru', 'visakhapatnam', 'vizag', 'vijayawada', 'hubli', 'belgaum', 'madurai', 'tiruchirappalli', 'trichy', 'salem', 'warangal', 'tirupati', 'pondicherry', 'puducherry', 'calicut', 'kozhikode', 'thrissur', 'karnataka', 'telangana', 'andhra', 'tamil nadu', 'kerala'],
  'North India': ['delhi', 'new delhi', 'ncr', 'gurgaon', 'gurugram', 'noida', 'faridabad', 'ghaziabad', 'chandigarh', 'mohali', 'jaipur', 'lucknow', 'dehradun'],
  'West India': ['mumbai', 'bombay', 'navi mumbai', 'thane', 'pune', 'ahmedabad', 'vadodara', 'surat', 'nagpur', 'nashik', 'indore', 'goa'],
  'East India': ['kolkata', 'calcutta', 'bhubaneswar', 'guwahati', 'patna', 'ranchi']
}
const regionOf = (place: string): string | null => Object.entries(REGIONS).find(([, cs]) => cs.some((c) => place.includes(c)))?.[0] ?? null

/** ok: true = fits (green), 'near' = close enough (amber), false = doesn't (red), null = not stated (grey). */
export type Check = { key: 'location' | 'experience' | 'salary' | 'company' | 'keyword'; ok: boolean | 'near' | null; label: string }

/**
 * How a job compares with the person's preferences — shown as green (ok) / red (not ok) / grey (unknown).
 * Nothing here hides a job; the person decides.
 */
export function checks(job: Job, prefs: Prefs): Check[] {
  const title = job.title.toLowerCase()
  const company = job.company.toLowerCase()
  const loc = (job.location || '').toLowerCase()
  const blob = [title, company, loc, (job.description || '').toLowerCase()].join(' ')
  const out: Check[] = []

  const locs = prefs.locations.map((l) => l.toLowerCase().trim()).filter(Boolean)
  if (locs.length) {
    const remote = /remote|work from home|wfh|anywhere/.test(loc + ' ' + title)
    const pan = /^india$|pan india|multiple locations|across india/.test(loc.trim())
    if (!loc) out.push({ key: 'location', ok: null, label: 'City not listed' })
    else if (locs.flatMap(sameCity).some((l) => loc.includes(l))) out.push({ key: 'location', ok: true, label: job.location })
    else if (remote) out.push({ key: 'location', ok: prefs.remote_ok, label: prefs.remote_ok ? 'Remote' : 'Remote (you prefer office)' })
    else if (pan) out.push({ key: 'location', ok: true, label: 'Anywhere in India' })
    else {
      // common sense: another city in the same region is "close enough", not a mismatch
      const theirs = regionOf(loc)
      const near = theirs && locs.some((l) => regionOf(l) === theirs)
      out.push({ key: 'location', ok: near ? 'near' : false, label: near ? `${job.location} · ${theirs}` : job.location })
    }
  }

  const yrs = yearsRequired(blob)
  if (!yrs) out.push({ key: 'experience', ok: null, label: 'Experience not stated' })
  else {
    const txt = yrs[0] === yrs[1] ? `${yrs[0]}+ yrs` : `${yrs[0]}–${yrs[1]} yrs`
    const ok = yrs[0] <= prefs.years_max && yrs[1] >= Math.max(0, prefs.years_min)
    out.push({ key: 'experience', ok, label: ok ? txt : `${txt} (you: ${prefs.years_experience || prefs.years_min}+)` })
  }

  if (prefs.min_salary_lpa) {
    const lpa = salaryLpa(job.salary)
    if (lpa == null) out.push({ key: 'salary', ok: null, label: 'Salary not listed' })
    else out.push({ key: 'salary', ok: lpa >= prefs.min_salary_lpa, label: `${lpa} LPA${lpa < prefs.min_salary_lpa ? ` (want ${prefs.min_salary_lpa}+)` : ''}` })
  }

  for (const c of prefs.exclude_companies) if (c && company.includes(c.toLowerCase())) out.push({ key: 'company', ok: false, label: `On your skip list: ${c}` })
  for (const k of prefs.exclude_keywords) if (k && has(blob, k)) out.push({ key: 'keyword', ok: false, label: `Mentions “${k}”` })
  return out
}

/**
 * Jobs are no longer hidden for city, experience or salary — those show as red checks instead.
 * Only companies and words the person put on their own skip lists are set aside.
 */
export function check(job: Job, prefs: Prefs): string | null {
  const company = job.company.toLowerCase()
  const blob = [job.title, company, job.location, job.description].join(' ').toLowerCase()
  for (const c of prefs.exclude_companies) if (c && company.includes(c.toLowerCase())) return `excluded company: ${c}`
  for (const k of prefs.exclude_keywords) if (k && has(blob, k)) return `excluded keyword: ${k}`
  return null
}
