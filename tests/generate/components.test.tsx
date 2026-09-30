import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { getMatieresForNiveau } from '@shared/catalog';
import { defaultMessage, type ErrorCode } from '@shared/errors';
import type { Capabilities, TeacherProfile } from '@shared/types';
import AiNotReadyCard from '@/components/generate/AiNotReadyCard';
import GenerateFormFields from '@/components/generate/GenerateFormFields';
import LoadingSkeleton from '@/components/generate/LoadingSkeleton';
import PrivacyNotice from '@/components/generate/PrivacyNotice';
import ResearchModePicker from '@/components/generate/ResearchModePicker';
import SidebarTools from '@/components/layout/SidebarTools';
import { createInitialForm, validateForm, type GenerateForm } from '@/lib/generation/request';
import { describeResearchOptions, privacyNotes, researchHints } from '@/lib/generation/research';

const PROFILE: TeacherProfile = {
  displayName: 'M. Martin', etablissement: 'Collège Jean Moulin', cycle: 'college', niveaux: ['4eme'], matierePrincipale: 'mathematiques',
};

const noop = () => {};

/** Rappel de la notation par défaut, tel qu'affiché sous « Notation » ('' : aucun rappel). */
function notationHint(html: string): string {
  return html.match(/<p id="gen-bareme-hint"[^>]*>([^<]*)<\/p>/)?.[1] ?? '';
}

function fields(form: GenerateForm, showErrors = false): string {
  return renderToStaticMarkup(
    <GenerateFormFields form={form} onChange={noop} onNiveauChange={noop} problems={validateForm(form)} showErrors={showErrors} />,
  );
}

describe('SidebarTools (barre latérale : « Outils pédagogiques »)', () => {
  const sidebar = (props: Partial<Parameters<typeof SidebarTools>[0]> = {}) => renderToStaticMarkup(
    <MemoryRouter>
      <SidebarTools open={false} onToggle={noop} activeType={null} onNavigate={noop} {...props} />
    </MemoryRouter>,
  );

  it('fermée par défaut : une seule entrée, rien de plus (pas de surcharge du menu)', () => {
    const html = sidebar();
    expect(html).toContain('Outils pédagogiques');
    expect(html).toContain('aria-expanded="false"');
    // La liste existe (aria-controls) mais reste masquée.
    expect(html).toMatch(/<div id="[^"]+" hidden=""/);
  });

  it('ouverte : les 11 outils en trois familles, chacun ouvre la page Générer sur cet outil', () => {
    const html = sidebar({ open: true, activeType: 'evaluation', niveau: '4eme' });
    expect(html).toContain('aria-expanded="true"');
    for (const family of ['Préparer', 'Entraîner et évaluer', 'Accompagner']) expect(html).toContain(family);
    expect(html.match(/href="\/app\/generate\?type=[a-z_]+"/g)).toHaveLength(11);
    // Outil en cours signalé (un seul).
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="true"[^>]*data-tool="evaluation"/);
  });

  it('fermée : l’outil en cours reste indiqué à côté de l’entrée', () => {
    expect(sidebar({ activeType: 'corrige', niveau: '4eme' })).toContain('Corrigé annoté');
  });

  it('libellés adaptés au supérieur', () => {
    const html = sidebar({ open: true, niveau: 'master_1' });
    for (const label of ['TD / Exercices', 'Examen', 'Syllabus', 'Plan de module', 'Correction de copie']) expect(html).toContain(label);
  });
});

