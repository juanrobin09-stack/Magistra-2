import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BookOpen, CalendarRange, ClipboardCheck, FileText, GraduationCap, Heart, Layers, Mail,
  MessageSquare, NotebookPen, PenLine, Search, Sparkles, Star, TrendingUp, Users, Zap, type LucideIcon,
} from 'lucide-react';
import { ALL_TYPES, getMatiereEmoji, getMatiereLabel, getSujetSuggestions, getToolInfo, type TypeContenu } from '@shared/catalog';
import { getNiveauLabel, isSuperieur } from '@shared/levels';
import type { GenerationSummary, UsageStats } from '@shared/types';
import { useRuntime } from '@/lib/runtime/context';
import ErrorBanner from '@/components/ui/ErrorBanner';
import ConnectRealAICard from '@/components/ai/ConnectRealAICard';
import { errorMessage, niveauLabelFor, timeAgo, toolLabelFor } from '@/components/history/logic';

type Loadable<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: string };

const TYPE_ICONS: Record<TypeContenu, LucideIcon> = {
  cours: BookOpen,
  exercices: PenLine,
  evaluation: ClipboardCheck,
  sequence: Layers,
  fiche_prep: FileText,
  appreciations: MessageSquare,
  progression: CalendarRange,
  differenciation: Users,
  lettre_parents: Mail,
  cahier_journal: NotebookPen,
  corrige: Search,
};

