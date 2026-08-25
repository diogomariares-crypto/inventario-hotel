import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

/**
 * Ecrã que aparece a seguir à palavra-passe, quando a conta tem autenticador
 * configurado. Sem o código de 6 dígitos a sessão não fica completa.
 */
export default function DesafioMfa() {
  const { email, revalidarMfa, signOut } = useAuth()
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => { campo.current?.focus() }, [])

  const validar = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErro(null)
    try {
      const { data: fatores, error: e1 } = await supabase.auth.mfa.listFactors()
      if (e1) throw e1
      const totp = fatores?.totp?.[0]
      if (!totp) throw new Error('Não encontrei nenhum autenticador nesta conta.')

      const { data: desafio, error: e2 } = await supabase.auth.mfa.challenge({ factorId: totp.id })
      if (e2) throw e2

      const { error: e3 } = await supabase.auth.mfa.verify({
        factorId: totp.id, challengeId: desafio.id, code: codigo.trim(),
      })
      if (e3) throw e3

      await revalidarMfa()
    } catch (err) {
      const m = (err as Error).message
      setErro(/invalid|incorrect/i.test(m)
        ? 'Código incorreto ou já expirado. Tenta o próximo.'
        : m)
      setCodigo('')
      campo.current?.focus()
    } finally { setBusy(false) }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-500 text-lg font-bold text-white">cb</div>
          <h1 className="mt-3 text-xl font-semibold">Código de verificação</h1>
          <p className="text-sm text-slate-500">
            Abre a app de autenticação e escreve o código de 6 dígitos.
          </p>
        </div>

        <form onSubmit={validar} className="card space-y-3 p-5">
          <div>
            <label className="label">Código</label>
            <input
              ref={campo}
              className="input text-center font-mono text-2xl tracking-[0.4em]"
              inputMode="numeric" autoComplete="one-time-code" maxLength={6}
              placeholder="000000"
              value={codigo}
              onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          {erro && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</div>
          )}

          <button className="btn-primary w-full" disabled={busy || codigo.length !== 6}>
            {busy ? 'A validar…' : 'Entrar'}
          </button>

          <p className="text-center text-xs text-slate-500">
            Sessão de {email}
          </p>
          <button type="button" onClick={signOut}
                  className="w-full text-center text-sm text-slate-500 hover:text-slate-800">
            Entrar com outra conta
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Sem acesso ao telemóvel da receção? Pede a um administrador para remover
          o autenticador desta conta.
        </p>
      </div>
    </div>
  )
}
