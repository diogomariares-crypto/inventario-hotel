import { useRef, useState } from 'react'

export interface Ponto {
  rot: string
  tit?: string
  subTit?: string
  a: number | null
  b: number | null
  parcial?: boolean
  destaque?: boolean
  fds?: boolean
}

const COR_A = '#2a78d6'   // ano atual
const COR_B = '#eb6834'   // ano anterior

/**
 * Barras lado a lado: ano atual contra o anterior.
 * Um eixo só — as duas séries são sempre da mesma métrica.
 */
export default function BarrasAno({
  dados, ano, ant, fmt, altura = 220, magro = false,
}: {
  dados: Ponto[]
  ano: string
  ant: string
  fmt: (v: number) => string
  altura?: number
  magro?: boolean
}) {
  const [tip, setTip] = useState<{ x: number; y: number; p: Ponto } | null>(null)
  const caixa = useRef<HTMLDivElement>(null)

  if (!dados.length) return null

  const W = 720, H = altura, mT = 16, mB = 32, mL = 52, mR = 8
  const bruto = Math.max(...dados.flatMap(d => [d.a ?? 0, d.b ?? 0]), 1) * 1.06
  const base = Math.pow(10, Math.floor(Math.log10(bruto / 4)))
  const passoEixo = [1, 2, 2.5, 5, 10].map(f => f * base).find(v => v * 4 >= bruto) ?? bruto / 4
  const max = passoEixo * 4
  const pH = H - mT - mB, pW = W - mL - mR
  const passo = pW / dados.length
  const bw = Math.max(2, Math.min(magro ? 9 : 22, (passo - (magro ? 3 : 8)) / 2))
  const y = (v: number) => mT + pH - (v / max) * pH

  const marca = (v: number) =>
    max >= 8000 ? `${Math.round(v / 1000)}k` : v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v))

  return (
    <div ref={caixa} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           onMouseLeave={() => setTip(null)}>
        {[0, 1, 2, 3, 4].map(i => {
          const v = max / 4 * i
          return (
            <g key={i}>
              <line x1={mL} y1={y(v)} x2={W - mR} y2={y(v)} stroke="#e2e8f0" />
              <text x={mL - 8} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="#94a3b8">
                {marca(v)}
              </text>
            </g>
          )
        })}
        <line x1={mL} y1={mT + pH} x2={W - mR} y2={mT + pH} stroke="#cbd5e1" />

        {dados.map((d, i) => {
          const cx = mL + passo * i + passo / 2
          const mostraRot = magro && dados.length > 20 ? i % 3 === 0 : true
          return (
            <g key={i}
               onMouseMove={e => {
                 const r = caixa.current?.getBoundingClientRect()
                 setTip({ x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0), p: d })
               }}>
              {d.destaque && (
                <rect x={cx - passo / 2} y={mT - 6} width={passo} height={pH + 12}
                      rx={4} fill="#2a78d6" opacity={0.08} />
              )}
              {d.fds && (
                <rect x={cx - passo / 2} y={mT - 4} width={passo} height={pH + 4}
                      fill="#0f172a" opacity={0.045} />
              )}
              <rect x={cx - passo / 2} y={mT - 6} width={passo} height={pH + 12} fill="transparent" />
              {d.b != null && (
                <rect x={cx - bw - 1} y={y(d.b)} width={bw} height={mT + pH - y(d.b)}
                      rx={2.5} fill={COR_B} />
              )}
              {d.a != null && (
                <rect x={cx + 1} y={y(d.a)} width={bw} height={mT + pH - y(d.a)}
                      rx={2.5} fill={COR_A}
                      opacity={d.parcial ? 0.55 : 1}
                      stroke={d.parcial ? COR_A : undefined}
                      strokeWidth={d.parcial ? 1.5 : undefined}
                      strokeDasharray={d.parcial ? '3 2' : undefined} />
              )}
              {mostraRot && (
                <text x={cx} y={H - mB + 15} textAnchor="middle" fontSize="10.5" fill="#94a3b8">
                  {d.rot}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {tip && (
        <div className="pointer-events-none absolute z-30 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
             style={{ left: Math.min(tip.x + 14, (caixa.current?.clientWidth ?? 0) - 190),
                      top: Math.max(tip.y - 70, 0) }}>
          <div className="mb-1 font-semibold">{tip.p.tit ?? tip.p.rot}</div>
          <div className="flex justify-between gap-6 tabular-nums">
            <span style={{ color: COR_A }}>{ano}</span>
            <span>{tip.p.a == null ? '—' : fmt(tip.p.a)}</span>
          </div>
          <div className="flex justify-between gap-6 tabular-nums">
            <span style={{ color: COR_B }}>{tip.p.subTit ?? ant}</span>
            <span>{tip.p.b == null ? '—' : fmt(tip.p.b)}</span>
          </div>
          {tip.p.a != null && tip.p.b ? (
            <div className="flex justify-between gap-6 tabular-nums text-slate-500">
              <span>diferença</span>
              <span>{((tip.p.a / tip.p.b - 1) * 100 > 0 ? '+' : '−') +
                Math.abs((tip.p.a / tip.p.b - 1) * 100).toFixed(1).replace('.', ',')}%</span>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function Legenda({ ano, ant }: { ano: string; ant: string }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-sm text-slate-600">
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: COR_B }} />{ant}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-3 w-3 rounded-sm" style={{ background: COR_A }} />{ano}
      </span>
    </div>
  )
}
