import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../lib/appState'
import {
  agrupar, custo, fetchDepartamentos, fetchEmpregados, fetchEmpresas, fetchParametros,
  jaSaiu, pct, somar, vaiSair,
  type Departamento, type Empregado, type Empresa, type Grupo, type Parametros,
} from '../lib/hr'
import { money, dmy } from '../lib/format'
import { Loading, StatCard } from '../components/ui'

type Escala = 'mes' | 'ano'

export default function RhCustos() {
  const { hotels } = useApp()
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [deps, setDeps] = useState<Departamento[]>([])
  const [pessoas, setPessoas] = useState<Empregado[]>([])
  const [param, setParam] = useState<Parametros | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [escala, setEscala] = useState<Escala>('mes')
  const [comBaixas, setComBaixas] = useState(false)

  useEffect(() => {
    Promise.all([
      fetchEmpresas(), fetchDepartamentos(), fetchEmpregados(),
      fetchParametros(new Date().getFullYear()),
    ])
      .then(([es, ds, ps, pa]) => { setEmpresas(es); setDeps(ds); setPessoas(ps); setParam(pa) })
      .catch(e => setErro((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const nomes = useMemo(() => ({
    empresa: Object.fromEntries(empresas.map(e => [e.id, e.nome])),
    hotel: Object.fromEntries(hotels.map(h => [h.id, h.name])),
    dep: Object.fromEntries(deps.map(d => [d.id, d.nome])),
  }), [empresas, hotels, deps])

  const ativas = useMemo(() => pessoas.filter(p => !jaSaiu(p)), [pessoas])

  const grupos = useMemo(() => {
    if (!param) return null
    return {
      empresa: agrupar(ativas, param, p => p.empresa_id, nomes.empresa, 'Sem empresa'),
      hotel: agrupar(ativas, param, p => p.hotel_id, nomes.hotel, 'Sem hotel atribuído'),
      dep: agrupar(ativas, param, p => p.departamento_id, nomes.dep, 'Sem departamento'),
    }
  }, [ativas, param, nomes])

  const total = useMemo(() => (param ? somar(ativas, param) : null), [ativas, param])

  if (loading) return <Loading />
  if (erro) {
    return (
      <div className="card p-6 text-sm">
        <h2 className="mb-2 font-semibold text-red-600">Não foi possível abrir os custos</h2>
        <p className="text-slate-600">{erro}</p>
      </div>
    )
  }
  if (!param || !grupos || !total) return null

  const f = escala === 'ano' ? 12 : 1
  const v = (n: number) => money(n * f)

  const porPreencher = ativas.filter(p => p.vencimento_base <= 0)
  const semDep = ativas.filter(p => !p.departamento_id)
  const semHotel = ativas.filter(p => !p.hotel_id)
  const baixas = pessoas.filter(p => p.estado === 'baixa')
  const saidas = pessoas.filter(p => vaiSair(p, 90))
    .sort((a, b) => (a.data_saida ?? '').localeCompare(b.data_saida ?? ''))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          {(['mes', 'ano'] as Escala[]).map(e => (
            <button key={e} onClick={() => setEscala(e)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      escala === e ? 'bg-white text-brand-700 shadow-sm' : 'text-slate-500'}`}>
              {e === 'mes' ? 'Por mês' : 'Por ano'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={comBaixas} onChange={e => setComBaixas(e.target.checked)} />
          contar as baixas ao custo cheio
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={`Custo de empresa / ${escala === 'ano' ? 'ano' : 'mês'}`}
                  value={v(comBaixas ? total.pleno : total.total)} tone="brand"
                  hint={`${ativas.length} pessoas ao serviço`} />
        <StatCard label="Remunerações" value={v(total.bruto)}
                  hint="o que as pessoas recebem" />
        <StatCard label="Encargos" value={v(total.encargos)}
                  hint={`TSU ${pct(param.tsu)} + seguro ${pct(param.seguro_at)}`} />
        <StatCard label="Custo médio por pessoa"
                  value={v(ativas.length ? total.total / ativas.length : 0)} />
      </div>

      {porPreencher.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>{porPreencher.length} pessoas ainda sem vencimento.</strong> Os totais acima só
          contam quem já tem os valores preenchidos, por isso vão subir à medida que preencheres:
          {' '}{porPreencher.slice(0, 6).map(p => p.nome).join(', ')}
          {porPreencher.length > 6 && ` e mais ${porPreencher.length - 6}`}.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Quadro titulo="Por empresa" nota="a entidade com que a pessoa tem contrato"
                linhas={grupos.empresa} total={total.total} escala={f} />
        <Quadro titulo="Por hotel" nota="onde a pessoa trabalha, independentemente do contrato"
                linhas={grupos.hotel} total={total.total} escala={f}
                alerta={semHotel.length ? `${semHotel.length} sem hotel atribuído` : undefined} />
        <Quadro titulo="Por departamento" linhas={grupos.dep} total={total.total} escala={f}
                alerta={semDep.length ? `${semDep.length} sem departamento` : undefined} />

        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-700">A acompanhar</h3>

          <div className="mt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Em baixa médica · {baixas.length}
            </div>
            {baixas.length === 0
              ? <p className="mt-1 text-sm text-slate-400">Ninguém.</p>
              : (
                <ul className="mt-1 space-y-1 text-sm">
                  {baixas.map(p => {
                    const c = custo(p, param)
                    return (
                      <li key={p.id} className="flex justify-between gap-2">
                        <span className="text-slate-700">{p.nome}</span>
                        <span className="tabular-nums text-slate-500">
                          {money(c.total * f)} <span className="text-amber-600">
                            (−{money((c.pleno - c.total) * f)})</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Saídas nos próximos 90 dias · {saidas.length}
            </div>
            {saidas.length === 0
              ? <p className="mt-1 text-sm text-slate-400">Nenhuma marcada.</p>
              : (
                <ul className="mt-1 space-y-1 text-sm">
                  {saidas.map(p => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="text-slate-700">{p.nome}</span>
                      <span className="tabular-nums text-slate-500">
                        {dmy(p.data_saida!)} · −{money(custo(p, param).total * f)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Quadro({
  titulo, nota, linhas, total, escala, alerta,
}: {
  titulo: string
  nota?: string
  linhas: Grupo[]
  total: number
  escala: number
  alerta?: string
}) {
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{titulo}</h3>
        {alerta && <span className="text-xs text-amber-600">{alerta}</span>}
      </div>
      {nota && <p className="text-xs text-slate-400">{nota}</p>}

      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
            <th className="pb-1 font-medium"></th>
            <th className="pb-1 text-right font-medium">Pessoas</th>
            <th className="pb-1 text-right font-medium">Remunerações</th>
            <th className="pb-1 text-right font-medium">Encargos</th>
            <th className="pb-1 text-right font-medium">Custo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(l => (
            <tr key={l.id} className="border-t border-slate-100">
              <td className="py-1.5">
                <div className="text-slate-700">{l.nome}</div>
                <div className="mt-0.5 h-1 w-full max-w-[140px] rounded-full bg-slate-100">
                  <div className="h-1 rounded-full bg-brand-500"
                       style={{ width: `${total ? Math.max(2, (l.total / total) * 100) : 0}%` }} />
                </div>
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-500">{l.pessoas}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-500">{money(l.bruto * escala)}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-500">{money(l.encargos * escala)}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums text-slate-800">
                {money(l.total * escala)}
                <div className="text-[11px] font-normal text-slate-400">
                  {total ? `${Math.round((l.total / total) * 100)}%` : '—'}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
