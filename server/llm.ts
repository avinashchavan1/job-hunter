// LLM layer for the server (same behaviour as the desktop app's src/main/llm.ts):
//  - anthropic: Claude via the official SDK, structured outputs
//  - openai_compat: any OpenAI-compatible /v1/chat/completions server (OpenRouter, ...), JSON validated with zod
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { AppSettings } from '../src/shared/types'
import { getSettings, secret } from './ctx'
import { kvGet, kvSet } from './store'

export class LLMNotConfigured extends Error {}
/** The AI account's daily allowance is used up: stop for today instead of retrying every job. */
export class LLMDailyLimit extends LLMNotConfigured {}

export type Block = { text: string; cache?: boolean }
type Opts = { effort?: 'low' | 'medium' | 'high'; maxTokens?: number }

const cooldown = new Map<string, number>()
let lastVia = ''

// Several keys for the same AI server (e.g. two people's OpenRouter accounts): use the first one that
// still has its daily allowance; one that hits the daily limit is skipped until tomorrow (India date).
const istDay = (): string => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
const spentKey = (): string => `llm_spent:${istDay()}`

export class Llm {
  private constructor(private s: AppSettings, private anthropicKey: string, private keys: string[], private spent: Set<number>) {}

  static async load(): Promise<Llm> {
    const keys = [await secret('LLM_API_KEY'), await secret('LLM_API_KEY_2'), await secret('LLM_API_KEY_3')]
    const spent = new Set<number>(JSON.parse((await kvGet(spentKey())) || '[]'))
    return new Llm(await getSettings(), await secret('ANTHROPIC_API_KEY'), keys, spent)
  }

  /** Index of the key to use now, or -1 if every key has used its daily allowance. */
  private keyIndex(): number {
    const live = this.keys.map((k, i) => (k && !this.spent.has(i) ? i : -1)).filter((i) => i >= 0)
    if (live.length) return live[0]
    return this.keys.some(Boolean) ? -1 : 0 // no key at all: send none (local servers)
  }
  private get compatKey(): string {
    const i = this.keyIndex()
    return i < 0 ? '' : this.keys[i] ?? ''
  }
  private async markSpent(): Promise<boolean> {
    const i = this.keyIndex()
    if (i >= 0) this.spent.add(i)
    await kvSet(spentKey(), JSON.stringify([...this.spent])).catch(() => {})
    return this.keyIndex() >= 0
  }

  get engine(): 'anthropic' | 'openai_compat' {
    return this.s.llm.provider
  }
  get model(): string {
    return this.engine === 'anthropic' ? this.s.model || 'claude-opus-5-5' : this.s.llm.model || 'auto'
  }
  get label(): string {
    return this.engine === 'anthropic' ? `Claude (${this.model})` : `${this.s.llm.baseUrl} · ${this.model}`
  }
  chain(): string[] {
    return [...new Set([this.s.llm.model, ...(this.s.llm.fallbackModels ?? [])].filter(Boolean))]
  }

