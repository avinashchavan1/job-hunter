import { ReactNode, useState } from 'react'
import logo from '../assets/logo.png'
import { ArrowLeft, ArrowRight, CheckCircle2, FileText, ShieldCheck, Upload } from 'lucide-react'
import type { AppSettings, Profile, SecretKey } from '@shared/types'
import { AiEngine, llmReady } from '../components/AiEngine'
import { Spinner, cx } from '../ui'
import { ExtLink, KeyField } from '../components/KeyField'

export function Onboarding({
  secrets, setSecrets, settings, setSettings, onDone, onCancel
}: {
  secrets: Record<SecretKey, boolean>
  setSecrets: (s: Record<SecretKey, boolean>) => void
  settings: AppSettings
  setSettings: (s: AppSettings) => void
  onDone: (p: Profile) => void
  onCancel?: () => void
}): ReactNode {
  const ready = llmReady(settings, secrets)
  const [step, setStep] = useState(onCancel && ready ? 3 : 0)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const createWithResume = async (): Promise<void> => {
    setErr('')
    setBusy(true)
    let p: Profile | null = null
    try {
      const created = await window.api.profiles.create(name.trim() || 'New profile')
      p = created
      const parsed = await window.api.profiles.importResume(created.id)
      p = parsed
      if (!parsed.profile) {
        await window.api.profiles.remove(created.id)
        setBusy(false)
        return
      }
      onDone(parsed)
    } catch (e: any) {
      if (p && !p.profile) await window.api.profiles.remove(p.id)
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
  }

  const steps = ['Welcome', 'AI engine', 'Job search', 'Resume']
  return (
    <div className="relative grid h-full place-items-center overflow-auto bg-ink-950 px-6 py-10">
      <div className="drag absolute inset-x-0 top-0 h-8" />
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex items-center justify-center gap-2">
          {steps.map((s, i) => (
            <button key={s} className="flex items-center gap-2 disabled:cursor-default" disabled={i > 1 && !ready} onClick={() => setStep(i)}>
              <div className={cx('grid h-6 w-6 place-items-center rounded-full text-[11px] font-semibold', i < step ? 'bg-emerald-400/20 text-emerald-700 dark:text-emerald-300' : i === step ? 'bg-brand-600 text-white' : 'bg-ink-700 text-ink-400')}>
                {i < step ? <CheckCircle2 size={14} /> : i + 1}
              </div>
              <span className={cx('text-xs', i === step ? 'text-ink-100' : 'text-ink-400')}>{s}</span>
              {i < steps.length - 1 && <div className="mx-1 h-px w-6 bg-ink-600" />}
            </button>
          ))}
        </div>

        <div className="card p-7 shadow-xl">
          {step === 0 && (
            <div>
              <img src={logo} alt="" className="h-16 w-16" draggable={false} />
              <h1 className="mt-5 text-2xl font-semibold tracking-tight">Job Hunter</h1>
              <p className="mt-2 text-sm leading-relaxed text-ink-300">
                Every morning it finds fresh jobs that fit a resume, scores each one, and writes a short tailored note. You review the ranked list and click Apply yourself.
              </p>
              <ul className="mt-5 space-y-2.5 text-sm text-ink-300">
                {[
                  'Never submits applications or creates accounts',
                  'Never asks for your LinkedIn, Naukri or Gmail password',
                  'Everything is stored on this computer; keys go in your system keychain',
                  'Works for several people — one profile each'
                ].map((t) => (
                  <li key={t} className="flex gap-2"><ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />{t}</li>
                ))}
              </ul>
              <button className="btn btn-primary mt-7 w-full !py-2.5" onClick={() => setStep(1)}>Get started <ArrowRight size={16} /></button>
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold">Choose the AI engine</h2>
              <p className="mb-5 mt-1 text-sm text-ink-400">It reads the resume, scores each job and writes the cover notes. You can change this later in Settings.</p>
              <AiEngine settings={settings} setSettings={setSettings} secrets={secrets} setSecrets={setSecrets} />
              <div className="mt-6 flex gap-2">
                <button className="btn btn-ghost" onClick={() => setStep(0)}><ArrowLeft size={16} /> Back</button>
                <button className="btn btn-primary flex-1 !py-2.5" disabled={!ready} onClick={() => setStep(2)}>Continue <ArrowRight size={16} /></button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-lg font-semibold">Connect a job search API</h2>
              <p className="mb-5 mt-1 text-sm text-ink-400">JSearch pulls postings from LinkedIn, Naukri, Indeed and company career pages through an API that allows automated use. The free plan is enough to start.</p>
              <ol className="mb-5 list-decimal space-y-1 pl-5 text-sm text-ink-300">
                <li>Open <ExtLink href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch">JSearch on RapidAPI</ExtLink> and sign up (Google sign-in is fine).</li>
                <li>Click <b>Subscribe to Test</b> → choose the free <b>Basic</b> plan.</li>
                <li>Copy the <b>X-RapidAPI-Key</b> shown in the code panel and paste it here.</li>
              </ol>
              <KeyField k="RAPIDAPI_KEY" label="RapidAPI key" isSet={secrets.RAPIDAPI_KEY} onSaved={setSecrets} test="job_api" />
              <div className="mt-6 flex gap-2">
                <button className="btn btn-ghost" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</button>
                <button className="btn btn-ghost" onClick={() => setStep(3)}>Skip for now</button>
                <button className="btn btn-primary flex-1 !py-2.5" disabled={!secrets.RAPIDAPI_KEY} onClick={() => setStep(3)}>Continue <ArrowRight size={16} /></button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-lg font-semibold">Who is job hunting?</h2>
              <p className="mb-5 mt-1 text-sm text-ink-400">Create a profile and add their resume. You can add more people later.</p>
              <label className="label">Profile name</label>
              <input className="field" placeholder="e.g. Sweta" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="mt-5 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line-strong px-6 py-8 text-sm text-ink-300 transition hover:border-brand-500/50 hover:bg-brand-500/5 disabled:opacity-60"
                disabled={busy} onClick={createWithResume}>
                {busy ? <Spinner size={22} /> : <Upload size={22} className="text-brand-600 dark:text-brand-400" />}
                <span className="font-medium text-ink-100">{busy ? 'Reading the resume…' : 'Choose resume (PDF or DOCX)'}</span>
                <span className="text-xs text-ink-400">{busy ? 'about 20–40 seconds' : 'Skills, titles and experience are extracted automatically'}</span>
              </button>
              {onCancel ? (
                <button className="btn btn-ghost mt-3 w-full" onClick={onCancel}>Cancel</button>
              ) : (
                <button className="btn btn-ghost mt-3" disabled={busy} onClick={() => setStep(2)}><ArrowLeft size={16} /> Back</button>
              )}
              {err && <p className="mt-3 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
              <p className="mt-4 flex items-center gap-1.5 text-xs text-ink-400"><FileText size={12} /> The resume is sent to your AI engine only to build the profile; it’s stored locally.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
