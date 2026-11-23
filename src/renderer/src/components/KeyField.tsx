import { ReactNode, useState } from 'react'
import { CheckCircle2, KeyRound, XCircle } from 'lucide-react'
import type { SecretKey } from '@shared/types'
import { Spinner, cx } from '../ui'

/** Write-only secret input: the value is sent to the main process and never read back. */
export function KeyField({
  k, label, isSet, onSaved, help, test
}: {
  k: SecretKey
  label: string
  isSet: boolean
  onSaved: (status: Record<SecretKey, boolean>) => void
  help?: ReactNode
  test?: 'llm' | 'job_api'
}): ReactNode {
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null)

  const save = async (): Promise<void> => {
    if (!val.trim()) return
    setBusy(true)
    setRes(null)
    onSaved(await window.api.secrets.set(k, val))
    setVal('')
    if (test) setRes(await window.api.secrets.test(test))
    setBusy(false)
  }
  const clear = async (): Promise<void> => {
    onSaved(await window.api.secrets.set(k, ''))
    setRes(null)
  }
  const runTest = async (): Promise<void> => {
    setBusy(true)
    setRes(await window.api.secrets.test(test!))
    setBusy(false)
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="label !mb-0">{label}</label>
        {isSet ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><CheckCircle2 size={12} /> Saved in Keychain</span>
        ) : (
          <span className="text-xs text-ink-400">Not set</span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            className="field !pl-8 font-mono"
            placeholder={isSet ? '•••••••••••••••• (paste to replace)' : 'Paste key'}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>
        <button className="btn btn-primary" disabled={!val.trim() || busy} onClick={save}>{busy ? <Spinner /> : 'Save'}</button>
        {isSet && test && !val && <button className="btn btn-outline" disabled={busy} onClick={runTest}>Test</button>}
        {isSet && !val && <button className="btn btn-ghost" onClick={clear}>Remove</button>}
      </div>
      {help && <p className="mt-1.5 text-xs text-ink-400">{help}</p>}
      {res && (
        <p className={cx('mt-2 flex items-start gap-1.5 text-xs', res.ok ? 'text-emerald-300' : 'text-rose-300')}>
          {res.ok ? <CheckCircle2 size={13} className="mt-px shrink-0" /> : <XCircle size={13} className="mt-px shrink-0" />}
          {res.message}
        </p>
      )}
    </div>
  )
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <a className="cursor-pointer text-brand-400 hover:underline" onClick={() => window.api.open(href)}>
      {children}
    </a>
  )
}
