import { useState } from 'react'
import { supabase, erroDoLink } from '../lib/supabase'

/**
 * Só entrar. As contas são criadas por um administrador em
 * Gestão → Utilizadores, e é também por aí que se repõe uma palavra-passe:
 * este projeto não envia emails.
 */
export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [ajuda, setAjuda] = useState(false)
  const [msg, setMsg] = useState<{ t: string; erro: boolean } | null>(
    erroDoLink ? { t: erroDoLink, erro: true } : null,
  )

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(), password,
      })
      if (error) throw error
    } catch (err) {
      const m = (err as Error).message ?? String(err)
      setMsg({
        t: /invalid login/i.test(m)
          ? 'Email ou palavra-passe incorretos.'
          : /rate limit|too many/i.test(m)
            ? 'Demasiadas tentativas. Espera alguns minutos e tenta outra vez.'
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
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoComplete="email" value={email}
                   onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="label">Palavra-passe</label>
            <input className="input" type="password" autoComplete="current-password"
                   value={password} onChange={e => setPassword(e.target.value)} required />
          </div>

          {msg && (
            <div className={`rounded-lg px-3 py-2 text-sm ${
              msg.erro ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'}`}>
              {msg.t}
            </div>
          )}

          <button className="btn-primary w-full" disabled={busy}>
            {busy ? 'Aguarda…' : 'Entrar'}
          </button>

          <button
            type="button"
            className="w-full text-center text-sm text-slate-500 hover:text-slate-800"
            onClick={() => setAjuda(a => !a)}
          >
            Esqueci-me da palavra-passe
          </button>

          {ajuda && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Fala com o administrador da app. Ele repõe a palavra-passe e entrega-te
              uma temporária; no primeiro acesso escolhes a tua.
            </div>
          )}
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          As contas são criadas por um administrador. Se ainda não tens acesso,
          pede a quem gere a app.
        </p>
      </div>
    </div>
  )
}