describe('GenerateFormFields — formats normés et réglages', () => {
  it('exercices : « Type d’exercice » propre à la matière et au niveau, « Variés » par défaut', () => {
    const html = fields({ ...createInitialForm(PROFILE, { type: 'exercices' }), niveau: '3eme', matiere: 'mathematiques' });
    expect(html).toContain('Type d’exercice');
    for (const label of ['Variés', 'Automatismes', 'Démonstration', 'QCM', 'Problème']) expect(html).toContain(`>${label}</button>`);
    expect(html).not.toContain('>Dictée</button>');
    // Le choix par défaut est signalé comme choisi.
    expect(html).toMatch(/aria-pressed="true"[^>]*>Variés</);
  });

  it('réglages de l’outil : nombre d’exercices, notation, corrigé', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'exercices' }));
    for (const label of ["Nombre d&#x27;exercices", 'Notation', 'Corrigé', 'Avec corrigé', 'Version élève seule', 'Sur 20', 'Par compétences']) {
      expect(html).toContain(label);
    }
    // Exercices : jamais de note sur 20 imposée par défaut (barème indicatif dans le corrigé au collège).
    expect(html).toContain('Par défaut : barème indicatif dans le corrigé.');
    expect(html).not.toContain('note sur 20');
  });

  it('évaluation en 3e : sujet type brevet et objectif (diagnostique, formative, sommative)', () => {
    const html = fields({ ...createInitialForm(PROFILE, { type: 'evaluation' }), niveau: '3eme', matiere: 'francais' });
    expect(html).toContain('Format de l’épreuve');
    expect(html).toContain('>Sujet type brevet</button>');
    for (const label of ['Diagnostique', 'Formative', 'Sommative']) expect(html).toContain(label);
  });

  it('format choisi : sa description s’affiche ; format d’une autre matière : ni affiché ni choisi', () => {
    const chosen = fields({ ...createInitialForm(PROFILE, { type: 'exercices' }), niveau: '1ere_gen', matiere: 'francais', modalite: 'dissertation' });
    expect(chosen).toMatch(/aria-pressed="true"[^>]*>Dissertation</);
    expect(chosen).toContain('Sujet, problématique, plan, rédaction');
    const stale = fields({ ...createInitialForm(PROFILE, { type: 'exercices' }), niveau: '4eme', matiere: 'mathematiques', modalite: 'dissertation' });
    expect(stale).toMatch(/aria-pressed="true"[^>]*>Variés</);
  });

  it('le nombre suit le format : « Nombre de questions » pour un QCM, aucun nombre pour une dictée (un seul sujet)', () => {
    const base = { ...createInitialForm(PROFILE, { type: 'exercices' }), niveau: '6eme' as const, matiere: 'francais' as const };
    const qcm = fields({ ...base, modalite: 'qcm' });
    expect(qcm).toContain('Nombre de questions');
    expect(qcm).not.toContain('Nombre d&#x27;exercices');
    expect(qcm).toContain('>15</button>');
    // Nombre gardé d'un autre format et non proposé ici : « Auto » est signalé comme choisi.
    const probleme = fields({ ...base, niveau: '4eme', matiere: 'mathematiques', modalite: 'probleme', nombreExercices: 12 });
    expect(probleme).toContain('Nombre de problèmes');
    expect(probleme).not.toContain('>12</button>');
    expect(probleme).toMatch(/aria-pressed="true"[^>]*>Auto</);
    const dictee = fields({ ...base, modalite: 'dictee', nombreExercices: 5 });
    expect(dictee).not.toMatch(/Nombre d/);
    expect(dictee).toContain('Texte, difficultés ciblées, grille · un seul sujet complet');
    // Les autres réglages restent (notation, corrigé).
    expect(dictee).toContain('Notation');
  });

  it('maternelle : ni notation, ni corrigé ; activités en ateliers ou jeux', () => {
    const html = fields({ ...createInitialForm(PROFILE, { type: 'exercices' }), niveau: 'maternelle_gs', matiere: 'nombres_formes' });
    expect(html).not.toContain('Notation');
    expect(html).not.toContain('Version élève seule');
    expect(html).toContain('>Ateliers</button>');
    expect(html).toContain("Nombre d&#x27;activités");
  });

  it('notation par défaut : sur 20 au collège, sans note pour une évaluation diagnostique ; notation choisie : aucun rappel', () => {
    const base = { ...createInitialForm(PROFILE, { type: 'evaluation' }), niveau: '4eme' as const, matiere: 'mathematiques' as const };
    const sommative = fields({ ...base, typeEvaluation: 'sommative' });
    expect(sommative).toContain('Par défaut : note sur 20.');
    expect(sommative).toMatch(/title="Note sur 20"[^>]*>Selon le niveau</);
    const diagnostique = fields({ ...base, typeEvaluation: 'diagnostique' });
    expect(diagnostique).toContain('Par défaut : sans note (évaluation diagnostique).');
    expect(diagnostique).not.toContain('note sur 20');
    expect(diagnostique).toMatch(/aria-pressed="true" title="Sans note"[^>]*>Selon l’objectif</);
    // Supérieur : même règle.
    const sup = fields({ ...base, niveau: 'master_1', matiere: 'informatique', typeEvaluation: 'diagnostique' });
    expect(sup).toContain('Par défaut : sans note (évaluation diagnostique).');
    // Notation choisie explicitement : elle prime, plus de rappel du défaut.
    const chosen = fields({ ...base, typeEvaluation: 'diagnostique', bareme: 'sur20' });
    expect(chosen).not.toContain('Par défaut :');
    expect(chosen).toMatch(/aria-pressed="true"[^>]*>Sur 20</);
    // Primaire : positionnement sans note.
    expect(fields({ ...base, niveau: 'cm2', matiere: 'mathematiques' })).toContain('Par défaut : positionnement sans note.');
  });

  it('exercices : pas d’objectif, un objectif diagnostique gardé dans le formulaire ne change pas la notation par défaut', () => {
    const html = fields({ ...createInitialForm(PROFILE, { type: 'exercices' }), typeEvaluation: 'diagnostique' });
    expect(html).not.toContain('Diagnostique');
    expect(notationHint(html)).toBe('Par défaut : barème indicatif dans le corrigé.');
  });

  it('exercices : la notation par défaut suit la consigne (jamais « sur 20 ») selon le niveau et le corrigé', () => {
    const base = createInitialForm(PROFILE, { type: 'exercices' });
    // Supérieur : éléments de correction, sans barème.
    const l1 = fields({ ...base, niveau: 'licence_1', matiere: getMatieresForNiveau('licence_1')[0].value });
    expect(l1).toContain('Par défaut : sans barème imposé.');
    expect(l1).toMatch(/title="Sans barème imposé"[^>]*>Selon le niveau</);
    // Version élève seule : ni corrigé, ni barème imposé.
    const eleve = fields({ ...base, sansCorrige: true });
    expect(eleve).toContain('Par défaut : sans barème imposé.');
    // École primaire : critères de réussite, sans note.
    expect(fields({ ...base, niveau: 'cm1', matiere: 'mathematiques' })).toContain('Par défaut : sans note (critères de réussite dans le corrigé).');
    for (const html of [l1, eleve]) expect(html).not.toContain('note sur 20');
  });

  it('sujet type brevet d’histoire-géographie : le barème officiel (40 + 20) est annoncé, y compris pour un diagnostic', () => {
    const base = { ...createInitialForm(PROFILE, { type: 'evaluation' }), niveau: '3eme' as const, matiere: 'histoire_geo' as const, modalite: 'sujet_brevet' };
    const brevet = fields(base);
    expect(brevet).toContain('Par défaut : barème officiel de l’épreuve (histoire-géographie sur 40, EMC sur 20).');
    expect(brevet).not.toContain('Par défaut : note sur 20.');
    expect(brevet).toMatch(/title="Barème officiel de l’épreuve"[^>]*>Selon l’épreuve</);
    // Objectif diagnostique : le format de l'épreuve prime, jamais « sans note » annoncé.
    const diagnostique = fields({ ...base, typeEvaluation: 'diagnostique' });
    expect(notationHint(diagnostique)).toBe('Par défaut : barème officiel de l’épreuve (histoire-géographie sur 40, EMC sur 20). Le format de l’épreuve prime sur l’objectif diagnostique.');
    // Autre sujet type examen (bac de philosophie) : note sur 20 sur le modèle de l'épreuve, même en diagnostique.
    const bac = fields({ ...base, niveau: 'terminale_gen', matiere: 'philosophie', modalite: 'sujet_bac', typeEvaluation: 'diagnostique' });
    expect(notationHint(bac)).toBe('Par défaut : note sur 20, sur le modèle de l’épreuve. Le format de l’épreuve prime sur l’objectif diagnostique.');
    // Brevet d'une autre matière : note sur 20 sur le modèle de l'épreuve.
    expect(notationHint(fields({ ...base, matiere: 'mathematiques' }))).toBe('Par défaut : note sur 20, sur le modèle de l’épreuve.');
    // Sujet type brevet gardé dans le formulaire mais sans objet en 4e (non transmis) : défaut de l'objectif.
    expect(notationHint(fields({ ...base, niveau: '4eme', typeEvaluation: 'diagnostique' }))).toBe('Par défaut : sans note (évaluation diagnostique).');
  });

  it('légende « Formats généraux » : seulement pour les formats de travail (exercices, évaluation, corrigé)', () => {
    const exercices = fields({ ...createInitialForm(PROFILE, { type: 'exercices' }), niveau: '3eme', matiere: 'francais' });
    expect(exercices).toMatch(/>Formats généraux<\/span><button[^>]*>Application</);
    const appreciations = fields({ ...createInitialForm(PROFILE, { type: 'appreciations' }), niveau: 'terminale_gen', matiere: 'mathematiques' });
    expect(appreciations).not.toContain('Formats généraux');
    expect(appreciations).toContain('>Conseil de classe</button>');
    expect(appreciations).toContain('>Livret scolaire (bac)</button>');
    const sequence = fields({ ...createInitialForm(PROFILE, { type: 'sequence' }), niveau: '3eme', matiere: 'physique_chimie' });
    expect(sequence).toContain('>Démarche d’investigation</button>');
    expect(sequence).not.toContain('Formats généraux');
    const progression = fields({ ...createInitialForm(PROFILE, { type: 'progression' }), niveau: '3eme', matiere: 'mathematiques' });
    expect(progression).toContain('>Spiralée</button>');
    expect(progression).not.toContain('Formats généraux');
  });

  it('différenciation : besoins particuliers (choix multiple) ; appréciations : ton et destination', () => {
    const diff = fields({ ...createInitialForm(PROFILE, { type: 'differenciation' }), besoins: ['dys'] });
    expect(diff).toContain('Besoins particuliers');
    expect(diff).toMatch(/aria-pressed="true"[^>]*>DYS</);
    expect(diff).toMatch(/aria-pressed="false"[^>]*>Allophones</);
    const app = fields({ ...createInitialForm(PROFILE, { type: 'appreciations' }), niveau: 'terminale_gen', matiere: 'mathematiques' });
    expect(app).toContain('>Livret scolaire (bac)</button>');
    expect(app).toContain('>Conseil de classe</button>');
    for (const label of ['Bienveillant', 'Encourageant', 'Exigeant', 'Factuel']) expect(app).toContain(label);
  });
});

