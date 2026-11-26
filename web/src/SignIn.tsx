import { FormEvent, ReactNode, useState } from 'react'
import { Spinner, cx } from '@renderer/ui'
import { cleanErr, sb } from './supabase'

export function SignIn(): ReactNode {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const creds = { email: email.trim().toLowerCase(), password }
    const { error } = mode === 'in' ? await sb.auth.signInWithPassword(creds) : await sb.auth.signUp(creds)
    if (error) setErr(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : cleanErr(error))
    setBusy(false)
  }

  return (
    <div className="grid min-h-full place-items-center px-6 py-16">
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="flex items-center gap-2.5">
          <img src="/logo.png" alt="" className="h-9 w-9" draggable={false} />
          <h1 className="text-xl font-semibold tracking-tight">Job Hunter</h1>
        </div>
        <p className="mt-3 text-sm text-ink-300">
          {mode === 'in' ? 'Sign in to see your matches.' : 'Create your sign-in. Use the email you were invited with.'}
        </p>

        <div className="mt-6 space-y-3">
          <div>
            <label className="label" htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required className="field" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={8} className="field"
              autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'up' && <p className="mt-1 text-xs text-ink-400">At least 8 characters.</p>}
          </div>
        </div>

        {err && <p className="mt-3 text-xs text-rose-700 dark:text-rose-300">{err}</p>}

        <button type="submit" className="btn btn-primary mt-5 w-full py-2" disabled={busy}>
          {busy && <Spinner size={14} />} {mode === 'in' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setErr('') }}
          className={cx('btn btn-ghost mt-2 w-full')}>
          {mode === 'in' ? 'First time? Create your sign-in' : 'I already have a sign-in'}
        </button>
      </form>
    </div>
  )
}
