import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import {
  ESTADOS, TIPOS_CONTRATO, alimentacaoDe, apagarEmpregado, criarEmpregado, custo,
  fetchDepartamentos, fetchEmpregados, fetchEmpresas, fetchParametros,
  guardarEmpregado, guardarEmpregados, hotelCurto, jaSaiu, pct, porId, somar, vaiSair,
  type Departamento, type Empregado, type Empresa, type Empresas, type Estado,
  type Parametros,
} from '../lib/hr'
import { money, dmy } from '../lib/format'
import { Loading, Modal, NumInput, Spinner, StatCard, TextoAuto, useToast } from '../components/ui'
import BulkEdit, { Caixa, type CampoBulk } from '../components/BulkEdit'
import { useSeleccao } from '../lib/seleccao'

const CORES_ESTADO: Record<Estado, string> = {
  activo: 'bg-slate-100 text-slate-600',
  baixa: 'bg-amber-100 text-amber-800',
  saiu: 'bg-slate-200 text-slate-500',
}

export default function Rh() {
  const { hotels } = useApp()
  const { email } = useAuth()
  const toast = useToast()

  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [deps, setDeps] = useState<Departamento[]>([])
  const [pessoas, setPessoas] = useState<Empregado[]>([])
  const [param, setParam] = useState<Parametros | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [saving, setSaving] = useState(0)

  const [busca, setBusca] = useState('')
  const [fEmpresa, setFEmpresa] = useState('')
  const [fHotel, setFHotel] = useState('')
  const [fDep, setFDep] = useState('')
  const [fEstado, setFEstado] = useState('')
  const [semSalario, setSemSalario] = useState(false)
  const [ficha, setFicha] = useState<string | null>(null)
  const [novo, setNovo] = useState(false)

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pessoasRef = useRef<Empregado[]>([])
  pessoasRef.current = pessoas

  useEffect(() => {
    Promise.all([
      fetchEmpresas(), fetchDepartamentos(), fetchEmpregados(),
      fetchParametros(new Date().getFullYear()),
    ])
      .then(([es, ds, ps, pa]) => { setEmpresas(es); setDeps(ds); setPessoas(ps); setParam(pa) })
      .catch(e => setErro((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const porEmpresa = useMemo(() => porId(empresas), [empresas])
  const nomeEmpresa = useMemo(
    () => Object.fromEntries(empresas.map(e => [e.id, e.nome])), [empresas])
  const nomeHotel = useMemo(
    () => Object.fromEntries(hotels.map(h => [h.id, h.name])), [hotels])
  const nomeDep = useMemo(
    () => Object.fromEntries(deps.map(d => [d.id, d.nome])), [deps])
  const funcoes = useMemo(
    () => [...new Set(pessoas.map(p => p.funcao).filter(Boolean))].sort() as string[],
    [pessoas])

  /** Guarda com atraso, para escrever à vontade sem uma gravação por tecla. */
  const alterar = (id: string, patch: Partial<Empregado>) => {
    setPessoas(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)))
    clearTimeout(timers.current[id])
    timers.current[id] = setTimeout(async () => {
      setSaving(s => s + 1)
      try {
        const atual = pessoasRef.current.find(p => p.id === id)
        if (atual) await guardarEmpregado(id, semChaves(atual), email)
      } catch (e) {
        toast((e as Error).message, 'erro')
      } finally { setSaving(s => s - 1) }
    }, 600)
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return pessoas.filter(p =>
      (!q || p.nome.toLowerCase().includes(q) || String(p.numero ?? '').includes(q) ||
        (p.funcao ?? '').toLowerCase().includes(q)) &&
      (!fEmpresa || p.empresa_id === fEmpresa) &&
      (!fHotel || (fHotel === '—' ? !p.hotel_id : p.hotel_id === fHotel)) &&
      (!fDep || (fDep === '—' ? !p.departamento_id : p.departamento_id === fDep)) &&
      (!fEstado || p.estado === fEstado) &&
      (!semSalario || p.vencimento_base <= 0))
  }, [pessoas, busca, fEmpresa, fHotel, fDep, fEstado, semSalario])

  const totais = useMemo(
    () => (param ? somar(filtradas.filter(p => !jaSaiu(p)), param, porEmpresa) : null),
    [filtradas, param, porEmpresa])

  const ids = useMemo(() => filtradas.map(p => p.id), [filtradas])
  const sel = useSeleccao(ids)
  const [aAplicar, setAAplicar] = useState(false)

  // Só os campos que fazem sentido dar a várias pessoas ao mesmo tempo. O nome
  // e o número não vêm aqui de propósito: são de cada um.
  const camposBulk: CampoBulk[] = [
    { chave: 'departamento_id', rotulo: 'Departamento', tipo: 'escolha',
      opcoes: deps.map(d => ({ v: d.id, rot: d.nome })),
      patch: v => ({ departamento_id: v || null }) },
    { chave: 'hotel_id', rotulo: 'Hotel', tipo: 'escolha',
      opcoes: hotels.map(h => ({ v: h.id, rot: h.name })),
      patch: v => ({ hotel_id: v || null }) },
    { chave: 'empresa_id', rotulo: 'Empresa', tipo: 'escolha',
      opcoes: empresas.map(e => ({ v: e.id, rot: e.nome })),
      nota: 'A empresa manda no subsídio de alimentação de quem não tiver valor próprio.',
      patch: v => ({ empresa_id: v }) },
    { chave: 'estado', rotulo: 'Estado', tipo: 'escolha',
      opcoes: ESTADOS.map(e => ({ v: e.v, rot: e.rot })),
      patch: v => ({ estado: v as Estado }) },
    { chave: 'funcao', rotulo: 'Função', tipo: 'texto',
      patch: v => ({ funcao: v.trim() || null }) },
    { chave: 'tipo_contrato', rotulo: 'Tipo de contrato', tipo: 'texto',
      patch: v => ({ tipo_contrato: v.trim() || null }) },
    { chave: 'data_saida', rotulo: 'Data de saída', tipo: 'data',
      nota: 'Deixa o estado como está — marca-se «saiu» à parte, se for o caso.',
      patch: v => ({ data_saida: v || null }) },
    { chave: 'vencimento_base', rotulo: 'Vencimento base', tipo: 'numero',
      patch: v => ({ vencimento_base: Number(v) }) },
    { chave: 'sub_alim_dia', rotulo: 'Subsídio de alimentação / dia', tipo: 'numero',
      nota: 'Zero volta a pôr a pessoa a seguir o valor da empresa.',
      patch: v => ({ sub_alim_dia: Number(v) > 0 ? Number(v) : null }) },
    { chave: 'abono_falhas', rotulo: 'Abono para falhas', tipo: 'numero',
      patch: v => ({ abono_falhas: Number(v) }) },
    { chave: 'sub_linguas', rotulo: 'Subsídio de línguas', tipo: 'numero',
      patch: v => ({ sub_linguas: Number(v) }) },
    { chave: 'isencao_horario', rotulo: 'Isenção de horário', tipo: 'numero',
      patch: v => ({ isencao_horario: Number(v) }) },
    { chave: 'meses_ferias', rotulo: 'Meses de férias', tipo: 'numero',
      patch: v => ({ meses_ferias: Number(v) }) },
    { chave: 'meses_natal', rotulo: 'Meses de Natal', tipo: 'numero',
      patch: v => ({ meses_natal: Number(v) }) },
  ]

  /** Escreve o campo em toda a gente escolhida, numa gravação só. */
  const aplicarBulk = async (patch: Record<string, unknown>) => {
    const alvo = sel.escolhidos()
    if (!alvo.length) return
    setAAplicar(true)
    try {
      await guardarEmpregados(alvo, patch as Partial<Empregado>, email)
      const dentro = new Set(alvo)
      setPessoas(ps => ps.map(p => (dentro.has(p.id) ? { ...p, ...patch } as Empregado : p)))
      toast(`${alvo.length} ${alvo.length === 1 ? 'pessoa alterada' : 'pessoas alteradas'}`)
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setAAplicar(false) }
  }

  const porPreencher = pessoas.filter(p => !jaSaiu(p) && p.vencimento_base <= 0).length
  const aSair = pessoas.filter(p => vaiSair(p)).length
  const emBaixa = pessoas.filter(p => p.estado === 'baixa').length

  if (loading) return <Loading />
  if (erro) {
    return (
      <div className="card p-6 text-sm">
        <h2 className="mb-2 font-semibold text-red-600">Não foi possível abrir os recursos humanos</h2>
        <p className="text-slate-600">{erro}</p>
      </div>
    )
  }
  if (!param) return null

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pessoas ao serviço" value={totais?.pessoas ?? 0}
                  hint={emBaixa || aSair
                    ? `inclui ${emBaixa} em baixa · ${aSair} com saída marcada`
                    : 'todas activas'} />
        <StatCard label="Custo de empresa / mês" value={money(totais?.total ?? 0)} tone="brand"
                  hint={`${money(totais?.bruto ?? 0)} + ${money(totais?.encargos ?? 0)} de encargos`} />
        <StatCard label="Custo / ano" value={money((totais?.total ?? 0) * 12)}
                  hint="mês médio × 12, já com férias e Natal" />
        <StatCard
          label="Por preencher"
          value={porPreencher}
          tone={porPreencher ? 'warn' : 'default'}
          hint="pessoas ainda sem vencimento definido" 
        />
      </div>

      {/* filtros */}
      <div className="card flex flex-wrap items-end gap-2 p-3">
        <input className="input min-w-[200px] flex-1" placeholder="Procurar por nome, nº ou função…"
               value={busca} onChange={e => setBusca(e.target.value)} />
        <select className="input w-auto" value={fEmpresa} onChange={e => setFEmpresa(e.target.value)}>
          <option value="">Todas as empresas</option>
          {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
        <select className="input w-auto" value={fHotel} onChange={e => setFHotel(e.target.value)}>
          <option value="">Todos os hotéis</option>
          {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          <option value="—">Sem hotel</option>
        </select>
        <select className="input w-auto" value={fDep} onChange={e => setFDep(e.target.value)}>
          <option value="">Todos os departamentos</option>
          {deps.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
          <option value="—">Sem departamento</option>
        </select>
        <select className="input w-auto" value={fEstado} onChange={e => setFEstado(e.target.value)}>
          <option value="">Todos os estados</option>
          {ESTADOS.map(e => <option key={e.v} value={e.v}>{e.rot}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600">
          <input type="checkbox" checked={semSalario} onChange={e => setSemSalario(e.target.checked)} />
          só por preencher
        </label>
        <div className="ml-auto flex items-center gap-2">
          {saving > 0 && <span className="flex items-center gap-1 text-sm text-slate-500"><Spinner /> a guardar</span>}
          <button className="btn-primary" onClick={() => setNovo(true)}>Nova pessoa</button>
        </div>
      </div>

      {/* lista */}
      <div className="card">
        <table className="w-full table-fixed text-sm">
          <colgroup>
            <col style={{ width: '4%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '10%' }} />
          </colgroup>
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="th">
                <Caixa
                  ligada={sel.n > 0 && sel.n === filtradas.length}
                  titulo={sel.n ? 'desescolher tudo' : 'escolher todos os que estão à vista'}
                  onAlternar={() => (sel.n ? sel.nenhum() : sel.todos())}
                />
              </th>
              <th className="th">Nome</th>
              <th className="th">Função</th>
              <th className="th">Departamento</th>
              <th className="th">Hotel</th>
              <th className="th">Estado</th>
              <th className="th text-right">Base</th>
              <th className="th text-right">Custo/mês</th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map(p => {
              const c = custo(p, param, porEmpresa)
              const saiu = jaSaiu(p)
              return (
                <tr key={p.id} className={`border-b border-slate-100 ${
                  saiu ? 'opacity-50' : ''} ${sel.tem(p.id) ? 'bg-brand-50' : ''}`}>
                  <td className="td align-top pt-3">
                    <Caixa ligada={sel.tem(p.id)}
                           onAlternar={com => sel.alternar(p.id, com)} />
                  </td>
                  <td className="td align-top">
                    <button className="text-left font-medium text-slate-800 hover:text-brand-700"
                            onClick={() => setFicha(p.id)}>
                      {p.numero != null && (
                        <span className="mr-1.5 tabular-nums font-normal text-slate-400">
                          {p.numero}
                        </span>
                      )}
                      {p.nome}
                    </button>
                    <div className="text-[11px] text-slate-400">
                      {nomeEmpresa[p.empresa_id] ?? '—'}
                      {vaiSair(p) && <span className="ml-1 text-amber-600">· sai a {dmy(p.data_saida!)}</span>}
                    </div>
                  </td>
                  <td className="td align-top">
                    <CampoFuncao
                      valor={p.funcao ?? ''}
                      sugestoes={funcoes}
                      onMudar={v => alterar(p.id, { funcao: v || null })}
                    />
                  </td>
                  <td className="td align-top">
                    <select className="input px-2 py-1.5 text-sm" value={p.departamento_id ?? ''}
                            title={nomeDep[p.departamento_id ?? ''] ?? ''}
                            onChange={e => alterar(p.id, { departamento_id: e.target.value || null })}>
                      <option value="">—</option>
                      {deps.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
                    </select>
                  </td>
                  <td className="td align-top">
                    <select className="input px-2 py-1.5 text-sm" value={p.hotel_id ?? ''}
                            title={nomeHotel[p.hotel_id ?? ''] ?? ''}
                            onChange={e => alterar(p.id, { hotel_id: e.target.value || null })}>
                      <option value="">—</option>
                      {hotels.map(h => (
                        <option key={h.id} value={h.id}>{hotelCurto(h.name)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="td align-top">
                    <select
                      className={`input px-2 py-1.5 text-sm ${CORES_ESTADO[p.estado]}`}
                      value={p.estado}
                      onChange={e => alterar(p.id, { estado: e.target.value as Estado })}
                    >
                      {ESTADOS.map(e => <option key={e.v} value={e.v}>{e.rot}</option>)}
                    </select>
                  </td>
                  <td className="td align-top text-right">
                    <NumInput className="px-2 py-1.5 text-sm" value={p.vencimento_base}
                              onChange={n => alterar(p.id, { vencimento_base: n })} />
                  </td>
                  <td className="td align-top text-right tabular-nums">
                    <div className="font-semibold text-slate-800">{money(c.total)}</div>
                    {p.estado === 'baixa' && c.pleno > c.total && (
                      <div className="text-[11px] text-amber-600">normal {money(c.pleno)}</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtradas.length === 0 && (
          <div className="p-8 text-center text-sm text-slate-500">Ninguém com estes filtros.</div>
        )}
      </div>

      {sel.n > 0 && (
        <div className="sticky bottom-16 z-20 md:bottom-4">
          <BulkEdit n={sel.n} campos={camposBulk} aGravar={aAplicar}
                    onAplicar={aplicarBulk} onLimpar={sel.nenhum} />
        </div>
      )}

      {ficha && (
        <Ficha
          pessoa={pessoas.find(p => p.id === ficha)!}
          param={param} empresas={empresas} porEmpresa={porEmpresa} deps={deps} funcoes={funcoes}
          hoteis={hotels.map(h => ({ id: h.id, nome: h.name }))}
          onFechar={() => setFicha(null)}
          onMudar={patch => alterar(ficha, patch)}
          onApagar={async () => {
            if (!confirm('Apagar esta ficha? Se a pessoa saiu, é preferível marcar como "Saiu" — o histórico fica.')) return
            await apagarEmpregado(ficha)
            setPessoas(ps => ps.filter(p => p.id !== ficha))
            setFicha(null)
            toast('Ficha apagada')
          }}
        />
      )}

      {novo && (
        <NovaPessoa
          empresas={empresas}
          onFechar={() => setNovo(false)}
          onCriar={async (nome, empresa_id) => {
            const e = await criarEmpregado({ nome, empresa_id })
            setPessoas(ps => [...ps, e].sort((a, b) => a.nome.localeCompare(b.nome, 'pt')))
            setNovo(false)
            setFicha(e.id)
          }}
        />
      )}

      <p className="px-1 text-xs text-slate-400">
        Custo de empresa = vencimento (×{12 + 1 + 1} meses, com férias e Natal) + subsídios +
        TSU {pct(param.tsu)} + seguro de acidentes de trabalho {pct(param.seguro_at)}
        {param.fundos > 0 && <> + fundos {pct(param.fundos)}</>}.
        As taxas e os limites isentos mudam-se em Definições.
      </p>
    </div>
  )
}

/**
 * Função da pessoa: cresce para mostrar o texto todo e sugere as funções que
 * já existem na casa, para não se andar a escrever "Empregado de Andares"
 * vinte vezes nem a inventar variantes que depois não agrupam.
 */
function CampoFuncao({
  valor, sugestoes, onMudar,
}: {
  valor: string
  sugestoes: string[]
  onMudar: (v: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const filtradas = useMemo(() => {
    const q = valor.trim().toLowerCase()
    return sugestoes
      .filter(f => f.toLowerCase() !== q && (!q || f.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [valor, sugestoes])

  return (
    <div className="relative">
      <TextoAuto
        className="px-2 py-1.5 text-sm"
        value={valor}
        onChange={onMudar}
        onFocus={() => setAberto(true)}
        onBlur={() => setAberto(false)}
      />
      {aberto && filtradas.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded-lg
                       border border-slate-200 bg-white py-1 shadow-lg">
          {filtradas.map(f => (
            <li key={f}>
              <button
                type="button"
                className="block w-full px-2.5 py-1 text-left text-sm text-slate-700 hover:bg-brand-50"
                // no mouseDown para o campo não perder o foco antes do clique contar
                onMouseDown={ev => { ev.preventDefault(); onMudar(f); setAberto(false) }}
              >
                {f}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Só as colunas editáveis: a chave e os carimbos de tempo são da base de dados. */
function semChaves(e: Empregado) {
  const fora = new Set(['id', 'criado_em', 'atualizado_em', 'atualizado_por'])
  return Object.fromEntries(
    Object.entries(e).filter(([k]) => !fora.has(k)),
  ) as Partial<Empregado>
}

/* --------------------------------------------------------------------- ficha */

function Ficha({
  pessoa, param, empresas, porEmpresa, deps, hoteis, funcoes, onFechar, onMudar, onApagar,
}: {
  pessoa: Empregado
  param: Parametros
  empresas: Empresa[]
  porEmpresa: Empresas
  deps: Departamento[]
  hoteis: { id: string; nome: string }[]
  funcoes: string[]
  onFechar: () => void
  onMudar: (p: Partial<Empregado>) => void
  onApagar: () => void
}) {
  const c = custo(pessoa, param, porEmpresa)
  const alim = alimentacaoDe(pessoa, porEmpresa)
  const daEmpresa = porEmpresa[pessoa.empresa_id]
  const campo = (k: keyof Empregado) => (n: number) => onMudar({ [k]: n } as Partial<Empregado>)

  return (
    <Modal open onClose={onFechar} title={pessoa.nome} wide>
      <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
        <div className="space-y-5">
          <Bloco titulo="Identificação">
            <Campo rot="Nome" larga>
              <input className="input" value={pessoa.nome}
                     onChange={e => onMudar({ nome: e.target.value })} />
            </Campo>
            <Campo rot="Nº">
              <NumInput value={pessoa.numero ?? 0}
                        onChange={n => onMudar({ numero: n || null })} />
            </Campo>
            <Campo rot="Empresa">
              <select className="input" value={pessoa.empresa_id}
                      onChange={e => onMudar({ empresa_id: e.target.value })}>
                {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
            </Campo>
            <Campo rot="Hotel">
              <select className="input" value={pessoa.hotel_id ?? ''}
                      onChange={e => onMudar({ hotel_id: e.target.value || null })}>
                <option value="">— sem hotel —</option>
                {hoteis.map(h => <option key={h.id} value={h.id}>{h.nome}</option>)}
              </select>
            </Campo>
            <Campo rot="Departamento">
              <select className="input" value={pessoa.departamento_id ?? ''}
                      onChange={e => onMudar({ departamento_id: e.target.value || null })}>
                <option value="">—</option>
                {deps.map(d => <option key={d.id} value={d.id}>{d.nome}</option>)}
              </select>
            </Campo>
            <Campo rot="Função">
              <input className="input" list="hr-funcoes-ficha" value={pessoa.funcao ?? ''}
                     onChange={e => onMudar({ funcao: e.target.value || null })} />
              <datalist id="hr-funcoes-ficha">
                {funcoes.map(f => <option key={f} value={f} />)}
              </datalist>
            </Campo>
            <Campo rot="Tipo de contrato">
              <select className="input" value={pessoa.tipo_contrato ?? ''}
                      onChange={e => onMudar({ tipo_contrato: e.target.value || null })}>
                <option value="">—</option>
                {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Campo>
            <Campo rot="Entrada">
              <input type="date" className="input" value={pessoa.data_entrada ?? ''}
                     onChange={e => onMudar({ data_entrada: e.target.value || null })} />
            </Campo>
            <Campo rot="Saída">
              <input type="date" className="input" value={pessoa.data_saida ?? ''}
                     onChange={e => onMudar({ data_saida: e.target.value || null })} />
            </Campo>
            <Campo rot="Estado" larga>
              <div className="flex flex-wrap gap-2">
                {ESTADOS.map(e => (
                  <button
                    key={e.v}
                    onClick={() => onMudar({ estado: e.v })}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                      pessoa.estado === e.v
                        ? 'bg-brand-500 text-white'
                        : 'border border-slate-200 bg-white text-slate-600'
                    }`}
                  >{e.rot}</button>
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {ESTADOS.find(e => e.v === pessoa.estado)?.desc}
              </p>
            </Campo>
          </Bloco>

          <Bloco titulo="Remuneração">
            <Campo rot="Vencimento base (mês)">
              <NumInput value={pessoa.vencimento_base} onChange={campo('vencimento_base')} />
            </Campo>
            <Campo rot="Meses de subs. de férias">
              <NumInput value={pessoa.meses_ferias} onChange={campo('meses_ferias')} />
            </Campo>
            <Campo rot="Meses de subs. de Natal">
              <NumInput value={pessoa.meses_natal} onChange={campo('meses_natal')} />
            </Campo>
            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Subsídio de alimentação
                </div>
                <label className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={alim.proprio}
                    onChange={ev => onMudar(ev.target.checked
                      // ao destacar da empresa, começa-se pelos valores dela
                      ? { sub_alim_dia: alim.dia, sub_alim_cartao: alim.cartao,
                          sub_alim_dias_mes: alim.dias }
                      : { sub_alim_dia: null, sub_alim_cartao: null, sub_alim_dias_mes: null })}
                  />
                  valor próprio
                </label>
              </div>

              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="label">Por dia (€)</label>
                  <NumInput value={alim.dia} disabled={!alim.proprio}
                            onChange={campo('sub_alim_dia')} />
                </div>
                <div>
                  <label className="label">Dias por mês</label>
                  <NumInput value={alim.dias} disabled={!alim.proprio}
                            onChange={campo('sub_alim_dias_mes')} />
                </div>
                <div>
                  <label className="label">Pago em</label>
                  <select className="input" value={alim.cartao ? 'cartao' : 'dinheiro'}
                          disabled={!alim.proprio}
                          onChange={ev => onMudar({ sub_alim_cartao: ev.target.value === 'cartao' })}>
                    <option value="cartao">Cartão refeição</option>
                    <option value="dinheiro">Dinheiro</option>
                  </select>
                </div>
              </div>

              <p className="mt-1.5 text-xs text-slate-500">
                {alim.proprio
                  ? <>Excepção a {daEmpresa?.nome ?? 'esta empresa'}, que pratica{' '}
                      {money(daEmpresa?.sub_alim_dia ?? 0)}/dia em{' '}
                      {daEmpresa?.sub_alim_cartao ? 'cartão' : 'dinheiro'}.
                      Desliga para voltar à regra da empresa.</>
                  : <>A seguir {daEmpresa?.nome ?? 'a empresa'}. Se lá mudares o valor, esta pessoa
                      acompanha. Liga só se esta pessoa for excepção.</>}
                {' '}Isento de TSU até{' '}
                {money(alim.cartao ? param.limite_alim_cartao : param.limite_alim_dinheiro)}/dia.
              </p>
            </div>
            <Campo rot="Subsídio de línguas">
              <NumInput value={pessoa.sub_linguas} onChange={campo('sub_linguas')} />
            </Campo>
            <Campo rot="Isenção de horário">
              <NumInput value={pessoa.isencao_horario} onChange={campo('isencao_horario')} />
            </Campo>
            <Campo rot="Abono para falhas">
              <NumInput value={pessoa.abono_falhas} onChange={campo('abono_falhas')} />
            </Campo>
            <Campo rot="Outros subsídios">
              <NumInput value={pessoa.outros_subsidios} onChange={campo('outros_subsidios')} />
            </Campo>
            <Campo rot="A que se referem" larga>
              <input className="input" value={pessoa.outros_desc ?? ''}
                     onChange={e => onMudar({ outros_desc: e.target.value || null })} />
            </Campo>
          </Bloco>

          <Bloco titulo="Correções">
            <Campo rot="Taxa TSU própria (%)">
              <NumInput
                value={pessoa.taxa_tsu != null ? pessoa.taxa_tsu * 100 : 0}
                onChange={n => onMudar({ taxa_tsu: n > 0 ? n / 100 : null })}
              />
              <p className="mt-1 text-xs text-slate-400">
                0 = usa a taxa geral ({pct(param.tsu)}). Serve para isenções ou taxas reduzidas.
              </p>
            </Campo>
            <Campo rot="Encargos à mão (mês)">
              <NumInput
                value={pessoa.encargos_manual ?? 0}
                onChange={n => onMudar({ encargos_manual: n > 0 ? n : null })}
              />
              <p className="mt-1 text-xs text-slate-400">
                0 = calcula. Preenche se a contabilidade der outro valor.
              </p>
            </Campo>
            <Campo rot="Notas" larga>
              <textarea className="input min-h-[70px]" value={pessoa.notas ?? ''}
                        onChange={e => onMudar({ notas: e.target.value || null })} />
            </Campo>
          </Bloco>

          <button className="text-sm text-red-600 hover:underline" onClick={onApagar}>
            Apagar ficha
          </button>
        </div>

        {/* conta em direto */}
        <div className="h-fit rounded-xl border border-slate-200 bg-slate-50 p-4 lg:sticky lg:top-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Custo de empresa
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-brand-700">
            {money(c.total)}<span className="text-sm font-normal text-slate-500"> /mês</span>
          </div>
          <div className="text-xs text-slate-500">{money(c.total * 12)} por ano</div>

          {pessoa.estado !== 'activo' && (
            <div className="mt-2 rounded-lg bg-amber-100 px-2.5 py-1.5 text-xs text-amber-800">
              {pessoa.estado === 'baixa'
                ? <>Em baixa. Ao serviço custaria {money(c.pleno)}/mês — poupança de {money(c.pleno - c.total)}.</>
                : <>Fora do quadro. Não entra nos totais.</>}
            </div>
          )}

          <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
            <Linha rot="Vencimento" v={c.base} nota="já com férias e Natal" />
            <Linha rot="Complementos" v={c.complementos} />
            <Linha rot="Abono para falhas" v={c.abono} />
            <Linha rot="Alimentação" v={c.alimentacao} />
            <Linha rot="Bruto" v={c.bruto} forte />
            <Linha rot={`Encargos (${pct(c.taxa)})`} v={c.encargos}
                   nota={c.encargosManuais ? 'valor à mão' : `sobre ${money(c.baseTsu)}`} />
            <Linha rot="Total" v={c.total} forte />
          </dl>
        </div>
      </div>
    </Modal>
  )
}

const Bloco = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
  <div>
    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h4>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
  </div>
)

const Campo = ({ rot, larga, children }: { rot: string; larga?: boolean; children: React.ReactNode }) => (
  <div className={larga ? 'sm:col-span-2' : ''}>
    <label className="label">{rot}</label>
    {children}
  </div>
)

const Linha = ({ rot, v, nota, forte }: { rot: string; v: number; nota?: string; forte?: boolean }) => (
  <div className={`flex items-baseline justify-between gap-2 ${forte ? 'border-t border-slate-200 pt-1 font-semibold' : ''}`}>
    <dt className="text-slate-600">
      {rot}
      {nota && <span className="block text-[11px] text-slate-400">{nota}</span>}
    </dt>
    <dd className="tabular-nums text-slate-800">{money(v)}</dd>
  </div>
)

/* ---------------------------------------------------------------- nova ficha */

function NovaPessoa({
  empresas, onFechar, onCriar,
}: {
  empresas: Empresa[]
  onFechar: () => void
  onCriar: (nome: string, empresaId: string) => Promise<void>
}) {
  const [nome, setNome] = useState('')
  const [empresa, setEmpresa] = useState(empresas[0]?.id ?? '')
  const [aCriar, setACriar] = useState(false)
  const toast = useToast()

  return (
    <Modal open onClose={onFechar} title="Nova pessoa">
      <div className="space-y-3">
        <div>
          <label className="label">Nome</label>
          <input className="input" autoFocus value={nome} onChange={e => setNome(e.target.value)} />
        </div>
        <div>
          <label className="label">Empresa</label>
          <select className="input" value={empresa} onChange={e => setEmpresa(e.target.value)}>
            {empresas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </div>
        <button
          className="btn-primary w-full"
          disabled={!nome.trim() || !empresa || aCriar}
          onClick={async () => {
            setACriar(true)
            try { await onCriar(nome.trim(), empresa) }
            catch (e) { toast((e as Error).message, 'erro'); setACriar(false) }
          }}
        >
          {aCriar ? 'A criar…' : 'Criar e abrir ficha'}
        </button>
      </div>
    </Modal>
  )
}
