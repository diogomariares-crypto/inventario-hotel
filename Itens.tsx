import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import { supabase } from '../lib/supabase'
import type { Department, Item } from '../lib/types'
import { DEPARTMENTS } from '../lib/types'
import { downloadCSV, money } from '../lib/format'
import { Loading, Modal, NumInput, useToast } from '../components/ui'

const vazio = (dept: Department, hotelId: string | null): Partial<Item> => ({
  department: dept,
  hotel_id: dept === 'FB' ? null : hotelId,
  count_frequency: dept === 'FB' ? 'mensal' : 'semanal',
  name: '',
  ref: null,
  category: null,
  supplier: null,
  unit: 'Un',
  unit_price_eur: null,
  par_qty: null,
  active: true,
  is_custom: true,
})

export default function Itens() {
  const { hotelId } = useApp()
  const toast = useToast()
  const [dept, setDept] = useState<Department>('HSK')
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [busca, setBusca] = useState('')
  const [edit, setEdit] = useState<Partial<Item> | null>(null)
  const [verInativos, setVerInativos] = useState(false)

  const carregar = async () => {
    if (!hotelId) return
    setLoading(true)
    let q = supabase.from('items').select('*').eq('department', dept)
    q = dept === 'FB' ? q.is('hotel_id', null) : q.eq('hotel_id', hotelId)
    const { data, error } = await q.order('name')
    if (error) toast(error.message, 'erro')
    setItems((data ?? []) as Item[])
    setLoading(false)
  }
  useEffect(() => { carregar() }, [hotelId, dept])

  const guardar = async () => {
    if (!edit?.name?.trim()) { toast('O nome é obrigatório', 'erro'); return }
    const payload = {
      ...edit,
      name: edit.name.trim(),
      ref: edit.ref?.trim() || null,
      category: edit.category?.trim() || null,
      supplier: edit.supplier?.trim() || null,
      unit: edit.unit?.trim() || 'Un',
    }
    const { error } = edit.id
      ? await supabase.from('items').update(payload).eq('id', edit.id)
      : await supabase.from('items').insert(payload)
    if (error) { toast(error.message, 'erro'); return }
    toast(edit.id ? 'Item atualizado' : 'Item criado')
    setEdit(null)
    carregar()
  }

  const alternarAtivo = async (i: Item) => {
    const { error } = await supabase.from('items').update({ active: !i.active }).eq('id', i.id)
    if (error) return toast(error.message, 'erro')
    carregar()
  }

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return items
      .filter(i => verInativos || i.active)
      .filter(i => !q || i.name.toLowerCase().includes(q) ||
        (i.ref ?? '').toLowerCase().includes(q) || (i.supplier ?? '').toLowerCase().includes(q))
  }, [items, busca, verInativos])

  const semPreco = items.filter(i => i.active && i.unit_price_eur == null).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Departamento</label>
          <select className="input w-auto" value={dept} onChange={e => setDept(e.target.value as Department)}>
            {DEPARTMENTS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
        <div className="min-w-[200px] flex-1">
          <label className="label">Pesquisar</label>
          <input className="input" value={busca} onChange={e => setBusca(e.target.value)}
                 placeholder="nome, referência ou fornecedor" />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
          <input type="checkbox" checked={verInativos} onChange={e => setVerInativos(e.target.checked)} />
          mostrar inativos
        </label>
        <button className="btn-ghost" onClick={() => downloadCSV(`itens_${dept}.csv`, [
          ['referencia', 'nome', 'categoria', 'fornecedor', 'unidade', 'preco_eur', 'par', 'ativo'],
          ...items.map(i => [i.ref, i.name, i.category, i.supplier, i.unit, i.unit_price_eur, i.par_qty, i.active ? 'sim' : 'nao']),
        ])}>Exportar</button>
        <button className="btn-primary" onClick={() => setEdit(vazio(dept, hotelId))}>+ Novo item</button>
      </div>

      {semPreco > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          {semPreco} {semPreco === 1 ? 'item ativo não tem' : 'itens ativos não têm'} preço unitário — sem preço
          não é possível calcular custo nem €/quarto para esses itens.
        </div>
      )}

      {loading ? <Loading /> : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Nome</th>
                {dept === 'FB' && <th className="th">Ref.</th>}
                {dept === 'FB' && <th className="th">Categoria</th>}
                {dept === 'FB' && <th className="th">Fornecedor</th>}
                {dept !== 'FB' && <th className="th">Contagem</th>}
                <th className="th">Un.</th>
                <th className="th text-right">Preço</th>
                {dept !== 'FB' && <th className="th text-right">Par</th>}
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lista.map(i => (
                <tr key={i.id} className={i.active ? '' : 'opacity-50'}>
                  <td className="td font-medium">{i.name}</td>
                  {dept === 'FB' && <td className="td text-slate-500">{i.ref}</td>}
                  {dept === 'FB' && <td className="td text-slate-500">{i.category}</td>}
                  {dept === 'FB' && <td className="td text-slate-500">{i.supplier}</td>}
                  {dept !== 'FB' && (
                    <td className="td">
                      <span className={`chip ${i.count_frequency === 'mensal'
                        ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
                        {i.count_frequency === 'mensal' ? 'mensal' : 'semanal'}
                      </span>
                    </td>
                  )}
                  <td className="td text-slate-500">{i.unit}</td>
                  <td className={`td text-right tabular-nums ${i.unit_price_eur == null ? 'text-amber-600' : ''}`}>
                    {i.unit_price_eur == null ? 'sem preço' : money(Number(i.unit_price_eur))}
                  </td>
                  {dept !== 'FB' && <td className="td text-right tabular-nums">{i.par_qty ?? '—'}</td>}
                  <td className="td whitespace-nowrap text-right">
                    <button className="text-sm text-brand-600 hover:underline" onClick={() => setEdit(i)}>editar</button>
                    <button className="ml-3 text-sm text-slate-400 hover:underline" onClick={() => alternarAtivo(i)}>
                      {i.active ? 'desativar' : 'ativar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lista.length === 0 && <div className="p-8 text-center text-sm text-slate-500">Sem itens.</div>}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Editar item' : 'Novo item'}>
        {edit && (
          <div className="space-y-3">
            <div>
              <label className="label">Nome *</label>
              <input className="input" value={edit.name ?? ''} onChange={e => setEdit({ ...edit, name: e.target.value })} />
            </div>
            {edit.department === 'FB' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Referência</label>
                  <input className="input" value={edit.ref ?? ''} onChange={e => setEdit({ ...edit, ref: e.target.value })} />
                </div>
                <div>
                  <label className="label">Categoria</label>
                  <input className="input" value={edit.category ?? ''} onChange={e => setEdit({ ...edit, category: e.target.value })} />
                </div>
                <div>
                  <label className="label">Fornecedor</label>
                  <input className="input" value={edit.supplier ?? ''} onChange={e => setEdit({ ...edit, supplier: e.target.value })} />
                </div>
              </div>
            )}
            {edit.department !== 'FB' && (
              <div>
                <label className="label">Periodicidade da contagem</label>
                <div className="flex gap-2">
                  {(['semanal', 'mensal'] as const).map(f => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setEdit({ ...edit, count_frequency: f })}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                        edit.count_frequency === f
                          ? 'border-brand-500 bg-brand-50 text-brand-700'
                          : 'border-slate-300 bg-white text-slate-600'}`}
                    >
                      {f === 'semanal' ? 'Semanal' : 'Mensal'}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Define em que lista de contagem este item aparece. Mudar a periodicidade não
                  altera as contagens já feitas.
                </p>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">Unidade</label>
                <input className="input" value={edit.unit ?? 'Un'} onChange={e => setEdit({ ...edit, unit: e.target.value })} />
              </div>
              <div>
                <label className="label">Preço unitário (€)</label>
                <NumInput value={Number(edit.unit_price_eur ?? 0)}
                          onChange={n => setEdit({ ...edit, unit_price_eur: n || null })} />
              </div>
              <div>
                <label className="label">Par (stock ideal)</label>
                <NumInput value={Number(edit.par_qty ?? 0)}
                          onChange={n => setEdit({ ...edit, par_qty: n || null })} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.active ?? true}
                     onChange={e => setEdit({ ...edit, active: e.target.checked })} />
              Item ativo
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-ghost" onClick={() => setEdit(null)}>Cancelar</button>
              <button className="btn-primary" onClick={guardar}>Guardar</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
