// One screen: (1) AI engine if not set up yet, (2) name + cities + drop a resume. Everything else
// has sensible defaults and lives in Settings.
import { DragEvent, ReactNode, useState } from 'react'
import logo from '../assets/logo.png'
import { Check, Upload } from 'lucide-react'
import type { AppSettings, Profile, SecretKey } from '@shared/types'
import { AiEngine, llmReady } from '../components/AiEngine'
import { ChipInput, Spinner, cx } from '../ui'

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
  const [name, setName] = useState('')
  const [cities, setCities] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [err, setErr] = useState('')

  const create = async (path?: string): Promise<void> => {
    setErr('')
    setBusy(true)
    let id: number | null = null
    try {
      const created = await window.api.profiles.create(name.trim() || 'New profile')
      id = created.id
      let p = await window.api.profiles.importResume(created.id, path)
      if (!p.profile) {
        // picker was cancelled
        await window.api.profiles.remove(created.id)
        setBusy(false)
        return
      }
      if (cities.length) p = await window.api.profiles.update(p.id, { prefs: { ...p.prefs, locations: cities } })
      onDone(p)
    } catch (e: any) {
      if (id != null) await window.api.profiles.remove(id)
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
  }

  const onDrop = (e: DragEvent): void => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (!f || busy || !ready) return
    if (!/\.(pdf|docx|txt|md)$/i.test(f.name)) return setErr('Use a PDF or Word (.docx) resume.')
    void create(window.api.pathForFile(f))
  }

  return (
    <div className="relative h-full overflow-auto bg-ink-950">
      <div className="drag absolute inset-x-0 top-0 h-8" />
      <div className="mx-auto max-w-xl px-6 py-14">
        <div className="flex items-center gap-2.5">
          <img src={logo} alt="" className="h-9 w-9" draggable={false} />
          <h1 className="text-xl font-semibold tracking-tight">{onCancel ? 'Add a person' : 'Set up Job Hunter'}</h1>
        </div>
        {!onCancel && (
          <p className="mt-3 text-sm leading-relaxed text-ink-300">
            {window.api.isWeb ? 'Each morning it finds jobs that fit the resume, ranks them, and helps you apply with a tailored resume, cover note and interview prep. Only people you invite can sign in.' : 'Each morning it finds jobs that fit the resume, ranks them, and helps you apply — tailored resume, cover note, form filling. You always press Submit yourself. Nothing leaves this computer except to the AI and job services you set up.'}
          </p>
        )}

        {!ready && (
          <section className="mt-8">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full bg-ink-100 text-[11px] text-ink-950">1</span> Connect an AI</h2>
            <p className="mb-4 text-xs text-ink-400">It reads the resume and scores jobs. A local FreeLLMAPI is picked up automatically if it’s running.</p>
            <AiEngine settings={settings} setSettings={setSettings} secrets={secrets} setSecrets={setSecrets} />
          </section>
        )}

        <section className={cx('mt-8', !ready && 'pointer-events-none opacity-40')}>
          {!ready && <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><span className="grid h-5 w-5 place-items-center rounded-full bg-ink-700 text-[11px]">2</span> Add the resume</h2>}
          {ready && !onCancel && <p className="mb-4 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><Check size={13} /> AI connected</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="label">Name</label>
              <input className="field" placeholder="e.g. Sweta" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Cities <span className="font-normal text-ink-400">(optional)</span></label>
              <ChipInput value={cities} onChange={setCities} placeholder="Bangalore, Pune…" />
            </div>
          </div>
          <button
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
            onClick={async () => {
              if (!window.api.pickResume) return create()
              const f = await window.api.pickResume()
              if (f) await create(f)
            }}
            disabled={busy || !ready}
            className={cx('mt-4 flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-10 text-sm transition',
              over ? 'border-ink-100 bg-hover' : 'border-line-strong hover:bg-hover')}>
            {busy ? <Spinner size={20} /> : <Upload size={20} className="text-ink-400" />}
            <span className="font-medium">{busy ? 'Reading the resume…' : 'Drop the resume here, or click to choose'}</span>
            <span className="text-xs text-ink-400">{busy ? 'about 20–40 seconds' : 'PDF or Word. Titles, skills and experience are picked up automatically.'}</span>
          </button>
          {err && <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
          {onCancel && <button className="btn btn-ghost mt-3" onClick={onCancel} disabled={busy}>Cancel</button>}
          <p className="mt-6 text-xs text-ink-400">Job search key, Gmail, Naukri and LinkedIn can be added later in Settings and Profile.</p>
        </section>
      </div>
    </div>
  )
}
