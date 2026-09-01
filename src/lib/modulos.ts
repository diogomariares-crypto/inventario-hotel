/**
 * Módulos da aplicação.
 *
 * Cada módulo é um separador de topo com as suas próprias páginas por baixo.
 * Para acrescentar uma app nova à operação basta:
 *   1. criar a página em src/pages/
 *   2. registar a rota em src/App.tsx
 *   3. acrescentar uma entrada aqui
 * Não é preciso mexer no menu — ele é construído a partir desta lista.
 */
export interface Pagina {
  to: string
  label: string
  /** Só visível para administradores. */
  soAdmin?: boolean
  /** Só visível a quem pode ver números do negócio (admin ou financeiro). */
  soPainel?: boolean
  /** Visível a quem pode ver o controlo de pequenos-almoços. */
  soPa?: boolean
  /** Só visível a quem tem o perfil de recursos humanos. */
  soRh?: boolean
  /** Só visível a quem pode ver custos de lavandaria. */
  soLav?: boolean
  /** Só visível a quem pode ver a produção do housekeeping. */
  soHk?: boolean
  /** Visível a quem escreve em pelo menos um departamento. */
  soEscrita?: boolean
}

export interface Modulo {
  id: string
  label: string
  icone: string
  /** Só visível para administradores. */
  soAdmin?: boolean
  /** Só visível a quem tem o perfil de recursos humanos. */
  soRh?: boolean
  /** Só visível a quem pode ver custos de lavandaria. */
  soLav?: boolean
  /** Só visível a quem pode ver a produção do housekeeping. */
  soHk?: boolean
  paginas: Pagina[]
}

export const MODULOS: Modulo[] = [
  {
    id: 'turnos',
    label: 'Turnos',
    icone: '⇄',
    paginas: [
      { to: '/turno', label: 'Relatório diário' },
      { to: '/turno-historico', label: 'Histórico' },
    ],
  },
  {
    id: 'fb',
    label: 'Faturação F&B',
    icone: '€',
    paginas: [
      { to: '/fb', label: 'Dia' },
      { to: '/fb-painel', label: 'Painel', soPainel: true },
      { to: '/fb-pa', label: 'Pequenos-almoços', soPa: true },
      { to: '/fb-importar', label: 'Importar Valentinas', soAdmin: true },
    ],
  },
  {
    id: 'parque',
    label: 'Parque',
    icone: '⬓',
    paginas: [
      { to: '/parque', label: 'Mapa' },
    ],
  },
  {
    id: 'inventario',
    label: 'Inventário',
    icone: '▤',
    paginas: [
      { to: '/', label: 'Painel' },
      { to: '/contagem', label: 'Contagem' },
      { to: '/encomendas', label: 'Encomendas' },
      { to: '/historico', label: 'Histórico' },
      { to: '/itens', label: 'Itens', soEscrita: true },
      { to: '/dados', label: 'Importar/Exportar', soAdmin: true },
    ],
  },
  {
    id: 'housekeeping',
    label: 'Housekeeping',
    icone: '⌂',
    soHk: true,
    paginas: [
      { to: '/hk', label: 'Registo do dia' },
      { to: '/hk-mapa', label: 'Mapa do mês' },
      { to: '/hk-outsourcing', label: 'Outsourcing' },
      { to: '/hk-definicoes', label: 'Definições', soAdmin: true },
    ],
  },
  {
    id: 'lavandaria',
    label: 'Lavandaria',
    icone: '⬗',
    soLav: true,
    paginas: [
      { to: '/lavandaria', label: 'Custos' },
    ],
  },
  {
    id: 'rh',
    label: 'Pessoal',
    icone: '☺',
    soRh: true,
    paginas: [
      { to: '/rh', label: 'Pessoas' },
      { to: '/rh-custos', label: 'Custos' },
      { to: '/rh-definicoes', label: 'Definições', soAdmin: true },
    ],
  },
  {
    id: 'gestao',
    label: 'Gestão',
    icone: '⛭',
    soAdmin: true,
    paginas: [
      { to: '/utilizadores', label: 'Utilizadores' },
      { to: '/migrar-imagens', label: 'Migrar imagens' },
    ],
  },
]

/** Módulo a que pertence um caminho — o que tiver a página mais específica. */
export function moduloDoCaminho(caminho: string): Modulo {
  let melhor: { modulo: Modulo; peso: number } | null = null
  for (const m of MODULOS) {
    for (const p of m.paginas) {
      const bate = p.to === '/' ? caminho === '/' : caminho === p.to || caminho.startsWith(p.to + '/')
      if (bate && (!melhor || p.to.length > melhor.peso)) {
        melhor = { modulo: m, peso: p.to.length }
      }
    }
  }
  return melhor?.modulo ?? MODULOS.find(m => m.id === 'inventario') ?? MODULOS[0]
}
