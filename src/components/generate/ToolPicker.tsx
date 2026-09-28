// Choix de l'outil : onglets défilants horizontaux sous `lg`, barre latérale au-dessus.
// Les 11 outils sont toujours accessibles, avec des libellés adaptés au niveau (getToolInfo).

import { useEffect, useRef } from 'react';
import { ALL_TYPES, getToolInfo, type TypeContenu } from '@shared/catalog';
import type { NiveauScolaire } from '@shared/levels';
import { FOCUS_RING } from './fieldUtils';

interface ToolPickerProps {
  value: TypeContenu;
  niveau: NiveauScolaire;
  onChange(type: TypeContenu): void;
}

export default function ToolPicker({ value, niveau, onChange }: ToolPickerProps) {
  const tools = ALL_TYPES.map(t => getToolInfo(t, niveau));
  const creation = tools.filter(t => t.category === 'creation');
  const outils = tools.filter(t => t.category === 'outils');
  const activeChip = useRef<HTMLButtonElement>(null);

  // Mobile : l'onglet actif reste visible dans la bande défilante (ex. ?type=corrige).
  useEffect(() => {
    const el = activeChip.current;
    const strip = el?.parentElement;
    if (!el || !strip || strip.offsetParent === null) return;
    const left = el.offsetLeft; // la bande est « relative » : position indépendante du défilement
    if (left < strip.scrollLeft || left + el.offsetWidth > strip.scrollLeft + strip.clientWidth) {
      strip.scrollLeft = Math.max(0, left - 16);
    }
  }, [value]);

  return (
    <>
      {/* ── Mobile et tablette : bande d'onglets défilante ── */}
      <nav aria-label="Outils de génération" className="lg:hidden -mx-4 sm:-mx-6 mb-5">
        <div className="relative flex gap-2 overflow-x-auto overscroll-x-contain px-4 sm:px-6 pb-2 snap-x snap-mandatory [scrollbar-width:thin]">
          {tools.map(t => {
            const active = t.value === value;
            return (
              <button
                key={t.value}
                ref={active ? activeChip : undefined}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(t.value)}
                className={`snap-start shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border whitespace-nowrap transition-colors ${FOCUS_RING} ${
                  active
                    ? 'bg-accent/15 text-white border-accent/40'
                    : 'bg-mg-800 text-mg-200 border-white/8 hover:text-mg-100 hover:border-white/15'
                }`}
              >
                <span aria-hidden="true">{t.icon}</span>
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>

      {/* ── Desktop : barre latérale ── */}
      <aside className="hidden lg:block">
        <nav aria-label="Outils de génération" className="sticky top-6 space-y-5">
          {[
            { title: 'Pédagogie', items: creation },
            { title: 'Outils', items: outils },
          ].map(group => (
            <div key={group.title}>
              <p className="px-2 mb-1.5 text-[11px] font-semibold text-mg-300 uppercase tracking-widest">{group.title}</p>
              <ul className="space-y-0.5">
                {group.items.map(t => {
                  const active = t.value === value;
                  return (
                    <li key={t.value}>
                      <button
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(t.value)}
                        title={t.description}
                        className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors ${FOCUS_RING} ${
                          active
                            ? 'bg-accent/10 text-white shadow-[inset_0_0_0_1px_rgba(200,182,255,0.18)]'
                            : 'text-mg-200 hover:text-mg-100 hover:bg-white/5'
                        }`}
                      >
                        <span aria-hidden="true" className={`text-base shrink-0 ${active ? '' : 'opacity-70'}`}>{t.icon}</span>
                        <span className="text-[13px] font-medium">{t.label}</span>
                        {active && <span aria-hidden="true" className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