describe('GenerateFormFields', () => {
  it('libellés associés aux champs', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'cours' }));
    expect(html).toContain('for="gen-sujet"');
    expect(html).toContain('id="gen-sujet"');
    expect(html).toContain('for="gen-niveau"');
    expect(html).not.toContain('Discipline'); // collège : pas de discipline
    expect(html).not.toContain('Difficulté'); // cours : pas de difficulté
  });

  it('appréciations : trimestre, profil, nombre et texte exact', () => {
    const form = { ...createInitialForm(PROFILE, { type: 'appreciations' }), nombreAppreciations: '12' };
    const html = fields(form);
    expect(html).toContain('Trimestre');
    expect(html).toContain('Magistra rédigera 12 appréciations');
    expect(html).toContain('id="gen-nombre"');
  });

  it('trimestre : boutons T1/T2/T3 centrés, avec une marge intérieure (un seul alignement par bouton)', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'appreciations' }));
    const buttons = html.match(/<button[^>]*aria-label="Trimestre \d"[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toContain('text-center');
      expect(button).not.toContain('text-left');
      expect(button).toMatch(/\bpx-2\b/);
    }
    // Les autres choix gardent l'alignement à gauche.
    expect(html).toMatch(/<button[^>]*class="[^"]*text-left[^"]*"[^>]*>Bulletin</);
  });

  it('livret scolaire (bac) : appréciation annuelle, le trimestre disparaît (et on dit pourquoi) ; bulletin : il revient', () => {
    const base = { ...createInitialForm(PROFILE, { type: 'appreciations' }), niveau: 'terminale_gen' as const, matiere: 'mathematiques' as const };
    const livret = fields({ ...base, modalite: 'livret_bac' });
    expect(livret).not.toContain('gen-trimestre-label');
    expect(livret).not.toContain('aria-label="Trimestre 1"');
    expect(livret).toContain('Appréciation annuelle pour le jury · pas de trimestre');
    expect(livret).toContain('sm:grid-cols-2');
    // La matière reste proposée.
    expect(livret).toContain('id="gen-matiere"');
    const bulletin = fields(base);
    expect(bulletin).toContain('gen-trimestre-label');
    expect(bulletin).toContain('sm:grid-cols-3');
    // Conseil de classe : le trimestre reste.
    const conseil = fields({ ...base, modalite: 'conseil_classe' });
    expect(conseil).toContain('gen-trimestre-label');
    expect(conseil).not.toContain('pas de trimestre');
  });

  it('différenciation : profils cochables + zone multiligne « Exercice ou contenu à adapter »', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'differenciation' }));
    expect(html).toContain('Exercice ou contenu à adapter');
    expect(html).toMatch(/<textarea[^>]*id="gen-contenu"/);
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
  });

  it('corrigé : zone « Travail à corriger »', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'corrige' }));
    expect(html).toContain('Travail à corriger');
    expect(html).toMatch(/<textarea[^>]*id="gen-copie"/);
  });

  it('courrier : 7 types + contexte', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'lettre_parents' }));
    expect(html).toContain('Contexte et détails');
    expect(html).not.toContain('id="gen-sujet"');
    expect(html).toContain('Réunion');
  });

  it('supérieur : discipline / UE et format CM-TD-TP-séminaire', () => {
    const form = { ...createInitialForm(PROFILE, { type: 'cours' }), niveau: 'master_1' as const, matiere: 'informatique' as const };
    const html = fields(form);
    expect(html).toContain('Discipline / intitulé de l');
    expect(html).toContain('Séminaire');
    expect(html).not.toContain('Trimestre');
  });

  it('exercices : difficulté sans valeur par défaut', () => {
    const html = fields(createInitialForm(PROFILE, { type: 'exercices' }));
    expect(html).toContain('Difficulté');
    expect(html).toContain('Non précisée');
    // Aucun bouton de difficulté pressé.
    const difficulty = html.slice(html.indexOf('gen-difficulte-label'));
    expect(difficulty.slice(0, difficulty.indexOf('gen-difficulte-hint'))).not.toContain('aria-pressed="true"');
  });

  it('erreurs affichées après tentative', () => {
    const form = { ...createInitialForm(PROFILE, { type: 'cours' }), sujet: '' };
    expect(fields(form, false)).not.toContain('Indiquez un sujet.');
    expect(fields(form, true)).toContain('Indiquez un sujet.');
  });
});

