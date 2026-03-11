import { useState, useRef } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useSearchParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import {
  Sparkles, Download, Copy, Check, FileText,
  Loader2, ChevronDown, Clock, AlertCircle
} from 'lucide-react';
import {
  NIVEAUX, TYPE_CONTENU, SUJETS_SUGGESTIONS, getMatieresForNiveau,
  type GenerationRequest, type TypeContenu, type NiveauScolaire, type Matiere,
  type DifficulteExercice, getNiveauLabel, getMatiereLabel, getMatiereEmoji
} from '@/types';
import { apiGenerate } from '@/lib/api';
import { generateDemoContent } from '@/lib/ai';
import { exportToPDF, exportToText, copyToClipboard } from '@/lib/export';
import { getTeacherProfile } from '@/hooks/useTeacherProfile';

// Tools that need the subject field
const NEEDS_SUJET = ['cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'progression', 'differenciation', 'cahier_journal'];
// Tools that need matiere + niveau
const NEEDS_CONTEXT = ['cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'progression', 'differenciation', 'appreciations', 'cahier_journal', 'corrige', 'lettre_parents'];

export default function GeneratePage() {
  const { user } = useUser();
  const [searchParams] = useSearchParams();
  const profile = getTeacherProfile();

  const initialType = (searchParams.get('type') as TypeContenu) || 'cours';
  const initialSujet = searchParams.get('sujet') || '';

  const [type, setType] = useState<TypeContenu>(initialType);
  const [matiere, setMatiere] = useState<Matiere>(profile?.matierePrincipale ?? 'francais');
  const [niveau, setNiveau] = useState<NiveauScolaire>(profile?.niveaux[0] ?? '6eme');
  const [sujet, setSujet] = useState(initialSujet);
  const [duree, setDuree] = useState('');
  const [objectifs, setObjectifs] = useState('');
  const [difficulte, setDifficulte] = useState<DifficulteExercice>('moyen');
  const [consignes, setConsignes] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // New tool-specific fields
  const [trimestre, setTrimestre] = useState<'1' | '2' | '3'>('1');
  const [profilEleve, setProfilEleve] = useState('bon');
  const [nombreEleves, setNombreEleves] = useState(25);
  const [typeLettre, setTypeLettre] = useState('comportement');
  const [texteEleve, setTexteEleve] = useState('');

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const canGenerate = () => {
    if (type === 'corrige') return texteEleve.trim().length > 0;
    if (type === 'lettre_parents') return true;
    if (type === 'appreciations') return true;
    if (type === 'cahier_journal') return true;
    if (type === 'progression') return true; // subject is optional for annual progression
    if (type === 'differenciation') return sujet.trim().length > 0; // needs a subject to differentiate
    return sujet.trim().length > 0;
  };

  const handleGenerate = async () => {
    if (!canGenerate()) return;
    setGenerating(true);
    setResult(null);
    setError(null);

    const request: GenerationRequest = {
      type, matiere, niveau,
      sujet: sujet.trim() || `${TYPE_CONTENU.find(t => t.value === type)?.label} — ${getMatiereLabel(matiere)} ${getNiveauLabel(niveau)}`,
      duree: duree || undefined,
      objectifs: objectifs || undefined,
      difficulte,
      consignesSupplementaires: consignes || undefined,
      trimestre: type === 'appreciations' ? trimestre : undefined,
      profilsEleves: type === 'appreciations' ? profilEleve : undefined,
      nombreEleves: type === 'appreciations' ? nombreEleves : undefined,
      typeLettre: type === 'lettre_parents' ? typeLettre as GenerationRequest['typeLettre'] : undefined,
      texteEleve: type === 'corrige' ? texteEleve : undefined,
    };

    try {
      if (user?.id) {
        const response = await apiGenerate(user.id, request);
        setResult(response.contenu);
        setRemaining(response.remaining);
      } else {
        await new Promise(r => setTimeout(r, 1500));
        setResult(generateDemoContent(request));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Une erreur est survenue.');
    } finally {
      setGenerating(false);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    await copyToClipboard(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const creationTypes = TYPE_CONTENU.filter(t => t.category === 'creation');
  const outilTypes = TYPE_CONTENU.filter(t => t.category === 'outils');

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      {/* Header */}
      <div className="mb-8 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <div className="badge badge-accent">
            <Sparkles size={12} /> Génération IA
          </div>
          {remaining !== null && (
            <div className="badge badge-accent">
              {remaining} restante{remaining > 1 ? 's' : ''} aujourd'hui
            </div>
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl text-white mb-2" style={{ fontFamily: 'var(--font-display)' }}>
          {profile?.displayName
            ? <>{profile.displayName}, que souhaitez-vous <em className="text-accent not-italic">créer</em> ?</>
            : <>Que souhaitez-vous <em className="text-accent not-italic">créer</em> ?</>
          }
        </h1>
      </div>

      {/* Type selection — Creation */}
      <div className="mb-3 animate-fade-in" style={{ animationDelay: '0.05s' }}>
        <p className="text-xs font-medium text-mg-400 uppercase tracking-wider mb-2">Contenu pédagogique</p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {creationTypes.map(t => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`p-3 rounded-xl border text-center transition-all ${
                type === t.value
                  ? 'border-accent/30 bg-accent/5 shadow-[0_0_15px_rgba(200,182,255,0.06)]'
                  : 'border-white/5 hover:border-white/10 bg-mg-800'
              }`}>
              <span className={`text-xl block mb-1 ${type === t.value ? 'text-accent' : 'text-mg-400'}`}>{t.icon}</span>
              <span className={`text-[11px] font-medium block ${type === t.value ? 'text-white' : 'text-mg-300'}`}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Type selection — Outils */}
      <div className="mb-8 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <p className="text-xs font-medium text-mg-400 uppercase tracking-wider mb-2">Outils enseignant</p>
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {outilTypes.map(t => (
            <button key={t.value} onClick={() => setType(t.value)}
              className={`p-3 rounded-xl border text-center transition-all ${
                type === t.value
                  ? 'border-accent/30 bg-accent/5 shadow-[0_0_15px_rgba(200,182,255,0.06)]'
                  : 'border-white/5 hover:border-white/10 bg-mg-800'
              }`}>
              <span className={`text-xl block mb-1 ${type === t.value ? 'text-accent' : 'text-mg-400'}`}>{t.icon}</span>
              <span className={`text-[11px] font-medium block ${type === t.value ? 'text-white' : 'text-mg-300'}`}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tool description */}
      <div className="mb-6 p-3 rounded-lg bg-mg-800/50 border border-white/5 animate-fade-in">
        <p className="text-sm text-mg-200">
          <span className="text-accent font-medium">{TYPE_CONTENU.find(t => t.value === type)?.icon} {TYPE_CONTENU.find(t => t.value === type)?.label}</span>
          {' — '}{TYPE_CONTENU.find(t => t.value === type)?.description}
        </p>
      </div>

      {/* Dynamic form */}
      <div className="space-y-5 animate-fade-in" style={{ animationDelay: '0.15s' }}>

        {/* Matière + Niveau (for most tools) */}
        {NEEDS_CONTEXT.includes(type) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Niveau</label>
              <select value={niveau} onChange={e => {
                const nv = e.target.value as NiveauScolaire;
                setNiveau(nv);
                const available = getMatieresForNiveau(nv);
                if (!available.find(m => m.value === matiere)) setMatiere(available[0]?.value ?? 'autre');
              }} className="select-field">
                {Object.entries(NIVEAUX).map(([key, group]) => (
                  <optgroup key={key} label={group.label}>
                    {group.niveaux.map(n => <option key={n.value} value={n.value}>{n.label}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Matière</label>
              <select value={matiere} onChange={e => setMatiere(e.target.value as Matiere)} className="select-field">
                {getMatieresForNiveau(niveau).map(m => <option key={m.value} value={m.value}>{m.emoji} {m.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Sujet (for content types) */}
        {NEEDS_SUJET.includes(type) && (
          <div>
            <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">
              {type === 'cahier_journal' ? 'Jour / Thème de la journée' : type === 'progression' ? 'Précisions (optionnel)' : 'Sujet / Thème'}
            </label>
            <input type="text" value={sujet} onChange={e => setSujet(e.target.value)}
              placeholder={type === 'cahier_journal' ? 'Ex : Lundi 15 mars, semaine des maths...' : type === 'progression' ? 'Ex : Progression incluant un projet théâtre au T2...' : 'Ex : La Révolution française, Les fractions...'}
              className="input-field text-base"
              onKeyDown={e => e.key === 'Enter' && handleGenerate()} />
            {!sujet && SUJETS_SUGGESTIONS[matiere] && type !== 'cahier_journal' && type !== 'progression' && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {SUJETS_SUGGESTIONS[matiere]!.slice(0, 4).map(s => (
                  <button key={s} onClick={() => setSujet(s)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-mg-700 text-mg-300 hover:text-accent hover:bg-accent/5 border border-white/5 hover:border-accent/20 transition-all">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* === APPRECIATIONS specific fields === */}
        {type === 'appreciations' && (
          <div className="space-y-4 p-4 rounded-xl bg-mg-800/50 border border-white/5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Trimestre</label>
                <div className="flex gap-2">
                  {(['1', '2', '3'] as const).map(t => (
                    <button key={t} onClick={() => setTrimestre(t)}
                      className={`flex-1 py-2 rounded-lg text-sm border transition-all ${trimestre === t ? 'bg-accent/10 text-accent border-accent/20' : 'bg-mg-700 text-mg-300 border-white/5'}`}>
                      T{t}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Profil élève</label>
                <select value={profilEleve} onChange={e => setProfilEleve(e.target.value)} className="select-field">
                  <option value="excellent">⭐ Excellent</option>
                  <option value="bon">🟢 Bon élève</option>
                  <option value="moyen">🟡 Moyen</option>
                  <option value="fragile">🟠 Fragile / En difficulté</option>
                  <option value="decrocheur">🔴 Décrocheur</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Nombre d'appréciations</label>
                <input type="number" value={nombreEleves} onChange={e => setNombreEleves(parseInt(e.target.value) || 10)}
                  min={1} max={35} className="input-field" />
              </div>
            </div>
            <p className="text-xs text-mg-400">Magistra génèrera {nombreEleves} appréciations variées pour ce profil. Vous choisirez celle qui correspond le mieux à chaque élève.</p>
          </div>
        )}

        {/* === LETTRE PARENTS specific fields === */}
        {type === 'lettre_parents' && (
          <div className="space-y-4 p-4 rounded-xl bg-mg-800/50 border border-white/5">
            <div>
              <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Type de courrier</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { v: 'comportement', l: '⚠️ Comportement', d: 'Signalement de comportement' },
                  { v: 'absence', l: '📋 Absences', d: 'Absences répétées' },
                  { v: 'felicitations', l: '🌟 Félicitations', d: 'Encouragements' },
                  { v: 'reunion', l: '🤝 Réunion', d: 'Convocation RDV' },
                  { v: 'incident', l: '🚨 Incident', d: 'Signalement' },
                  { v: 'orientation', l: '🎯 Orientation', d: 'Information' },
                ].map(lt => (
                  <button key={lt.v} onClick={() => setTypeLettre(lt.v)}
                    className={`p-2.5 rounded-lg text-left border transition-all ${typeLettre === lt.v ? 'bg-accent/10 border-accent/20' : 'bg-mg-700 border-white/5 hover:border-white/10'}`}>
                    <span className={`text-sm block ${typeLettre === lt.v ? 'text-white' : 'text-mg-200'}`}>{lt.l}</span>
                    <span className="text-[10px] text-mg-400">{lt.d}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Contexte / détails</label>
              <textarea value={consignes} onChange={e => setConsignes(e.target.value)} rows={2}
                placeholder="Ex : L'élève a été absent 5 fois ce mois sans justificatif..."
                className="input-field resize-none" />
            </div>
          </div>
        )}

        {/* === CORRIGE specific fields === */}
        {type === 'corrige' && (
          <div className="space-y-4 p-4 rounded-xl bg-mg-800/50 border border-white/5">
            <div>
              <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">
                Travail de l'élève à corriger
              </label>
              <textarea value={texteEleve} onChange={e => setTexteEleve(e.target.value)} rows={8}
                placeholder="Collez ici le texte de l'élève (copie, rédaction, réponse à une question...)&#10;&#10;Exemple :&#10;La révolution française a commencer en 1789 quand les gens étaient pas content du roi. Ils ont pris la Bastille parce que..."
                className="input-field resize-none font-mono text-sm" />
              <p className="text-xs text-mg-400 mt-1">Tapez ou collez le travail de l'élève. Magistra l'analysera et produira un corrigé détaillé avec annotations.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Consigne de l'exercice</label>
              <input type="text" value={sujet} onChange={e => setSujet(e.target.value)}
                placeholder="Ex : Rédiger un paragraphe sur les causes de la Révolution française"
                className="input-field" />
            </div>
          </div>
        )}

        {/* Duration (for applicable types) */}
        {['cours', 'fiche_prep', 'sequence', 'cahier_journal'].includes(type) && (
          <div>
            <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">
              Durée <span className="text-mg-400 normal-case">(optionnel)</span>
            </label>
            <div className="relative">
              <Clock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-mg-400" />
              <input type="text" value={duree} onChange={e => setDuree(e.target.value)}
                placeholder={type === 'cahier_journal' ? 'Ex : Journée complète 8h30-16h30' : 'Ex : 55 minutes, 2 heures...'} className="input-field pl-10" />
            </div>
          </div>
        )}

        {/* Advanced options (for content types) */}
        {['cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep'].includes(type) && (
          <div>
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="btn-ghost text-xs uppercase tracking-wider">
              <ChevronDown size={14} className={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
              Options avancées
            </button>
            {showAdvanced && (
              <div className="mt-4 space-y-4 animate-fade-in">
                <div>
                  <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Objectifs pédagogiques</label>
                  <textarea value={objectifs} onChange={e => setObjectifs(e.target.value)} rows={2}
                    placeholder="Ex : Savoir identifier les causes de la Révolution, maîtriser la chronologie..."
                    className="input-field resize-none" />
                </div>
                {(type === 'exercices' || type === 'evaluation') && (
                  <div>
                    <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Difficulté</label>
                    <div className="flex gap-2 flex-wrap">
                      {(['facile', 'moyen', 'difficile', 'differencie'] as DifficulteExercice[]).map(d => (
                        <button key={d} onClick={() => setDifficulte(d)} className={`px-3 py-1.5 rounded-lg text-sm transition-all border ${
                          difficulte === d ? 'bg-accent/10 text-accent border-accent/20' : 'bg-mg-700 text-mg-300 border-white/5 hover:border-white/10'
                        }`}>
                          {d === 'facile' ? '🟢 Facile' : d === 'moyen' ? '🟡 Moyen' : d === 'difficile' ? '🔴 Difficile' : '🔀 Différencié'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Consignes supplémentaires</label>
                  <textarea value={consignes} onChange={e => setConsignes(e.target.value)} rows={2}
                    placeholder="Ex : Inclure un exercice sur document, adapter pour des élèves allophones..."
                    className="input-field resize-none" />
                </div>
              </div>
            )}
          </div>
        )}

        {/* No-auth notice */}
        {!user && (
          <div className="flex items-start gap-3 p-4 rounded-xl bg-warning/5 border border-warning/15">
            <AlertCircle size={18} className="text-warning shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-warning font-medium">Mode démonstration</p>
              <p className="text-xs text-mg-300 mt-1">Connectez-vous pour générer du vrai contenu pédagogique avec l'IA.</p>
            </div>
          </div>
        )}

        {/* Generate button */}
        <button onClick={handleGenerate} disabled={!canGenerate() || generating}
          className="btn-primary w-full sm:w-auto text-base py-3 px-8">
          {generating ? <><Loader2 size={18} className="animate-spin" /> Génération en cours...</>
            : <><Sparkles size={18} /> Générer</>}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-6 p-4 rounded-xl bg-danger/5 border border-danger/20 animate-fade-in">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {/* Result */}
      {(result || generating) && (
        <div ref={resultRef} className="mt-10 animate-fade-in">
          <div className="glow-line mb-8" />
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{getMatiereEmoji(matiere)}</span>
                <h2 className="text-xl text-white" style={{ fontFamily: 'var(--font-display)' }}>
                  {TYPE_CONTENU.find(t => t.value === type)?.label}
                </h2>
              </div>
              <p className="text-xs text-mg-400">
                {getNiveauLabel(niveau)} · {getMatiereLabel(matiere)}
                {sujet && ` · ${sujet}`}
              </p>
            </div>
            {result && !generating && (
              <div className="flex items-center gap-2">
                <button onClick={handleCopy} className="btn-ghost text-xs">
                  {copied ? <Check size={14} className="text-success" /> : <Copy size={14} />}
                  {copied ? 'Copié' : 'Copier'}
                </button>
                <button onClick={() => exportToText(result, sujet || type)} className="btn-ghost text-xs">
                  <FileText size={14} /> Markdown
                </button>
                <button onClick={() => exportToPDF(result, sujet || type)} className="btn-secondary text-xs py-2 px-3">
                  <Download size={14} /> PDF
                </button>
              </div>
            )}
          </div>

          <div className="card p-6 sm:p-8">
            {generating ? (
              <div className="space-y-4">
                {[75, 100, 85, 65, 50, 100, 80].map((w, i) => (
                  <div key={i} className={`h-${i === 0 || i === 4 ? 6 : 4} rounded animate-shimmer`} style={{ width: `${w}%` }} />
                ))}
              </div>
            ) : (
              <div className="prose-content">
                <ReactMarkdown>{result || ''}</ReactMarkdown>
              </div>
            )}
          </div>

          {result && !generating && (
            <p className="text-xs text-success mt-4 flex items-center gap-1.5">
              <Check size={12} /> Sauvegardé dans votre historique
            </p>
          )}
        </div>
      )}
    </div>
  );
}
