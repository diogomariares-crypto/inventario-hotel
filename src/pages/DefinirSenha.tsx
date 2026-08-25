import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * Aparece quando a palavra-passe atual foi definida por um administrador.
 * Enquanto não for trocada por uma própria, não se entra no resto da app —
 * uma palavra-passe entregue por telefone ou mensagem não pode ficar a valer.
 */
export default function DefinirSenha() {
  const { email, refreshRoles, signOut } = useAuth()
  const [nova, setNova] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault()
    setErro(null)
    if (nova.length < 8) return setErro('A palavra-passe tem de ter pelo menos 8 caracteres.')
    if (nova !== confirmar) return setErro('As duas palavras-passe não coincidem.')

    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: nova })
      if (error) throw error

      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles')
          .update({ senha_temporaria: false }).eq('id', user.id)
      }
      await refreshRoles()
    } catch (err) {
      const m = (err as Error).message
      setErro(/should be different|same as/i.test(m)
        ? 'Escolhe uma palavra-passe diferente da temporária.'
        : m)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-lg font-bold text-white">cb</div>
          <h1 className="mt-3 text-xl font-semibold">Escolhe a tua palavra-passe</h1>
          <p className="text-sm text-slate-500">
            A que usaste foi criada por um administrador e só serve para este primeiro acesso.
          </p>
        </div>

        <form onSubmit={guardar} className="card space-y-3 p-5">
          <div>
            <label className="label">Nova palavra-passe</label>
            <input className="input" type="password" autoComplete="new-password" minLength={8}
                   value={nova} onChange={e => setNova(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Repetir</label>
            <input className="input" type="password" autoComplete="new-password" minLength={8}
                   value={confirmar} onChange={e => setConfirmar(e.target.value)} required />
          </div>

          {erro && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>
          )}

          <p className="text-xs text-slate-500">
            Mínimo 8 caracteres. Não a partilhes por mensagem — quem precisar de acesso
            pede a sua própria conta.
          </p>

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'A guardar…' : 'Guardar e entrar'}
          </button>

          <p className="text-center text-xs text-slate-500">Sessão de {email}</p>
          <button type="button" onClick={signOut}
                  className="w-full text-center text-sm text-slate-500 hover:text-slate-800">
            Entrar com outra conta
          </button>
        </form>
      </div>
    </div>
  )
}
