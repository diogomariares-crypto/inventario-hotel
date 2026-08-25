import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/ui'

/** Cada pessoa muda aqui a sua própria palavra-passe. */
export default function Conta() {
  const { email, fullName, roles } = useAuth()
  const toast = useToast()
  const nav = useNavigate()

  const [nome, setNome] = useState(fullName ?? '')
  const [nova, setNova] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [busy, setBusy] = useState(false)

  const guardarNome = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('profiles')
      .update({ full_name: nome.trim() || null }).eq('id', user.id)
    if (error) return toast(error.message, 'erro')
    toast('Nome atualizado')
  }

  const mudarPasse = async (e: React.FormEvent) => {
    e.preventDefault()
    if (nova.length < 8) { toast('A palavra-passe tem de ter pelo menos 8 caracteres', 'erro'); return }
    if (nova !== confirmar) { toast('As duas palavras-passe não coincidem', 'erro'); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: nova })
    setBusy(false)
    if (error) return toast(error.message, 'erro')
    setNova(''); setConfirmar('')
    toast('Palavra-passe alterada')
    nav('/')
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="text-lg font-semibold">A minha conta</h1>
        <p className="text-sm text-slate-500">{email}</p>
        <div className="mt-1 flex flex-wrap gap-1">
          {roles.length === 0
            ? <span className="chip bg-amber-100 text-amber-800">sem permissões</span>
            : roles.map(r => (
                <span key={r} className="chip bg-slate-100 text-slate-700">{r.toUpperCase()}</span>
              ))}
        </div>
      </div>

      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Nome</h2>
        <p className="text-sm text-slate-600">
          É o que aparece a quem vir quem criou ou fechou cada registo.
        </p>
        <div className="flex gap-2">
          <input className="input" value={nome} onChange={e => setNome(e.target.value)}
                 placeholder="Ex: Maria Silva" />
          <button className="btn-ghost" onClick={guardarNome}>Guardar</button>
        </div>
      </div>

      <form onSubmit={mudarPasse} className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Alterar palavra-passe</h2>
        <div>
          <label className="label">Nova palavra-passe</label>
          <input className="input" type="password" autoComplete="new-password" minLength={8}
                 value={nova} onChange={e => setNova(e.target.value)} required />
        </div>
        <div>
          <label className="label">Repetir</label>
          <input className="input" type="password" autoComplete="new-password" minLength={8}
                 value={confirmar} onChange={e => setConfirmar(e.target.value)} required />
        </div>
        <p className="text-xs text-slate-500">
          Mínimo 8 caracteres. Se recebeste um convite ou um link de recuperação, é aqui que
          defines a tua palavra-passe.
        </p>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'A guardar…' : 'Alterar palavra-passe'}
        </button>
      </form>
    </div>
  )
}
