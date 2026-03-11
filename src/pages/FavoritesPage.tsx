import { useState, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/lib/auth';
import ReactMarkdown from 'react-markdown';
import { Heart, Download, Copy, Check, Loader2 } from 'lucide-react';
import { apiGetHistory, apiToggleFavorite } from '@/lib/api';
import { exportToPDF, copyToClipboard } from '@/lib/export';
import { getNiveauLabel, getMatiereEmoji, TYPE_CONTENU } from '@/types';
import type { GeneratedContent } from '@/types';

export default function FavoritesPage() {
  const { user } = useCurrentUser();
  const [contents, setContents] = useState<GeneratedContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GeneratedContent | null>(null);
  const [copied, setCopied] = useState(false);

  const loadFavorites = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    const all = await apiGetHistory(user.id);
    setContents(all.filter(c => c.isFavorite));
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { loadFavorites(); }, [loadFavorites]);

  const handleRemoveFavorite = async (id: string) => {
    if (!user?.id) return;
    await apiToggleFavorite(user.id, id, false);
    setContents(prev => prev.filter(c => c.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleCopy = async (content: string) => {
    await copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex">
      <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[360px] lg:border-r border-white/5`}>
        <div className="px-5 py-6">
          <div className="flex items-center gap-2 mb-1">
            <Heart size={18} className="text-accent fill-accent" />
            <h1 className="text-xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Favoris</h1>
          </div>
          <p className="text-xs text-mg-400">{contents.length} favori{contents.length > 1 ? 's' : ''}</p>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-mg-400" />
            </div>
          ) : contents.length === 0 ? (
            <div className="text-center py-12 px-4">
              <Heart size={32} className="text-mg-500 mx-auto mb-3" />
              <p className="text-sm text-mg-400">Aucun favori</p>
              <p className="text-xs text-mg-500 mt-1">Ajoutez des contenus en favoris pour les retrouver ici</p>
            </div>
          ) : (
            contents.map(c => (
              <button key={c.id} onClick={() => setSelected(c)}
                className={`w-full text-left p-3 rounded-lg transition-all border ${
                  selected?.id === c.id ? 'bg-accent/5 border-accent/15' : 'border-transparent hover:bg-white/3'
                }`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-lg shrink-0">{getMatiereEmoji(c.matiere)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-mg-100 truncate">{c.sujet}</p>
                    <p className="text-xs text-mg-400 mt-0.5">
                      {TYPE_CONTENU.find(t => t.value === c.type)?.label} · {getNiveauLabel(c.niveau)}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      <div className={`${selected ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-w-0`}>
        {selected ? (
          <>
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <button className="lg:hidden btn-ghost text-xs mb-2" onClick={() => setSelected(null)}>← Retour</button>
                <h2 className="text-lg text-white truncate" style={{ fontFamily: 'var(--font-display)' }}>{selected.sujet}</h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleRemoveFavorite(selected.id)} className="btn-ghost p-2">
                  <Heart size={16} className="text-accent fill-accent" />
                </button>
                <button onClick={() => handleCopy(selected.contenu)} className="btn-ghost p-2">
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                </button>
                <button onClick={() => exportToPDF(selected.contenu, selected.sujet)} className="btn-ghost p-2"><Download size={16} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 sm:p-8">
              <div className="prose-content max-w-3xl"><ReactMarkdown>{selected.contenu}</ReactMarkdown></div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Heart size={40} className="text-mg-600 mx-auto mb-3" />
              <p className="text-sm text-mg-400">Sélectionnez un favori</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
