import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Check, ChevronRight, GraduationCap, Loader2, School, Sparkles, Users } from 'lucide-react';
import { defaultMatiereFor, getMatiereEmoji, getMatiereLabel, getMatieresForNiveau, isMatiereAvailableFor, type Matiere } from '@shared/catalog';
import { toMagistraError } from '@shared/errors';
import { ALL_NIVEAUX, NIVEAUX, getNiveauLabel, isNiveau, isSuperieur, type NiveauScolaire } from '@shared/levels';
import type { TeacherProfile } from '@shared/types';
import { FullPageSpinner } from '@/components/guards';
import { PersonalAccessScreen } from '@/components/PersonalAccess';
import LegalLinks from '@/components/LegalLinks';
import SelectField from '@/components/ui/SelectField';
import { useOptionalRuntime } from '@/lib/runtime/context';
import type { RuntimeValue } from '@/lib/runtime/types';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

const CYCLES = [
  { id: 'maternelle', label: 'Maternelle', emoji: '🧒', desc: 'TPS à GS', color: 'from-pink-500/20 to-rose-500/20', border: 'border-pink-500/30' },
  { id: 'primaire', label: 'Élémentaire', emoji: '📚', desc: 'CP à CM2', color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30' },
  { id: 'college', label: 'Collège', emoji: '🏫', desc: '6ème à 3ème', color: 'from-emerald-500/20 to-green-500/20', border: 'border-emerald-500/30' },
  { id: 'lycee_general', label: 'Lycée Général & Techno', emoji: '🎓', desc: '2nde à Terminale', color: 'from-violet-500/20 to-purple-500/20', border: 'border-violet-500/30' },
  { id: 'lycee_pro', label: 'Lycée Professionnel', emoji: '🔧', desc: 'CAP, Bac Pro', color: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-500/30' },
  { id: 'superieur', label: 'Supérieur', emoji: '🏛️', desc: 'BTS à Doctorat', color: 'from-indigo-500/20 to-blue-500/20', border: 'border-indigo-500/30' },
];

const STEPS = ['Bienvenue', 'Établissement', 'Niveaux', 'Matières', 'C’est prêt !'];
const LAST_STEP = STEPS.length - 1;
/** Étapes facultatives : elles seules peuvent être passées. */
const SKIPPABLE_STEPS = new Set([1, 3]);

interface Draft {
  displayName: string;
  etablissement: string;
  cycle: string;
  niveaux: NiveauScolaire[];
  /** Matière choisie explicitement (null : matière par défaut du niveau). */
  matiereChoisie: Matiere | null;
  matiereSecondaire: Matiere | null;
  discipline: string;
}

function cycleOf(niveau: NiveauScolaire | undefined): string {
  if (!niveau) return '';
  return Object.entries(NIVEAUX).find(([, g]) => g.niveaux.some(n => n.value === niveau))?.[0] ?? '';
}

/** Niveaux dans l'ordre officiel (le premier sert de référence pour les matières). */
function sortNiveaux(niveaux: NiveauScolaire[]): NiveauScolaire[] {
  return [...new Set(niveaux)].sort((a, b) => ALL_NIVEAUX.indexOf(a) - ALL_NIVEAUX.indexOf(b));
}

function draftFromProfile(profile: TeacherProfile | null, fallbackName: string): Draft {
  if (!profile) {
    return { displayName: fallbackName, etablissement: '', cycle: '', niveaux: [], matiereChoisie: null, matiereSecondaire: null, discipline: '' };
  }
  const niveaux = sortNiveaux((profile.niveaux ?? []).filter(isNiveau));
  const cycle = profile.cycle && NIVEAUX[profile.cycle] && niveaux.every(n => cycleOf(n) === profile.cycle) ? profile.cycle : cycleOf(niveaux[0]);
  return {
    displayName: profile.displayName ?? '',
    etablissement: profile.etablissement ?? '',
    cycle,
    niveaux: niveaux.filter(n => cycleOf(n) === cycle),
    matiereChoisie: profile.matierePrincipale ?? null,
    matiereSecondaire: profile.matiereSecondaire ?? null,
    discipline: profile.discipline ?? '',
  };
}

/** Matière principale effective : toujours disponible pour le premier niveau choisi. */
function effectiveMatiere(draft: Draft): Matiere | null {
  const first = draft.niveaux[0];
  if (!first) return null;
  return defaultMatiereFor(first, draft.matiereChoisie ?? undefined);
}

function effectiveSecondaire(draft: Draft, principale: Matiere | null): Matiere | undefined {
  const first = draft.niveaux[0];
  const sec = draft.matiereSecondaire;
  if (!first || !sec || sec === principale || !isMatiereAvailableFor(sec, first)) return undefined;
  return sec;
}

function buildProfile(draft: Draft): TeacherProfile | null {
  const principale = effectiveMatiere(draft);
  if (!principale || draft.niveaux.length === 0) return null;
  const secondaire = effectiveSecondaire(draft, principale);
  const discipline = draft.discipline.trim();
  return {
    displayName: draft.displayName.trim(),
    etablissement: draft.etablissement.trim(),
    cycle: draft.cycle,
    niveaux: draft.niveaux,
    matierePrincipale: principale,
    ...(secondaire ? { matiereSecondaire: secondaire } : {}),
    ...(discipline ? { discipline } : {}),
  };
}

function storageNotice(mode: RuntimeValue['mode']): string {
  if (mode === 'web') return 'Votre profil est enregistré dans votre compte : il n’est partagé avec aucun autre utilisateur.';
  if (mode === 'local') return 'Votre profil est enregistré sur cet ordinateur uniquement.';
  if (mode === 'personal') return 'Mode personnel : votre profil est enregistré par le serveur Magistra démarré sur cet ordinateur, sans compte.';
  return 'Mode démonstration : votre profil est enregistré dans ce navigateur uniquement.';
}

export default function OnboardingPage() {
  useDocumentTitle('Profil enseignant');
  const runtime = useOptionalRuntime();
  const [searchParams] = useSearchParams();
  const explicitEdit = searchParams.get('edit') === '1';

  if (!runtime || runtime.profileStatus === 'loading') return <FullPageSpinner label="Chargement de votre profil…" />;
  if (runtime.profileStatus === 'error') {
    if (runtime.mode === 'personal' && runtime.profileError?.code === 'UNAUTHENTICATED') return <PersonalAccessScreen rejected />;
    return (
      <div className="min-h-screen flex items-center justify-center bg-mg-900 px-6" role="alert">
        <div className="card max-w-md text-center p-8">
          <p className="text-white mb-2 font-semibold">Impossible de charger votre profil.</p>
          <p className="text-sm text-mg-200 mb-5">Vérifiez votre connexion puis réessayez. Aucun profil n’a été modifié.</p>
          <button type="button" className="btn-primary text-sm py-2 px-5" onClick={() => void runtime.reloadProfile()}>
            Réessayer
          </button>
        </div>
      </div>
    );
  }
  return <OnboardingWizard runtime={runtime} explicitEdit={explicitEdit} />;
}

function OnboardingWizard({ runtime, explicitEdit }: { runtime: RuntimeValue; explicitEdit: boolean }) {
  const navigate = useNavigate();
  // Un profil existant n'est jamais écrasé sans « Enregistrer » explicite : on passe en mode édition.
  const [editing] = useState(() => explicitEdit || runtime.profile !== null);
  const [canCancel] = useState(() => runtime.profile !== null);
  const [draft, setDraft] = useState<Draft>(() => draftFromProfile(runtime.profile, runtime.user?.firstName ?? ''));
  const [step, setStep] = useState(() => (editing ? 1 : 0));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) {
      previousStep.current = step;
      headingRef.current?.focus();
    }
  }, [step]);

  const principale = effectiveMatiere(draft);
  const secondaire = effectiveSecondaire(draft, principale);
  const firstNiveau = draft.niveaux[0];
  const availableMatieres = firstNiveau ? getMatieresForNiveau(firstNiveau) : [];
  const selectedCycleNiveaux = draft.cycle ? NIVEAUX[draft.cycle]?.niveaux ?? [] : [];
  const superieur = firstNiveau ? isSuperieur(firstNiveau) : draft.cycle === 'superieur';
  const niveauxValid = draft.niveaux.length > 0;

  const canReach = (target: number) => target <= 2 || niveauxValid;
  const canNext = step === 2 ? niveauxValid : true;
  const cancelTarget = explicitEdit ? '/app/settings' : '/app';

  const goTo = (target: number) => {
    if (target >= 0 && target <= LAST_STEP && canReach(target)) setStep(target);
  };

  const selectCycle = (id: string) => {
    setDraft(d => (d.cycle === id ? d : { ...d, cycle: id, niveaux: [] }));
  };

  const toggleNiveau = (niveau: NiveauScolaire) => {
    setDraft(d => {
      const niveaux = d.niveaux.includes(niveau) ? d.niveaux.filter(v => v !== niveau) : sortNiveaux([...d.niveaux, niveau]);
      return { ...d, niveaux };
    });
  };

  const handleSave = async () => {
    const profile = buildProfile(draft);
    if (!profile) {
      setStep(2);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await runtime.saveProfile(profile);
      navigate('/app', { replace: true });
    } catch (err) {
      setSaveError(`Enregistrement impossible : ${toMagistraError(err).message}`);
      setSaving(false);
    }
  };

  const headingProps = {
    ref: headingRef,
    tabIndex: -1,
    className: 'text-xl text-white focus:outline-none',
    style: { fontFamily: 'var(--font-display)' },
  } as const;

  return (
    <div className="min-h-screen bg-mg-900 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">
        {editing && (
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-mg-200">Modification de votre profil</p>
            {canCancel && (
              <button type="button" className="btn-ghost text-sm py-1.5 px-3" onClick={() => navigate(cancelTarget)}>
                Annuler
              </button>
            )}
          </div>
        )}

        {/* Progression */}
        <ol className="flex items-center gap-1 mb-8" aria-label="Étapes">
          {STEPS.map((s, i) => {
            const bar = (
              <>
                <span className={`h-1 w-full rounded-full transition-all duration-500 ${i <= step ? 'bg-accent' : 'bg-mg-600'}`} aria-hidden="true" />
                <span className={`text-[10px] tracking-wide transition-colors ${i <= step ? 'text-accent' : 'text-mg-300'}`}>{s}</span>
              </>
            );
            return (
              <li key={s} className="flex-1" aria-current={i === step ? 'step' : undefined}>
                {editing ? (
                  <button
                    type="button"
                    onClick={() => goTo(i)}
                    disabled={!canReach(i)}
                    className="w-full flex flex-col items-center gap-1.5 disabled:cursor-not-allowed rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                  >
                    {bar}
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">{bar}</div>
                )}
              </li>
            );
          })}
        </ol>

        <div className="card p-6 sm:p-8 border-accent/5">
          {/* === Étape 0 : Bienvenue === */}
          {step === 0 && (
            <div className="text-center animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center mx-auto mb-5">
                <GraduationCap size={32} className="text-mg-900" aria-hidden="true" />
              </div>
              <h1 {...headingProps} className="text-2xl sm:text-3xl text-white mb-3 focus:outline-none">
                Bienvenue sur <span className="text-accent">Magistra</span>
              </h1>
              <p className="text-mg-200 text-sm leading-relaxed max-w-md mx-auto mb-6">
                En quelques instants, indiquez vos niveaux et votre matière : Magistra adapte ensuite le vocabulaire,
                les exigences et les suggestions à votre enseignement.
              </p>
              <ul className="flex flex-col gap-2 text-left max-w-xs mx-auto mb-2">
                <li className="flex items-center gap-3 text-sm text-mg-100">
                  <Sparkles size={16} className="text-accent shrink-0" aria-hidden="true" />
                  <span>Cours, TD, évaluations, syllabus, appréciations…</span>
                </li>
                <li className="flex items-center gap-3 text-sm text-mg-100">
                  <Users size={16} className="text-accent shrink-0" aria-hidden="true" />
                  <span>Adapté à vos niveaux, à votre discipline et à vos documents</span>
                </li>
                <li className="flex items-center gap-3 text-sm text-mg-100">
                  <BookOpen size={16} className="text-accent shrink-0" aria-hidden="true" />
                  <span>De la maternelle au doctorat, avec un accent sur le supérieur</span>
                </li>
              </ul>
            </div>
          )}

          {/* === Étape 1 : Établissement (facultatif) === */}
          {step === 1 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <School size={20} className="text-accent" aria-hidden="true" />
                <h2 {...headingProps}>Votre établissement</h2>
              </div>
              <p className="text-sm text-mg-200 mb-6">Ces informations sont facultatives.</p>

              <div className="space-y-4">
                <div>
                  <label htmlFor="onb-etablissement" className="block text-xs font-medium text-mg-200 mb-2 uppercase tracking-wider">
                    Nom de l’établissement <span className="text-mg-300 normal-case">(facultatif)</span>
                  </label>
                  <input
                    id="onb-etablissement"
                    type="text"
                    value={draft.etablissement}
                    onChange={e => setDraft(d => ({ ...d, etablissement: e.target.value }))}
                    placeholder="Ex : Université de Bordeaux, Collège Victor Hugo…"
                    className="input-field text-base"
                    maxLength={160}
                    autoComplete="organization"
                  />
                </div>
                <div>
                  <label htmlFor="onb-nom" className="block text-xs font-medium text-mg-200 mb-2 uppercase tracking-wider">
                    Votre nom <span className="text-mg-300 normal-case">(facultatif)</span>
                  </label>
                  <input
                    id="onb-nom"
                    type="text"
                    value={draft.displayName}
                    onChange={e => setDraft(d => ({ ...d, displayName: e.target.value }))}
                    placeholder="Ex : Mme Dupont, M. Martin…"
                    className="input-field"
                    maxLength={80}
                    autoComplete="name"
                  />
                </div>
              </div>
            </div>
          )}

          {/* === Étape 2 : Cycle et niveaux (obligatoire) === */}
          {step === 2 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <Users size={20} className="text-accent" aria-hidden="true" />
                <h2 {...headingProps}>Vos niveaux</h2>
              </div>
              <p className="text-sm text-mg-200 mb-5" id="onb-niveaux-hint">
                Sélectionnez votre cycle puis au moins une classe.
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5" role="group" aria-label="Cycle">
                {CYCLES.map(c => {
                  const active = draft.cycle === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => selectCycle(c.id)}
                      className={`p-3 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                        active ? `bg-gradient-to-br ${c.color} ${c.border} shadow-lg` : 'bg-mg-700 border-white/5 hover:border-white/10'
                      }`}
                    >
                      <span className="text-xl block mb-1" aria-hidden="true">{c.emoji}</span>
                      <span className={`text-xs font-semibold block ${active ? 'text-white' : 'text-mg-100'}`}>{c.label}</span>
                      <span className="text-[10px] text-mg-200 block">{c.desc}</span>
                    </button>
                  );
                })}
              </div>

              {draft.cycle && (
                <div>
                  <p id="onb-classes-label" className="text-xs text-mg-200 mb-2 uppercase tracking-wider font-medium">
                    Vos classes <span className="text-mg-300 normal-case">(sélection multiple)</span>
                  </p>
                  <div className="flex flex-wrap gap-2" role="group" aria-labelledby="onb-classes-label">
                    {selectedCycleNiveaux.map(n => {
                      const selected = draft.niveaux.includes(n.value);
                      return (
                        <button
                          key={n.value}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleNiveau(n.value)}
                          className={`px-3 py-1.5 rounded-lg text-sm border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                            selected ? 'bg-accent/15 text-accent border-accent/25 font-medium' : 'bg-mg-700 text-mg-200 border-white/5 hover:border-white/10'
                          }`}
                        >
                          {selected && <Check size={12} className="inline mr-1" aria-hidden="true" />}
                          {n.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {!niveauxValid && (
                <p className="text-xs text-mg-300 mt-4" role="note">
                  Au moins une classe est nécessaire pour adapter les contenus : cette étape ne peut pas être passée.
                </p>
              )}
            </div>
          )}

          {/* === Étape 3 : Matières === */}
          {step === 3 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <BookOpen size={20} className="text-accent" aria-hidden="true" />
                <h2 {...headingProps}>Vos matières</h2>
              </div>
              <p className="text-sm text-mg-200 mb-5">
                Matières proposées pour {firstNiveau ? getNiveauLabel(firstNiveau) : 'votre niveau'}.
              </p>

              <div className="space-y-5">
                <div>
                  <p id="onb-matiere-label" className="block text-xs font-medium text-mg-200 mb-2 uppercase tracking-wider">
                    Matière principale
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1" role="group" aria-labelledby="onb-matiere-label">
                    {availableMatieres.map(m => {
                      const active = principale === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setDraft(d => ({ ...d, matiereChoisie: m.value }))}
                          className={`p-3 rounded-xl border text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
                            active ? 'bg-accent/10 border-accent/25' : 'bg-mg-700 border-white/5 hover:border-white/10'
                          }`}
                        >
                          <span className="text-lg mr-2" aria-hidden="true">{m.emoji}</span>
                          <span className={`text-sm ${active ? 'text-white font-medium' : 'text-mg-100'}`}>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p id="onb-secondaire-label" className="block text-xs font-medium text-mg-200 mb-2 uppercase tracking-wider">
                    Matière secondaire <span className="text-mg-300 normal-case">(facultatif)</span>
                  </p>
                  <SelectField
                    ariaLabelledBy="onb-secondaire-label"
                    value={secondaire ?? ''}
                    onChange={v => setDraft(d => ({ ...d, matiereSecondaire: (v || null) as Matiere | null }))}
                    options={[
                      { value: '', label: '— Aucune —' },
                      ...availableMatieres.filter(m => m.value !== principale).map(m => ({ value: m.value, label: m.label, prefix: m.emoji })),
                    ]}
                  />
                  <p className="text-xs text-mg-300 mt-1.5">Elle est prise en compte dans les contenus générés, en complément de la matière principale.</p>
                </div>

                <div>
                  <label htmlFor="onb-discipline" className="block text-xs font-medium text-mg-200 mb-2 uppercase tracking-wider">
                    Discipline / spécialité <span className="text-mg-300 normal-case">(facultatif)</span>
                  </label>
                  <input
                    id="onb-discipline"
                    type="text"
                    value={draft.discipline}
                    onChange={e => setDraft(d => ({ ...d, discipline: e.target.value }))}
                    placeholder={superieur ? 'Ex : Systèmes d’information, Droit public, Microbiologie…' : 'Ex : Lettres modernes, Section européenne…'}
                    className="input-field"
                    maxLength={120}
                    aria-describedby="onb-discipline-help"
                  />
                  <p id="onb-discipline-help" className="text-xs text-mg-300 mt-1.5">
                    {superieur
                      ? 'Précisez votre champ : le vocabulaire et les références des contenus s’y adapteront.'
                      : 'Utile si votre enseignement est plus spécialisé que la matière choisie.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* === Étape 4 : Récapitulatif === */}
          {step === LAST_STEP && (
            <div className="text-center animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-success/10 border border-success/20 flex items-center justify-center mx-auto mb-5">
                <Check size={32} className="text-success" aria-hidden="true" />
              </div>
              <h2 {...headingProps} className="text-2xl text-white mb-2 focus:outline-none">
                {editing ? <>Vérifiez vos <span className="text-accent">modifications</span></> : <>Votre espace est <span className="text-accent">prêt</span></>}
              </h2>
              <p className="text-sm text-mg-200 mb-6 max-w-sm mx-auto">
                Vos niveaux et matières seront pré-sélectionnés à chaque génération. Vous pourrez les modifier à tout moment dans les Réglages.
              </p>

              <div className="card p-4 text-left mb-4 bg-mg-700/50">
                <dl className="space-y-2 text-sm">
                  {draft.displayName.trim() && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-mg-300">Nom</dt>
                      <dd className="text-mg-50 font-medium text-right">{draft.displayName.trim()}</dd>
                    </div>
                  )}
                  <div className="flex justify-between gap-4">
                    <dt className="text-mg-300">Établissement</dt>
                    <dd className="text-mg-50 font-medium text-right">{draft.etablissement.trim() || <span className="text-mg-300 font-normal">Non renseigné</span>}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-mg-300">Cycle</dt>
                    <dd className="text-mg-50 font-medium text-right">{CYCLES.find(c => c.id === draft.cycle)?.label ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-mg-300">Classes</dt>
                    <dd className="text-mg-50 font-medium text-right">{draft.niveaux.map(n => getNiveauLabel(n)).join(', ')}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-mg-300">Matière principale</dt>
                    <dd className="text-mg-50 font-medium text-right">
                      {principale ? <><span aria-hidden="true">{getMatiereEmoji(principale)} </span>{getMatiereLabel(principale)}</> : '—'}
                    </dd>
                  </div>
                  {secondaire && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-mg-300">Matière secondaire</dt>
                      <dd className="text-mg-50 font-medium text-right">
                        <span aria-hidden="true">{getMatiereEmoji(secondaire)} </span>{getMatiereLabel(secondaire)}
                      </dd>
                    </div>
                  )}
                  {draft.discipline.trim() && (
                    <div className="flex justify-between gap-4">
                      <dt className="text-mg-300">Discipline</dt>
                      <dd className="text-mg-50 font-medium text-right">{draft.discipline.trim()}</dd>
                    </div>
                  )}
                </dl>
              </div>
              <p className="text-xs text-mg-300 mb-2">{storageNotice(runtime.mode)}</p>
              {saveError && (
                <p className="text-sm text-danger mt-3" role="alert">{saveError}</p>
              )}
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-5 border-t border-white/5">
            {step > 0 ? (
              <button type="button" onClick={() => goTo(step - 1)} className="btn-ghost text-sm" disabled={saving}>
                ← Retour
              </button>
            ) : runtime.mode === 'local' && !canCancel ? (
              // Application Windows, premier lancement : ni barre d'adresse ni bouton « précédent » — la présentation
              // de Magistra (page d'accueil tant qu'aucun profil n'existe) reste à un clic, jamais une impasse.
              <Link to="/" className="btn-ghost text-sm">← Présentation</Link>
            ) : <div />}

            {step < LAST_STEP ? (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                disabled={!canNext}
                aria-describedby={step === 2 && !canNext ? 'onb-niveaux-hint' : undefined}
                className="btn-primary text-sm py-2.5 px-6"
              >
                Continuer <ChevronRight size={14} aria-hidden="true" />
              </button>
            ) : (
              <button type="button" onClick={() => void handleSave()} disabled={saving || !niveauxValid} className="btn-primary text-sm py-2.5 px-6">
                {saving ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : editing ? <Check size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
                {saving ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Commencer à générer'}
              </button>
            )}
          </div>
        </div>

        {/* Avant de créer son espace : où lire comment les données sont traitées (pages publiques). Nouvel onglet : le profil
            en cours de saisie n'est pas conservé si l'assistant est quitté. Application Windows : pas d'onglet, les pages
            s'ouvrent dans l'application. */}
        {!editing && (
          <p className="text-center text-xs text-mg-300 mt-5">
            En continuant, vous pouvez consulter : <LegalLinks newTab={runtime.mode !== 'local'} />
          </p>
        )}

        {/* Seules les étapes facultatives peuvent être passées */}
        {SKIPPABLE_STEPS.has(step) && (
          <div className="text-center mt-4">
            <button type="button" onClick={() => goTo(step + 1)} className="text-xs text-mg-300 hover:text-mg-100 transition-colors">
              Passer cette étape →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
