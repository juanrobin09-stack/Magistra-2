import type { GenerationRequest, GeneratedContent } from '@/types';
import { getNiveauLabel, getMatiereLabel } from '@/types';

const API_BASE = import.meta.env.PROD ? '/api' : '/api';

export interface GenerateResponse {
  id: string;
  contenu: string;
  remaining: number;
  tokens_used: number;
}

export async function apiGenerate(
  userId: string,
  request: GenerationRequest
): Promise<GenerateResponse> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId,
      type: request.type,
      matiere: getMatiereLabel(request.matiere),
      niveau: getNiveauLabel(request.niveau),
      sujet: request.sujet,
      duree: request.duree,
      objectifs: request.objectifs,
      difficulte: request.difficulte,
      consignes: request.consignesSupplementaires,
      nombreEleves: request.nombreEleves,
      trimestre: request.trimestre,
      profilsEleves: request.profilsEleves,
      typeLettre: request.typeLettre,
      texteEleve: request.texteEleve,
    }),
  });

  if (res.status === 429) {
    const data = await res.json();
    throw new Error(data.error || 'Limite quotidienne atteinte. Revenez demain !');
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Erreur réseau.' }));
    throw new Error(data.error || 'Erreur lors de la génération.');
  }

  return res.json();
}

export async function apiGetHistory(userId: string): Promise<GeneratedContent[]> {
  const res = await fetch(`${API_BASE}/history?userId=${userId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.map((item: Record<string, unknown>) => ({
    id: item.id,
    type: item.type,
    matiere: item.matiere,
    niveau: item.niveau,
    sujet: item.sujet,
    contenu: item.contenu,
    isFavorite: item.is_favorite,
    createdAt: new Date(item.created_at as string),
  }));
}

export async function apiToggleFavorite(userId: string, id: string, isFavorite: boolean): Promise<void> {
  await fetch(`${API_BASE}/favorite`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, userId, isFavorite }),
  });
}

export async function apiDeleteGeneration(userId: string, id: string): Promise<void> {
  await fetch(`${API_BASE}/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, userId }),
  });
}
