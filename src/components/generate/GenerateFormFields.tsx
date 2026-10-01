// Champs du formulaire, affichés selon l'outil (TOOL_FIELDS), le niveau (supérieur ou non) et la matière (formats
// normés). Un champ non affiché n'est jamais transmis (voir src/lib/generation/request.ts).
// Ordre : niveau et matière, puis le choix principal de l'outil (format normé : « Type d'exercice », « Format de
// l'épreuve »…), les champs propres à l'outil, une grille compacte de réglages, enfin objectifs et consignes.

import type { ReactElement } from 'react';
import { Clock } from 'lucide-react';
import {
  DIFFICULTES, FORMATS_SEANCE, getMatieresForNiveau, getSujetSuggestions, PROFILS_DIFFERENCIATION, PROFILS_ELEVE,
  TOOL_FIELDS, TOOL_REQUIRES_SUJET, TYPES_LETTRE,
  type DifficulteExercice, type FormatSeance, type Matiere, type ProfilDifferenciation, type ProfilEleve, type TypeContenu,
} from '@shared/catalog';
import {
  BAREMES, BESOINS_PARTICULIERS, countLabel, countUnit, defaultModaliteLabel, modaliteFieldLabel, modalitesFor, NOMBRES_SEANCES,
  TONS, TYPES_EVALUATION,
  type Bareme, type BesoinParticulier, type TonRedaction, type TypeEvaluation,
} from '@shared/formats';
import { getLevelGroup, isNiveau, isSuperieur, NIVEAUX, type NiveauScolaire } from '@shared/levels';
import SelectField from '@/components/ui/SelectField';
import {
  appreciationSummary, chosenCount, fieldLimit, formDefaultNotation, MAX_APPRECIATIONS, MIN_APPRECIATIONS, normalizeAppreciationInput, visibleFields,
  type FormField, type FormProblem, type GenerateForm, type Trimestre,
} from '@/lib/generation/request';
import { ChipGroup, ChoiceButton, Field, type ChipOption } from './fields';
import { describedBy, FOCUS_RING, LABEL_CLASS } from './fieldUtils';

interface GenerateFormFieldsProps {
  form: GenerateForm;
  onChange(patch: Partial<GenerateForm>): void;
  onNiveauChange(niveau: NiveauScolaire): void;
  problems: FormProblem[];
  showErrors: boolean;
}

const CONTENT_TOOLS: TypeContenu[] = ['cours', 'exercices', 'evaluation', 'sequence', 'fiche_prep', 'differenciation'];

/**
 * Outils dont les choix sont des formats de travail (QCM, application… après ceux de la discipline ou de l'épreuve) :
 * seuls à recevoir la légende « Formats généraux ». Ailleurs (destination, démarche, forme de la progression, type de
 * séance), les choix ne sont pas des formats et la légende induirait en erreur.
 */
const CAPTIONED_TOOLS: TypeContenu[] = ['exercices', 'evaluation', 'corrige'];

const FORMAT_SHORT: Record<FormatSeance, string> = { cm: 'CM', td: 'TD', tp: 'TP', seminaire: 'Séminaire' };

function sujetText(tool: TypeContenu, sup: boolean): { label: string; placeholder: string; hint?: string } {
  switch (tool) {
    case 'progression':
      return {
        label: 'Précisions',
        placeholder: sup ? 'Ex : 12 semaines, 24 h de CM et 12 h de TD…' : 'Ex : inclure un projet théâtre au 2e trimestre…',
      };
    case 'appreciations':
      return { label: 'Contexte', placeholder: 'Ex : chapitre sur les fractions, travail en groupe…' };
    case 'differenciation':
      return {
        label: 'Sujet / notion',
        placeholder: 'Ex : Les fractions, le passé composé…',
        hint: "Indiquez un sujet, collez l'exercice à adapter ci-dessous, ou les deux.",
      };
    case 'cahier_journal':
      return { label: sup ? 'Jour / thème' : 'Jour / thème de la journée', placeholder: 'Ex : lundi 15 mars, semaine des mathématiques…' };
    case 'corrige':
      return { label: "Consigne de l'exercice", placeholder: 'Ex : Rédiger un paragraphe argumenté sur les causes de la Révolution française' };
    default:
      return {
        label: 'Sujet / thème',
        placeholder: sup ? "Ex : La gouvernance des systèmes d'information" : 'Ex : La Révolution française, les fractions…',
      };
  }
}

