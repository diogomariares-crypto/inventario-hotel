import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AppRole } from '../lib/types'
import { Loading, Modal, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'

interface Linha {
  id: string
  email: string
  full_name: string | null
  senha_temporaria: boolean
  roles: AppRole[]
}

const TODOS: { role: AppRole; label: string; desc: string }[] = [
  { role: 'admin', label: 'Administrador', desc: 'tudo, incluindo itens, preços e contas' },
  { role: 'fo', label: 'Front Office', desc: 'contagens FO e operação diária' },
  { role: 'hsk', label: 'Housekeeping', desc: 'contagens HSK e operação diária' },
  { role: 'fb', label: 'F&B', desc: 'contagens do restaurante e faturação diária' },
  { role: 'financeiro', label: 'Financeiro', desc: 'painel de faturação e números do negócio' },
  { role: 'rh', label: 'Recursos Humanos', desc: 'fichas de pessoal, vencimentos e custos de empresa' },
]

export default function Utilizadores() {
  const toast = useToast()
  const { session, refreshRoles } = useAuth()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState<{ nome: string; email: string; papeis: AppRole[] } | null>(null)
  const [aTrabalhar, setATrabalhar] = useState(false)
  const [temporaria, setTemporaria] = useState<{ email: string; senha: string } | null>(null)
  const [comMfa, setComMfa] = useState<Set<string>>(new Set())

  const carregar = async () => {
    setLoading(true)
    const [{ data: perfis, error: e1 }, { data: papeis, error: e2 }] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name, senha_temporaria').order('email'),
      supabase.from('user_roles').select('user_id, role'),
    ])
    if (e1 || e2) toast((e1 ?? e2)!.message, 'erro')
    const porUser: Record<string, AppRole[]> = {}
    for (const p of papeis ?? []) (porUser[p.user_id] ??= []).push(p.role as AppRole)
    setLinhas((perfis ?? []).map(p => ({
      ...p,
      senha_temporaria: p.senha_temporaria === true,
      roles: porUser[p.id] ?? [],
    })))
    setLoading(false)

    // quem tem autenticador ativo (só o servidor sabe)
    try {
      const r = await chamar({ acao: 'mfa' }) as unknown as { comMfa?: string[] }
      setComMfa(new Set(r.comMfa ?? []))
    } catch { /* não é crítico */ }
  }
  useEffect(() => { carregar() }, [])

  const chamar = async (corpo: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('gerir-utilizadores', { body: corpo })
    if (error) {
      // o corpo de erro traz a mensagem em português
      let msg = error.message
      try {
        const ctx = (error as unknown as { context?: Response }).context
        if (ctx) msg = (await ctx.json())?.erro ?? msg
      } catch { /* fica a mensagem original */ }
      throw new Error(msg)
    }
    if (data?.erro) throw new Error(data.erro)
    return data as { ok: boolean; temporaria?: string | null }
  }

  const criar = async () => {
    if (!novo) return
    if (!novo.email.includes('@')) { toast('Email inválido', 'erro'); return }
    setATrabalhar(true)
    try {
      const r = await chamar({
        acao: 'convidar',
        email: novo.email, nome: novo.nome, papeis: novo.papeis,
      })
      const criado = novo.email
      setNovo(null)
      if (r.temporaria) setTemporaria({ email: criado, senha: r.temporaria })
      carregar()
    } catch (e) { toast((e as Error).message, 'erro') } finally { setATrabalhar(false) }
  }

  const repor = async (l: Linha) => {
    if (!confirm(
      `Repor a palavra-passe de ${l.email}?\n\n` +
      'A atual deixa de funcionar imediatamente. Vais receber uma temporária ' +
      'para lhe entregares.',
    )) return
    try {
      const r = await chamar({ acao: 'repor', email: l.email })
      if (r.temporaria) setTemporaria({ email: l.email, senha: r.temporaria })
      carregar()
    } catch (e) { toast((e as Error).message, 'erro') }
  }

  const removerMfa = async (l: Linha) => {
    if (!confirm(
      `Remover o autenticador de ${l.email}?\n\n` +
      'Use isto quando o telemóvel da receção se perde ou é reiniciado. ' +
      'A conta volta a entrar só com palavra-passe até configurar outro.',
    )) return
    try {
      await chamar({ acao: 'remover-mfa', id: l.id })
      toast('Autenticador removido')
      carregar()
    } catch (e) { toast((e as Error).message, 'erro') }
  }

  const remover = async (l: Linha) => {
    if (!confirm(`Apagar a conta de ${l.email}? Esta ação não pode ser anulada.`)) return
    try {
      await chamar({ acao: 'remover', id: l.id })
      toast('Conta apagada')
      carregar()
    } catch (e) { toast((e as Error).message, 'erro') }
  }

  const alternar = async (userId: string, role: AppRole, tem: boolean) => {
    const { error } = tem
      ? await supabase.from('user_roles').delete().eq('user_id', userId).eq('role', role)
      : await supabase.from('user_roles').insert({ user_id: userId, role })
    if (error) return toast(error.message, 'erro')
    setLinhas(ls => ls.map(l => l.id === userId
      ? { ...l, roles: tem ? l.roles.filter(r => r !== role) : [...l.roles, role] }
      : l))
    if (userId === session?.user.id) refreshRoles()
  }

  if (loading) return <Loading />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Utilizadores</h1>
          <p className="text-sm text-slate-500">
            Sem pelo menos um papel atribuído, a conta não vê dados nenhuns. Cada pessoa ativa
            a autenticação em dois passos em <em>A minha conta</em>. Quem se esquecer da
            palavra-passe pede-te aqui uma nova — não há emails de recuperação.
          </p>
        </div>
        <button className="btn-primary"
                onClick={() => setNovo({ nome: '', email: '', papeis: ['fo'] })}>
          + Nova conta
        </button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Pessoa</th>
              {TODOS.map(t => <th key={t.role} className="th text-center">{t.label}</th>)}
              <th className="th"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {linhas.map(l => (
              <tr key={l.id}>
                <td className="td">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{l.full_name ?? '—'}</span>
                    {comMfa.has(l.id) && (
                      <span className="chip bg-brand-100 text-brand-700" title="Autenticador ativo">
                        2 passos
                      </span>
                    )}
                    {l.senha_temporaria && (
                      <span className="chip bg-amber-100 text-amber-800"
                            title="Ainda não escolheu uma palavra-passe própria">
                        temporária
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{l.email}</div>
                  {l.roles.length === 0 && (
                    <span className="chip mt-1 bg-amber-100 text-amber-800">sem acesso</span>
                  )}
                </td>
                {TODOS.map(t => {
                  const tem = l.roles.includes(t.role)
                  return (
                    <td key={t.role} className="td text-center">
                      <input type="checkbox" className="h-4 w-4 accent-[#1a6b4a]"
                             checked={tem} title={t.desc}
                             onChange={() => alternar(l.id, t.role, tem)} />
                    </td>
                  )
                })}
                <td className="td whitespace-nowrap text-right">
                  <button className="text-sm text-brand-600 hover:underline"
                          onClick={() => repor(l)}>repor palavra-passe</button>
                  {comMfa.has(l.id) && (
                    <button className="ml-3 text-sm text-amber-700 hover:underline"
                            onClick={() => removerMfa(l)}>remover autenticador</button>
                  )}
                  {l.id !== session?.user.id && (
                    <button className="ml-3 text-sm text-slate-400 hover:text-red-600"
                            onClick={() => remover(l)}>apagar</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {linhas.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">Ainda não há contas criadas.</div>
        )}
      </div>

      {/* nova conta */}
      <Modal open={!!novo} onClose={() => setNovo(null)} title="Nova conta">
        {novo && (
          <div className="space-y-3">
            <div>
              <label className="label">Nome</label>
              <input className="input" value={novo.nome} placeholder="Ex: Maria Silva"
                     onChange={e => setNovo({ ...novo, nome: e.target.value })} />
            </div>
            <div>
              <label className="label">Email *</label>
              <input className="input" type="email" value={novo.email}
                     placeholder="nome@chicandbasic.com"
                     onChange={e => setNovo({ ...novo, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Permissões</label>
              <div className="space-y-1.5">
                {TODOS.map(t => (
                  <label key={t.role} className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#1a6b4a]"
                           checked={novo.papeis.includes(t.role)}
                           onChange={e => setNovo({
                             ...novo,
                             papeis: e.target.checked
                               ? [...novo.papeis, t.role]
                               : novo.papeis.filter(p => p !== t.role),
                           })} />
                    <span><strong>{t.label}</strong> <span className="text-slate-500">— {t.desc}</span></span>
                  </label>
                ))}
              </div>
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Não é enviado nenhum email. A seguir mostro uma palavra-passe temporária
              para lhe entregares — no primeiro acesso a app obriga-a a escolher a dela.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setNovo(null)}>Cancelar</button>
              <button className="btn-primary" onClick={criar} disabled={aTrabalhar}>
                {aTrabalhar ? 'A criar…' : 'Criar conta'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* palavra-passe temporária */}
      <Modal open={!!temporaria} onClose={() => setTemporaria(null)} title="Palavra-passe temporária">
        {temporaria && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Entrega esta palavra-passe a <strong>{temporaria.email}</strong>. Só serve
              para o primeiro acesso: a app não a deixa entrar sem escolher outra.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-lg bg-slate-100 px-3 py-2 font-mono text-sm">
                {temporaria.senha}
              </code>
              <button className="btn-ghost"
                      onClick={() => {
                        navigator.clipboard?.writeText(temporaria.senha)
                        toast('Copiada')
                      }}>Copiar</button>
            </div>
            <p className="text-xs text-slate-500">
              Isto aparece uma única vez — se fechares sem copiar, tens de repor outra vez.
            </p>
            <div className="flex justify-end pt-1">
              <button className="btn-primary" onClick={() => setTemporaria(null)}>Fechar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
