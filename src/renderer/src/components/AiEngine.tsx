import { ReactNode, useEffect, useState } from 'react'
import { CheckCircle2, Cpu, Radar, Sparkles, XCircle } from 'lucide-react'
import type { AppSettings, SecretKey } from '@shared/types'
import { Spinner, cx } from '../ui'
import { ExtLink, KeyField } from './KeyField'

export function llmReady(s: AppSettings, secrets: Record<SecretKey, boolean>): boolean {
  return s.llm.provider === 'anthropic' ? secrets.ANTHROPIC_API_KEY : !!s.llm.baseUrl
}

export function AiEngine({
  settings, setSettings, secrets, setSecrets
}: {
  settings: AppSettings
  setSettings: (s: AppSettings) => void
  secrets: Record<SecretKey, boolean>
  setSecrets: (s: Record<SecretKey, boolean>) => void
}): ReactNode {
  const s = settings
  const [detected, setDetected] = useState<string | null>(null)
  const [models, setModels] = useState<string[]>([])
  const [url, setUrl] = useState(s.llm.baseUrl)
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const save = async (patch: Partial<AppSettings>): Promise<void> => setSettings(await window.api.settings.save(patch))
  const setLlm = (patch: Partial<AppSettings['llm']>): Promise<void> => save({ llm: { ...s.llm, ...patch } })

  useEffect(() => {
    void window.api.llm.detect().then(setDetected)
  }, [])
  useEffect(() => {
    if (s.llm.provider === 'openai_compat' && s.llm.baseUrl) void window.api.llm.models().then(setModels)
  }, [s.llm.provider, s.llm.baseUrl, secrets.LLM_API_KEY])

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(await window.api.secrets.test('llm'))
    setTesting(false)
  }

  const opts = [
    { key: 'anthropic' as const, title: 'Claude', desc: 'Best scoring & cover notes. Paid per use (Anthropic key).', icon: <Sparkles size={18} /> },
    { key: 'openai_compat' as const, title: 'Free / local AI', desc: 'FreeLLMAPI, Ollama, LM Studio or any OpenAI-compatible server.', icon: <Cpu size={18} /> }
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        {opts.map((o) => (
          <button
            key={o.key}
            onClick={() => {
              setTest(null)
              void setLlm({ provider: o.key, ...(o.key === 'openai_compat' && !s.llm.baseUrl && detected ? { baseUrl: detected, model: 'auto:smart' } : {}) })
              if (o.key === 'openai_compat' && !s.llm.baseUrl && detected) setUrl(detected)
            }}
            className={cx(
              'rounded-2xl border p-4 text-left transition',
              s.llm.provider === o.key ? 'border-brand-500/60 bg-brand-500/10 ring-4 ring-brand-500/10' : 'border-white/[0.08] hover:border-white/20'
            )}
          >
            <div className="flex items-center gap-2 font-medium">
              <span className={s.llm.provider === o.key ? 'text-brand-400' : 'text-ink-400'}>{o.icon}</span>
              {o.title}
            </div>
            <p className="mt-1 text-xs text-ink-400">{o.desc}</p>
          </button>
        ))}
      </div>

      {s.llm.provider === 'anthropic' ? (
        <>
          <KeyField k="ANTHROPIC_API_KEY" label="Anthropic API key" isSet={secrets.ANTHROPIC_API_KEY} onSaved={setSecrets} test="llm"
            help={<>Get one at <ExtLink href="https://console.anthropic.com/settings/keys">console.anthropic.com → API keys</ExtLink>.</>} />
          <div>
            <label className="label">Model</label>
            <select className="field" value={s.model} onChange={(e) => save({ model: e.target.value })}>
              <option value="claude-opus-5-5">Claude Opus 5.5 (best quality)</option>
              <option value="claude-sonnet-5-5">Claude Sonnet 5.5 (cheaper)</option>
              <option value="claude-haiku-5-5">Claude Haiku 5.5 (cheapest)</option>
            </select>
          </div>
        </>
      ) : (
        <>
          {detected && (
            <div className="flex items-center gap-2 rounded-xl bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
              <Radar size={14} /> FreeLLMAPI detected on this computer ({detected})
              {s.llm.baseUrl !== detected && (
                <button className="ml-auto underline" onClick={() => { setUrl(detected); void setLlm({ baseUrl: detected, model: 'auto:smart' }) }}>Use it</button>
              )}
            </div>
          )}
          <div>
            <label className="label">Server URL</label>
            <div className="flex gap-2">
              <input className="field font-mono" placeholder="http://localhost:3001/v1" value={url} onChange={(e) => setUrl(e.target.value)}
                onBlur={() => url !== s.llm.baseUrl && setLlm({ baseUrl: url.trim() })} />
            </div>
            <p className="mt-1.5 text-xs text-ink-400">FreeLLMAPI: http://localhost:3001/v1 · Ollama: http://localhost:11434/v1 · LM Studio: http://localhost:1234/v1</p>
          </div>
          <KeyField k="LLM_API_KEY" label="Server API key" isSet={secrets.LLM_API_KEY} onSaved={setSecrets} test="llm"
            help={<>For FreeLLMAPI, copy the unified key (starts with <code>freellmapi-</code>) from the Keys page header at <ExtLink href="http://localhost:3001">localhost:3001</ExtLink>. Ollama / LM Studio need none.</>} />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Model</label>
              <select className="field" value={s.llm.model} onChange={(e) => setLlm({ model: e.target.value })}>
                {[...new Set(['auto:smart', 'auto', 'auto:fast', s.llm.model, ...models])].filter(Boolean).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              {models.length > 0 && !models.includes(s.llm.model) && !/:3001\b/.test(s.llm.baseUrl) ? (
                <p className="mt-1.5 text-xs text-rose-300">“{s.llm.model}” isn’t offered by this server — pick a model from the list.</p>
              ) : (
                <p className="mt-1.5 text-xs text-ink-400">FreeLLMAPI: “auto:smart”. OpenRouter: any model id, e.g. one ending in “:free”.</p>
              )}
            </div>
            <div>
              <label className="label">Parallel requests</label>
              <input type="number" min={1} max={4} className="field" value={s.llm.concurrency} onChange={(e) => setLlm({ concurrency: Math.min(4, Math.max(1, Number(e.target.value))) })} />
              <p className="mt-1.5 text-xs text-ink-400">Keep at 1 for free tiers to avoid rate limits.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="btn btn-outline" disabled={testing || !s.llm.baseUrl} onClick={runTest}>{testing ? <Spinner /> : null} Test connection</button>
            {test && (
              <span className={cx('flex items-start gap-1.5 text-xs', test.ok ? 'text-emerald-300' : 'text-rose-300')}>
                {test.ok ? <CheckCircle2 size={13} className="mt-px shrink-0" /> : <XCircle size={13} className="mt-px shrink-0" />}{test.message}
              </span>
            )}
          </div>
          <p className="rounded-xl bg-amber-400/10 px-3 py-2 text-xs text-amber-200/90">
            Free models score less consistently than Claude, and resumes/job text go to whichever upstream provider the server routes to.
          </p>
        </>
      )}
    </div>
  )
}