const TOOL_STYLE: Record<TypeContenu, { iconBg: string; iconColor: string }> = {
  cours: { iconBg: 'bg-violet-500/10', iconColor: 'text-violet-300' },
  exercices: { iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-300' },
  evaluation: { iconBg: 'bg-amber-500/10', iconColor: 'text-amber-300' },
  sequence: { iconBg: 'bg-pink-500/10', iconColor: 'text-pink-300' },
  fiche_prep: { iconBg: 'bg-sky-500/10', iconColor: 'text-sky-300' },
  appreciations: { iconBg: 'bg-blue-500/10', iconColor: 'text-blue-300' },
  progression: { iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-300' },
  differenciation: { iconBg: 'bg-teal-500/10', iconColor: 'text-teal-300' },
  lettre_parents: { iconBg: 'bg-rose-500/10', iconColor: 'text-rose-300' },
  cahier_journal: { iconBg: 'bg-orange-500/10', iconColor: 'text-orange-300' },
  corrige: { iconBg: 'bg-cyan-500/10', iconColor: 'text-cyan-300' },
};

/** Outils mis en avant selon le public : le supérieur privilégie TD, examens, syllabus et corrections. */
const QUICK_TOOLS_SCOLAIRE: TypeContenu[] = ['cours', 'exercices', 'evaluation', 'sequence', 'appreciations', 'differenciation'];
const QUICK_TOOLS_SUPERIEUR: TypeContenu[] = ['cours', 'exercices', 'evaluation', 'sequence', 'progression', 'corrige'];

function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return 'Bonsoir';
  if (h < 12) return 'Bonjour';
  if (h < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

function StatValue({ state, pick }: { state: Loadable<UsageStats>; pick: (s: UsageStats) => number }) {
  if (state.status === 'ready') {
    return (
      <p className="text-5xl text-white leading-none" style={{ fontFamily: 'var(--font-display)' }}>
        {pick(state.data)}
      </p>
    );
  }
  return (
    <p className="text-5xl text-mg-300 leading-none" style={{ fontFamily: 'var(--font-display)' }} aria-label={state.status === 'loading' ? 'Chargement' : 'Indisponible'}>
      –
    </p>
  );
}

export default function DashboardPage() {
  const { store, profile, user, mode } = useRuntime();
  // L'heure est lue une seule fois, à l'ouverture de la page (jamais pendant le rendu).
  const [now] = useState(() => new Date());

  const [stats, setStats] = useState<Loadable<UsageStats>>({ status: 'loading' });
  const [statsKey, setStatsKey] = useState(0);
  const [recent, setRecent] = useState<Loadable<GenerationSummary[]>>({ status: 'loading' });
  const [recentKey, setRecentKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    store.getStats().then(
      data => {
        if (!cancelled) setStats({ status: 'ready', data });
      },
      err => {
        if (!cancelled) setStats({ status: 'error', error: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, statsKey]);

  useEffect(() => {
    let cancelled = false;
    store.listGenerations({ limit: 5 }).then(
      page => {
        if (!cancelled) setRecent({ status: 'ready', data: page.items.slice(0, 5) });
      },
      err => {
        if (!cancelled) setRecent({ status: 'error', error: errorMessage(err) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, recentKey]);

  const retryStats = () => {
    setStats({ status: 'loading' });
    setStatsKey(k => k + 1);
  };
  const retryRecent = () => {
    setRecent({ status: 'loading' });
    setRecentKey(k => k + 1);
  };

  const niveau = profile?.niveaux?.[0];
  const superieur = niveau ? isSuperieur(niveau) : false;
  const quickTools = superieur ? QUICK_TOOLS_SUPERIEUR : QUICK_TOOLS_SCOLAIRE;
  const matiere = profile?.matierePrincipale;
  const suggestions = matiere && niveau ? getSujetSuggestions(matiere, niveau).slice(0, 3) : [];

  const displayName = profile?.displayName || user?.firstName || '';
  const dateStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const nowMs = now.getTime();
  const top = stats.status === 'ready' ? stats.data.topMatiere : undefined;

  return (
    <div className="px-6 lg:px-10 py-8 space-y-8 animate-fade-in">
      {/* ── En-tête ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl sm:text-4xl text-white mb-1.5 leading-tight" style={{ fontFamily: 'var(--font-display)' }}>
            {greetingFor(now)}{displayName ? `, ${displayName}` : ''} <span aria-hidden="true">✨</span>
          </h1>
          <p className="text-sm text-mg-300 first-letter:uppercase">{dateStr}</p>
        </div>
        <Link
          to="/app/generate"
          className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-accent/8 border border-accent/15 text-sm font-medium text-accent hover:bg-accent/15 transition-colors self-start"
        >
          <Sparkles size={13} aria-hidden="true" /> Nouveau contenu
        </Link>
      </div>

      {mode === 'demo' && (
        <div className="space-y-2">
          <div className="rounded-xl border border-accent/15 bg-accent/5 px-4 py-3 text-sm text-mg-100" role="note">
            <strong className="text-accent font-semibold">Mode démonstration.</strong>{' '}
            Les contenus sont des exemples pré-rédigés : aucune IA n’est utilisée. Votre historique et vos favoris restent dans ce navigateur.
          </div>
          <ConnectRealAICard />
        </div>
      )}

      {/* ── Statistiques ── */}
      <section aria-labelledby="stats-title" className="space-y-3">
        <h2 id="stats-title" className="sr-only">Statistiques</h2>
        {stats.status === 'error' && (
          <ErrorBanner message={`Statistiques indisponibles. ${stats.error}`} onRetry={retryStats} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" aria-busy={stats.status === 'loading'}>
          {/* Aujourd'hui */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-mg-200 uppercase tracking-wider">Aujourd'hui</p>
              <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                <Zap size={13} className="text-accent" aria-hidden="true" />
              </div>
            </div>
            <StatValue state={stats} pick={s => s.today} />
            <p className="text-xs text-mg-300">
              {stats.status === 'ready' ? `contenu${stats.data.today > 1 ? 's' : ''} généré${stats.data.today > 1 ? 's' : ''} · ${plural(stats.data.total, 'contenu')} au total` : 'contenus générés'}
            </p>
          </div>

          {/* Cette semaine */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-mg-200 uppercase tracking-wider">7 derniers jours</p>
              <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <TrendingUp size={13} className="text-emerald-300" aria-hidden="true" />
              </div>
            </div>
            <StatValue state={stats} pick={s => s.week} />
            <p className="text-xs text-emerald-300 flex items-center gap-1">
              <TrendingUp size={11} aria-hidden="true" />
              contenus générés
            </p>
          </div>

          {/* Matière phare (vrai nombre) ou favoris */}
          <div className="card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-mg-200 uppercase tracking-wider">{top ? 'Matière phare' : 'Favoris'}</p>
              <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <Star size={13} className="text-amber-300" aria-hidden="true" />
              </div>
            </div>
            {top ? (
              <p className="text-3xl text-white leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
                <span aria-hidden="true">{getMatiereEmoji(top.matiere)} </span>
                {getMatiereLabel(top.matiere)}
              </p>
            ) : (
              <StatValue state={stats} pick={s => s.favorites} />
            )}
            <p className="text-xs text-mg-300">
              {top && stats.status === 'ready'
                ? `${plural(top.count, 'génération')} · ${plural(stats.data.favorites, 'favori')}`
                : 'contenus favoris'}
            </p>
          </div>
        </div>
      </section>

      {/* ── Grille principale ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Colonne gauche (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Outils rapides */}
          <section aria-labelledby="tools-title">
            <div className="flex items-center justify-between mb-3">
              <h2 id="tools-title" className="text-sm font-semibold text-mg-100">Outils rapides</h2>
              <Link to="/app/generate" className="text-xs text-accent hover:underline flex items-center gap-1">
                Voir les {ALL_TYPES.length} outils <ArrowRight size={10} aria-hidden="true" />
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {quickTools.map(type => {
                const info = getToolInfo(type, niveau);
                const Icon = TYPE_ICONS[type];
                const style = TOOL_STYLE[type];
                return (
                  <Link
                    key={type}
                    to={`/app/generate?type=${type}`}
                    className="card p-4 hover:border-white/12 hover:-translate-y-0.5 group flex flex-col gap-3 transition-all duration-200"
                  >
                    <div className={`w-9 h-9 rounded-xl ${style.iconBg} flex items-center justify-center group-hover:scale-110 transition-transform duration-200`}>
                      <Icon size={17} className={style.iconColor} aria-hidden="true" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-mg-100 group-hover:text-white transition-colors">{info.label}</p>
                      <p className="text-xs text-mg-300 mt-0.5">{info.description}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Idées de sujets */}
          {matiere && suggestions.length > 0 && (
            <section aria-labelledby="ideas-title">
              <h2 id="ideas-title" className="text-xs font-medium text-mg-200 uppercase tracking-wider mb-3">
                Idées en {getMatiereLabel(matiere)}
                {niveau ? ` · ${getNiveauLabel(niveau)}` : ''}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {suggestions.map(s => (
                  <Link
                    key={s}
                    to={`/app/generate?sujet=${encodeURIComponent(s)}`}
                    className="card p-3.5 hover:border-accent/15 group transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-base" aria-hidden="true">{getMatiereEmoji(matiere)}</span>
                      <div className="min-w-0">
                        <p className="text-sm text-mg-100 group-hover:text-white transition-colors">{s}</p>
                        <p className="text-xs text-accent opacity-80 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mt-0.5">
                          Générer <ArrowRight size={9} aria-hidden="true" />
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Colonne droite (1/3) */}
        <div className="space-y-5">
          {/* Récent */}
          <section aria-labelledby="recent-title">
            <div className="flex items-center justify-between mb-3">
              <h2 id="recent-title" className="text-sm font-semibold text-mg-100">Récent</h2>
              {recent.status === 'ready' && recent.data.length > 0 && (
                <Link to="/app/history" className="text-xs text-accent hover:underline flex items-center gap-1">
                  Tout voir <ArrowRight size={10} aria-hidden="true" />
                </Link>
              )}
            </div>

            {recent.status === 'loading' && (
              <div className="space-y-1.5" role="status" aria-label="Chargement des contenus récents">
                {[0, 1, 2].map(i => (
                  <div key={i} className="h-[52px] rounded-xl animate-shimmer" aria-hidden="true" />
                ))}
              </div>
            )}

            {recent.status === 'error' && (
              <ErrorBanner message={`Contenus récents indisponibles. ${recent.error}`} onRetry={retryRecent} />
            )}

            {recent.status === 'ready' && recent.data.length === 0 && (
              <div className="card p-6 text-center">
                <Sparkles size={26} className="text-mg-300 mx-auto mb-3" aria-hidden="true" />
                <p className="text-sm text-mg-200 mb-3">Aucune génération pour le moment</p>
                <Link to="/app/generate" className="btn-primary text-xs py-2 px-4 inline-flex">
                  <Sparkles size={12} aria-hidden="true" /> Commencer
                </Link>
              </div>
            )}

            {recent.status === 'ready' && recent.data.length > 0 && (
              <ul className="space-y-1.5">
                {recent.data.map(item => {
                  const Icon = TYPE_ICONS[item.type] ?? FileText;
                  return (
                    <li key={item.id}>
                      <Link
                        to={`/app/history?id=${encodeURIComponent(item.id)}`}
                        className="flex items-center gap-3 p-2.5 rounded-xl border border-white/5 hover:border-accent/12 hover:bg-mg-800/60 group transition-all"
                      >
                        <div className="w-7 h-7 rounded-lg bg-mg-700 flex items-center justify-center shrink-0 group-hover:bg-accent/10 transition-colors">
                          <Icon size={13} className="text-mg-200 group-hover:text-accent transition-colors" aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-mg-100 truncate">{item.sujet}</p>
                          <p className="text-[11px] text-mg-300 truncate">
                            {toolLabelFor(item)} · {niveauLabelFor(item)}
                          </p>
                        </div>
                        <p className="text-[11px] text-mg-300 shrink-0">
                          <time dateTime={item.createdAt}>{timeAgo(item.createdAt, nowMs)}</time>
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Carte profil */}
          {profile && (
            <section aria-labelledby="profile-title" className="card p-4">
              <div className="flex items-center gap-3 mb-3.5">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center shrink-0">
                  <GraduationCap size={16} className="text-mg-900" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 id="profile-title" className="text-sm font-semibold text-white truncate">{profile.displayName || 'Mon profil'}</h2>
                  {profile.etablissement && <p className="text-[11px] text-mg-300 truncate">{profile.etablissement}</p>}
                </div>
              </div>
              <dl className="space-y-2 pt-3 border-t border-white/5 text-xs">
                <div className="flex justify-between gap-3">
                  <dt className="text-mg-300">Classes</dt>
                  <dd className="text-mg-100 text-right">{(profile.niveaux ?? []).map(n => getNiveauLabel(n)).join(', ')}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mg-300">Matière</dt>
                  <dd className="text-mg-100 text-right">
                    <span aria-hidden="true">{getMatiereEmoji(profile.matierePrincipale)} </span>
                    {getMatiereLabel(profile.matierePrincipale)}
                    {profile.matiereSecondaire ? `, ${getMatiereLabel(profile.matiereSecondaire)}` : ''}
                  </dd>
                </div>
                {profile.discipline && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-mg-300">Discipline</dt>
                    <dd className="text-mg-100 text-right">{profile.discipline}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-mg-300">Total généré</dt>
                  <dd className="text-accent font-semibold">{stats.status === 'ready' ? stats.data.total : '–'}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-mg-300">Favoris</dt>
                  <dd>
                    <Link to="/app/favorites" className="text-pink-300 font-semibold flex items-center gap-1 hover:underline">
                      <Heart size={10} className="fill-pink-300" aria-hidden="true" /> {stats.status === 'ready' ? stats.data.favorites : '–'}
                    </Link>
                  </dd>
                </div>
              </dl>
              <Link to="/onboarding?edit=1" className="btn-ghost text-xs mt-3.5 w-full justify-center py-1.5">
                Modifier le profil
              </Link>
            </section>
          )}

          {/* Astuce */}
          <div className="p-4 rounded-xl bg-accent/4 border border-accent/10">
            <p className="text-xs font-semibold text-accent mb-1.5 flex items-center gap-1.5">
              <Sparkles size={11} aria-hidden="true" /> Astuce
            </p>
            <p className="text-xs text-mg-200 leading-relaxed">
              {superieur
                ? 'Ajoutez vos supports (cours, polycopiés, articles) dans le générateur : Magistra s’appuie dessus et cite les pages utilisées. Relisez et adaptez toujours le résultat.'
                : 'Ajoutez vos propres documents dans le générateur : Magistra s’appuie dessus et cite ses sources. Relisez et adaptez toujours le résultat à vos élèves.'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
