// Resume file -> structured profile (Claude reads PDFs natively; DOCX goes through mammoth).
import { readFileSync } from 'fs'
import { extname } from 'path'
import { ParsedProfile } from '../shared/types'
import { RESUME_SYSTEM as SYSTEM, ResumeSchema as Schema, prefsFromProfile, resumePrompt } from '../shared/resume'
import { engine, parse } from './llm'

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
  return parse(SYSTEM, { text: resumePrompt(text) }, Schema, { effort: 'medium', maxTokens: 6000 })
}

export { prefsFromProfile }
