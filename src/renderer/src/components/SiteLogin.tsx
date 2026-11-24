import { ReactNode, useEffect, useState } from 'react'
import { CheckCircle2, LogIn, ShieldAlert } from 'lucide-react'
import type { Profile } from '@shared/types'
import { Spinner } from '../ui'

type Site = 'naukri' | 'linkedin'
const NAME: Record<Site, string> = { naukri: 'Naukri', linkedin: 'LinkedIn' }

export function SiteLogin({ profile, site, onChange }: { profile: Profile; site: Site; onChange: () => void }): ReactNode {
  const [status, setStatus] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    void window.api.browser.status(profile.id).then((s) => setStatus(s[site]))
  }, [profile.id, site])

  const login = async (): Promise<void> => {
    setMsg('')
    setBusy(true)
    try {
      const ok = await window.api.browser.login(profile.id, site)
      setStatus(ok)
      if (!ok) setMsg('Sign-in didn’t finish (window closed, or 10 minutes passed). Try again.')
      onChange()
    } catch (e: any) {
      setMsg(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy(false)
  }

  return (
    <div className="mt-3 space-y-2 pl-12">
      {site === 'linkedin' && (
        <p className="flex items-start gap-1.5 rounded-lg bg-amber-400/10 px-2 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-200">
          <ShieldAlert size={13} className="mt-px shrink-0" />
          LinkedIn’s terms forbid automated browsing. Job Hunter is slow, read-only and capped, but your account could still be restricted. Job-alert emails via Gmail are the zero-risk alternative.
        </p>
      )}
      {status ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={13} /> Signed in</span>
          <button className="text-ink-400 underline hover:text-ink-100" onClick={async () => { await window.api.browser.logout(profile.id, site); setStatus(false); onChange() }}>Sign out</button>
        </div>
      ) : (
        <button className="btn btn-outline !py-1.5 text-xs" onClick={login} disabled={busy}>
          {busy ? <Spinner size={14} /> : <LogIn size={14} />}
          {busy ? `Sign in to ${NAME[site]} in the Chrome window that opened…` : `Sign in to ${NAME[site]}`}
        </button>
      )}
      {msg && <p className="text-xs text-rose-700 dark:text-rose-300">{msg}</p>}
      {!status && !busy && <p className="text-[11px] text-ink-400">Opens a separate Chrome window just for Job Hunter. You type your password there yourself — the app never sees it.</p>}
    </div>
  )
}
