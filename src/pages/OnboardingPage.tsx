import { useState } from 'react';
import { useCurrentUser } from '@/lib/auth';
import { useNavigate } from 'react-router-dom';
import {
  GraduationCap, ChevronRight, School, BookOpen, Users, Sparkles, Check
} from 'lucide-react';
import {
  NIVEAUX, getMatieresForNiveau,
  type NiveauScolaire, type Matiere
} from '@/types';
import type { TeacherProfile } from '@/hooks/useTeacherProfile';

const CYCLES = [
  { id: 'maternelle', label: 'Maternelle', emoji: '🧒', desc: 'TPS à GS', color: 'from-pink-500/20 to-rose-500/20', border: 'border-pink-500/30' },
  { id: 'primaire', label: 'Élémentaire', emoji: '📚', desc: 'CP à CM2', color: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/30' },
  { id: 'college', label: 'Collège', emoji: '🏫', desc: '6ème à 3ème', color: 'from-emerald-500/20 to-green-500/20', border: 'border-emerald-500/30' },
  { id: 'lycee_general', label: 'Lycée Général & Techno', emoji: '🎓', desc: '2nde à Terminale', color: 'from-violet-500/20 to-purple-500/20', border: 'border-violet-500/30' },
  { id: 'lycee_pro', label: 'Lycée Professionnel', emoji: '🔧', desc: 'CAP, Bac Pro', color: 'from-amber-500/20 to-orange-500/20', border: 'border-amber-500/30' },
  { id: 'superieur', label: 'Supérieur', emoji: '🏛️', desc: 'BTS à Doctorat', color: 'from-indigo-500/20 to-blue-500/20', border: 'border-indigo-500/30' },
];

const STEPS = ['Bienvenue', 'Établissement', 'Niveaux', 'Matières', 'C\'est prêt !'];

export default function OnboardingPage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<TeacherProfile>({
    displayName: user?.firstName || '',
    etablissement: '',
    cycle: '',
    niveaux: [],
    matierePrincipale: 'francais',
  });

  const canNext = () => {
    if (step === 0) return true;
    if (step === 1) return profile.etablissement.trim().length > 0;
    if (step === 2) return profile.cycle !== '' && profile.niveaux.length > 0;
    if (step === 3) return !!profile.matierePrincipale;
    return true;
  };

  const handleFinish = () => {
    // Save profile to localStorage (will be synced to Supabase when backend is available)
    localStorage.setItem('magistra_teacher_profile', JSON.stringify(profile));
    localStorage.setItem('magistra_onboarding_done', 'true');
    navigate('/app');
  };

  const selectedCycleNiveaux = profile.cycle ? NIVEAUX[profile.cycle]?.niveaux ?? [] : [];
  const firstSelectedNiveau = profile.niveaux[0];
  const availableMatieres = firstSelectedNiveau ? getMatieresForNiveau(firstSelectedNiveau) : [];

  return (
    <div className="min-h-screen bg-mg-900 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-xl">

        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
              <div className={`h-1 w-full rounded-full transition-all duration-500 ${
                i <= step ? 'bg-accent' : 'bg-mg-700'
              }`} />
              <span className={`text-[10px] tracking-wide transition-colors ${
                i <= step ? 'text-accent' : 'text-mg-500'
              }`}>{s}</span>
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="card p-6 sm:p-8 border-accent/5">

          {/* === STEP 0: Welcome === */}
          {step === 0 && (
            <div className="text-center animate-fade-in">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-dim to-accent flex items-center justify-center mx-auto mb-5">
                <GraduationCap size={32} className="text-mg-900" />
              </div>
              <h1 className="text-2xl sm:text-3xl text-white mb-3" style={{ fontFamily: 'var(--font-display)' }}>
                Bienvenue sur <span className="text-accent">Magistra</span>
              </h1>
              <p className="text-mg-300 text-sm leading-relaxed max-w-md mx-auto mb-6">
                En quelques secondes, personnalisez votre espace pour que Magistra s'adapte
                parfaitement à votre pratique. Vos cours, vos niveaux, votre style.
              </p>
              <div className="flex flex-col gap-2 text-left max-w-xs mx-auto mb-2">
                <div className="flex items-center gap-3 text-sm text-mg-200">
                  <Sparkles size={16} className="text-accent shrink-0" />
                  <span>Génération de cours, exercices, évaluations</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-mg-200">
                  <Users size={16} className="text-accent shrink-0" />
                  <span>Adapté à vos élèves et au programme officiel</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-mg-200">
                  <BookOpen size={16} className="text-accent shrink-0" />
                  <span>De la maternelle à l'université</span>
                </div>
              </div>
            </div>
          )}

          {/* === STEP 1: Établissement === */}
          {step === 1 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <School size={20} className="text-accent" />
                <h2 className="text-xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Votre établissement</h2>
              </div>
              <p className="text-sm text-mg-400 mb-6">Dans quel établissement enseignez-vous ?</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Nom de l'établissement</label>
                  <input
                    type="text"
                    value={profile.etablissement}
                    onChange={e => setProfile({ ...profile, etablissement: e.target.value })}
                    placeholder="Ex : École Jean Moulin, Collège Victor Hugo..."
                    className="input-field text-base"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">
                    Votre nom <span className="text-mg-500 normal-case">(optionnel)</span>
                  </label>
                  <input
                    type="text"
                    value={profile.displayName}
                    onChange={e => setProfile({ ...profile, displayName: e.target.value })}
                    placeholder="Ex : Mme Dupont, M. Martin..."
                    className="input-field"
                  />
                </div>
              </div>
            </div>
          )}

          {/* === STEP 2: Cycle & Niveaux === */}
          {step === 2 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <Users size={20} className="text-accent" />
                <h2 className="text-xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Vos niveaux</h2>
              </div>
              <p className="text-sm text-mg-400 mb-5">Sélectionnez votre cycle puis vos classes</p>

              {/* Cycle selection */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
                {CYCLES.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setProfile({ ...profile, cycle: c.id, niveaux: [] })}
                    className={`p-3 rounded-xl border text-left transition-all ${
                      profile.cycle === c.id
                        ? `bg-gradient-to-br ${c.color} ${c.border} shadow-lg`
                        : 'bg-mg-700 border-white/5 hover:border-white/10'
                    }`}
                  >
                    <span className="text-xl block mb-1">{c.emoji}</span>
                    <span className={`text-xs font-semibold block ${profile.cycle === c.id ? 'text-white' : 'text-mg-200'}`}>{c.label}</span>
                    <span className="text-[10px] text-mg-400 block">{c.desc}</span>
                  </button>
                ))}
              </div>

              {/* Level selection within cycle */}
              {profile.cycle && (
                <div>
                  <p className="text-xs text-mg-300 mb-2 uppercase tracking-wider font-medium">
                    Vos classes <span className="text-mg-500 normal-case">(sélection multiple)</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {selectedCycleNiveaux.map(n => {
                      const selected = profile.niveaux.includes(n.value);
                      return (
                        <button
                          key={n.value}
                          onClick={() => {
                            const niveaux = selected
                              ? profile.niveaux.filter(v => v !== n.value)
                              : [...profile.niveaux, n.value];
                            setProfile({ ...profile, niveaux });
                          }}
                          className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${
                            selected
                              ? 'bg-accent/15 text-accent border-accent/25 font-medium'
                              : 'bg-mg-700 text-mg-300 border-white/5 hover:border-white/10'
                          }`}
                        >
                          {selected && <Check size={12} className="inline mr-1" />}
                          {n.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === STEP 3: Matières === */}
          {step === 3 && (
            <div className="animate-fade-in">
              <div className="flex items-center gap-2 mb-1">
                <BookOpen size={20} className="text-accent" />
                <h2 className="text-xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Vos matières</h2>
              </div>
              <p className="text-sm text-mg-400 mb-5">Quelle est votre matière principale ?</p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Matière principale</label>
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
                    {availableMatieres.map(m => (
                      <button
                        key={m.value}
                        onClick={() => setProfile({ ...profile, matierePrincipale: m.value })}
                        className={`p-3 rounded-xl border text-left transition-all ${
                          profile.matierePrincipale === m.value
                            ? 'bg-accent/10 border-accent/25'
                            : 'bg-mg-700 border-white/5 hover:border-white/10'
                        }`}
                      >
                        <span className="text-lg mr-2">{m.emoji}</span>
                        <span className={`text-sm ${profile.matierePrincipale === m.value ? 'text-white font-medium' : 'text-mg-200'}`}>
                          {m.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">
                    Matière secondaire <span className="text-mg-500 normal-case">(optionnel)</span>
                  </label>
                  <select
                    value={profile.matiereSecondaire ?? ''}
                    onChange={e => setProfile({ ...profile, matiereSecondaire: (e.target.value || undefined) as Matiere | undefined })}
                    className="select-field"
                  >
                    <option value="">— Aucune —</option>
                    {availableMatieres.filter(m => m.value !== profile.matierePrincipale).map(m => (
                      <option key={m.value} value={m.value}>{m.emoji} {m.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* === STEP 4: Done === */}
          {step === 4 && (
            <div className="text-center animate-fade-in">
              <div className="w-16 h-16 rounded-full bg-success/10 border border-success/20 flex items-center justify-center mx-auto mb-5">
                <Check size={32} className="text-success" />
              </div>
              <h2 className="text-2xl text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
                Votre espace est <span className="text-accent">prêt</span>
              </h2>
              <p className="text-sm text-mg-300 mb-6 max-w-sm mx-auto">
                Magistra est maintenant configuré pour vous. Vos niveaux et matières seront pré-sélectionnés à chaque génération.
              </p>

              <div className="card p-4 text-left mb-6 bg-mg-700/50">
                <div className="space-y-2 text-sm">
                  {profile.displayName && (
                    <div className="flex justify-between">
                      <span className="text-mg-400">Nom</span>
                      <span className="text-mg-100 font-medium">{profile.displayName}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-mg-400">Établissement</span>
                    <span className="text-mg-100 font-medium">{profile.etablissement}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mg-400">Cycle</span>
                    <span className="text-mg-100 font-medium">{CYCLES.find(c => c.id === profile.cycle)?.label}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mg-400">Classes</span>
                    <span className="text-mg-100 font-medium">
                      {profile.niveaux.map(n => NIVEAUX[profile.cycle]?.niveaux.find(x => x.value === n)?.label ?? n).join(', ')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mg-400">Matière</span>
                    <span className="text-mg-100 font-medium">
                      {availableMatieres.find(m => m.value === profile.matierePrincipale)?.emoji}{' '}
                      {availableMatieres.find(m => m.value === profile.matierePrincipale)?.label}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-between mt-8 pt-5 border-t border-white/5">
            {step > 0 ? (
              <button onClick={() => setStep(step - 1)} className="btn-ghost text-sm">
                ← Retour
              </button>
            ) : <div />}

            {step < 4 ? (
              <button
                onClick={() => setStep(step + 1)}
                disabled={!canNext()}
                className="btn-primary text-sm py-2.5 px-6"
              >
                Continuer <ChevronRight size={14} />
              </button>
            ) : (
              <button onClick={handleFinish} className="btn-primary text-sm py-2.5 px-6">
                <Sparkles size={14} /> Commencer à générer
              </button>
            )}
          </div>
        </div>

        {/* Skip */}
        {step < 4 && (
          <div className="text-center mt-4">
            <button onClick={handleFinish} className="text-xs text-mg-500 hover:text-mg-300 transition-colors">
              Passer cette étape →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
