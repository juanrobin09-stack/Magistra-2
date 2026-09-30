import { useCallback, useRef, useState } from 'react';

export interface ToastState {
  id: number;
  message: string;
  tone: 'success' | 'error' | 'info';
}

/** État d'une notification unique (la plus récente remplace la précédente). */
export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const counter = useRef(0);

  const showToast = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    counter.current += 1;
    setToast({ id: counter.current, message, tone });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  return { toast, showToast, dismissToast };
}
