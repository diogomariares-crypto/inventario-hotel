import { useEffect, useState } from 'react'
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

  /* -------------------- autenticação em dois passos -------------------- */
  const [fatores, setFatores] = useState<{ id: string; friendly_name?: string }[] | null>(null)
  const [inscricao, setInscricao] = useState<{ id: string; qr: string; segredo: string } | null>(null)
  const [codigo, setCodigo] = useState('')
  const [erroMfa, setErroMfa] = useState<string | null>(null)

  const carregarFatores = async () => {
    const { data } = await supabase.auth.mfa.listFactors()
    setFatores((data?.totp ?? []).filter(f => f.status === 'verified'))
  }
  useEffect(() => { carregarFatores() }, [])

  const comecarInscricao = async () => {
    setErroMfa(null)
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `Autenticador ${new Date().toLocaleDateString('pt-PT')}`,
    })
    if (error) return setErroMfa(error.message)
    setInscricao({ id: data.id, qr: data.totp.qr_code, segredo: data.totp.secret })
  }

  const confirmarInscricao = async () => {
    if (!inscricao) return
    setErroMfa(null)
    const { data: desafio, error: e1 } = await supabase.auth.mfa.challenge({ factorId: inscricao.id })
    if (e1) return setErroMfa(e1.message)
    const { error: e2 } = await supabase.auth.mfa.verify({
      factorId: inscricao.id, challengeId: desafio.id, code: codigo.trim(),
    })
    if (e2) {
      setErroMfa(/invalid|incorrect/i.test(e2.message)
        ? 'Código incorreto ou já expirado. Tenta o próximo.' : e2.message)
      setCodigo('')
      return
    }
    setInscricao(null); setCodigo('')
    toast('Autenticador ativado')
    carregarFatores()
  }

  const removerFator = async (id: string) => {
    if (!confirm('Desativar a autenticação em dois passos nesta conta?')) return
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id })
    if (error) return toast(error.message, 'erro')
    toast('Autenticador removido')
    carregarFatores()
  }

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
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        await supabase.from('profiles')
          .update({ senha_temporaria: false }).eq('id', user.id)
      }
    }
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

      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Autenticação em dois passos</h2>
        <p className="text-sm text-slate-600">
          Além da palavra-passe, passa a ser pedido um código de 6 dígitos gerado por uma app
          de autenticação — Google Authenticator, Microsoft Authenticator ou outra.
        </p>

        {fatores === null ? (
          <p className="text-sm text-slate-500">A verificar…</p>
        ) : inscricao ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              Abre a app de autenticação, escolhe <strong>adicionar conta</strong> e lê este código:
            </p>
            <img src={inscricao.qr} alt="Código QR" className="mx-auto h-48 w-48" />
            <details className="text-xs text-slate-500">
              <summary className="cursor-pointer">Não consigo ler o código</summary>
              <p className="mt-1">Escreve esta chave à mão na app:</p>
              <code className="mt-1 block break-all rounded bg-slate-100 p-2 font-mono">
                {inscricao.segredo}
              </code>
            </details>
            <div>
              <label className="label">Código gerado pela app</label>
              <input
                className="input text-center font-mono text-xl tracking-[0.3em]"
                inputMode="numeric" maxLength={6} placeholder="000000"
                value={codigo} onChange={e => setCodigo(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            {erroMfa && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erroMfa}</div>
            )}
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => { setInscricao(null); setCodigo('') }}>
                Cancelar
              </button>
              <button className="btn-primary" onClick={confirmarInscricao}
                      disabled={codigo.length !== 6}>Ativar</button>
            </div>
          </div>
        ) : fatores.length ? (
          <div className="space-y-2">
            <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
              Está ativa nesta conta.
            </div>
            {fatores.map(f => (
              <div key={f.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-600">{f.friendly_name ?? 'Autenticador'}</span>
                <button className="text-red-600 hover:underline" onClick={() => removerFator(f.id)}>
                  desativar
                </button>
              </div>
            ))}
          </div>
        ) : (
          <>
            {erroMfa && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{erroMfa}</div>
            )}
            <button className="btn-primary" onClick={comecarInscricao}>Ativar</button>
            <p className="text-xs text-slate-500">
              Em contas partilhadas, instala o autenticador no telemóvel da receção. Se esse
              telemóvel se perder, um administrador pode remover o autenticador desta conta.
            </p>
          </>
        )}
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
          Mínimo 8 caracteres. Se te esqueceres dela, pede a um administrador que a reponha —
          ele entrega-te uma temporária e voltas a escolher a tua no acesso seguinte.
        </p>
        <button className="btn-primary" disabled={busy}>
          {busy ? 'A guardar…' : 'Alterar palavra-passe'}
        </button>
      </form>
    </div>
  )
}
