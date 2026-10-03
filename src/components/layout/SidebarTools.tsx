// « Outils pédagogiques » dans la barre latérale, sous « Réglages » : une entrée repliable (fermée par défaut, pour ne
// pas surcharger le menu) qui déroule les 11 outils classés en trois familles. Chaque outil ouvre la page Générer sur
// cet outil (/app/generate?type=…) ; l'outil de la page Générer est signalé (aria-current). L'état ouvert ou fermé
// est retenu sur cet appareil. Libellés adaptés au niveau (supérieur : « TD / Exercices »…) : celui du formulaire sur
// la page Générer, pour nommer les outils comme elle ; ailleurs, celui du profil de l'enseignant.

import { forwardRef, useId } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, LayoutGrid } from 'lucide-react';
import { getToolInfo, TOOL_GROUPS, type TypeContenu } from '@shared/catalog';
import type { NiveauScolaire } from '@shared/levels';
import { TOOL_ICONS } from '@/lib/toolIcons';

interface SidebarToolsProps {
  open: boolean;
  onToggle(): void;
  /** Outil affiché par la page Générer (null hors de cette page). */
  activeType: TypeContenu | null;
  niveau?: NiveauScolaire;
  /** Clic sur un outil (ferme le tiroir sur mobile). */
  onNavigate(): void;
}

const SidebarTools = forwardRef<HTMLButtonElement, SidebarToolsProps>(function SidebarTools(
  { open, onToggle, activeType, niveau, onNavigate },
  toggleRef,
) {
  const listId = useId();
  const active = activeType ? getToolInfo(activeType, niveau) : null;
  return (
    <div className="pt-2 mt-2 border-t border-white/5">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
        className={`
          w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-left
          transition-colors duration-200 border border-transparent
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
          ${open ? 'text-mg-50' : 'text-mg-200 hover:text-mg-50 hover:bg-white/3'}
        `}
      >
        <LayoutGrid size={18} aria-hidden="true" className={open ? 'text-accent' : ''} />
        <span className="flex-1 min-w-0">
          <span className="block">Outils pédagogiques</span>
          {/* Replié : l'outil en cours reste visible d'un coup d'œil, sur une petite ligne. */}
          {!open && active && (
            <span className="block truncate text-[11px] font-medium text-accent/90 leading-tight">{active.label}</span>
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" className={`shrink-0 text-mg-300 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Repliée : la liste n'est pas du tout affichée (ni lue par les lecteurs d'écran, ni parcourue au clavier). */}
      <div id={listId} hidden={!open} className="mt-1 mb-1 space-y-2.5">
        {open && TOOL_GROUPS.map(group => (
          <div key={group.id} role="group" aria-labelledby={`${listId}-${group.id}`}>
            <p id={`${listId}-${group.id}`} className="px-3 pt-1.5 pb-1 text-[10.5px] font-semibold text-mg-300 uppercase tracking-widest">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.tools.map(type => {
                const tool = getToolInfo(type, niveau);
                const Icon = TOOL_ICONS[type];
                const current = type === activeType;
                return (
                  <li key={type}>
                    <Link
                      to={`/app/generate?type=${type}`}
                      onClick={onNavigate}
                      aria-current={current ? 'true' : undefined}
                      title={tool.description}
                      data-tool={type}
                      className={`
                        group flex items-center gap-2.5 pl-3 pr-2 py-1.5 rounded-lg text-[13px] font-medium
                        transition-colors duration-150
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50
                        ${current
                          ? 'bg-accent/10 text-white shadow-[inset_0_0_0_1px_rgba(200,182,255,0.18)]'
                          : 'text-mg-200 hover:text-mg-50 hover:bg-white/3'}
                      `}
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.7}
                        aria-hidden="true"
                        className={`shrink-0 ${current ? 'text-accent' : 'text-mg-300 group-hover:text-mg-100'}`}
                      />
                      <span className="min-w-0 truncate">{tool.label}</span>
                      {current && <span aria-hidden="true" className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
});

export default SidebarTools;
