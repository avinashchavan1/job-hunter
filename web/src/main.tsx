import './web.css'

import { ReactNode, StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Session } from '@supabase/supabase-js'
import { LogOut } from 'lucide-react'
import { Spinner } from '@renderer/ui'
import { sb } from './supabase'
import { SignIn } from './SignIn'
import { Members } from './Members'

type Access = { member: boolean; admin: boolean }

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
  return (
    <div className="mx-auto max-w-3xl px-6 pb-12 pt-8">
      <header className="flex items-center gap-2.5">
        <img src="/logo.png" alt="" className="h-8 w-8" draggable={false} />
        <h1 className="flex-1 text-lg font-semibold tracking-tight">Job Hunter</h1>
        <span className="hidden text-xs text-ink-400 sm:inline">{email}</span>
        <button className="btn btn-ghost" onClick={() => sb.auth.signOut()}><LogOut size={14} /> Sign out</button>
      </header>

      {!access!.member ? (
        <div className="mt-16 text-center">
          <p className="text-sm font-medium">You're signed in, but {email} isn't on the list yet.</p>
          <p className="mt-1 text-sm text-ink-400">Ask the person who invited you to add this email, then reload the page.</p>
        </div>
      ) : (
        <div className="mt-8">
          <p className="mb-8 text-sm text-ink-300">
            The web version is being built. Next up: people and resumes, then job checks and your Today list.
          </p>
          <Members me={email} isAdmin={access!.admin} />
        </div>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
