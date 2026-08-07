import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AppRole } from '../lib/types'
import { Loading, useToast } from '../components/ui'
import { useAuth } from '../lib/auth'

interface Linha { id: string; email: string; full_name: string | null; roles: AppRole[] }

const TODOS: { role: AppRole; label: string; desc: string }[] = [
  { role: 'admin', label: 'Administrador', desc: 'tudo, incluindo itens e utilizadores' },
  { role: 'fo', label: 'Front Office', desc: 'contagens FO' },
  { role: 'hsk', label: 'Housekeeping', desc: 'contagens HSK' },
  { role: 'fb', label: 'F&B', desc: 'contagens do restaurante' },
]

export default function Utilizadores() {
  const toast = useToast()
  const { session, refreshRoles } = useAuth()
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    setLoading(true)
    const [{ data: perfis, error: e1 }, { data: papeis, error: e2 }] = await Promise.all([
      supabase.from('profiles').select('id, email, full_name').order('email'),
      supabase.from('user_roles').select('user_id, role'),
    ])
    if (e1 || e2) toast((e1 ?? e2)!.message, 'erro')
    const porUser: Record<string, AppRole[]> = {}
    for (const p of papeis ?? []) (porUser[p.user_id] ??= []).push(p.role as AppRole)
    setLinhas((perfis ?? []).map(p => ({ ...p, roles: porUser[p.id] ?? [] })))
    setLoading(false)
  }
  useEffect(() => { carregar() }, [])

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
      <div>
        <h1 className="text-lg font-semibold">Utilizadores</h1>
        <p className="text-sm text-slate-500">
          Cada pessoa cria a própria conta no ecrã de entrada. Aqui atribuis-lhe as permissões.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Pessoa</th>
              {TODOS.map(t => <th key={t.role} className="th text-center">{t.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {linhas.map(l => (
              <tr key={l.id}>
                <td className="td">
                  <div className="font-medium">{l.full_name ?? '—'}</div>
                  <div className="text-xs text-slate-500">{l.email}</div>
                  {l.roles.length === 0 && (
                    <span className="chip mt-1 bg-amber-100 text-amber-800">sem acesso</span>
                  )}
                </td>
                {TODOS.map(t => {
                  const tem = l.roles.includes(t.role)
                  return (
                    <td key={t.role} className="td text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-[#1a6b4a]"
                        checked={tem}
                        title={t.desc}
                        onChange={() => alternar(l.id, t.role, tem)}
                      />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {linhas.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">Ainda não há contas criadas.</div>
        )}
      </div>

      <div className="card p-4 text-sm text-slate-600">
        <strong className="text-slate-800">Como dar acesso a alguém</strong>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>A pessoa abre a app e escolhe <em>Ainda não tenho conta</em>.</li>
          <li>Regista-se com o email de trabalho e uma palavra-passe.</li>
          <li>A conta aparece nesta lista — marca as permissões que precisa.</li>
        </ol>
      </div>
    </div>
  )
}