function consignesText(tool: TypeContenu, sup: boolean): { label: string; placeholder: string; hint?: string; rows: number } {
  switch (tool) {
    case 'lettre_parents':
      return {
        label: 'Contexte et détails',
        placeholder: sup
          ? 'Ex : changement de salle pour le TD du 12 mars, rendu du dossier repoussé…'
          : "Ex : l'élève a été absent 5 fois ce mois-ci sans justificatif…",
        hint: "Magistra est invité à ne rien inventer et à laisser entre crochets ce qui manque ([Date], [Nom]…) : relisez chaque information avant envoi.",
        rows: 4,
      };
    case 'corrige':
      return { label: 'Attentes de correction', placeholder: "Ex : barème sur 10, insister sur l'argumentation…", rows: 3 };
    case 'differenciation':
      return { label: 'Consignes supplémentaires', placeholder: 'Ex : calculatrice autorisée, consignes de 2 lignes maximum…', rows: 3 };
    default:
      return {
        label: 'Consignes supplémentaires',
        placeholder: sup
          ? 'Ex : insister sur les controverses, inclure une étude de cas…'
          : 'Ex : inclure un exercice sur document, adapter pour des élèves allophones…',
        rows: 3,
      };
  }
}

function CharCount({ value, field }: { value: string; field: FormField }) {
  const max = fieldLimit(field);
  if (!max || value.length < max * 0.8) return null;
  const over = value.length > max;
  return (
    <p className={`text-xs mt-1 text-right ${over ? 'text-warning' : 'text-mg-300'}`}>
      {value.length.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')} caractères
    </p>
  );
}

export default function GenerateFormFields({ form, onChange, onNiveauChange, problems, showErrors }: GenerateFormFieldsProps) {
  const tool = form.type;
  const sup = isSuperieur(form.niveau);
  const fields = visibleFields(tool, form.niveau, form.matiere, form.modalite);
  const has = (f: FormField) => fields.has(f);
  const errorOf = (f: FormField) => (showErrors ? problems.find(p => p.field === f)?.message ?? null : null);

  const niveauGroups = Object.values(NIVEAUX).map(g => ({
    label: g.label,
    options: g.niveaux.map(n => ({ value: n.value, label: n.label })),
  }));
  const matieres = getMatieresForNiveau(form.niveau).map(m => ({ value: m.value, label: m.label, prefix: m.emoji }));
  const suggestions = has('sujet') && CONTENT_TOOLS.includes(tool) && !form.sujet.trim()
    ? getSujetSuggestions(form.matiere, form.niveau).slice(0, 4)
    : [];
  const sujet = sujetText(tool, sup);
  const consignes = consignesText(tool, sup);
  const learner = sup ? "l'étudiant" : "l'élève";

  // Format normé : seulement ceux de cet outil, ce niveau et cette matière ; un format gardé d'un autre contexte
  // n'est ni affiché comme choisi ni transmis (request.ts).
  // Formats de la discipline ou de l'épreuve d'abord, puis les formats généraux (QCM, application…), séparés.
  const available = has('modalite') ? modalitesFor(tool, form.niveau, form.matiere) : [];
  const specific = available.filter(m => m.matieres || m.niveaux);
  const general = available.filter(m => !m.matieres && !m.niveaux);
  const modalites = [...specific, ...general];
  const modalite = modalites.find(m => m.value === form.modalite);
  const modaliteOptions: ChipOption<string>[] = [
    { value: '', label: defaultModaliteLabel(tool), title: 'Magistra choisit la forme la plus adaptée au sujet et au niveau' },
    ...modalites.map(m => ({ value: m.value, label: m.label, title: m.description })),
  ];
  const generalCaption = CAPTIONED_TOOLS.includes(tool) && specific.length > 0 && general.length > 0
    ? { value: general[0].value, text: 'Formats généraux' }
    : undefined;
  // Travail d'un seul tenant (dissertation, dictée…) : le nombre d'exercices disparaît ; on dit pourquoi.
  const singleTask = !!modalite && TOOL_FIELDS[tool].includes('nombreExercices') && !has('nombreExercices');
  // Appréciation annuelle (livret scolaire) : le trimestre disparaît ; on dit pourquoi aussi.
  const noTrimestre = !!modalite && !sup && TOOL_FIELDS[tool].includes('trimestre') && !has('trimestre');
  const modaliteHint = modalite
    ? `${modalite.description}${singleTask ? ' · un seul sujet complet' : ''}${noTrimestre ? ' · pas de trimestre' : ''}`
    : undefined;

  const settings: ReactElement[] = [];
  if (has('difficulte')) {
    settings.push(
      <div key="difficulte" role="group" aria-labelledby="gen-difficulte-label" aria-describedby="gen-difficulte-hint">
        <p id="gen-difficulte-label" className={LABEL_CLASS}>
          Difficulté <span className="ml-1 normal-case tracking-normal font-normal text-mg-300">(facultatif)</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {DIFFICULTES.map(d => (
            <ChoiceButton
              key={d.value}
              pressed={form.difficulte === d.value}
              onClick={() => onChange({ difficulte: form.difficulte === d.value ? '' : (d.value as DifficulteExercice) })}
              className="px-2.5 py-1.5 text-[13px]"
            >
              {d.label}
            </ChoiceButton>
          ))}
        </div>
        <p id="gen-difficulte-hint" className="text-xs text-mg-300 mt-1.5">
          {form.difficulte ? 'Cliquez à nouveau pour retirer ce choix.' : 'Non précisée : progression du plus simple au plus complexe.'}
        </p>
      </div>,
    );
  }
  // Ce qui se compte selon le format (exercices, questions, problèmes…), avec des nombres qui lui conviennent.
  const unit = countUnit(modalite?.value, getLevelGroup(form.niveau));
  if (has('nombreExercices') && unit) {
    settings.push(
      <ChipGroup<number | ''>
        key="nombreExercices"
        id="gen-nombre-exercices"
        label={countLabel(unit)}
        value={chosenCount(form.nombreExercices, unit)}
        onChange={v => onChange({ nombreExercices: v })}
        options={[{ value: '', label: 'Auto', title: 'Magistra choisit selon le sujet' }, ...unit.options.map(n => ({ value: n, label: String(n) }))]}
      />,
    );
  }
  if (has('nombreSeances')) {
    settings.push(
      <ChipGroup<number | ''>
        key="nombreSeances"
        id="gen-nombre-seances"
        label="Nombre de séances"
        value={form.nombreSeances}
        onChange={v => onChange({ nombreSeances: v })}
        options={[{ value: '', label: 'Auto', title: '4 à 6 séances' }, ...NOMBRES_SEANCES.map(n => ({ value: n, label: String(n) }))]}
      />,
    );
  }
  if (has('typeEvaluation')) {
    settings.push(
      <ChipGroup<TypeEvaluation | ''>
        key="typeEvaluation"
        id="gen-objectif-evaluation"
        label="Objectif"
        value={form.typeEvaluation}
        onChange={v => onChange({ typeEvaluation: v })}
        options={[{ value: '', label: 'Au choix' }, ...TYPES_EVALUATION.map(t => ({ value: t.value, label: t.label, title: t.description }))]}
      />,
    );
  }
  if (has('bareme')) {
    // Notation par défaut, telle que Magistra la demandera pour cet outil, ce niveau, ce format et cet objectif
    // (formDefaultNotation). Une notation choisie prime toujours : le rappel disparaît.
    const byDefault = formDefaultNotation(form);
    settings.push(
      <ChipGroup<Bareme | ''>
        key="bareme"
        id="gen-bareme"
        label="Notation"
        value={form.bareme}
        onChange={v => onChange({ bareme: v })}
        options={[
          { value: '', label: byDefault.label, title: byDefault.title },
          ...BAREMES.map(b => ({ value: b.value, label: b.label, title: b.description })),
        ]}
        hint={form.bareme ? undefined : byDefault.hint}
      />,
    );
  }
  if (has('sansCorrige')) {
    settings.push(
      <ChipGroup<'avec' | 'sans'>
        key="sansCorrige"
        id="gen-corrige"
        label="Corrigé"
        value={form.sansCorrige ? 'sans' : 'avec'}
        onChange={v => onChange({ sansCorrige: v === 'sans' })}
        options={[
          { value: 'avec', label: 'Avec corrigé', title: 'Corrigé détaillé à la fin du document' },
          { value: 'sans', label: 'Version élève seule', title: 'Énoncés seuls, prêts à distribuer' },
        ]}
      />,
    );
  }
  if (has('ton')) {
    settings.push(
      <ChipGroup<TonRedaction | ''>
        key="ton"
        id="gen-ton"
        label="Ton"
        value={form.ton}
        onChange={v => onChange({ ton: v })}
        options={[{ value: '', label: 'Bienveillant' }, ...TONS.map(t => ({ value: t.value, label: t.label }))]}
      />,
    );
  }
  if (has('format')) {
    settings.push(
      <div key="format" role="group" aria-labelledby="gen-format-label">
        <p id="gen-format-label" className={LABEL_CLASS}>
          Format <span className="ml-1 normal-case tracking-normal font-normal text-mg-300">(facultatif)</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FORMATS_SEANCE.map(f => (
            <ChoiceButton
              key={f.value}
              pressed={form.format === f.value}
              onClick={() => onChange({ format: form.format === f.value ? '' : f.value })}
              ariaLabel={f.label}
              title={f.label}
              className="px-2.5 py-1.5 text-[13px]"
            >
              {FORMAT_SHORT[f.value]}
            </ChoiceButton>
          ))}
        </div>
      </div>,
    );
  }
  if (has('duree')) {
    settings.push(
      <Field key="duree" id="gen-duree" label="Durée" optional>
        <div className="relative">
          <Clock size={15} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-mg-300 pointer-events-none" />
          <input
            id="gen-duree"
            type="text"
            value={form.duree}
            onChange={e => onChange({ duree: e.target.value })}
            maxLength={fieldLimit('duree')}
            placeholder={tool === 'cahier_journal' ? 'Ex : journée complète 8h30-16h30' : sup ? 'Ex : 2 heures, 1h30…' : 'Ex : 55 minutes, 2 heures…'}
            className="input-field pl-9"
            autoComplete="off"
          />
        </div>
      </Field>,
    );
  }

  const textInput = (field: 'sujet' | 'discipline' | 'duree', id: string, props: { placeholder: string; hint?: boolean }) => {
    const error = errorOf(field);
    return (
      <input
        id={id}
        type="text"
        value={form[field]}
        onChange={e => onChange({ [field]: e.target.value } as Partial<GenerateForm>)}
        maxLength={fieldLimit(field)}
        placeholder={props.placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, Boolean(props.hint), Boolean(error))}
        className="input-field"
        autoComplete="off"
      />
    );
  };

  const textArea = (field: 'objectifs' | 'consignes' | 'contenuSource' | 'texteEleve', id: string, props: { placeholder: string; rows: number; hint?: boolean; mono?: boolean }) => {
    const error = errorOf(field);
    return (
      <>
        <textarea
          id={id}
          value={form[field]}
          onChange={e => onChange({ [field]: e.target.value } as Partial<GenerateForm>)}
          rows={props.rows}
          placeholder={props.placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, Boolean(props.hint), Boolean(error))}
          className={`input-field resize-y min-h-[4.5rem] ${props.mono ? 'font-mono text-sm' : ''}`}
        />
        <CharCount value={form[field]} field={field} />
      </>
    );
  };

  return (
    <div className="space-y-5">
      {/* Niveau + matière */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label id="gen-niveau-label" htmlFor="gen-niveau" className={LABEL_CLASS}>Niveau</label>
          <SelectField
            id="gen-niveau"
            ariaLabelledBy="gen-niveau-label"
            value={form.niveau}
            onChange={v => {
              if (isNiveau(v)) onNiveauChange(v);
            }}
            groups={niveauGroups}
          />
        </div>
        {/* Courrier aux familles : pas de matière (elle n'est pas transmise au modèle). */}
        {form.type !== 'lettre_parents' && (
          <div>
            <label id="gen-matiere-label" htmlFor="gen-matiere" className={LABEL_CLASS}>Matière</label>
            <SelectField
              id="gen-matiere"
              ariaLabelledBy="gen-matiere-label"
              value={form.matiere}
              onChange={v => onChange({ matiere: v as Matiere })}
              options={matieres}
            />
          </div>
        )}
      </div>

      {has('discipline') && (
        <Field
          id="gen-discipline"
          label="Discipline / intitulé de l'UE"
          optional
          hint="Précisez la spécialité ou l'unité d'enseignement : le contenu sera calibré en conséquence."
        >
          {textInput('discipline', 'gen-discipline', { placeholder: "Ex : Systèmes d'information — UE Gouvernance des SI", hint: true })}
        </Field>
      )}

      {/* Choix principal de l'outil : format normé (dissertation, QCM, sujet type brevet, fiche de synthèse…) */}
      {modalites.length > 0 && (
        <ChipGroup<string>
          id="gen-modalite"
          label={modaliteFieldLabel(tool, sup)}
          value={modalite ? modalite.value : ''}
          onChange={v => onChange({ modalite: v })}
          options={modaliteOptions}
          captionBefore={generalCaption}
          hint={modalite ? modaliteHint : undefined}
          className="p-3.5 rounded-xl bg-accent/[0.04] border border-accent/10"
        />
      )}

      {/* Courrier : type */}
      {has('typeLettre') && (
        <fieldset>
          <legend className={LABEL_CLASS}>{sup ? 'Type de message' : 'Type de courrier'}</legend>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {TYPES_LETTRE.map(t => (
              <ChoiceButton
                key={t.value}
                pressed={form.typeLettre === t.value}
                onClick={() => onChange({ typeLettre: t.value })}
                className="p-2.5 min-w-0"
              >
                <span className="block text-sm font-medium">{t.label}</span>
                <span className="block text-[11px] text-mg-300 leading-snug">{t.description}</span>
              </ChoiceButton>
            ))}
          </div>
        </fieldset>
      )}

      {/* Appréciations : trimestre, profil, nombre */}
      {has('nombreAppreciations') && (
        <div className="space-y-4 p-4 rounded-xl bg-mg-900/40 border border-white/6">
          <div className={`grid grid-cols-1 gap-4 ${has('trimestre') ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
            {has('trimestre') && (
              <div role="group" aria-labelledby="gen-trimestre-label">
                <p id="gen-trimestre-label" className={LABEL_CLASS}>Trimestre</p>
                <div className="flex gap-2">
                  {(['1', '2', '3'] as Trimestre[]).map(t => (
                    <ChoiceButton
                      key={t}
                      pressed={form.trimestre === t}
                      onClick={() => onChange({ trimestre: t })}
                      ariaLabel={`Trimestre ${t}`}
                      align="center"
                      className="flex-1 px-2 py-2"
                    >
                      T{t}
                    </ChoiceButton>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label id="gen-profil-label" htmlFor="gen-profil" className={LABEL_CLASS}>Profil de {learner}</label>
              <SelectField
                id="gen-profil"
                ariaLabelledBy="gen-profil-label"
                value={form.profilEleve}
                onChange={v => onChange({ profilEleve: v as ProfilEleve })}
                options={PROFILS_ELEVE.map(p => ({ value: p.value, label: p.label }))}
              />
            </div>
            <Field id="gen-nombre" label={sup ? 'Nombre de commentaires' : "Nombre d'appréciations"} error={errorOf('nombreAppreciations')}>
              <input
                id="gen-nombre"
                type="number"
                inputMode="numeric"
                min={MIN_APPRECIATIONS}
                max={MAX_APPRECIATIONS}
                step={1}
                value={form.nombreAppreciations}
                onChange={e => onChange({ nombreAppreciations: e.target.value })}
                onBlur={e => onChange({ nombreAppreciations: normalizeAppreciationInput(e.target.value) })}
                aria-invalid={errorOf('nombreAppreciations') ? true : undefined}
                aria-describedby="gen-nombre-summary"
                className="input-field"
              />
            </Field>
          </div>
          <p id="gen-nombre-summary" className="text-xs text-mg-200 flex items-center gap-1.5" aria-live="polite">
            <span className="text-accent" aria-hidden="true">✦</span>
            {appreciationSummary(form.nombreAppreciations, sup)}
          </p>
        </div>
      )}

      {/* Sujet */}
      {has('sujet') && (
        <Field
          id="gen-sujet"
          label={sujet.label}
          optional={!TOOL_REQUIRES_SUJET[tool]}
          hint={sujet.hint}
          error={errorOf('sujet')}
        >
          {textInput('sujet', 'gen-sujet', { placeholder: sujet.placeholder, hint: Boolean(sujet.hint) })}
          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2.5" role="group" aria-label="Suggestions de sujets">
              {suggestions.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onChange({ sujet: s })}
                  aria-label={`Utiliser la suggestion « ${s} »`}
                  className={`text-xs px-2.5 py-1.5 rounded-lg bg-mg-700 text-mg-200 hover:text-accent hover:bg-accent/5 border border-white/5 hover:border-accent/20 transition-colors text-left ${FOCUS_RING}`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </Field>
      )}

      {/* Différenciation : contenu à adapter + profils + besoins particuliers */}
      {has('contenuSource') && (
        <Field
          id="gen-contenu"
          label="Exercice ou contenu à adapter"
          optional={Boolean(form.sujet.trim())}
          hint="Collez l'énoncé tel quel : Magistra en produira une version pour chaque profil coché."
          error={errorOf('contenuSource')}
        >
          {textArea('contenuSource', 'gen-contenu', {
            rows: 6,
            hint: true,
            placeholder: "Ex :\nExercice 1 — Calcule : 3/4 + 1/2 = …\nExercice 2 — Range dans l'ordre croissant : 2/3 ; 1/2 ; 5/6",
          })}
        </Field>
      )}

      {has('profilsDifferenciation') && (
        <fieldset aria-describedby={errorOf('profilsDifferenciation') ? 'gen-profils-error' : undefined}>
          <legend className={LABEL_CLASS}>Profils à produire</legend>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {PROFILS_DIFFERENCIATION.map(p => {
              const checked = form.profilsDifferenciation.includes(p.value);
              const toggle = () => {
                const next: ProfilDifferenciation[] = checked
                  ? form.profilsDifferenciation.filter(v => v !== p.value)
                  : [...form.profilsDifferenciation, p.value];
                onChange({ profilsDifferenciation: next });
              };
              return (
                <label
                  key={p.value}
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/70 ${
                    checked ? 'bg-accent/10 border-accent/40' : 'bg-mg-700 border-white/5 hover:border-white/15'
                  }`}
                >
                  <input type="checkbox" checked={checked} onChange={toggle} className="mt-0.5 h-4 w-4 shrink-0 accent-[#c8b6ff]" />
                  <span className="min-w-0">
                    <span className={`block text-sm font-medium ${checked ? 'text-white' : 'text-mg-100'}`}>{p.label}</span>
                    <span className="block text-[11px] text-mg-300 leading-snug">{p.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {errorOf('profilsDifferenciation') && (
            <p id="gen-profils-error" className="text-xs text-warning mt-2">{errorOf('profilsDifferenciation')}</p>
          )}
        </fieldset>
      )}

      {has('besoins') && (
        <ChipGroup<BesoinParticulier>
          id="gen-besoins"
          label={<>Besoins particuliers <span className="ml-1 normal-case tracking-normal font-normal text-mg-300">(facultatif)</span></>}
          values={form.besoins ?? []}
          onToggle={v => {
            const current = form.besoins ?? [];
            onChange({ besoins: current.includes(v) ? current.filter(b => b !== v) : [...current, v] });
          }}
          options={BESOINS_PARTICULIERS.map(b => ({ value: b.value, label: b.label, title: b.description }))}
          hint="Des aménagements pédagogiques adaptés sont ajoutés à chaque version (jamais de diagnostic)."
        />
      )}

      {/* Corrigé : travail à corriger */}
      {has('texteEleve') && (
        <Field
          id="gen-copie"
          label="Travail à corriger"
          hint={`Collez le texte de ${learner} (copie, rédaction, réponse). Il n'est pas enregistré tel quel dans l'historique, mais le corrigé enregistré peut en citer des passages.`}
          error={errorOf('texteEleve')}
        >
          {textArea('texteEleve', 'gen-copie', {
            rows: 8,
            hint: true,
            mono: true,
            placeholder: "Collez ici le travail à corriger…",
          })}
        </Field>
      )}

      {/* Réglages de l'outil : grille compacte (difficulté, nombre, objectif, notation, corrigé, ton, format, durée) */}
      {settings.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 pt-4 border-t border-white/6">
          {settings}
        </div>
      )}

      {(has('objectifs') || has('consignes')) && (
        <div className={`grid grid-cols-1 gap-4 ${has('objectifs') && has('consignes') ? 'md:grid-cols-2' : ''}`}>
          {has('objectifs') && (
            <Field id="gen-objectifs" label="Objectifs pédagogiques" optional error={errorOf('objectifs')}>
              {textArea('objectifs', 'gen-objectifs', {
                rows: 3,
                placeholder: sup
                  ? "Ex : à l'issue de la séance, l'étudiant sera capable de…"
                  : 'Ex : identifier les causes de la Révolution, maîtriser la chronologie…',
              })}
            </Field>
          )}
          {has('consignes') && (
            <Field
              id="gen-consignes"
              label={consignes.label}
              optional
              hint={consignes.hint}
              error={errorOf('consignes')}
            >
              {textArea('consignes', 'gen-consignes', { rows: consignes.rows, placeholder: consignes.placeholder, hint: Boolean(consignes.hint) })}
            </Field>
          )}
        </div>
      )}
    </div>
  );
}
