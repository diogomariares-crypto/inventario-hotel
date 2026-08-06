export type Department = 'FO' | 'HSK' | 'FB'
export type AppRole = 'admin' | 'fo' | 'hsk' | 'fb'
export type PeriodKind = 'semanal' | 'mensal'
export type CountStatus = 'rascunho' | 'submetido'

export const DEPARTMENTS: { value: Department; label: string; kind: PeriodKind }[] = [
  { value: 'FO', label: 'Front Office', kind: 'semanal' },
  { value: 'HSK', label: 'Housekeeping', kind: 'semanal' },
  { value: 'FB', label: 'F&B / Restaurante', kind: 'mensal' },
]

export const deptLabel = (d: Department) =>
  DEPARTMENTS.find(x => x.value === d)?.label ?? d

export const MOTIVOS = [
  'Validade',
  'Dano',
  'Derrame',
  'Roubo',
  'Erro de contagem',
  'Outro',
] as const

export interface Hotel {
  id: string
  slug: string
  name: string
  active: boolean
}

export interface Item {
  id: string
  hotel_id: string | null
  department: Department
  ref: string | null
  name: string
  category: string | null
  supplier: string | null
  unit: string
  unit_price_eur: number | null
  par_qty: number | null
  active: boolean
  is_custom: boolean
}

export interface Period {
  id: string
  hotel_id: string
  department: Department
  kind: PeriodKind
  start_date: string
  end_date: string
  label: string
  occupied_rooms: number | null
  status: CountStatus
  submitted_at: string | null
}

export interface Count {
  id: string
  period_id: string
  item_id: string
  opening_qty: number
  purchased_qty: number
  amount_paid_eur: number
  closing_qty: number
  closing_counted: boolean
  quebras: number
  motivo: string | null
  comentario: string | null
  unit_price_eur: number | null
  updated_by: string | null
  updated_at: string
}

export interface VCount {
  id: string
  hotel_id: string
  hotel_slug: string
  hotel_name: string
  department: Department
  kind: PeriodKind
  period_id: string
  start_date: string
  end_date: string
  label: string
  occupied_rooms: number | null
  status: CountStatus
  item_id: string
  item_name: string
  ref: string | null
  category: string | null
  supplier: string | null
  unit: string
  unit_price_eur: number | null
  opening_qty: number
  purchased_qty: number
  amount_paid_eur: number
  closing_qty: number
  quebras: number
  motivo: string | null
  comentario: string | null
  used_qty: number
  cost_used_eur: number | null
  stock_value_eur: number | null
  used_per_room: number | null
  cost_per_room_eur: number | null
  updated_at: string
}
