import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, sessaoDoLink } from './supabase'
import type { AppRole, Department } from './types'

interface AuthState {
  session: Session | null
  /** Tem autenticador configurado mas ainda não introduziu o código nesta sessão. */
  precisaCodigo: boolean
  revalidarMfa: () => Promise<void>
  email: string | null
  fullName: string | null
  /** Um administrador definiu esta palavra-passe: tem de ser mudada antes de entrar. */
  senhaTemporaria: boolean
  roles: AppRole[]
  loading: boolean
  isAdmin: boolean
  /** Vê o painel de faturação e o resto dos números do negócio. */
  podeVerPainel: boolean
  /** Vê o controlo de pequenos-almoços: receção, F&B, financeiro e admin. */
  podeVerPa: boolean
  podeVerRh: boolean
  podeVerLavandaria: boolean
  podeVerHk: boolean
  /** Vê e conta o dinheiro das caixas: direção e financeiro. */
  podeVerCaixa: boolean
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
  const [senhaTemporaria, setSenhaTemporaria] = useState(false)
  const [loading, setLoading] = useState(true)
  const [precisaCodigo, setPrecisaCodigo] = useState(false)

  /**
   * O Supabase distingue dois níveis de garantia: aal1 (só palavra-passe) e
   * aal2 (palavra-passe + código). Se a conta tem autenticador configurado,
   * a sessão só está completa em aal2.
   */
  const verificarMfa = async () => {
    const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    setPrecisaCodigo(data?.nextLevel === 'aal2' && data.nextLevel !== data.currentLevel)
  }

  const loadRoles = async (uid: string | undefined) => {
    if (!uid) { setRoles([]); setFullName(null); setSenhaTemporaria(false); return }
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from('user_roles').select('role').eq('user_id', uid),
      supabase.from('profiles').select('full_name, senha_temporaria').eq('id', uid).maybeSingle(),
    ])
    setRoles((r ?? []).map(x => x.role as AppRole))
    setFullName(p?.full_name ?? null)
    setSenhaTemporaria(p?.senha_temporaria === true)
  }

  useEffect(() => {
    // Se viemos de um link de recuperação ou de convite, esperamos que a
    // sessão desse link fique instalada antes de perguntar quem está ligado.
    sessaoDoLink
      .then(() => supabase.auth.getSession())
      .then(async ({ data }) => {
        setSession(data.session)
        if (data.session) await verificarMfa()
        await loadRoles(data.session?.user.id)
        setLoading(false)
      })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      loadRoles(s?.user.id)
      if (s) verificarMfa(); else setPrecisaCodigo(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const isAdmin = roles.includes('admin')
  const podeVerPainel = isAdmin || roles.includes('financeiro')
  const podeVerPa = podeVerPainel || roles.includes('fo') || roles.includes('fb')
  // salários só para quem tem o perfil próprio — não anda colado a nenhum operacional
  const podeVerRh = isAdmin || roles.includes('rh')
  // custos de rouparia: direcção, financeiro e quem trata dos quartos
  const podeVerLavandaria = podeVerPainel || roles.includes('hsk')
  // produção e pessoal do housekeeping: a governanta lança, a direção lê
  const podeVerHk = podeVerLavandaria
  // dinheiro: só direção e financeiro, como na base de dados (pode_ver_caixa)
  const podeVerCaixa = podeVerPainel
  const canWrite = (d: Department) =>
    isAdmin ||
    (d === 'FO' && roles.includes('fo')) ||
    (d === 'HSK' && roles.includes('hsk')) ||
    (d === 'FB' && roles.includes('fb'))

  const allowedDepartments = (['FO', 'HSK', 'FB'] as Department[]).filter(canWrite)

  const value: AuthState = {
    session,
    precisaCodigo,
    revalidarMfa: verificarMfa,
    email: session?.user.email ?? null,
    fullName,
    senhaTemporaria,
    roles,
    loading,
    isAdmin,
    podeVerPainel,
    podeVerPa,
    podeVerRh,
    podeVerLavandaria,
    podeVerHk,
    podeVerCaixa,
    canWrite,
    allowedDepartments,
    signOut: async () => { await supabase.auth.signOut() },
    refreshRoles: async () => loadRoles(session?.user.id),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