const CAPS: Capabilities = {
  maxDocumentChars: 1000,
  research: { academic: true, web: false, institutional: false, wikipedia: true },
  privacy: { level: 'local', message: "L'IA fonctionne sur cet ordinateur." },
  engineLabel: 'Ollama',
  ready: true,
};

describe('ResearchModePicker', () => {
  it('démo : modes réseau désactivés et expliqués', () => {
    const options = describeResearchOptions(CAPS, 'demo', '4eme');
    const html = renderToStaticMarkup(
      <ResearchModePicker options={options} value="documents" onChange={noop} hints={researchHints('documents', 0, '4eme', options)} />,
    );
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('Recherche indisponible en mode démonstration.');
  });

  it('documents + Internet seul : avertissement', () => {
    const options = describeResearchOptions(CAPS, 'local', 'master_1');
    const html = renderToStaticMarkup(
      <ResearchModePicker options={options} value="internet" onChange={noop} hints={researchHints('internet', 2, 'master_1', options)} />,
    );
    expect(html).toContain('Vos documents ne seront pas utilisés dans ce mode');
    expect(html).toContain('Internet : Wikipédia et sources académiques seulement (aucun moteur web configuré)');
  });
});

describe('PrivacyNotice', () => {
  it('note locale uniquement si privacy.level === local', () => {
    expect(renderToStaticMarkup(<PrivacyNotice notes={privacyNotes(CAPS, 'documents')} />))
      .toContain('Vos documents et générations restent sur cet ordinateur');
    const server = { ...CAPS, privacy: { level: 'server' as const, message: 'Transmis au serveur Magistra.' } };
    const html = renderToStaticMarkup(<PrivacyNotice notes={privacyNotes(server, 'academic')} />);
    expect(html).not.toContain('restent sur cet ordinateur');
    expect(html).toContain('Transmis au serveur Magistra.');
    expect(html).toContain('jamais vos documents');
  });
});

