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
  return <App key={session.user.id} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
