import { useState, useEffect, useCallback } from 'react';
import { useCurrentUser } from '@/lib/auth';
import { Link } from 'react-router-dom';
import {
  Sparkles, BookOpen, FileText, ClipboardCheck, Layers,
  ArrowRight, TrendingUp, Star, Zap, Heart,
  GraduationCap, Loader2, MessageSquare, Users, PenLine
} from 'lucide-react';
import { getTeacherProfile } from '@/hooks/useTeacherProfile';
import { apiGetHistory } from '@/lib/api';
import {
  TYPE_CONTENU, getNiveauLabel, getMatiereEmoji, getMatiereLabel,
  SUJETS_SUGGESTIONS
} from '@/types';
import type { GeneratedContent, Matiere } from '@/types';

const TYPE_ICONS: Record<string, typeof BookOpen> = {
  cours: BookOpen,
  exercices: ClipboardCheck,
  evaluation: FileText,
  sequence: Layers,
  fiche_prep: FileText,
  appreciations: MessageSquare,
  progression: TrendingUp,
  differenciation: Users,
  lettre_parents: FileText,
  cahier_journal: FileText,
  corrige: ClipboardCheck,
};

const QUICK_TOOLS = [
  { type: 'cours',         label: 'Cours',           desc: 'Cours complets',     Icon: BookOpen,      iconBg: 'bg-violet-500/10', iconColor: 'text-violet-400' },
  { type: 'exercices',     label: 'Exercices',        desc: 'Avec corrigés',      Icon: PenLine,       iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-400' },
  { type: 'evaluation',    label: 'Évaluation',       desc: 'Barèmes officiels',  Icon: ClipboardCheck,iconBg: 'bg-amber-500/10',   iconColor: 'text-amber-400' },
  { type: 'sequence',      label: 'Séquences',        desc: 'Multi-séances',      Icon: Layers,        iconBg: 'bg-pink-500/10',    iconColor: 'text-pink-400' },
  { type: 'appreciations', label: 'Appréciations',    desc: '180+ bulletins',     Icon: MessageSquare, iconBg: 'bg-blue-500/10',    iconColor: 'text-blue-400' },
  { type: 'differenciation',label: 'Différenciation', desc: '3 niveaux',          Icon: Users,         iconBg: 'bg-teal-500/10',    iconColor: 'text-teal-400' },
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function getTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1)  return "À l'instant";
  if (min < 60) return `Il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24)   return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1)  return 'Hier';
  if (d < 7)    return `Il y a ${d} jours`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function DashboardPage() {
  const { user } = useCurrentUser();
  const profile = getTeacherProfile();
  const [history, setHistory] = useState<GeneratedContent[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    if (!user?.id) { setLoading(false); return; }
    const data = await apiGetHistory(user.id);
    setHistory(data);
    setLoading(false);
  }, [user?.id]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const today = new Date().toDateString();
  const todayCount  = history.filter(h => new Date(h.createdAt).toDateString() === today).length;
  const thisWeek    = history.filter(h => new Date(h.createdAt) >= new Date(Date.now() - 7 * 86400000)).length;
  const favCount    = history.filter(h => h.isFavorite).length;
  const totalCount  = history.length;

  const matiereCounts: Record<string, number> = {};
  history.forEach(h => { if (h.matiere) matiereCounts[h.matiere as string] = (matiereCounts[h.matiere as string] || 0) + 1; });
  const topMatiereKey   = Object.entries(matiereCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topMatiereLabel = topMatiereKey ? getMatiereLabel(topMatiereKey as Matiere) : null;

  const typeCounts: Record<string, number> = {};
  history.forEach(h => { typeCounts[h.type] = (typeCounts[h.type] || 0) + 1; });

  const recent     = history.slice(0, 5);
  const matiereKey = profile?.matierePrincipale as Matiere | undefined;
  const suggestions = matiereKey ? (SUJETS_SUGGESTIONS[matiereKey] ?? []).slice(0, 3) : [];

  const displayName = profile?.displayName || user?.firstName || '';
  const dateStr = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const quotaLeft   = 20 - todayCount;
  const quotaPct    = Math.min((todayCount / 20) * 100, 100);

  return (
    <div className="px-6 lg:px-10 py-8 space-y-8 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl text-white mb-1.5 leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            {getGreeting()}{displayName ? `, ${displayName}` : ''} ✨
          </h1>
          <p className="text-sm text-mg-400 capitalize">{dateStr}</p>
        </div>
        <div className="shrink-0">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent/8 border border-accent/15 text-sm font-medium text-accent">
            <Zap size={13} />
            {quotaLeft} / 20 générations
          </div>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">

        {/* Aujourd'hui */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-mg-400 uppercase tracking-wider">Aujourd'hui</p>
            <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
              <Zap size={13} className="text-accent" />
            </div>
          </div>
          <p className="text-5xl text-white leading-none" style={{ fontFamily: 'var(--font-display)' }}>
            {todayCount}
          </p>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-mg-400">
              <span>sur 20 quotidiennes</span>
              <span>{Math.round(quotaPct)}%</span>
            </div>
            <div className="h-1.5 bg-mg-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent transition-all duration-700"
                style={{ width: `${quotaPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Cette semaine */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-mg-400 uppercase tracking-wider">Cette semaine</p>
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp size={13} className="text-emerald-400" />
            </div>
          </div>
          <p className="text-5xl text-white leading-none" style={{ fontFamily: 'var(--font-display)' }}>
            {thisWeek}
          </p>
          <p className="text-xs text-emerald-400 flex items-center gap-1">
            <TrendingUp size={11} />
            contenus générés
          </p>
        </div>

        {/* Matière phare ou Favoris */}
        <div className="card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-mg-400 uppercase tracking-wider">
              {topMatiereLabel ? 'Matière phare' : 'Favoris'}
            </p>
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Star size={13} className="text-amber-400" />
            </div>
          </div>
          {topMatiereLabel ? (
            <p className="text-3xl text-white leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
              {topMatiereLabel}
            </p>
          ) : (
            <p className="text-5xl text-white leading-none" style={{ fontFamily: 'var(--font-display)' }}>
              {favCount}
            </p>
          )}
          <p className="text-xs text-mg-400">
            {topMatiereLabel
              ? `${typeCounts[topMatiereKey!] ?? 0} générations`
              : 'contenus favoris'}
          </p>
        </div>
      </div>

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left 2/3 */}
        <div className="lg:col-span-2 space-y-6">

          {/* Quick tools */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-mg-200">Outils rapides</h2>
              <Link to="/app/generate" className="text-xs text-accent hover:underline flex items-center gap-1">
                Voir tous <ArrowRight size={10} />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {QUICK_TOOLS.map(tool => (
                <Link
                  key={tool.type}
                  to={`/app/generate?type=${tool.type}`}
                  className="card p-4 hover:border-white/12 hover:-translate-y-0.5 group flex flex-col gap-3 transition-all duration-200"
                >
                  <div className={`w-9 h-9 rounded-xl ${tool.iconBg} flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}>
                    <tool.Icon size={17} className={tool.iconColor} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-mg-100 group-hover:text-white transition-colors">{tool.label}</p>
                    <p className="text-xs text-mg-400 mt-0.5">{tool.desc}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-mg-400 uppercase tracking-wider mb-3">
                Idées pour {matiereKey ? getMatiereLabel(matiereKey) : 'vous'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {suggestions.map(s => (
                  <Link
                    key={s}
                    to={`/app/generate?sujet=${encodeURIComponent(s)}`}
                    className="card p-3.5 hover:border-accent/15 group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base">{matiereKey ? getMatiereEmoji(matiereKey) : '📝'}</span>
                      <div className="min-w-0">
                        <p className="text-sm text-mg-200 group-hover:text-white transition-colors truncate">{s}</p>
                        <p className="text-xs text-accent opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mt-0.5">
                          Générer <ArrowRight size={9} />
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right 1/3 */}
        <div className="space-y-5">

          {/* Recent */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-mg-200">Récent</h2>
              {history.length > 0 && (
                <Link to="/app/history" className="text-xs text-accent hover:underline flex items-center gap-1">
                  Tout voir <ArrowRight size={10} />
                </Link>
              )}
            </div>

            {loading ? (
              <div className="card p-6 flex items-center justify-center">
                <Loader2 size={20} className="animate-spin text-mg-400" />
              </div>
            ) : recent.length === 0 ? (
              <div className="card p-6 text-center">
                <Sparkles size={26} className="text-mg-500 mx-auto mb-3" />
                <p className="text-sm text-mg-300 mb-3">Aucune génération</p>
                <Link to="/app/generate" className="btn-primary text-xs py-2 px-4 inline-flex">
                  <Sparkles size={12} /> Commencer
                </Link>
              </div>
            ) : (
              <div className="space-y-1.5">
                {recent.map(item => {
                  const Icon = TYPE_ICONS[item.type] || FileText;
                  return (
                    <Link
                      key={item.id}
                      to="/app/history"
                      className="flex items-center gap-3 p-2.5 rounded-xl border border-white/5 hover:border-accent/12 hover:bg-mg-800/60 group transition-all"
                    >
                      <div className="w-7 h-7 rounded-lg bg-mg-700 flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                        <Icon size={13} className="text-mg-300 group-hover:text-accent transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-mg-100 truncate">{item.sujet}</p>
                        <p className="text-[10px] text-mg-500">
                          {TYPE_CONTENU.find(t => t.value === item.type)?.label} · {typeof item.niveau === 'string' ? item.niveau : getNiveauLabel(item.niveau)}
                        </p>
                      </div>
                      <p className="text-[10px] text-mg-500 shrink-0">{getTimeAgo(new Date(item.createdAt))}</p>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Profile card */}
          {profile && (
            <div className="card p-4">
              <div className="flex items-center gap-3 mb-3.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center shrink-0">
                  <GraduationCap size={16} className="text-mg-900" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{profile.displayName || 'Enseignant'}</p>
                  <p className="text-[11px] text-mg-400 truncate">{profile.etablissement}</p>
                </div>
              </div>
              <div className="space-y-2 pt-3 border-t border-white/5">
                <div className="flex justify-between text-xs">
                  <span className="text-mg-400">Classes</span>
                  <span className="text-mg-200 text-right max-w-[55%] truncate">
                    {profile.niveaux.map(n => getNiveauLabel(n)).join(', ')}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-mg-400">Total généré</span>
                  <span className="text-accent font-semibold">{totalCount}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-mg-400">Favoris</span>
                  <span className="text-pink-400 font-semibold flex items-center gap-1">
                    <Heart size={10} className="fill-pink-400" /> {favCount}
                  </span>
                </div>
              </div>
              <Link to="/app/settings" className="btn-ghost text-xs mt-3.5 w-full justify-center py-1.5">
                Modifier le profil
              </Link>
            </div>
          )}

          {/* Tip */}
          <div className="p-4 rounded-xl bg-accent/4 border border-accent/10">
            <p className="text-xs font-semibold text-accent mb-1.5 flex items-center gap-1.5">
              <Sparkles size={11} /> Astuce
            </p>
            <p className="text-xs text-mg-300 leading-relaxed">
              Utilisez les "Options avancées" dans le générateur pour cibler les objectifs pédagogiques et le programme officiel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
