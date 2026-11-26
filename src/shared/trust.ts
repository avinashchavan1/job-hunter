// Quick, offline "is this posting legit / is this the real place to apply" check.
// Pure function (no network, no AI) so it runs instantly in the UI for every job.
import type { Job } from './types'

export type TrustLevel = 'direct' | 'ok' | 'repost' | 'agency' | 'risky'
export interface Trust {
  level: TrustLevel
  label: string
  reasons: string[]
  /** Search link to find the company's own posting (only when the link is not already the company's). */
  findOriginal?: string
}

// Job boards / ATS where the employer posts directly or that verify employers.
const DIRECT_HOSTS = [
  'greenhouse.io', 'lever.co', 'myworkdayjobs.com', 'workday.com', 'smartrecruiters.com', 'workable.com', 'ashbyhq.com',
  'icims.com', 'successfactors.com', 'successfactors.eu', 'taleo.net', 'oraclecloud.com', 'jobvite.com', 'bamboohr.com',
  'recruitee.com', 'darwinbox.in', 'keka.com', 'zohorecruit.com', 'zohorecruit.in', 'freshteam.com', 'personio.de', 'teamtailor.com',
  'breezy.hr', 'jazzhr.com', 'eightfold.ai', 'phenompeople.com', 'avature.net'
]
const TRUSTED_BOARDS = ['naukri.com', 'linkedin.com', 'indeed.com', 'instahyre.com', 'iimjobs.com', 'hirist.tech', 'cutshort.io', 'foundit.in', 'glassdoor.com', 'glassdoor.co.in', 'wellfound.com', 'angel.co']
// Sites that copy postings from elsewhere. Not scams, but apply on the original.
const REPOST_HOSTS = [
  'social-networking.me', 'jooble.org', 'jobrapido.com', 'talent.com', 'trabajo.org', 'bebee.com', 'jobleads.com', 'whatjobs.com',
  'jobsora.com', 'careerjet.co.in', 'careerjet.com', 'neuvoo.com', 'simplyhired.com', 'adzuna.in', 'adzuna.com', 'jobisjob.com',
  'recruit.net', 'expertini.com', 'jobted.in', 'mncjobsindia.com', 'freshersworld.com', 'shine.com', 'timesjobs.com', 'apna.co',
  'workindia.in', 'kitjob.in', 'jora.com', 'learn4good.com', 'built-in.com', 'builtin.com', 'tm-praxis', 'remoterocketship.com',
  'himalayas.app', 'jobgether.com', 'dailyremote.com'
]
const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'rb.gy', 'cutt.ly', 'shorturl.at', 'forms.gle', 'wa.me', 't.me', 'telegram.me']
const SCAM_TEXT = /registration fee|security deposit|refundable deposit|pay (a |the )?(fee|amount)|processing fee|training fee|send money|whatsapp (us|me|hr)|telegram|earn (rs\.?|₹|inr)?\s?\d+[,\d]* (per|a) (day|week)|no interview|instant joining.*(fee|pay)|data entry.*work from home|part[- ]time.*daily (payment|payout)/i
const AGENCY = /\b(placement|placements|consultan(cy|ts)|staffing|manpower|recruit(ers|ment)|hr solutions|talent solutions|outsourcing|search partners|executive search)\b/i
const HIDDEN_COMPANY = /^(confidential|anywhere|hiring|company|undisclosed|leading (mnc|company|client)|top mnc|mnc|reputed (company|client)|client of .+|n\/a|-)$/i

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}
const onHost = (host: string, list: string[]): boolean => list.some((d) => host === d || host.endsWith('.' + d) || host.includes(d))

export function checkTrust(j: Pick<Job, 'url' | 'company' | 'title' | 'description' | 'source'>): Trust {
  const host = hostOf(j.url)
  const company = (j.company || '').trim()
  const reasons: string[] = []
  const companyTokens = company.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 3 && !/^(private|limited|india|technologies|technology|solutions|services|systems|software|global|group|consulting)$/.test(t))
  const find = `https://www.google.com/search?q=${encodeURIComponent(`${company} careers ${j.title}`)}`

  if (SCAM_TEXT.test(j.description || '')) {
    return { level: 'risky', label: 'Looks risky', reasons: ['Mentions fees, deposits, chat-app contact or pay-per-day work — common in job scams. Never pay to apply.'], findOriginal: company ? find : undefined }
  }
  if (host && onHost(host, SHORTENERS)) reasons.push('Link goes through a shortener or chat app, so you cannot see where it really leads.')
  if (/@(gmail|yahoo|outlook|hotmail|rediffmail)\.com/i.test(j.description || '')) reasons.push('Asks you to email a personal (Gmail/Yahoo) address instead of a company one.')
  if (reasons.length) return { level: 'risky', label: 'Looks risky', reasons, findOriginal: company ? find : undefined }

  if (!company || HIDDEN_COMPANY.test(company)) {
    return { level: 'agency', label: 'Company hidden', reasons: ['The employer is not named. Ask who the client is before sharing details.'] }
  }
  if (AGENCY.test(company)) {
    return { level: 'agency', label: 'Agency', reasons: [`${company} looks like a recruitment agency, not the employer. Fine to use, but ask which company it is for.`], findOriginal: find }
  }
  if (host && onHost(host, REPOST_HOSTS)) {
    return { level: 'repost', label: 'Reposted', reasons: [`${host} copies listings from other sites. Apply on ${company}'s own careers page instead — your details go straight to them.`], findOriginal: find }
  }
  if (host && (onHost(host, DIRECT_HOSTS) || companyTokens.some((t) => host.replace(/[^a-z0-9]/g, '').includes(t)))) {
    return { level: 'direct', label: 'Company site', reasons: ['Link goes to the employer’s own hiring system.'] }
  }
  if (host && onHost(host, TRUSTED_BOARDS)) return { level: 'ok', label: host.split('.')[0].replace(/^\w/, (c) => c.toUpperCase()), reasons: ['Posted on a major job board.'] }
  if (!host) return { level: 'ok', label: 'No link', reasons: [] }
  return { level: 'repost', label: 'Unknown site', reasons: [`${host} is not the company’s site or a known job board. Check the job on ${company}'s careers page before applying.`], findOriginal: find }
}
