import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  /** Emoji ou court texte affiché avant le libellé. */
  prefix?: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  groups?: SelectGroup[];
  className?: string;
  /** Identifiant du bouton (permet un <label htmlFor>). */
  id?: string;
  /** Nom accessible du champ (quand aucun libellé visible n'est associé). */
  ariaLabel?: string;
  /** Identifiant de l'élément qui sert de libellé visible. */
  ariaLabelledBy?: string;
  disabled?: boolean;
}

/** Hauteur maximale de la liste (max-h-64) + marge : en dessous, on ouvre vers le haut. */
const LIST_SPACE = 272;
const TYPEAHEAD_DELAY = 600;

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function optionText(opt: SelectOption): string {
  return opt.prefix ? `${opt.prefix} ${opt.label}` : opt.label;
}

/**
 * Liste déroulante accessible (motif « bouton + listbox ») :
 * - bouton aria-haspopup="listbox", aria-expanded, aria-controls ;
 * - listbox role="listbox", options role="option" aria-selected, option active via aria-activedescendant ;
 * - clavier : flèches, Début/Fin, Page préc./suiv., Entrée/Espace, Échap, Tab, recherche par premières lettres ;
 * - le focus revient au bouton à la fermeture ; fermeture au clic extérieur ; ouverture vers le haut si nécessaire.
 */
