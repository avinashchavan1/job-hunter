// Resume bytes -> text (PDF via unpdf, DOCX by unzipping word/document.xml).
import { extractText, getDocumentProxy } from 'unpdf'
import { strFromU8, unzipSync } from 'fflate'

export async function resumeText(bytes: Uint8Array, ext: string): Promise<string> {
  if (ext === 'pdf') {
    const pdf = await getDocumentProxy(bytes)
    const { text } = await extractText(pdf, { mergePages: true })
    return text as string
  }
  if (ext === 'docx') {
    const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' })
    const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array())
    return xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<\/w:p>|<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return new TextDecoder().decode(bytes)
}
