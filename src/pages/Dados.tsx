import { useState } from 'react'
import { useApp } from '../lib/appState'
import { supabase } from '../lib/supabase'
import { fetchVCounts } from '../lib/data'
import { downloadCSV } from '../lib/format'
import { useToast } from '../components/ui'
import type { Department } from '../lib/types'

/** Divide uma linha CSV respeitando aspas. Aceita ; ou , como separador. */
function parseLinha(l: string, sep: string) {
  const out: string[] = []
  let cur = '', dentro = false
  for (let i = 0; i < l.length; i++) {
    const c = l[i]
    if (c === '"') {
      if (dentro && l[i + 1] === '"') { cur += '"'; i++ } else dentro = !dentro
    } else if (c === sep && !dentro) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map(s => s.trim())
}

const num = (s: string) => {
  const v = Number(String(s ?? '').replace(/\s/g, '').replace(',', '.'))
  return Number.isFinite(v) ? v : 0
}

export default function Dados() {
  const { hotelId, hotels } = useApp()
  const toast = useToast()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const escrever = (s: string) => setLog(l => [...l, s])

  const exportarTudo = async () => {
    setBusy(true)
    try {
      const rows = await fetchVCounts({ hotelId: hotelId ?? undefined })
      downloadCSV(`inventario_completo_${hotels.find(h => h.id === hotelId)?.slug ?? ''}.csv`, [
        ['departamento', 'tipo', 'periodo_inicio', 'periodo_fim', 'quartos_ocupados', 'item',
         'referencia', 'categoria', 'fornecedor', 'unidade', 'preco_unitario_eur',
         'inv_inicial', 'recebido_encomendas', 'outras_entradas', 'valor_pago_eur',
         'inv_final', 'quebras', 'motivo', 'comentario',
         'utilizado', 'custo_utilizado_eur', 'valor_stock_eur', 'custo_por_quarto_eur'],
        ...rows.map(r => [
          r.department, r.kind, r.start_date, r.end_date, r.occupied_rooms, r.item_name,
          r.ref, r.category, r.supplier, r.unit, r.unit_price_eur,
          r.opening_qty, r.received_qty, r.purchased_qty, r.amount_paid_eur,
          r.closing_qty, r.quebras, r.motivo, r.comentario,
          r.used_qty, r.cost_used_eur, r.stock_value_eur, r.cost_per_room_eur,
        ]),
      ])
      toast(`${rows.length} linhas exportadas`)
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setBusy(false) }
  }

  const importar = async (file: File) => {
    if (!hotelId) return
    setBusy(true); setLog([])
    try {
      const texto = await file.text()
      const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
      const sep = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ';' : ','
      const cab = parseLinha(linhas[0], sep).map(h => h.toLowerCase())
      const idx = (n: string) => cab.indexOf(n)

      const obrig = ['departamento', 'item', 'periodo_inicio']
      const faltam = obrig.filter(c => idx(c) === -1)
      if (faltam.length) throw new Error(`Faltam colunas obrigatórias: ${faltam.join(', ')}`)

      escrever(`${linhas.length - 1} linhas a processar…`)

      const itemCache = new Map<string, string>()
      const periodCache = new Map<string, string>()
      let ok = 0, erros = 0

      for (let n = 1; n < linhas.length; n++) {
        const c = parseLinha(linhas[n], sep)
        const dep = (c[idx('departamento')] || '').toUpperCase() as Department
        if (!['FO', 'HSK', 'FB'].includes(dep)) { erros++; escrever(`linha ${n + 1}: departamento inválido`); continue }
        const nome = c[idx('item')]
        const inicio = c[idx('periodo_inicio')]
        if (!nome || !inicio) { erros++; continue }

        // item
        const chaveItem = `${dep}|${nome}`
        let itemId = itemCache.get(chaveItem)
        if (!itemId) {
          let q = supabase.from('items').select('id').eq('department', dep).eq('name', nome)
          q = dep === 'FB' ? q.is('hotel_id', null) : q.eq('hotel_id', hotelId)
          const { data } = await q.maybeSingle()
          if (data) itemId = data.id
          else {
            const { data: novo, error } = await supabase.from('items').insert({
              department: dep, hotel_id: dep === 'FB' ? null : hotelId, name: nome,
              unit_price_eur: idx('preco_unitario_eur') > -1 ? num(c[idx('preco_unitario_eur')]) || null : null,
              is_custom: true,
            }).select('id').single()
            if (error) { erros++; escrever(`linha ${n + 1}: ${error.message}`); continue }
            itemId = novo.id
          }
          itemCache.set(chaveItem, itemId!)
        }

        // período
        const fim = idx('periodo_fim') > -1 && c[idx('periodo_fim')] ? c[idx('periodo_fim')] : inicio
        const chaveP = `${dep}|${inicio}`
        let periodId = periodCache.get(chaveP)
        if (!periodId) {
          const { data } = await supabase.from('periods').select('id')
            .eq('hotel_id', hotelId).eq('department', dep).eq('start_date', inicio).maybeSingle()
          if (data) periodId = data.id
          else {
            const { data: novo, error } = await supabase.from('periods').insert({
              hotel_id: hotelId, department: dep,
              kind: dep === 'FB' ? 'mensal' : 'semanal',
              start_date: inicio, end_date: fim,
              label: dep === 'FB' ? inicio.slice(0, 7) : inicio,
              occupied_rooms: idx('quartos_ocupados') > -1 && c[idx('quartos_ocupados')]
                ? num(c[idx('quartos_ocupados')]) : null,
            }).select('id').single()
            if (error) { erros++; escrever(`linha ${n + 1}: ${error.message}`); continue }
            periodId = novo.id
          }
          periodCache.set(chaveP, periodId!)
        }

        const { error } = await supabase.from('counts').upsert({
          period_id: periodId, item_id: itemId,
          opening_qty: idx('inv_inicial') > -1 ? num(c[idx('inv_inicial')]) : 0,
          purchased_qty: idx('comprado') > -1 ? num(c[idx('comprado')]) : 0,
          amount_paid_eur: idx('valor_pago_eur') > -1 ? num(c[idx('valor_pago_eur')]) : 0,
          closing_qty: idx('inv_final') > -1 ? num(c[idx('inv_final')]) : 0,
          quebras: idx('quebras') > -1 ? num(c[idx('quebras')]) : 0,
          closing_counted: true,
        }, { onConflict: 'period_id,item_id' })
        if (error) { erros++; escrever(`linha ${n + 1}: ${error.message}`) } else ok++
      }
      escrever(`Concluído: ${ok} linhas importadas, ${erros} com erro.`)
      toast(`${ok} linhas importadas`)
    } catch (e) {
      escrever(`Erro: ${(e as Error).message}`)
      toast((e as Error).message, 'erro')
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Importar e exportar</h1>
        <p className="text-sm text-slate-500">
          Dados do hotel {hotels.find(h => h.id === hotelId)?.name}.
        </p>
      </div>

      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Exportar</h2>
        <p className="text-sm text-slate-600">
          Gera um CSV com todas as contagens e valores já calculados (utilizado, custo, €/quarto).
          Abre diretamente no Excel.
        </p>
        <button className="btn-primary" onClick={exportarTudo} disabled={busy}>Exportar tudo em CSV</button>
      </div>

      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-semibold">Importar</h2>
        <p className="text-sm text-slate-600">
          Colunas aceites (a primeira linha é o cabeçalho, separador <code>;</code> ou <code>,</code>):
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
departamento;item;periodo_inicio;periodo_fim;quartos_ocupados;inv_inicial;comprado;valor_pago_eur;inv_final;quebras;preco_unitario_eur
HSK;Toucas;2026-08-03;2026-08-09;312;120;0;0;96;0;0,1085</pre>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
          <li><strong>departamento</strong>, <strong>item</strong> e <strong>periodo_inicio</strong> são obrigatórios.</li>
          <li>Itens e períodos que não existam são criados automaticamente.</li>
          <li>Se já existir contagem para o mesmo item e período, é substituída.</li>
        </ul>
        <input
          type="file" accept=".csv,text/csv" disabled={busy}
          onChange={e => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = '' }}
          className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-500 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
        />
      </div>

      {log.length > 0 && (
        <div className="card max-h-72 overflow-y-auto p-4">
          <h2 className="mb-2 text-sm font-semibold">Registo</h2>
          <pre className="whitespace-pre-wrap text-xs text-slate-600">{log.join('\n')}</pre>
        </div>
      )}
    </div>
  )
}
