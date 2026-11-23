// LLM layer with two engines:
//  - anthropic: Claude via the official SDK, structured outputs
//  - openai_compat: any OpenAI-compatible /v1/chat/completions server
//    (FreeLLMAPI, Ollama, LM Studio, OpenRouter...), JSON validated with zod
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { getSettings, secret } from './settings'

export class LLMNotConfigured extends Error {}

export type Block = { text: string; cache?: boolean }
type Opts = { effort?: 'low' | 'medium' | 'high'; maxTokens?: number }

export const engine = (): 'anthropic' | 'openai_compat' => getSettings().llm.provider

export function model(): string {
  const s = getSettings()
  return s.llm.provider === 'anthropic' ? s.model || 'claude-opus-5-5' : s.llm.model || 'auto'
}

/** Short label for UI/logs. */
export const engineLabel = (): string => (engine() === 'anthropic' ? `Claude (${model()})` : `${getSettings().llm.baseUrl} · ${model()}`)

// ---------------- Anthropic ----------------
let _client: Anthropic | null = null
let _key = ''
function anthropic(): Anthropic {
  const key = secret('ANTHROPIC_API_KEY')
  if (!key) throw new LLMNotConfigured('Anthropic API key is not set. Add it in Settings → AI engine.')
  if (!_client || key !== _key) {
    _client = new Anthropic({ apiKey: key, maxRetries: 4 })
    _key = key
  }
  return _client
}

async function parseAnthropic<T extends z.ZodType>(system: Block[], content: string | Anthropic.ContentBlockParam[], schema: T, o: Opts): Promise<z.infer<T>> {
  const resp = await anthropic().messages.parse({
    model: model(),
    max_tokens: o.maxTokens ?? 8000,
    system: system.map((b) => ({ type: 'text' as const, text: b.text, ...(b.cache ? { cache_control: { type: 'ephemeral' as const } } : {}) })),
    output_config: { effort: o.effort ?? getSettings().effort, format: zodOutputFormat(schema) },
    messages: [{ role: 'user', content }]
  })
  if (resp.stop_reason === 'refusal') throw new Error(`model declined (${resp.stop_details?.category ?? 'unknown'})`)
  if (resp.parsed_output == null) throw new Error(`no structured output (stop_reason=${resp.stop_reason})`)
  noteLlm(true, model())
  return resp.parsed_output as z.infer<T>
}

// ---------------- OpenAI-compatible ----------------
function compatBase(): string {
  const b = (getSettings().llm.baseUrl || '').replace(/\/+$/, '')
  if (!b) throw new LLMNotConfigured('Set the server URL in Settings → AI engine.')
  return b.endsWith('/v1') ? b : `${b}/v1`
}

