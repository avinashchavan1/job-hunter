import './web.css'

import { ReactNode, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import { LogOut } from 'lucide-react'
import { Section, Spinner } from '@renderer/ui'
import App from '@renderer/App'
import { setSettingsExtra } from '@renderer/pages/SettingsPage'
import { sb } from './supabase'
import { SignIn } from './SignIn'
import { Members } from './Members'
import { webApi } from './api'

window.api = webApi

type Access = { member: boolean; admin: boolean }

function Account({ email }: { email: string }): ReactNode {
  return (
    <Section title="Your sign-in" desc={`Signed in as ${email}.`}>
      <button className="btn btn-outline" onClick={() => sb.auth.signOut()}><LogOut size={14} /> Sign out</button>
    </Section>
  )
}

// Google sends people back here after connecting Gmail
const GMAIL_WHY: Record<string, string> = {
  access_denied: 'You cancelled the Google sign-in.',
  norefresh: 'Google did not give long-term access. Remove Job Hunter at myaccount.google.com/permissions and connect again.',
  expired: 'The Google sign-in took too long. Try again.'
}
function GmailNotice(): ReactNode {
  const [msg] = useState(() => {
    const q = new URLSearchParams(location.search)
    const g = q.get('gmail')
    if (!g) return null
    history.replaceState(null, '', location.pathname)
    if (g === 'connected') return { ok: true, text: 'Gmail connected. Job-alert emails are read on the next check.' }
    const why = q.get('why') || ''
    return { ok: false, text: `Gmail not connected: ${GMAIL_WHY[why] ?? why}` }
  })
  const [open, setOpen] = useState(!!msg)
  if (!msg || !open) return null
  return (
    <div className={`fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-sm shadow-lg ${msg.ok ? 'border-emerald-500/40 bg-ink-900 text-emerald-700 dark:text-emerald-300' : 'border-rose-500/40 bg-ink-900 text-rose-700 dark:text-rose-300'}`}>
      {msg.text} <button className="ml-3 underline" onClick={() => setOpen(false)}>OK</button>
    </div>
  )
}

function Root(): ReactNode {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [access, setAccess] = useState<Access | null>(null)

  useEffect(() => {
    void sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setAccess(null)
    if (!session) return
    void Promise.all([sb.rpc('jh_is_member'), sb.rpc('jh_is_admin')]).then(([m, a]) =>
      setAccess({ member: m.data === true, admin: a.data === true })
    )
  }, [session?.user.id])

  if (session === undefined || (session && !access)) return <div className="grid h-full place-items-center"><Spinner size={20} /></div>
  if (!session) return <SignIn />

  const email = session.user.email ?? ''
  if (!access!.member)
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium">You're signed in, but {email} isn't on the list yet.</p>
          <p className="mt-1 text-sm text-ink-400">Ask the person who invited you to add this email, then reload the page.</p>
          <button className="btn btn-outline mt-5" onClick={() => sb.auth.signOut()}><LogOut size={14} /> Sign out</button>
        </div>
      </div>
    )

  setSettingsExtra(
    <>
      <Members me={email} isAdmin={access!.admin} />
      <Account email={email} />
    </>
  )
  return (
    <>
      <App key={session.user.id} />
      <GmailNotice />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
