import { ReactNode, useEffect, useState } from 'react'
import { CheckCircle2, Mail, XCircle } from 'lucide-react'
import type { Profile, SecretKey } from '@shared/types'
import { Spinner } from '../ui'
import { ExtLink, KeyField } from './KeyField'

const clean = (e: any): string => String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Per-profile connect / disconnect. */
export function GmailConnect({ profile, onChange, oauthReady }: { profile: Profile; onChange: () => void; oauthReady: boolean }): ReactNode {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    void window.api.gmail.connected(profile.id).then(setConnected)
  }, [profile.id, profile.gmail_email])

  const connect = async (): Promise<void> => {
    setErr('')
    setBusy(true)
    try {
      await window.api.gmail.connect(profile.id)
      onChange()
    } catch (e) {
      setErr(clean(e))
    }
    setBusy(false)
  }

  if (!oauthReady)
    return <p className="mt-2 pl-12 text-xs text-amber-700 dark:text-amber-300">One-time setup needed first: Settings → Gmail.</p>

  return (
    <div className="mt-3 pl-12">
      {connected && profile.gmail_email ? (
        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-300"><CheckCircle2 size={13} /> {profile.gmail_email}</span>
          <button className="text-ink-400 underline hover:text-ink-100" onClick={async () => { await window.api.gmail.disconnect(profile.id); onChange() }}>Disconnect</button>
        </div>
      ) : (
        <button className="btn btn-outline !py-1.5 text-xs" onClick={connect} disabled={busy}>
          {busy ? <Spinner size={14} /> : <Mail size={14} />} {busy ? 'Waiting for Google sign-in in your browser…' : 'Connect Gmail'}
        </button>
      )}
      {err && <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-300"><XCircle size={13} className="mt-px shrink-0" />{err}</p>}
    </div>
  )
}

/** One-time Google OAuth client setup (Settings). */
export function GmailSetup({ secrets, setSecrets }: { secrets: Record<SecretKey, boolean>; setSecrets: (s: Record<SecretKey, boolean>) => void }): ReactNode {
  const ready = secrets.GOOGLE_CLIENT_ID && secrets.GOOGLE_CLIENT_SECRET
  return (
    <div className="space-y-4">
      {!ready && window.api.isWeb && (
        <ol className="list-decimal space-y-1.5 rounded-md bg-ink-850/70 p-4 pl-8 text-sm text-ink-300">
          <li>In <ExtLink href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Google Cloud</ExtLink> (the project used for Google sign-in), enable the <b>Gmail API</b>.</li>
          <li><b>Google Auth Platform → Data access</b>: add the scope <code className="selectable font-mono">gmail.readonly</code>. <b>Audience → Test users</b>: add every Gmail you’ll connect.</li>
          <li><b>Clients</b> → open the <b>Web application</b> client → Authorized redirect URIs → add <code className="selectable font-mono break-all">https://vrhcofbhrcqthbacixpb.supabase.co/functions/v1/jh-api/gmail-callback</code></li>
          <li>In Supabase → Edge Functions → Secrets, set <code className="selectable font-mono">JH_GOOGLE_CLIENT_ID</code> and <code className="selectable font-mono">JH_GOOGLE_CLIENT_SECRET</code> to that web client.</li>
        </ol>
      )}
      {!ready && !window.api.isWeb && (
        <ol className="list-decimal space-y-1.5 rounded-md bg-ink-850/70 p-4 pl-8 text-sm text-ink-300">
          <li>Open <ExtLink href="https://console.cloud.google.com/projectcreate">Google Cloud Console</ExtLink> and create a project named “Job Hunter” (free).</li>
          <li>Enable the <ExtLink href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</ExtLink> for that project.</li>
          <li>Open <ExtLink href="https://console.cloud.google.com/auth/overview">Google Auth Platform</ExtLink> → Get started: app name “Job Hunter”, your email, audience <b>External</b>.</li>
          <li>Under <b>Audience → Test users</b>, add every Gmail address you’ll connect (yours, Sweta’s…).</li>
          <li>Under <b>Clients → Create client</b>, choose <b>Desktop app</b>. Copy the Client ID and Client secret into the fields below.</li>
        </ol>
      )}
      <KeyField k="GOOGLE_CLIENT_ID" label="Google OAuth client ID" isSet={secrets.GOOGLE_CLIENT_ID} onSaved={setSecrets} help="Looks like 1234-abc.apps.googleusercontent.com" />
      <KeyField k="GOOGLE_CLIENT_SECRET" label="Google OAuth client secret" isSet={secrets.GOOGLE_CLIENT_SECRET} onSaved={setSecrets} help="Starts with GOCSPX-" />
      <p className="text-xs text-ink-400">Job Hunter asks Google only for <b>read-only</b> Gmail access and only searches LinkedIn / Naukri alert emails. Each person connects their own inbox from their profile.</p>
    </div>
  )
}
