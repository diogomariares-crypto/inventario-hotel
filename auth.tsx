import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { AppRole, Department } from './types'

interface AuthState {
  session: Session | null
  email: string | null
  fullName: string | null
  roles: AppRole[]
  loading: boolean
  isAdmin: boolean
  canWrite: (d: Department) => boolean
  allowedDepartments: Department[]
  signOut: () => Promise<void>
  refreshRoles: () => Promise<void>
}

const Ctx = createContext<AuthState>(null as unknown as AuthState)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [roles, setRoles] = useState<AppRole[]>([])
  const [fullName, setFullName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) { setRoles([]); setFullName(null); return }
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('profiles').select('full_name').eq('id', uid).maybeSingle(),
    ])
    setRoles((r ?? []).map(x => x.role as AppRole))
    setFullName(p?.full_name ?? null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      await loadRoles(data.session?.user.id)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadRoles(s?.user.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const isAdmin = roles.includes('admin')
  const canWrite = (d: Department) =>
    isAdmin ||
    (d === 'FO' && roles.includes('fo')) ||
    (d === 'HSK' && roles.includes('hsk')) ||
    (d === 'FB' && roles.includes('fb'))

  const allowedDepartments = (['FO', 'HSK', 'FB'] as Department[]).filter(canWrite)

  const value: AuthState = {
    session,
    email: session?.user.email ?? null,
    fullName,
    roles,
    loading,
    isAdmin,
    canWrite,
    allowedDepartments,
    signOut: async () => { await supabase.auth.signOut() },
    refreshRoles: async () => loadRoles(session?.user.id),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
