// Score a job against a profile with Claude and write a tailored cover note.
import { z } from 'zod'
import { Job, Profile } from '../shared/types'
import { candidateBlock, MATCH_SYSTEM as SYSTEM, MatchSchema, postingText, relevance } from '../shared/match'
export { relevance }
import * as db from './db'
import { engine, LLMNotConfigured, model, parse } from './llm'
import { getSettings } from './settings'

export async function scoreJob(p: Profile, j: Job): Promise<z.infer<typeof MatchSchema>> {
  const system = [
    { text: SYSTEM },
    // identical for every job in a run -> cached prefix on Claude
    { text: 'CANDIDATE PROFILE\n' + candidateBlock(p), cache: true }
  ]
  return parse(system, { text: postingText(j) }, MatchSchema, { maxTokens: 4000 })
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

export async function rescoreOne(p: Profile, jobId: string): Promise<void> {
  const j = db.getJob(jobId)
  if (!j || !p.profile) throw new Error('job or profile not found')
  const m = await scoreJob(p, j)
  db.saveScore(p.id, j.id, Math.max(0, Math.min(100, m.score)), m.reasons, m.red_flags, m.cover_note, model(), m.matched_skills.slice(0, 8), m.missing_skills.slice(0, 6))
}
