// Resume file -> structured profile (Claude reads PDFs natively; DOCX goes through mammoth).
import { readFileSync } from 'fs'
import { extname } from 'path'
import { z } from 'zod'
import { ParsedProfile, Prefs } from '../shared/types'
import { engine, parse } from './llm'

const Schema = z.object({
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

const SYSTEM =
  'You extract a structured candidate profile from a resume. Use only facts in the resume. ' +
  'Compute years of experience from dates when not stated; count training and internships separately and do not add them. ' +
  'Do not include phone numbers or email addresses anywhere in the output.'

async function pdfText(path: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(path)))
  const { text } = await extractText(pdf, { mergePages: true })
  return text as string
}

export async function resumeText(path: string): Promise<string> {
  const ext = extname(path).toLowerCase()
  if (ext === '.pdf') return pdfText(path)
  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ path })).value
  }
  return readFileSync(path, 'utf8')
}

export async function parseResume(path: string): Promise<ParsedProfile> {
  const ext = extname(path).toLowerCase()
  // Claude reads PDFs natively (keeps layout); other engines get extracted text
  if (ext === '.pdf' && engine() === 'anthropic') {
    return parse(SYSTEM, { text: 'Extract the candidate profile from this resume.', pdf: readFileSync(path).toString('base64') }, Schema, { effort: 'medium' })
  }
  const text = await resumeText(path)
  if (text.trim().length < 200) throw new Error('Could not read text from this resume (scanned image?). Try a text-based PDF or DOCX.')
  return parse(SYSTEM, { text: `Extract the candidate profile from this resume:

${text}` }, Schema, { effort: 'medium', maxTokens: 6000 })
}

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