describe('AiNotReadyCard', () => {
  const render = (mode: 'local' | 'web' | 'personal', caps: Capabilities | null, error: string | null = null, adminContact?: string) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <AiNotReadyCard mode={mode} caps={caps} checkError={error} checking={false} onRecheck={noop} adminContact={adminContact} />
      </MemoryRouter>,
    ).replace(/&#x27;/g, "'");
  const server = (code: ErrorCode, message: string): Capabilities => ({
    ...CAPS, ready: false, privacy: { level: 'server', message: '' }, notReady: { code, message },
  });

  it('rien si l’IA est prête', () => {
    expect(render('local', CAPS)).toBe('');
  });

  it('local : lien vers la configuration de l’IA', () => {
    const html = render('local', { ...CAPS, ready: false });
    expect(html).toContain("Configurer l'intelligence artificielle");
    expect(html).toContain('href="/setup"');
    expect(html).toContain('href="/app/settings"');
  });

  it('web : serveur indisponible, sans lien /setup', () => {
    const html = render('web', { ...CAPS, ready: false, privacy: { level: 'server', message: '' } });
    expect(html).toContain("Le serveur d'IA est indisponible");
    expect(html).not.toContain('href="/setup"');
  });

  it('web, aucune IA branchée : texte dédié (préréglage gratuit, vérification) et code à transmettre', () => {
    const html = render('web', server('AI_NOT_CONFIGURED', defaultMessage('AI_NOT_CONFIGURED')));
    expect(html).toContain("Aucune intelligence artificielle n'est encore branchée sur ce site. L'administrateur doit choisir un fournisseur (par exemple AI_PRESET=ovhcloud, gratuit, sans clé) — vérification : npm run ai:check");
    expect(html).toContain('AI_NOT_CONFIGURED');
    expect(html).not.toContain('ne répond pas pour le moment');
    expect(html).not.toContain('quelques instants');
  });

  it('web : chaque cause affiche son message précis et son code (plus jamais « ne répond pas » pour tout)', () => {
    const cases: [ErrorCode, string, string][] = [
      ['AI_AUTH_FAILED', "Le service d'IA refuse l'accès", "L'administrateur doit vérifier AI_API_KEY."],
      ['MODEL_NOT_INSTALLED', "Modèle d'IA introuvable", 'Le modèle « x » n’est pas disponible sur le serveur d’IA.'],
      ['AI_SERVER_UNREACHABLE', "Le serveur d'IA est injoignable", "Le serveur d'IA est injoignable à l'adresse configurée."],
      ['AI_QUOTA_EXCEEDED', "Quota du service d'IA atteint", 'Quota atteint : nouvel essai possible vers 14 h 05.'],
    ];
    for (const [code, title, message] of cases) {
      const html = render('web', server(code, message));
      expect(html).toContain(title);
      expect(html).toContain(message);
      expect(html).toContain(`Code à transmettre à l’administrateur : <span class="font-mono text-mg-50">${code}</span>`);
      expect(html).not.toContain('ne répond pas pour le moment');
    }
  });

  it('web : contact de l’administrateur affiché s’il est configuré', () => {
    const html = render('web', server('AI_AUTH_FAILED', 'Accès refusé.'), null, 'dsi@lycee.fr');
    expect(html).toContain('href="mailto:dsi@lycee.fr"');
    expect(render('web', server('AI_AUTH_FAILED', 'Accès refusé.'))).not.toContain('Contact de l’administrateur');
  });

  it('mode personnel : texte adapté (l’enseignant administre son serveur)', () => {
    const html = render('personal', server('AI_NOT_CONFIGURED', defaultMessage('AI_NOT_CONFIGURED')));
    expect(html).toContain("Aucune intelligence artificielle n'est encore branchée sur ce serveur Magistra.");
    expect(html).toContain('Ollama');
    expect(html).toContain('Code d’erreur');
    expect(html).toContain('npm run ai:check -- --dev');
  });

  it('cause précise d’AI_NOT_CONFIGURED (préréglage sans clé) : affichée telle quelle, jamais remplacée', () => {
    const cause = "Le service d'IA « Mistral AI (La Plateforme) » exige une clé d'accès : l'administrateur doit renseigner AI_API_KEY.";
    for (const mode of ['web', 'personal'] as const) {
      const html = render(mode, server('AI_NOT_CONFIGURED', cause));
      expect(html).toContain(cause);
      expect(html).not.toContain('Installez Ollama');
      expect(html).not.toContain('choisir un fournisseur');
    }
  });

  it('état non vérifié (AI_STATUS_UNKNOWN) : simple note, la génération reste possible', () => {
    const html = render('web', { ...CAPS, privacy: { level: 'server', message: '' }, aiWarning: { code: 'AI_STATUS_UNKNOWN', message: 'x' } });
    expect(html).toContain('role="note"');
    expect(html).toContain('la génération reste possible');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('Vérifier à nouveau');
  });
});

