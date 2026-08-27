import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  fetchDepartamentos, fetchEmpresas, fetchParametros, guardarParametros, pct,
  type Departamento, type Empresa, type Parametros,
} from '../lib/hr'
import { money } from '../lib/format'
import { Loading, NumInput, useToast } from '../components/ui'

export default function RhDefinicoes() {
  const toast = useToast()
  const [ano, setAno] = useState(new Date().getFullYear())
  const [p, setP] = useState<Parametros | null>(null)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [deps, setDeps] = useState<Departamento[]>([])
  const [loading, setLoading] = useState(true)
  const [anos, setAnos] = useState<number[]>([])

  const carregar = () =>
    Promise.all([
      supabase.from('hr_parametros').select('ano').order('ano'),
      fetchEmpresas(), fetchDepartamentos(), fetchParametros(ano),
    ]).then(([as, es, ds, pa]) => {
      setAnos((as.data ?? []).map(r => Number(r.ano)))
      setEmpresas(es); setDeps(ds); setP(pa)
    }).finally(() => setLoading(false))

  useEffect(() => { carregar() }, [ano])

  const mudar = (patch: Partial<Parametros>) => setP(x => (x ? { ...x, ...patch } : x))
  const taxa = (k: keyof Parametros) => (n: number) => mudar({ [k]: n / 100 } as Partial<Parametros>)

  if (loading || !p) return <Loading />

  const total = p.tsu + p.seguro_at + p.fundos

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Ano</label>
            <select className="input w-auto" value={ano} onChange={e => setAno(Number(e.target.value))}>
              {[...new Set([...anos, ano, new Date().getFullYear() + 1])].sort()
                .map(a => <option key={a} value={a}>{a}{anos.includes(a) ? '' : ' (novo)'}</option>)}
            </select>
          </div>
          <p className="flex-1 text-xs text-slate-500">
            Estes valores são a única fonte das percentagens usadas nos custos. Quando a lei mudar,
            cria o ano novo aqui — os anos anteriores ficam guardados como estavam.
            {p.ano !== ano && (
              <strong className="block text-amber-700">
                Ainda não há parâmetros para {ano}; estás a ver os de {p.ano}. Grava para criar {ano}.
              </strong>
            )}
          </p>
          <button
            className="btn-primary"
            onClick={async () => {
              try {
                await guardarParametros({ ...p, ano })
                toast(`Parâmetros de ${ano} guardados`)
                setLoading(true); carregar()
              } catch (e) { toast((e as Error).message, 'erro') }
            }}
          >
            Guardar {ano}
          </button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Encargos da entidade patronal
            </h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="label">TSU (%)</label>
                <NumInput value={p.tsu * 100} onChange={taxa('tsu')} />
              </div>
              <div>
                <label className="label">Seguro AT (%)</label>
                <NumInput value={p.seguro_at * 100} onChange={taxa('seguro_at')} />
              </div>
              <div>
                <label className="label">Fundos FCT/FGCT (%)</label>
                <NumInput value={p.fundos * 100} onChange={taxa('fundos')} />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Total aplicado: <strong>{pct(total)}</strong>. Em 2026 o FCT está extinto e o FGCT
              suspenso, por isso o normal é ficar a zero. O seguro de acidentes de trabalho varia
              com a apólice — 1% é uma média.
            </p>
          </div>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Subsídio de alimentação — limites isentos por dia
            </h4>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label">Em dinheiro (€)</label>
                <NumInput value={p.limite_alim_dinheiro}
                          onChange={n => mudar({ limite_alim_dinheiro: n })} />
              </div>
              <div>
                <label className="label">Em cartão (€)</label>
                <NumInput value={p.limite_alim_cartao}
                          onChange={n => mudar({ limite_alim_cartao: n })} />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Só a parte acima do limite paga TSU. Valores de 2026:
              {' '}{money(6.15)} em dinheiro, {money(10.46)} em cartão.
            </p>
          </div>

          <div className="md:col-span-2">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Quantas vezes por ano se paga cada coisa
            </h4>
            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="label">Alimentação (meses)</label>
                <NumInput value={p.meses_alimentacao} onChange={n => mudar({ meses_alimentacao: n })} />
              </div>
              <div>
                <label className="label">Complementos (meses)</label>
                <NumInput value={p.meses_complementos} onChange={n => mudar({ meses_complementos: n })} />
              </div>
              <div>
                <label className="label">Abono para falhas (meses)</label>
                <NumInput value={p.meses_abono} onChange={n => mudar({ meses_abono: n })} />
              </div>
              <div>
                <label className="label">Abono isento até (% do base)</label>
                <NumInput value={p.isencao_abono_pct * 100} onChange={taxa('isencao_abono_pct')} />
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Complementos = línguas, isenção de horário e outros. Por defeito 14 meses, porque
              costumam entrar nos subsídios de férias e de Natal; o abono para falhas fica em 12,
              porque não. A alimentação em 11 meses assume um mês de férias sem subsídio.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ListaSimples
          titulo="Empresas"
          nota="entidades empregadoras. Não se apagam se tiverem pessoas."
          linhas={empresas.map(e => ({ id: e.id, nome: e.nome }))}
          tabela="hr_empresas"
          onMudou={carregar}
        />
        <ListaSimples
          titulo="Departamentos"
          linhas={deps.map(d => ({ id: d.id, nome: d.nome }))}
          tabela="hr_departamentos"
          onMudou={carregar}
        />
      </div>
    </div>
  )
}

function ListaSimples({
  titulo, nota, linhas, tabela, onMudou,
}: {
  titulo: string
  nota?: string
  linhas: { id: string; nome: string }[]
  tabela: 'hr_empresas' | 'hr_departamentos'
  onMudou: () => void
}) {
  const toast = useToast()
  const [novo, setNovo] = useState('')

  const acao = async (fn: () => PromiseLike<{ error: unknown }>) => {
    const { error } = await fn()
    if (error) toast((error as { message?: string }).message ?? 'Não foi possível guardar', 'erro')
    else onMudou()
  }

  return (
    <div className="card p-4">
      <h3 className="text-sm font-semibold text-slate-700">{titulo}</h3>
      {nota && <p className="text-xs text-slate-400">{nota}</p>}

      <div className="mt-2 space-y-1.5">
        {linhas.map((l, i) => (
          <div key={l.id} className="flex items-center gap-2">
            <input
              className="input h-9 text-sm"
              defaultValue={l.nome}
              onBlur={e => {
                const nome = e.target.value.trim()
                if (nome && nome !== l.nome) {
                  acao(() => supabase.from(tabela).update({ nome }).eq('id', l.id))
                }
              }}
            />
            <button
              className="shrink-0 rounded-lg px-2 py-1 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="Apagar"
              onClick={() => {
                if (!confirm(`Apagar "${l.nome}"?`)) return
                acao(() => supabase.from(tabela).delete().eq('id', l.id))
              }}
            >✕</button>
            <span className="w-4 shrink-0 text-right text-[11px] text-slate-300">{i + 1}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <input className="input h-9 text-sm" placeholder="Acrescentar…" value={novo}
               onChange={e => setNovo(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        <button
          className="btn-ghost shrink-0"
          disabled={!novo.trim()}
          onClick={() => {
            const nome = novo.trim()
            setNovo('')
            acao(() => supabase.from(tabela).insert({ nome, ordem: linhas.length + 1 }))
          }}
        >
          Juntar
        </button>
      </div>
    </div>
  )
}
