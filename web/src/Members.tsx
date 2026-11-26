import { FormEvent, ReactNode, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Section, Spinner } from '@renderer/ui'
import { cleanErr, sb } from './supabase'

type Member = { email: string; is_admin: boolean; added_at: string }

/** Who can sign in and see the data. Only admins can change it (enforced in the database). */
export function Members({ me, isAdmin }: { me: string; isAdmin: boolean }): ReactNode {
  const [rows, setRows] = useState<Member[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const load = async (): Promise<void> => {
    const { data, error } = await sb.from('jh_members').select('*').order('added_at')
    if (error) setErr(cleanErr(error))
    else setRows(data as Member[])
  }
  useEffect(() => void load(), [])

  const add = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    const { error } = await sb.from('jh_members').insert({ email: email.trim().toLowerCase() })
    if (error) setErr(error.code === '23505' ? 'Already on the list.' : cleanErr(error))
    else setEmail('')
    await load()
    setBusy(false)
  }
  const remove = async (m: Member): Promise<void> => {
    if (!confirm(`Remove ${m.email}? They will no longer be able to see anything.`)) return
    const { error } = await sb.from('jh_members').delete().eq('email', m.email)
    if (error) setErr(cleanErr(error))
    await load()
  }

  return (
    <Section title="People who can sign in" desc="Add someone's email, then they open this site and create their sign-in with that email.">
      <ul className="divide-y divide-line border-y border-line">
        {rows.map((m) => (
          <li key={m.email} className="flex items-center gap-3 py-2 text-sm">
            <span className="flex-1">{m.email}{m.email === me && <span className="text-ink-400"> (you)</span>}</span>
            {m.is_admin && <span className="text-xs text-ink-400">admin</span>}
            {isAdmin && m.email !== me && (
              <button className="btn btn-ghost !px-2" onClick={() => remove(m)} aria-label={`Remove ${m.email}`}><Trash2 size={14} /></button>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <form onSubmit={add} className="mt-3 flex gap-2">
          <input type="email" required className="field" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn btn-outline shrink-0" disabled={busy}>{busy && <Spinner size={13} />} Add</button>
        </form>
      )}
      {err && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
    </Section>
  )
}
