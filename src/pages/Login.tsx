import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode] = useState<'entrar' | 'criar'>('entrar')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ t: string; erro: boolean } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      if (mode === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() } },
        })
        if (error) throw error
        setMsg({
          t: 'Conta criada. Pede ao administrador para te atribuir permissões — só depois consegues registar contagens.',
          erro: false,
        })
      }
    } catch (err) {
      const m = (err as Error).message ?? String(err)
      setMsg({
        t: m.includes('Invalid login')
          ? 'Email ou palavra-passe incorretos.'
          : m.includes('already registered')
            ? 'Já existe uma conta com este email.'
            : m,
        erro: true,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-lg font-bold text-white">cb</div>
          <h1 className="mt-3 text-xl font-semibold">Operações</h1>
          <p className="text-sm text-slate-500">Turnos · Inventário · chic&amp;basic</p>
        </div>

        <form onSubmit={submit} className="card space-y-3 p-5">
          {mode === 'criar' && (
            <div>
              <label className="label">Nome</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)}
                     placeholder="Ex: Maria Silva" required />
            </div>
          )}
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email}
                   onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Palavra-passe</label>
            <input className="input" type="password"
                   autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'}
                   value={password} onChange={e => setPassword(e.target.value)}
                   minLength={6} required />
          </div>

          {msg && (
            <div className={`rounded-lg px-3 py-2 text-sm ${
              msg.erro ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'}`}>
              {msg.t}
            </div>
          )}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Aguarda…' : mode === 'entrar' ? 'Entrar' : 'Criar conta'}
          </button>

          <button
            type="button"
            className="w-full text-center text-sm text-slate-500 hover:text-slate-800"
            onClick={() => { setMode(m => (m === 'entrar' ? 'criar' : 'entrar')); setMsg(null) }}
          >
            {mode === 'entrar' ? 'Ainda não tenho conta' : 'Já tenho conta'}
          </button>
        </form>
      </div>
    </div>
  )
}
