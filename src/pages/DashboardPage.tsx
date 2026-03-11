import { useState, useEffect, useCallback } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Link } from 'react-router-dom';
import {
  Sparkles, BookOpen, FileText, ClipboardCheck, Layers, FolderOpen,
  ArrowRight, TrendingUp, Star, Zap, Heart,
  GraduationCap, Loader2
} from 'lucide-react';
import { getTeacherProfile } from '@/hooks/useTeacherProfile';
import { apiGetHistory } from '@/lib/api';
import {
  TYPE_CONTENU, getNiveauLabel, getMatiereEmoji, getMatiereLabel, getMatieresForNiveau,
  SUJETS_SUGGESTIONS
} from '@/types';
import type { GeneratedContent, Matiere } from '@/types';

const TYPE_ICONS: Record<string, typeof BookOpen> = {
  cours: BookOpen,
  exercices: ClipboardCheck,
  evaluation: FileText,
  sequence: Layers,
  fiche_prep: FolderOpen,
  appreciations: FileText,
  progression: BookOpen,
  differenciation: ClipboardCheck,
  lettre_parents: FileText,
  cahier_journal: FolderOpen,
  corrige: ClipboardCheck,
};

const QUICK_ACTIONS = [
  { type: 'cours', label: 'Cours', icon: '✦', color: 'from-violet-500/20 to-purple-500/20', border: 'border-violet-500/30' },
  { type: 'exercices', label: 'Exercices', icon: '◈', color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30' },
  { type: 'evaluation', label: 'Évaluation', icon: '◎', color: 'from-emerald-500/20 to-green-500/20', border: 'border-emerald-500/30' },
  { type: 'appreciations', label: 'Appréciations', icon: '💬', color: 'from-pink-500/20 to-rose-500/20', border: 'border-pink-500/30' },
  { type: 'progression', label: 'Progression', icon: '📅', color: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-500/30' },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Bonjour';
  if (hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function getTimeAgo(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "À l'instant";
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Hier';
  if (days < 7) return `Il y a ${days} jours`;
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function DashboardPage() {
  const { user } = useUser();
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

  // Stats
  const today = new Date().toDateString();
  const todayCount = history.filter(h => new Date(h.createdAt).toDateString() === today).length;
  const thisWeek = history.filter(h => {
    const d = new Date(h.createdAt);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  }).length;
  const favCount = history.filter(h => h.isFavorite).length;
  const totalCount = history.length;

  // Type breakdown
  const typeCounts: Record<string, number> = {};
  history.forEach(h => { typeCounts[h.type] = (typeCounts[h.type] || 0) + 1; });

  // Recent items (last 5)
  const recent = history.slice(0, 5);

  // Suggestions based on profile
  const matiereKey = profile?.matierePrincipale as Matiere | undefined;
  const suggestions = matiereKey ? (SUJETS_SUGGESTIONS[matiereKey] ?? []).slice(0, 3) : [];

  const greeting = getGreeting();
  const displayName = profile?.displayName || user?.firstName || '';

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-10">

      {/* Header */}
      <div className="mb-8 animate-fade-in">
        <h1 className="text-2xl sm:text-3xl text-white mb-1" style={{ fontFamily: 'var(--font-display)' }}>
          {greeting}{displayName ? `, ${displayName}` : ''} <span className="text-accent">!</span>
        </h1>
        {profile?.etablissement && (
          <p className="text-sm text-mg-400 flex items-center gap-1.5">
            <GraduationCap size={14} />
            {profile.etablissement}
            {profile.niveaux.length > 0 && (
              <> · {profile.niveaux.map(n => getNiveauLabel(n)).join(', ')}</>
            )}
          </p>
        )}
      </div>

      {/* Quick actions */}
      <div className="mb-8 animate-fade-in" style={{ animationDelay: '0.05s' }}>
        <h2 className="text-xs font-medium text-mg-400 uppercase tracking-wider mb-3">Créer du contenu</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {QUICK_ACTIONS.map(action => (
            <Link
              key={action.type}
              to={`/app/generate?type=${action.type}`}
              className={`p-4 rounded-xl border bg-gradient-to-br ${action.color} ${action.border} hover:scale-[1.02] transition-all group`}
            >
              <span className="text-2xl block mb-2 group-hover:scale-110 transition-transform">{action.icon}</span>
              <span className="text-sm font-semibold text-white block">{action.label}</span>
              <span className="text-xs text-mg-300 mt-0.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                Créer <ArrowRight size={10} />
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
              <Zap size={16} className="text-accent" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{todayCount}</p>
          <p className="text-xs text-mg-400">Aujourd'hui</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <TrendingUp size={16} className="text-blue-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{thisWeek}</p>
          <p className="text-xs text-mg-400">Cette semaine</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <Star size={16} className="text-emerald-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{totalCount}</p>
          <p className="text-xs text-mg-400">Total généré</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg bg-pink-500/10 flex items-center justify-center">
              <Heart size={16} className="text-pink-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{favCount}</p>
          <p className="text-xs text-mg-400">Favoris</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Recent + Suggestions */}
        <div className="lg:col-span-2 space-y-6">

          {/* Recent generations */}
          <div className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-medium text-mg-400 uppercase tracking-wider">Dernières générations</h2>
              {history.length > 0 && (
                <Link to="/app/history" className="text-xs text-accent hover:underline flex items-center gap-1">
                  Tout voir <ArrowRight size={10} />
                </Link>
              )}
            </div>

            {loading ? (
              <div className="card p-8 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-mg-400" />
              </div>
            ) : recent.length === 0 ? (
              <div className="card p-8 text-center">
                <Sparkles size={32} className="text-mg-500 mx-auto mb-3" />
                <p className="text-sm text-mg-300 mb-1">Aucune génération pour le moment</p>
                <p className="text-xs text-mg-500 mb-4">Créez votre premier contenu pédagogique en quelques secondes</p>
                <Link to="/app/generate" className="btn-primary text-sm py-2 px-5 inline-flex">
                  <Sparkles size={14} /> Générer mon premier cours
                </Link>
              </div>
            ) : (
              <div className="space-y-2">
                {recent.map(item => {
                  const Icon = TYPE_ICONS[item.type] || FileText;
                  return (
                    <Link
                      key={item.id}
                      to="/app/history"
                      className="card p-4 flex items-center gap-4 hover:border-accent/15 group cursor-pointer"
                    >
                      <div className="w-10 h-10 rounded-xl bg-mg-700 flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                        <Icon size={18} className="text-mg-300 group-hover:text-accent transition-colors" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-mg-100 truncate">{item.sujet}</p>
                        <p className="text-xs text-mg-400">
                          {TYPE_CONTENU.find(t => t.value === item.type)?.label} · {typeof item.niveau === 'string' ? item.niveau : getNiveauLabel(item.niveau)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-mg-500">{getTimeAgo(new Date(item.createdAt))}</p>
                        {item.isFavorite && <Heart size={12} className="text-accent fill-accent ml-auto mt-1" />}
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <h2 className="text-xs font-medium text-mg-400 uppercase tracking-wider mb-3">
                Idées pour {matiereKey ? getMatiereLabel(matiereKey) : 'vous'}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {suggestions.map(s => (
                  <Link
                    key={s}
                    to={`/app/generate?sujet=${encodeURIComponent(s)}`}
                    className="card p-4 hover:border-accent/15 group"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-lg">{matiereKey ? getMatiereEmoji(matiereKey) : '📝'}</span>
                      <div>
                        <p className="text-sm text-mg-200 group-hover:text-white transition-colors">{s}</p>
                        <p className="text-xs text-mg-500 mt-0.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          Générer <ArrowRight size={10} />
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: Profile + Type breakdown */}
        <div className="space-y-6">

          {/* Profile card */}
          {profile && (
            <div className="animate-fade-in" style={{ animationDelay: '0.15s' }}>
              <h2 className="text-xs font-medium text-mg-400 uppercase tracking-wider mb-3">Mon profil</h2>
              <div className="card p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center">
                    <GraduationCap size={20} className="text-mg-900" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">{profile.displayName || 'Enseignant'}</p>
                    <p className="text-xs text-mg-400">{profile.etablissement}</p>
                  </div>
                </div>
                <div className="space-y-2.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-mg-400">Classes</span>
                    <span className="text-mg-200 text-right">
                      {profile.niveaux.map(n => getNiveauLabel(n)).join(', ')}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-mg-400">Matière</span>
                    <span className="text-mg-200">
                      {profile.niveaux[0]
                        ? getMatieresForNiveau(profile.niveaux[0]).find(m => m.value === profile.matierePrincipale)?.label ?? profile.matierePrincipale
                        : profile.matierePrincipale}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-mg-400">Quota quotidien</span>
                    <span className="text-mg-200">{20 - todayCount} / 20 restantes</span>
                  </div>
                </div>
                <Link to="/app/settings" className="btn-ghost text-xs mt-4 w-full justify-center">
                  Modifier le profil
                </Link>
              </div>
            </div>
          )}

          {/* Content breakdown */}
          {totalCount > 0 && (
            <div className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <h2 className="text-xs font-medium text-mg-400 uppercase tracking-wider mb-3">Répartition</h2>
              <div className="card p-5 space-y-3">
                {TYPE_CONTENU.map(t => {
                  const count = typeCounts[t.value] || 0;
                  if (count === 0) return null;
                  const pct = Math.round((count / totalCount) * 100);
                  return (
                    <div key={t.value}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-mg-300 flex items-center gap-1.5">
                          <span>{t.icon}</span> {t.label}
                        </span>
                        <span className="text-mg-400">{count}</span>
                      </div>
                      <div className="h-1.5 bg-mg-700 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-accent-dim to-accent rounded-full transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick tip */}
          <div className="animate-fade-in" style={{ animationDelay: '0.25s' }}>
            <div className="card p-5 bg-accent/3 border-accent/8">
              <p className="text-xs font-semibold text-accent mb-1.5">💡 Astuce</p>
              <p className="text-xs text-mg-300 leading-relaxed">
                Utilisez les "Options avancées" dans le générateur pour préciser les objectifs pédagogiques et
                obtenir un contenu encore plus ciblé et conforme au programme officiel.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