describe('PrivacyNotice — prestataire tiers', () => {
  const thirdParty: Capabilities = {
    ...CAPS,
    privacy: { level: 'server', message: 'Les demandes et les extraits de vos documents sont envoyés à « OVHcloud AI Endpoints » (France) pour la génération.' },
    providerInfo: { label: 'OVHcloud AI Endpoints', thirdParty: true, country: 'France', privacyUrl: 'https://docs.ovhcloud.com/x' },
  };

  it('annonce l’envoi au prestataire, lien vers ses engagements, jamais « restent sur cet ordinateur »', () => {
    const html = renderToStaticMarkup(<PrivacyNotice notes={privacyNotes(thirdParty, 'documents')} />);
    expect(html).toContain('envoyés à « OVHcloud AI Endpoints » (France)');
    expect(html).toContain('href="https://docs.ovhcloud.com/x"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('restent sur cet ordinateur');
  });

  it('même si le moteur se déclare « local », un tiers n’est jamais présenté comme local', () => {
    const notes = privacyNotes({ ...thirdParty, privacy: { level: 'local', message: 'x' } }, 'documents');
    expect(notes.local).toBeNull();
  });

  it('lien non https : ignoré', () => {
    const notes = privacyNotes({ ...thirdParty, providerInfo: { ...thirdParty.providerInfo!, privacyUrl: 'javascript:alert(1)' } }, 'documents');
    expect(renderToStaticMarkup(<PrivacyNotice notes={notes} />)).not.toContain('javascript:');
  });
});

describe('LoadingSkeleton', () => {
  it('classes statiques visibles', () => {
    const html = renderToStaticMarkup(<LoadingSkeleton />);
    expect(html).toContain('h-6 w-3/4');
    expect(html).toContain('h-4 w-full');
    expect(html).toContain('animate-shimmer');
    expect(html).not.toMatch(/h-\$\{|h-undefined/);
  });
});
