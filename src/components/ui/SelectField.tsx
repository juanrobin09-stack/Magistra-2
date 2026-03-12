import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  prefix?: string; // emoji or short text before label
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
}

export default function SelectField({ value, onChange, options, groups, className = '' }: SelectFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Find current label
  const allOptions: SelectOption[] = options
    ? options
    : (groups ?? []).flatMap(g => g.options);
  const current = allOptions.find(o => o.value === value);
  const currentLabel = current
    ? [current.prefix, current.label].filter(Boolean).join(' ')
    : '—';

  const handleSelect = (val: string) => {
    onChange(val);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`
          w-full flex items-center justify-between gap-2
          px-3 py-2.5 rounded-xl text-sm text-left
          bg-mg-700 border transition-all duration-200
          ${open
            ? 'border-accent/30 ring-1 ring-accent/20 text-mg-100'
            : 'border-white/8 hover:border-white/15 text-mg-200'
          }
        `}
      >
        <span className="truncate">{currentLabel}</span>
        <ChevronDown
          size={15}
          className={`shrink-0 text-mg-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown — always opens downward */}
      {open && (
        <div className="
          absolute top-[calc(100%+6px)] left-0 right-0 z-50
          bg-mg-700 border border-white/10 rounded-xl shadow-2xl shadow-black/50
          overflow-hidden
        ">
          <div className="max-h-64 overflow-y-auto overscroll-contain py-1 scrollbar-thin">
            {/* Flat list */}
            {options && options.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`
                  w-full flex items-center justify-between gap-2
                  px-3 py-2 text-sm text-left transition-colors
                  ${opt.value === value
                    ? 'bg-accent/10 text-accent'
                    : 'text-mg-200 hover:bg-white/5 hover:text-mg-100'
                  }
                `}
              >
                <span>{opt.prefix ? `${opt.prefix} ${opt.label}` : opt.label}</span>
                {opt.value === value && <Check size={13} className="shrink-0 text-accent" />}
              </button>
            ))}

            {/* Grouped list */}
            {groups && groups.map((group, gi) => (
              <div key={gi}>
                <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-mg-400 select-none">
                  {group.label}
                </p>
                {group.options.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelect(opt.value)}
                    className={`
                      w-full flex items-center justify-between gap-2
                      px-4 py-2 text-sm text-left transition-colors
                      ${opt.value === value
                        ? 'bg-accent/10 text-accent'
                        : 'text-mg-200 hover:bg-white/5 hover:text-mg-100'
                      }
                    `}
                  >
                    <span>{opt.prefix ? `${opt.prefix} ${opt.label}` : opt.label}</span>
                    {opt.value === value && <Check size={13} className="shrink-0 text-accent" />}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