  /** One structured call validated against a zod schema. `pdf` (base64) goes natively to Claude. */
  async parse<T extends z.ZodType>(system: Block[] | string, user: { text: string; pdf?: string }, schema: T, o: Opts = {}): Promise<z.infer<T>> {
    const sys = typeof system === 'string' ? [{ text: system }] : system
    if (this.engine === 'anthropic') {
      const content: string | Anthropic.ContentBlockParam[] = user.pdf
        ? [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: user.pdf } },
            { type: 'text', text: user.text }
          ]
        : user.text
      return this.parseAnthropic(sys, content, schema, o)
    }
    return this.parseCompat(sys, user.text, schema, o)
  }

  async test(): Promise<string> {
    const Ok = z.object({ ok: z.boolean() })
    const r = await this.parse('You are a health check.', { text: 'Return {"ok": true}.' }, Ok, { effort: 'low', maxTokens: 200 })
    if (!r.ok) throw new Error('unexpected reply')
    return this.engine === 'anthropic' ? `Claude works (${this.model}).` : `AI server works (model ${this.model}${lastVia ? `, served by ${lastVia}` : ''}).`
  }

  async models(): Promise<string[]> {
    const r = await fetch(`${this.compatBase()}/models`, { headers: this.compatKey ? { authorization: `Bearer ${this.compatKey}` } : {}, signal: AbortSignal.timeout(10_000) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const j: any = await r.json()
    return (j.data ?? []).map((m: any) => m.id).filter(Boolean)
  }

  // ---------------- Anthropic ----------------
  private async parseAnthropic<T extends z.ZodType>(system: Block[], content: string | Anthropic.ContentBlockParam[], schema: T, o: Opts): Promise<z.infer<T>> {
    if (!this.anthropicKey) throw new LLMNotConfigured('Anthropic API key is not set. Add it in Settings → AI engine.')
    const client = new Anthropic({ apiKey: this.anthropicKey, maxRetries: 4 })
    const resp = await client.messages.parse({
      model: this.model,
      max_tokens: o.maxTokens ?? 8000,
      system: system.map((b) => ({ type: 'text' as const, text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
      output_config: { effort: o.effort ?? this.s.effort, format: zodOutputFormat(schema) },
      messages: [{ role: 'user', content }]
    })
    if (resp.stop_reason === 'refusal') throw new Error(`model declined (${resp.stop_details?.category ?? 'unknown'})`)
    if (resp.parsed_output == null) throw new Error(`no structured output (stop_reason=${resp.stop_reason})`)
    return resp.parsed_output as z.infer<T>
  }

  // ---------------- OpenAI-compatible ----------------
  private compatBase(): string {
    const b = (this.s.llm.baseUrl || '').replace(/\/+$/, '')
    if (!b) throw new LLMNotConfigured('Set the AI server URL in Settings → AI engine.')
    if (/localhost|127\.0\.0\.1/.test(b)) throw new LLMNotConfigured('The AI server is set to this computer (localhost), which the website can’t reach. Use OpenRouter or Claude in Settings → AI engine.')
    return b.endsWith('/v1') ? b : `${b}/v1`
  }

  private async chat(messages: { role: string; content: string }[], o: Opts, useModel: string): Promise<{ text: string; via: string }> {
    const r = await fetch(`${this.compatBase()}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.compatKey ? { authorization: `Bearer ${this.compatKey}` } : {}) },
      body: JSON.stringify({ model: useModel, messages, max_tokens: o.maxTokens ?? 4000, temperature: 0.2 }),
      signal: AbortSignal.timeout(120_000)
    })
    const body = await r.text()
    if (r.status === 401 || r.status === 403) throw new LLMNotConfigured(`AI server rejected the request (HTTP ${r.status}): ${body.slice(0, 200)}`)
    if (r.status === 429 && /per-day|per day|daily/i.test(body)) {
      // this account is done for today: switch to the next key, if there is one
      if (await this.markSpent()) return this.chat(messages, o, useModel)
      throw new LLMDailyLimit('The AI’s free daily limit is used up (OpenRouter allows ~50 free requests a day without credits). Scoring continues automatically tomorrow — or add $10 of OpenRouter credits for 1,000 free requests a day.')
    }
    if (!r.ok) {
      const err = new Error(`AI server HTTP ${r.status}: ${body.slice(0, 300)}`) as Error & { status?: number }
      err.status = r.status
      throw err
    }
    const j = JSON.parse(body)
    const text = j.choices?.[0]?.message?.content ?? ''
    if (!text) {
      const err = new Error(`empty reply from ${useModel}`) as Error & { status?: number }
      err.status = 502
      throw err
    }
    return { text: typeof text === 'string' ? text : JSON.stringify(text), via: r.headers.get('x-routed-via') || j.model || useModel }
  }

  private async parseCompat<T extends z.ZodType>(system: Block[], content: string, schema: T, o: Opts): Promise<z.infer<T>> {
    const sys =
      system.map((b) => b.text).join('\n\n') +
      `\n\nRespond with ONLY a JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(z.toJSONSchema(schema))}`
    const messages = [
      { role: 'system', content: sys },
      { role: 'user', content }
    ]
    let failure = ''
    const chain = this.chain()
    if (!chain.length) throw new LLMNotConfigured('Pick an AI model in Settings → AI engine.')
    for (const m of chain) {
      if ((cooldown.get(m) ?? 0) > Date.now() && m !== chain[chain.length - 1]) continue
      let lastErr = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        const msgs = lastErr
          ? [...messages, { role: 'user', content: `Your previous reply was not valid: ${lastErr.slice(0, 400)}. Reply again with only the corrected JSON object.` }]
          : messages
        let out: { text: string; via: string }
        try {
          out = await this.chat(msgs, o, m)
        } catch (e: any) {
          if (e instanceof LLMNotConfigured) throw e
          failure = `${m}: ${e?.message ?? e}`
          const st = e?.status ?? 0
          if (st === 429 || st === 404) {
            cooldown.set(m, Date.now() + 10 * 60_000)
            break
          }
          if (st >= 500 || st === 400 || st === 422) {
            await new Promise((r) => setTimeout(r, 2000))
            continue
          }
          throw e
        }
        lastVia = out.via
        try {
          const parsed = schema.safeParse(extractJson(out.text))
          if (parsed.success) return parsed.data
          lastErr = parsed.error.message
        } catch (e: any) {
          lastErr = `not JSON (${e?.message ?? e})`
        }
        failure = `${m}: invalid JSON (${lastErr})`
      }
    }
    throw new Error(`all models failed (${chain.join(' → ')}) — last: ${failure.slice(0, 280)}`)
  }
}

function extractJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.search(/[{[]/)
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}
