import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import { DEPARTMENTS } from '../lib/types'
import ContagemSemanal from './ContagemSemanal'
import ContagemMensal from './ContagemMensal'

export default function Contagem() {
  const { dept, setDept } = useApp()
  const { canWrite, roles } = useAuth()

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {DEPARTMENTS.map(d => (
          <button
            key={d.value}
            onClick={() => setDept(d.value)}
            className={`rounded-lg px-3.5 py-2 text-sm font-medium ${
              dept === d.value
                ? 'bg-brand-500 text-white'
                : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {d.label}
            <span className="ml-1.5 text-[11px] opacity-70">
              {d.kind === 'mensal' ? 'mensal' : 'semanal'}
            </span>
          </button>
        ))}
      </div>

      {!canWrite(dept) && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {roles.length === 0
            ? 'A tua conta ainda não tem permissões. Pede a um administrador para as atribuir.'
            : 'Só podes consultar este departamento — não tens permissão para alterar contagens.'}
        </div>
      )}

      {dept === 'FB' ? <ContagemMensal /> : <ContagemSemanal dept={dept} />}
    </div>
  )
}
