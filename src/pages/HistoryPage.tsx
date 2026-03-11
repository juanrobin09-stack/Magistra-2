import { useState, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/lib/auth';
import ReactMarkdown from 'react-markdown';
import { History, Trash2, Heart, Download, Copy, Check, Search, FileText, Loader2 } from 'lucide-react';
import { apiGetHistory, apiDeleteGeneration, apiToggleFavorite } from '@/lib/api';
import { exportToPDF, exportToText, copyToClipboard } from '@/lib/export';
import { getNiveauLabel, getMatiereEmoji, TYPE_CONTENU } from '@/types';
import type { GeneratedContent } from '@/types';

export default function HistoryPage() {
  const { user } = useCurrentUser();
  const [contents, setContents] = useState<GeneratedContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<GeneratedContent | null>(null);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    const data = await apiGetHistory(user.id);
    setContents(data);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const filtered = contents.filter(c =>
    c.sujet.toLowerCase().includes(search.toLowerCase()) ||
    (c.matiere ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (!user?.id) return;
    await apiDeleteGeneration(user.id, id);
    setContents(prev => prev.filter(c => c.id !== id));
    if (selected?.id === id) setSelected(null);
  };

  const handleToggleFavorite = async (id: string) => {
    if (!user?.id) return;
    const item = contents.find(c => c.id === id);
    if (!item) return;
    await apiToggleFavorite(user.id, id, !item.isFavorite);
    setContents(prev => prev.map(c => c.id === id ? { ...c, isFavorite: !c.isFavorite } : c));
    if (selected?.id === id) setSelected(prev => prev ? { ...prev, isFavorite: !prev.isFavorite } : null);
  };

  const handleCopy = async (content: string) => {
    await copyToClipboard(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-full flex">
      {/* List */}
      <div className={`${selected ? 'hidden lg:flex' : 'flex'} flex-col w-full lg:w-[360px] lg:border-r border-white/5`}>
        <div className="px-5 py-6">
          <div className="flex items-center gap-2 mb-1">
            <History size={18} className="text-accent" />
            <h1 className="text-xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Historique</h1>
          </div>
          <p className="text-xs text-mg-400">{contents.length} génération{contents.length > 1 ? 's' : ''}</p>
        </div>

        <div className="px-5 pb-4">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-mg-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher..." className="input-field pl-9 py-2 text-sm" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-mg-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 px-4">
              <History size={32} className="text-mg-500 mx-auto mb-3" />
              <p className="text-sm text-mg-400">{search ? 'Aucun résultat' : 'Aucune génération pour le moment'}</p>
              {!search && <p className="text-xs text-mg-500 mt-1">Générez votre premier contenu pour le voir apparaître ici</p>}
            </div>
          ) : (
            filtered.map(c => (
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
                    <p className="text-xs text-mg-500 mt-0.5">
                      {new Date(c.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  {c.isFavorite && <Heart size={12} className="text-accent fill-accent shrink-0 mt-1" />}
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Detail */}
      <div className={`${selected ? 'flex' : 'hidden lg:flex'} flex-col flex-1 min-w-0`}>
        {selected ? (
          <>
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <button className="lg:hidden btn-ghost text-xs mb-2" onClick={() => setSelected(null)}>← Retour</button>
                <h2 className="text-lg text-white truncate" style={{ fontFamily: 'var(--font-display)' }}>{selected.sujet}</h2>
                <p className="text-xs text-mg-400">{selected.matiere} · {getNiveauLabel(selected.niveau)}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => handleToggleFavorite(selected.id)} className="btn-ghost p-2">
                  <Heart size={16} className={selected.isFavorite ? 'text-accent fill-accent' : ''} />
                </button>
                <button onClick={() => handleCopy(selected.contenu)} className="btn-ghost p-2">
                  {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
                </button>
                <button onClick={() => exportToText(selected.contenu, selected.sujet)} className="btn-ghost p-2"><FileText size={16} /></button>
                <button onClick={() => exportToPDF(selected.contenu, selected.sujet)} className="btn-ghost p-2"><Download size={16} /></button>
                <button onClick={() => handleDelete(selected.id)} className="btn-ghost p-2 text-danger/70 hover:text-danger"><Trash2 size={16} /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 sm:p-8">
              <div className="prose-content max-w-3xl"><ReactMarkdown>{selected.contenu}</ReactMarkdown></div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <FileText size={40} className="text-mg-600 mx-auto mb-3" />
              <p className="text-sm text-mg-400">Sélectionnez un contenu pour l'afficher</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