export default function SelectField({
  value, onChange, options, groups, className = '', id, ariaLabel, ariaLabelledBy, disabled = false,
}: SelectFieldProps) {
  const baseId = useId();
  const buttonId = id ?? `${baseId}-button`;
  const listboxId = `${baseId}-listbox`;
  const valueId = `${baseId}-value`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');

  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typeahead = useRef({ text: '', time: 0 });

  const flat = useMemo<SelectOption[]>(() => options ?? (groups ?? []).flatMap(g => g.options), [options, groups]);
  const selectedIndex = flat.findIndex(o => o.value === value);
  const current = selectedIndex >= 0 ? flat[selectedIndex] : undefined;
  const currentLabel = current ? optionText(current) : '—';
  const optionId = (index: number) => `${baseId}-opt-${index}`;

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const openList = useCallback((initial: 'selected' | 'first' | 'last' = 'selected') => {
    if (disabled || flat.length === 0) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect && typeof window !== 'undefined') {
      const below = window.innerHeight - rect.bottom;
      setPlacement(below < LIST_SPACE && rect.top > below ? 'up' : 'down');
    }
    let index: number;
    if (initial === 'first') index = 0;
    else if (initial === 'last') index = flat.length - 1;
    else index = selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex(index);
    setOpen(true);
  }, [disabled, flat.length, selectedIndex]);

  const commit = useCallback((index: number) => {
    const opt = flat[index];
    if (opt && opt.value !== value) onChange(opt.value);
    close(true);
  }, [flat, value, onChange, close]);

  // Focus sur la liste à l'ouverture.
  useEffect(() => {
    if (open) listRef.current?.focus({ preventScroll: true });
  }, [open]);

  // L'option active reste visible.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = document.getElementById(`${baseId}-opt-${activeIndex}`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, baseId]);

  // Fermeture au clic extérieur.
  useEffect(() => {
    if (!open) return;
    function handlePointer(e: MouseEvent | TouchEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('touchstart', handlePointer);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('touchstart', handlePointer);
    };
  }, [open]);

  /** Recherche par premières lettres ; renvoie l'index trouvé ou -1. */
  const findByTypeahead = (key: string, from: number): number => {
    const now = Date.now();
    const state = typeahead.current;
    state.text = now - state.time > TYPEAHEAD_DELAY ? key : state.text + key;
    state.time = now;
    const query = normalize(state.text);
    const repeated = query.length > 1 && query.split('').every(c => c === query[0]);
    const needle = repeated ? query[0] : query;
    const start = repeated || query.length === 1 ? from + 1 : Math.max(from, 0);
    for (let i = 0; i < flat.length; i++) {
      const idx = (start + i) % flat.length;
      if (normalize(flat[idx].label).startsWith(needle)) return idx;
    }
    return -1;
  };

  const isPrintable = (e: ReactKeyboardEvent) => e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;

  const onButtonKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        openList(e.key === 'ArrowUp' && selectedIndex < 0 ? 'last' : 'selected');
        return;
      case 'Home':
        e.preventDefault();
        openList('first');
        return;
      case 'End':
        e.preventDefault();
        openList('last');
        return;
      default:
        if (isPrintable(e)) {
          const found = findByTypeahead(e.key, selectedIndex);
          if (found >= 0) {
            e.preventDefault();
            openList();
            setActiveIndex(found);
          }
        }
    }
  };

  const onListKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const last = flat.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(i => Math.min(last, i + 1));
        return;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(i => Math.max(0, i - 1));
        return;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        e.preventDefault();
        setActiveIndex(last);
        return;
      case 'PageDown':
        e.preventDefault();
        setActiveIndex(i => Math.min(last, i + 10));
        return;
      case 'PageUp':
        e.preventDefault();
        setActiveIndex(i => Math.max(0, i - 10));
        return;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (activeIndex >= 0) commit(activeIndex);
        else close(true);
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case 'Tab':
        // La liste se ferme sans changer la valeur ; le focus repart du bouton, puis la tabulation
        // native l'amène à l'élément suivant (ou précédent) — il ne tombe jamais sur <body>.
        setOpen(false);
        buttonRef.current?.focus();
        return;
      default:
        if (isPrintable(e)) {
          e.preventDefault();
          const found = findByTypeahead(e.key, activeIndex);
          if (found >= 0) setActiveIndex(found);
        }
    }
  };

  // Le nom accessible du bouton inclut la valeur courante (« Niveau : CP »).
  const labelledBy = ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined;
  const buttonLabel = !ariaLabelledBy && ariaLabel ? `${ariaLabel} : ${currentLabel}` : undefined;
  // Avec un <label htmlFor={id}>, le libellé devient le nom : la valeur est alors annoncée en description.
  const describedBy = !ariaLabelledBy && !ariaLabel && id ? valueId : undefined;

  // Index de départ de chaque groupe dans la liste aplatie.
  const groupStarts: number[] = [];
  let acc = 0;
  for (const g of groups ?? []) {
    groupStarts.push(acc);
    acc += g.options.length;
  }

  const renderOption = (opt: SelectOption, index: number, indented: boolean) => {
    const selected = opt.value === value;
    const active = index === activeIndex;
    return (
      <div
        key={`${opt.value}-${index}`}
        id={optionId(index)}
        role="option"
        aria-selected={selected}
        onClick={() => commit(index)}
        onMouseMove={() => {
          if (activeIndex !== index) setActiveIndex(index);
        }}
        className={`
          w-full flex items-center justify-between gap-2 ${indented ? 'px-4' : 'px-3'} py-2 text-sm text-left cursor-pointer transition-colors
          ${selected ? 'text-accent' : 'text-mg-200'}
          ${active ? (selected ? 'bg-accent/15' : 'bg-white/8 text-mg-50') : selected ? 'bg-accent/10' : ''}
        `}
      >
        <span>{optionText(opt)}</span>
        {selected && <Check size={13} className="shrink-0 text-accent" aria-hidden="true" />}
      </div>
    );
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={labelledBy}
        aria-label={buttonLabel}
        aria-describedby={describedBy}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 rounded-xl text-sm text-left
          bg-mg-700 border transition-all duration-200
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60
          disabled:opacity-50 disabled:cursor-not-allowed
          ${open
            ? 'border-accent/30 ring-1 ring-accent/20 text-mg-100'
            : 'border-white/8 hover:border-white/15 text-mg-200'
          }
        `}
      >
        <span id={valueId} className="truncate">{currentLabel}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={`shrink-0 text-mg-300 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className={`
            absolute left-0 right-0 z-50
            ${placement === 'up' ? 'bottom-[calc(100%+6px)]' : 'top-[calc(100%+6px)]'}
            bg-mg-700 border border-white/10 rounded-xl shadow-2xl shadow-black/50 overflow-hidden
          `}
        >
          <div
            ref={listRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={ariaLabelledBy}
            aria-label={!ariaLabelledBy ? ariaLabel : undefined}
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            onKeyDown={onListKeyDown}
            // Le clic sur une option ne doit pas retirer le focus de la liste avant la sélection.
            onMouseDown={e => e.preventDefault()}
            onBlur={e => {
              if (!containerRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
            }}
            className="max-h-64 overflow-y-auto overscroll-contain py-1 scrollbar-thin focus:outline-none"
          >
            {options && options.map((opt, i) => renderOption(opt, i, false))}
            {!options && groups && groups.map((group, gi) => {
              const groupLabelId = `${baseId}-group-${gi}`;
              return (
                <div key={gi} role="group" aria-labelledby={groupLabelId}>
                  <div
                    id={groupLabelId}
                    role="presentation"
                    className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-mg-300 select-none"
                  >
                    {group.label}
                  </div>
                  {group.options.map((opt, oi) => renderOption(opt, groupStarts[gi] + oi, true))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
