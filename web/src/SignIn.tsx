import { FormEvent, ReactNode, useState } from 'react'
import { Spinner, cx } from '@renderer/ui'
import { cleanErr, sb } from './supabase'

export function SignIn(): ReactNode {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(() => {
    // Google sends errors back in the address bar
    const q = new URLSearchParams(location.search + '&' + location.hash.slice(1))
    return q.get('error_description')?.replace(/\+/g, ' ') ?? ''
  })

  const google = async (): Promise<void> => {
    setErr('')
    setBusy(true)
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${location.origin}/app/` } })
    if (error) {
      setErr(/provider is not enabled/i.test(error.message) ? 'Google sign-in isn’t switched on yet — use email and password for now.' : cleanErr(error))
      setBusy(false)
    }
  }

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

        <button type="button" onClick={google} disabled={busy} className="btn btn-outline mt-6 w-full py-2">
          <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          Continue with Google
        </button>
        <div className="my-5 flex items-center gap-3 text-xs text-ink-400"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>

        <div className="space-y-3">
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
