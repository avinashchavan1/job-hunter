import { ReactNode, useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { LogOut } from 'lucide-react'
import { sb } from './supabase'

/** Photo and name from the Google sign-in (Supabase keeps them in user_metadata); initials otherwise. */
export function who(u: User): { name: string; email: string; photo: string | null } {
  const m = (u.user_metadata ?? {}) as Record<string, string | undefined>
  const email = u.email ?? ''
  return { name: m.full_name || m.name || email.split('@')[0], email, photo: m.avatar_url || m.picture || null }
}

export function Avatar({ user, size = 28 }: { user: User; size?: number }): ReactNode {
  const { name, photo } = who(user)
  const [broken, setBroken] = useState(false)
  const initials = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?'
  return photo && !broken ? (
    <img src={photo} alt="" width={size} height={size} referrerPolicy="no-referrer" onError={() => setBroken(true)}
      className="rounded-full object-cover ring-1 ring-line" style={{ width: size, height: size }} draggable={false} />
  ) : (
    <span className="grid place-items-center rounded-full bg-ink-100 font-semibold text-ink-950" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials}</span>
  )
}

/** Top-right account button with a small menu. */
export function AccountMenu({ user, isAdmin }: { user: User; isAdmin: boolean }): ReactNode {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { name, email } = who(user)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div ref={ref} className="fixed right-4 top-2.5 z-40">
      <button onClick={() => setOpen(!open)} className="rounded-full transition hover:opacity-85" title={`${name} (${email})`} aria-label="Account menu" aria-expanded={open}>
        <Avatar user={user} />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg border border-line bg-ink-900 p-1 shadow-lg">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Avatar user={user} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{name}</div>
              <div className="truncate text-xs text-ink-400">{email}</div>
              {isAdmin && <div className="mt-0.5 text-[11px] text-ink-400">Admin</div>}
            </div>
          </div>
          <div className="my-1 h-px bg-line" />
          <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-ink-300 hover:bg-hover hover:text-ink-100" onClick={() => sb.auth.signOut()}>
            <LogOut size={14} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}