async function chat(messages: { role: string; content: string }[], o: Opts, responseFormat?: unknown, useModel = model()): Promise<{ text: string; via: string }> {
  const key = secret('LLM_API_KEY')
  const r = await fetch(`${compatBase()}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: useModel, messages, max_tokens: o.maxTokens ?? 4000, temperature: 0.2, ...(responseFormat ? { response_format: responseFormat } : {}) }),
    signal: AbortSignal.timeout(180_000)
  })
  const body = await r.text()
  if (r.status === 401 || r.status === 403) throw new LLMNotConfigured(`AI server rejected the request (HTTP ${r.status}): ${body.slice(0, 200)}`)
  if (!r.ok) {
    const err = new Error(`AI server HTTP ${r.status}: ${body.slice(0, 300)}`) as Error & { status?: number; retryAfter?: number }
    err.status = r.status
    err.retryAfter = Number(r.headers.get('retry-after')) || undefined
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

function extractJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const start = t.search(/[{[]/)
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (start >= 0 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

let lastVia = ''
export const lastRoutedVia = (): string => lastVia

async function parseCompat<T extends z.ZodType>(system: Block[], content: string, schema: T, o: Opts): Promise<z.infer<T>> {
  const jsonSchema = z.toJSONSchema(schema)
  const sys =
    system.map((b) => b.text).join('\n\n') +
    `\n\nRespond with ONLY a JSON object (no prose, no code fences) that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`
  const messages = [
    { role: 'system', content: sys },
    { role: 'user', content }
  ]
  let failure = ''
  const chain = modelChain()
  for (const m of chain) {
    if ((cooldown.get(m) ?? 0) > Date.now() && m !== chain[chain.length - 1]) continue
    let lastErr = '' // shown to the model when its JSON was invalid
    for (let attempt = 0; attempt < 3; attempt++) {
      const msgs = lastErr
        ? [...messages, { role: 'user', content: `Your previous reply was not valid: ${lastErr.slice(0, 400)}. Reply again with only the corrected JSON object.` }]
        : messages
      let out: { text: string; via: string }
      try {
        // no response_format: routers skip most models when it is set; ask in the prompt and validate instead
        out = await chat(msgs, o, undefined, m)
      } catch (e: any) {
        if (e instanceof LLMNotConfigured) throw e
        failure = `${m}: ${e?.message ?? e}`
        const st = e?.status ?? 0
        if (st === 429 || st === 404) {
          // rate-limited / unknown model: rest it for 10 min and go to the next model straight away
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
        if (parsed.success) {
          noteLlm(true, out.via || m)
          return parsed.data
        }
        lastErr = parsed.error.message
      } catch (e: any) {
        lastErr = `not JSON (${e?.message ?? e})`
      }
      failure = `${m}: invalid JSON (${lastErr})`
    }
  }
  noteLlm(false, failure)
  throw new Error(`all models failed (${chain.join(' → ')}) — last: ${failure.slice(0, 280)}`)
}

/** Last success / failure for the health panel. */
export const llmHealth: { okAt?: string; okVia?: string; failAt?: string; failMsg?: string } = {}
function noteLlm(ok: boolean, info: string): void {
  const t = new Date().toISOString()
  if (ok) Object.assign(llmHealth, { okAt: t, okVia: info })
  else Object.assign(llmHealth, { failAt: t, failMsg: info.slice(0, 300) })
}
export const cooledModels = (): string[] => [...cooldown.entries()].filter(([, t]) => t > Date.now()).map(([m]) => m)

/** Primary model then fallbacks (same server). */
const cooldown = new Map<string, number>()
export function modelChain(): string[] {
  const s = getSettings().llm
  return [...new Set([s.model, ...(s.fallbackModels ?? [])].filter(Boolean))]
}

// ---------------- public ----------------

/**
 * One structured call validated against a zod schema.
 * `pdf` (base64) is sent natively to Claude; for other engines pass `text` with the extracted text instead.
 */
export async function parse<T extends z.ZodType>(
  system: Block[] | string,
  user: { text: string; pdf?: string },
  schema: T,
  opts: Opts = {}
): Promise<z.infer<T>> {
  const sys = typeof system === 'string' ? [{ text: system }] : system
  if (engine() === 'anthropic') {
    const content: string | Anthropic.ContentBlockParam[] = user.pdf
      ? [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: user.pdf } },
          { type: 'text', text: user.text }
        ]
      : user.text
    return parseAnthropic(sys, content, schema, opts)
  }
  return parseCompat(sys, user.text, schema, opts)
}

/** Cheap connectivity check used by the setup wizard. */
export async function testEngine(): Promise<string> {
  const Ok = z.object({ ok: z.boolean() })
  const r = await parse('You are a health check.', { text: 'Return {"ok": true}.' }, Ok, { effort: 'low', maxTokens: 200 })
  if (!r.ok) throw new Error('unexpected reply')
  return engine() === 'anthropic' ? `Claude works (${model()}).` : `AI server works (model ${model()}${lastVia ? `, served by ${lastVia}` : ''}).`
}

/** List model ids from an OpenAI-compatible server (for the settings dropdown). */
export async function listCompatModels(): Promise<string[]> {
  const key = secret('LLM_API_KEY')
  const r = await fetch(`${compatBase()}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(10_000) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const j: any = await r.json()
  return (j.data ?? []).map((m: any) => m.id).filter(Boolean)
}

/** Detect a FreeLLMAPI instance on this machine. */
export async function detectFreeLLMAPI(): Promise<string | null> {
  try {
    const r = await fetch('http://127.0.0.1:3001/api/ping', { signal: AbortSignal.timeout(1500) })
    if (r.ok && (await r.text()).includes('"ok"')) return 'http://localhost:3001/v1'
  } catch {
    /* not running */
  }
  return null
}
