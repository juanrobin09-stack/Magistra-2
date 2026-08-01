import { useState, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/lib/auth';
import { apiGetHistory } from '@/lib/api';
import { ALPHA_MODE, ALPHA_MAX_GENERATIONS } from '@/lib/alpha';

// Nombre de générations déjà utilisées et restantes pour le compte courant,
// pendant la phase Alpha (limite totale, pas quotidienne).
export function useAlphaUsage() {
  const { user } = useCurrentUser();
  const [used, setUsed] = useState(0);
  const [loading, setLoading] = useState(ALPHA_MODE);

  const refresh = useCallback(async () => {
    if (!ALPHA_MODE || !user?.id) { setLoading(false); return; }
    const history = await apiGetHistory(user.id);
    setUsed(history.length);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  return {
    used,
    remaining: Math.max(0, ALPHA_MAX_GENERATIONS - used),
    max: ALPHA_MAX_GENERATIONS,
    loading,
    refresh,
  };
}
