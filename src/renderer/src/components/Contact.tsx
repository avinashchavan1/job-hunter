import { ReactNode, useState } from 'react'
import { FileText } from 'lucide-react'
import { Contact, EMPTY_CONTACT } from '@shared/types'
import { Spinner } from '../ui'

const FIELDS: { k: keyof Contact; label: string; placeholder: string; type?: string }[] = [
  { k: 'full_name', label: 'Full name', placeholder: 'As on your resume' },
  { k: 'email', label: 'Email', placeholder: 'name@example.com', type: 'email' },
  { k: 'phone', label: 'Phone', placeholder: '+91 98xxxxxxxx', type: 'tel' },
  { k: 'city', label: 'Current city', placeholder: 'Bangalore' },
  { k: 'current_company', label: 'Current company', placeholder: 'Employer name' },
  { k: 'current_title', label: 'Current title', placeholder: 'SAP EWM Consultant' },
  { k: 'linkedin_url', label: 'LinkedIn URL', placeholder: 'https://linkedin.com/in/…' },
  { k: 'portfolio_url', label: 'Website / portfolio', placeholder: 'Optional' }
]

export function ContactEditor({ profileId, value, onChange, hasResume }: { profileId: number; value: Contact | undefined; onChange: (c: Contact) => void; hasResume: boolean }): ReactNode {
  const c = { ...EMPTY_CONTACT, ...(value ?? {}) }
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const fromResume = async (): Promise<void> => {
    setBusy(true)
    setMsg('')
    try {
      const got = await window.api.profiles.contactFromResume(profileId)
      const next = { ...c }
      let n = 0
      for (const [k, v] of Object.entries(got) as [keyof Contact, string][]) if (v && !next[k]) { next[k] = v; n++ }
      onChange(next)
      setMsg(n ? `Filled ${n} field${n > 1 ? 's' : ''} from the resume — check them, then Save changes.` : 'Nothing new found in the resume.')
    } catch (e: any) {
      setMsg(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <div key={f.k}>
            <label className="label">{f.label}</label>
            <input className="field" type={f.type ?? 'text'} value={c[f.k]} placeholder={f.placeholder} onChange={(e) => onChange({ ...c, [f.k]: e.target.value })} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {hasResume && (
          <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={fromResume} disabled={busy}>
            {busy ? <Spinner size={14} /> : <FileText size={14} />} Fill from resume
          </button>
        )}
        {msg && <span className="text-xs text-ink-400">{msg}</span>}
      </div>
    </div>
  )
}
