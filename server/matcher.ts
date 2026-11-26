// Scores jobs for a person with the AI (same rules as the desktop app), within a time budget:
// edge functions have a wall-clock limit, so whatever is left is picked up by the next scheduler tick.
import type { Job, Profile } from '../src/shared/types'
import { candidateBlock, MATCH_SYSTEM, MatchSchema, type MatchResult, postingText, relevance } from '../src/shared/match'
import { getSettings } from './ctx'
import { Llm, LLMNotConfigured } from './llm'
import { saveScore, unscoredJobs } from './store'

export async function scoreJob(llm: Llm, p: Profile, j: Job): Promise<MatchResult> {
  const system = [{ text: MATCH_SYSTEM }, { text: 'CANDIDATE PROFILE\n' + candidateBlock(p), cache: true }]
  return llm.parse(system, { text: postingText(j) }, MatchSchema, { maxTokens: 4000 })
}

async function scoreAndSave(llm: Llm, p: Profile, j: Job): Promise<number> {
  const m = await scoreJob(llm, p, j)
  const score = Math.max(0, Math.min(100, Math.round(m.score)))
  await saveScore(p.id, j.id, { score, reasons: m.reasons, red_flags: m.red_flags, cover_note: m.cover_note, model: llm.model, matched: m.matched_skills.slice(0, 8), missing: m.missing_skills.slice(0, 6) })
  return score
}

/** Scores unscored jobs best-first until `deadline` (ms timestamp) or `limit` jobs. */
export async function scorePending(p: Profile, deadline: number, log: (s: string) => void, limit = 60): Promise<{ scored: number; score_failed: number; left: number }> {
  if (!p.profile) throw new Error('profile has no parsed resume yet')
  const llm = await Llm.load()
  const pool = await unscoredJobs(p.id, 400)
  const queue = pool.map((j) => ({ j, r: relevance(p, j) })).sort((a, b) => b.r - a.r).slice(0, limit).map((x) => x.j)
  let scored = 0
  let failed = 0
  const worker = async (): Promise<void> => {
    // ~35 s is a slow free-model reply; don't start one we can't finish
    for (let j = queue.shift(); j && Date.now() < deadline - 35_000; j = queue.shift()) {
      try {
        const s = await scoreAndSave(llm, p, j)
        scored++
        log(`scored ${String(s).padStart(3)}  ${j.title.slice(0, 60)} @ ${j.company.slice(0, 30)}`)
      } catch (e: any) {
        if (e instanceof LLMNotConfigured) throw e
        failed++
        log(`score failed for "${j.title}": ${e?.message ?? e}`)
      }
    }
  }
  const n = llm.engine === 'anthropic' ? 3 : Math.max(1, (await getSettings()).llm.concurrency)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return { scored, score_failed: failed, left: Math.max(0, pool.length - scored - failed) }
}

export async function rescoreOne(p: Profile, j: Job): Promise<void> {
  if (!p.profile) throw new Error('Add a resume first')
  await scoreAndSave(await Llm.load(), p, j)
}
