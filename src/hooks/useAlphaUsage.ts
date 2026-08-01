import { useState, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/lib/auth';
import { ALPHA_MAX_GENERATIONS } from '@/lib/alpha';

// Compteur de générations Alpha, suivi localement (localStorage) par compte —
// volontairement sans base de données ni appel réseau.
function storageKey(userId: string): string {
  return `magistra_alpha_used_${userId}`;
}

function readUsed(userId?: string | null): number {
  if (!userId) return 0;
  try {
    return parseInt(localStorage.getItem(storageKey(userId)) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

export function useAlphaUsage() {
  const { user } = useCurrentUser();
  const [used, setUsed] = useState(() => readUsed(user?.id));

  useEffect(() => { setUsed(readUsed(user?.id)); }, [user?.id]);

  const increment = useCallback(() => {
    if (!user?.id) return;
    const next = readUsed(user.id) + 1;
    try { localStorage.setItem(storageKey(user.id), String(next)); } catch { /* storage indisponible */ }
    setUsed(next);
  }, [user?.id]);

  const refresh = useCallback(() => setUsed(readUsed(user?.id)), [user?.id]);

  return {
    used,
    remaining: Math.max(0, ALPHA_MAX_GENERATIONS - used),
    max: ALPHA_MAX_GENERATIONS,
    loading: false,
    increment,
    refresh,
  };
}
