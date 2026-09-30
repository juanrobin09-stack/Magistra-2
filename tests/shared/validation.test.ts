import { describe, expect, it } from 'vitest';
import type { GenerationRecordDraft } from '../../shared/types';
import {
  RECORD_LIMITS, REQUEST_LIMITS, displaySujet, validateGenerationRecordDraft, validateGenerationRequest, validateProfile,
} from '../../shared/validation';

function invalid(input: unknown): { code: string; message: string } {
  try {
    validateGenerationRequest(input);
  } catch (err) {
    return err as { code: string; message: string };
  }
  throw new Error('La demande aurait dû être refusée.');
}

const passage = (text: string, extra: Record<string, unknown> = {}) => ({
  docId: 'd1', docName: 'cours.pdf', kind: 'pdf', locator: { type: 'pages', start: 3, end: 4 }, text, ...extra,
});

describe('validateGenerationRequest — liste blanche des champs (pas de paramètres fantômes)', () => {
  it('ne conserve que les champs propres à l’outil choisi', () => {
    const req = validateGenerationRequest({
      type: 'lettre_parents', niveau: '4eme', matiere: 'francais', typeLettre: 'absence',
      sujet: 'fantôme', duree: '1 h', objectifs: 'fantôme', difficulte: 'moyen', format: 'td', trimestre: '2',
      profilEleve: 'bon', nombreAppreciations: 12, profilsDifferenciation: ['renforce'], contenuSource: 'fantôme', texteEleve: 'fantôme',
      userId: 'usr_pirate', model: 'gpt-4', __proto__: { admin: true },
    });
    expect(req).toEqual({
      type: 'lettre_parents', niveau: '4eme', matiere: 'francais', discipline: undefined, sujet: '', typeLettre: 'absence',
      researchMode: 'documents', consignes: undefined, documents: undefined, profile: null,
    });
    expect(req).not.toHaveProperty('userId');
    expect(req).not.toHaveProperty('difficulte');
  });

  it('exercices : difficulté et format conservés, trimestre ignoré', () => {
    const req = validateGenerationRequest({ type: 'exercices', niveau: 'licence_1', sujet: 'Les graphes', difficulte: 'differencie', format: 'td', trimestre: '1' });
    expect(req.difficulte).toBe('differencie');
    expect(req.format).toBe('td');
    expect(req.trimestre).toBeUndefined();
  });

  it('valeurs hors liste blanche remplacées par une valeur sûre ou ignorées', () => {
    const req = validateGenerationRequest({ type: 'appreciations', niveau: 'cm2', profilEleve: 'génie', typeLettre: 'x', trimestre: '4', researchMode: 'web' });
    expect(req.profilEleve).toBe('bon');
    expect(req.trimestre).toBeUndefined();
    expect(req.researchMode).toBe('documents');
    expect(req.nombreAppreciations).toBe(10);
  });

  it('matière inconnue → matière par défaut du niveau', () => {
    expect(validateGenerationRequest({ type: 'cours', niveau: 'maternelle_ps', sujet: 'Les couleurs', matiere: 'n_importe_quoi' }).matiere).toBe('langage_oral');
  });

  it('différenciation : profils dédoublonnés, profils inconnus retirés, tous par défaut', () => {
    const one = validateGenerationRequest({ type: 'differenciation', niveau: '5eme', sujet: 'x', profilsDifferenciation: ['renforce', 'renforce', 'hpi', 42] });
    expect(one.profilsDifferenciation).toEqual(['renforce']);
    const all = validateGenerationRequest({ type: 'differenciation', niveau: '5eme', sujet: 'x', profilsDifferenciation: 'renforce' });
    expect(all.profilsDifferenciation).toEqual(['renforce', 'standard', 'approfondissement']);
  });
});

describe('validateGenerationRequest — bornes et erreurs lisibles', () => {
  it('types, niveaux inconnus et entrées non objet refusés', () => {
    expect(invalid({ type: 'poeme', niveau: '4eme', sujet: 'x' })).toMatchObject({ code: 'INVALID_REQUEST', message: 'Type de contenu inconnu.' });
    expect(invalid({ type: 'cours', niveau: 'terminale_s', sujet: 'x' })).toMatchObject({ code: 'INVALID_REQUEST', message: 'Niveau inconnu.' });
    expect(invalid(null).code).toBe('INVALID_REQUEST');
    expect(invalid('cours').code).toBe('INVALID_REQUEST');
    expect(invalid([{ type: 'cours' }]).code).toBe('INVALID_REQUEST');
  });

  it('champs trop longs ou de mauvais type', () => {
    expect(invalid({ type: 'cours', niveau: '4eme', sujet: 'a'.repeat(REQUEST_LIMITS.sujet + 1) }))
      .toMatchObject({ code: 'INVALID_REQUEST', message: `Le champ « sujet » est trop long (${REQUEST_LIMITS.sujet} caractères maximum).` });
    expect(invalid({ type: 'cours', niveau: '4eme', sujet: { $gt: '' } })).toMatchObject({ message: 'Champ « sujet » invalide.' });
    expect(invalid({ type: 'corrige', niveau: '4eme', texteEleve: 'x'.repeat(REQUEST_LIMITS.texteEleve + 1) }).message).toMatch(/travail à corriger.*trop long/);
    expect(validateGenerationRequest({ type: 'cours', niveau: '4eme', sujet: 'a'.repeat(REQUEST_LIMITS.sujet) }).sujet).toHaveLength(REQUEST_LIMITS.sujet);
  });

  it('champs obligatoires selon l’outil', () => {
    expect(invalid({ type: 'cours', niveau: '4eme', sujet: '   ' }).message).toBe('Indiquez un sujet.');
    expect(invalid({ type: 'corrige', niveau: '4eme' }).message).toBe('Collez le travail à corriger.');
    expect(invalid({ type: 'differenciation', niveau: '4eme' }).message).toBe('Indiquez un sujet ou collez le contenu à adapter.');
  });

  it('nombre d’appréciations : 1 à 40, 10 par défaut, erreur explicite sinon', () => {
    const count = (n: unknown) => validateGenerationRequest({ type: 'appreciations', niveau: '3eme', nombreAppreciations: n }).nombreAppreciations;
    expect(count(undefined)).toBe(10);
    expect(count('')).toBe(10);
    expect(count(1)).toBe(1);
    expect(count(7)).toBe(7);
    expect(count('12')).toBe(12);
    expect(count(40)).toBe(40);
    for (const bad of [0, -3, 41, 1000, 'beaucoup', Number.NaN, true, [5]]) {
      expect(invalid({ type: 'appreciations', niveau: '3eme', nombreAppreciations: bad }))
        .toMatchObject({ code: 'INVALID_REQUEST', message: "Le nombre d'appréciations doit être compris entre 1 et 40." });
    }
  });

  it('caractères de contrôle invisibles retirés, retours à la ligne conservés', () => {
    const req = validateGenerationRequest({ type: 'cours', niveau: '4eme', sujet: 'Les\u0000 frac\u0007tions', consignes: 'Ligne 1\nLigne 2\tTab' });
    expect(req.sujet).toBe('Les fractions');
    expect(req.consignes).toBe('Ligne 1\nLigne 2\tTab');
  });
});

describe('validateGenerationRequest — documents', () => {
  it('documents valides conservés avec leur localisation', () => {
    const req = validateGenerationRequest({ type: 'cours', niveau: 'master_1', sujet: 'x', researchMode: 'documents_internet', documents: [passage('Texte du cours.')] });
    expect(req.documents).toEqual([{ docId: 'd1', docName: 'cours.pdf', kind: 'pdf', locator: { type: 'pages', start: 3, end: 4 }, text: 'Texte du cours.' }]);
  });

  it('documents invalides refusés avec un message clair (et jamais de plantage)', () => {
    const base = { type: 'cours', niveau: 'master_1', sujet: 'x' };
    expect(invalid({ ...base, documents: 'pas un tableau' })).toMatchObject({ code: 'INVALID_REQUEST', message: 'Documents invalides.' });
    expect(invalid({ ...base, documents: [null] })).toMatchObject({ code: 'INVALID_REQUEST', message: 'Extrait de document invalide.' });
    expect(invalid({ ...base, documents: [42] })).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(invalid({ ...base, documents: [passage('x', { locator: { type: 'pages', start: 5, end: 2 } })] }).message).toBe('Localisation de document invalide.');
    expect(invalid({ ...base, documents: [passage('x', { locator: { type: 'chapitres', start: 1, end: 1 } })] }).message).toBe('Localisation de document invalide.');
    expect(invalid({ ...base, documents: [passage('x'.repeat(REQUEST_LIMITS.passageChars + 1))] }).message).toMatch(/extrait.*trop long/);
    expect(invalid({ ...base, documents: Array.from({ length: REQUEST_LIMITS.maxPassages + 1 }, () => passage('x')) }).code).toBe('DOCUMENT_TOO_LARGE');
    const big = Array.from({ length: 11 }, () => passage('x'.repeat(REQUEST_LIMITS.passageChars)));
    expect(invalid({ ...base, documents: big })).toMatchObject({ code: 'DOCUMENT_TOO_LARGE', message: 'Les extraits de documents dépassent la taille autorisée.' });
  });

  it('extraits vides ignorés ; type de fichier inconnu ramené à « txt »', () => {
    const req = validateGenerationRequest({ type: 'cours', niveau: '4eme', sujet: 'x', documents: [passage('   '), passage('Texte', { kind: 'exe' })] });
    expect(req.documents).toHaveLength(1);
    expect(req.documents?.[0].kind).toBe('txt');
  });

  it('mode « Internet » : les documents sont ignorés (jamais transmis)', () => {
    const req = validateGenerationRequest({ type: 'cours', niveau: 'licence_2', sujet: 'x', researchMode: 'internet', documents: [passage('Secret du cours')] });
    expect(req.documents).toBeUndefined();
    // Même un document invalide ne bloque pas une demande en mode Internet.
    expect(validateGenerationRequest({ type: 'cours', niveau: 'licence_2', sujet: 'x', researchMode: 'internet', documents: [null] }).documents).toBeUndefined();
  });
});

describe('validateGenerationRequest — profil enseignant', () => {
  it('profil nettoyé : niveaux et matières en liste blanche, matière secondaire conservée', () => {
    const req = validateGenerationRequest({
      type: 'cours', niveau: '4eme', sujet: 'x',
      profile: { displayName: ' Mme Dupont ', etablissement: 'Collège X', cycle: 'college', niveaux: ['4eme', 'inconnu'], matierePrincipale: 'francais', matiereSecondaire: 'latin', discipline: 'Lettres', isAdmin: true },
    });
    expect(req.profile).toEqual({ displayName: 'Mme Dupont', etablissement: 'Collège X', cycle: 'college', niveaux: ['4eme'], matierePrincipale: 'francais', matiereSecondaire: 'latin', discipline: 'Lettres' });
  });

  it('profil absent ou invalide → null ; matière secondaire identique à la principale ignorée', () => {
    expect(validateGenerationRequest({ type: 'cours', niveau: '4eme', sujet: 'x', profile: 'x' }).profile).toBeNull();
    expect(validateGenerationRequest({ type: 'cours', niveau: '4eme', sujet: 'x', profile: [1] }).profile).toBeNull();
    const same = validateGenerationRequest({ type: 'cours', niveau: '4eme', sujet: 'x', profile: { matierePrincipale: 'francais', matiereSecondaire: 'francais' } });
    expect(same.profile?.matiereSecondaire).toBeUndefined();
  });
});

describe('validateProfile (exporté pour le serveur)', () => {
  it('mêmes règles que dans une demande de génération', () => {
    expect(validateProfile({ displayName: 'M. Martin', etablissement: 'Université de Lille', cycle: 'superieur', niveaux: ['master_1', 'x'], matierePrincipale: 'droit', matiereSecondaire: 'nope', discipline: 'Droit public', role: 'admin' }))
      .toEqual({ displayName: 'M. Martin', etablissement: 'Université de Lille', cycle: 'superieur', niveaux: ['master_1'], matierePrincipale: 'droit', matiereSecondaire: undefined, discipline: 'Droit public' });
    expect(validateProfile(null)).toBeNull();
    expect(validateProfile('profil')).toBeNull();
    expect(validateProfile({ matierePrincipale: 'inconnue' })?.matierePrincipale).toBe('autre');
  });

  it('champ trop long → erreur lisible', () => {
    expect(() => validateProfile({ displayName: 'x'.repeat(121) })).toThrow('Le champ « nom » est trop long (120 caractères maximum).');
    expect(() => validateProfile({ etablissement: 42 })).toThrow('Champ « établissement » invalide.');
  });
});

describe('displaySujet', () => {
  it('utilise le sujet, sinon un intitulé descriptif', () => {
    const appr = validateGenerationRequest({ type: 'appreciations', niveau: '3eme', matiere: 'francais', trimestre: '2', profilEleve: 'fragile' });
    expect(displaySujet(appr, 'Appréciations', '3ème', 'Français')).toBe('Appréciations — Français, 3ème, T2 (fragile)');
    const cours = validateGenerationRequest({ type: 'cours', niveau: '3eme', sujet: 'Le roman' });
    expect(displaySujet(cours, 'Cours', '3ème', 'Français')).toBe('Le roman');
  });
});

// ─── Génération à enregistrer (POST /api/generation, Magistra locale) ───────

function refused(input: unknown): { code: string; message: string } {
  try {
    validateGenerationRecordDraft(input);
  } catch (err) {
    return err as { code: string; message: string };
  }
  throw new Error('La génération aurait dû être refusée.');
}

const record: GenerationRecordDraft = {
  type: 'cours',
  niveau: 'licence_1',
  matiere: 'informatique',
  discipline: 'Algorithmique',
  sujet: 'Les graphes orientés',
  contenu: '# Les graphes\n\n    code indenté\n\nTexte [S1].\n',
  sources: [
    { n: 1, kind: 'document', title: 'cours.pdf', docName: 'cours.pdf', locator: { type: 'pages', start: 3, end: 4, title: 'Définitions', partial: true, labels: { start: 'xii', end: 'xiii' } } },
    { n: 2, kind: 'crossref', title: 'Graph theory', authors: ['A. Martin'], year: 2019, venue: 'Journal', doi: '10.1000/x.1', url: 'https://doi.org/10.1000/x.1' },
    { n: 3, kind: 'wikipedia', title: 'Graphe orienté', venue: 'Wikipédia', url: 'https://fr.wikipedia.org/wiki/Graphe_orient%C3%A9' },
  ],
  params: {
    researchMode: 'documents_internet', duree: '2 h', objectifs: 'Définir', consignes: 'Exemples', difficulte: 'moyen', format: 'td',
    trimestre: '2', profilEleve: 'bon', nombreAppreciations: 12, profilsDifferenciation: ['renforce', 'standard'], typeLettre: 'absence',
    contenuSource: 'Texte à adapter', texteEleveLength: 1_234, documents: ['cours.pdf', 'td.docx'],
  },
  truncated: false,
  internetUsed: true,
  model: 'ministral-3:8b',
};

const withSource = (extra: Record<string, unknown>, index = 1) => ({
  ...record, sources: record.sources.map((s, i) => (i === index ? { ...s, ...extra } : s)),
});
const withParams = (extra: Record<string, unknown>) => ({ ...record, params: { ...record.params, ...extra } });

describe('validateGenerationRecordDraft — génération valide', () => {
  it('copie propre, identique à l’entrée valide (contenu ni rogné ni retouché)', () => {
    const out = validateGenerationRecordDraft(structuredClone(record));
    expect(out).toEqual(record);
    expect(out.contenu).toBe(record.contenu);
  });

  it('identifiant, date, favori, utilisateur et champs inconnus ignorés (jamais repris du corps)', () => {
    const out = validateGenerationRecordDraft({
      ...record, id: '00000000-0000-4000-8000-000000000000', createdAt: '1999-01-01T00:00:00Z', isFavorite: true, userId: 'user_B',
      user_id: 'user_B', admin: true, ...JSON.parse('{"__proto__": {"pollue": true}}'),
    });
    expect(Object.keys(out).sort()).toEqual(['contenu', 'discipline', 'internetUsed', 'matiere', 'model', 'niveau', 'params', 'sources', 'sujet', 'truncated', 'type']);
    expect(({} as Record<string, unknown>).pollue).toBeUndefined();
    expect((out as unknown as Record<string, unknown>).pollue).toBeUndefined();
  });

  it('minimum : sources et paramètres absents → listes vides ; champs facultatifs absents', () => {
    const out = validateGenerationRecordDraft({ type: 'cours', niveau: '4eme', matiere: 'francais', sujet: 'Le roman', contenu: 'Texte' });
    expect(out).toEqual({ type: 'cours', niveau: '4eme', matiere: 'francais', sujet: 'Le roman', contenu: 'Texte', sources: [], params: {} });
  });

  it('bornes exactes acceptées', () => {
    const out = validateGenerationRecordDraft({
      ...record, sujet: 's'.repeat(RECORD_LIMITS.sujet), contenu: 'c'.repeat(RECORD_LIMITS.contenu), model: 'm'.repeat(RECORD_LIMITS.model),
      sources: Array.from({ length: RECORD_LIMITS.maxSources }, (_, i) => ({ n: i + 1, kind: 'web', title: 't'.repeat(RECORD_LIMITS.sourceTitle), url: `https://exemple.fr/${'p'.repeat(RECORD_LIMITS.url - 20)}` })),
      params: { documents: Array.from({ length: RECORD_LIMITS.maxDocumentNames }, (_, i) => `${i}${'d'.repeat(RECORD_LIMITS.docName - 3)}`) },
    });
    expect(out.sources).toHaveLength(RECORD_LIMITS.maxSources);
    expect(out.contenu).toHaveLength(RECORD_LIMITS.contenu);
    expect(out.params.documents).toHaveLength(RECORD_LIMITS.maxDocumentNames);
  });

  it('caractères de contrôle retirés partout ; tabulations et retours à la ligne du contenu conservés', () => {
    const out = validateGenerationRecordDraft({
      ...record, sujet: 'Les\u0000 gra\u0007phes', contenu: '# Ti\u0000tre\n\n\tLigne\r\n\u001b[31m',
      sources: [{ n: 1, kind: 'web', title: 'Ti\u0008tre', authors: ['Au\u0000teur'], url: 'https://exemple.fr/a' }],
      params: { documents: ['cou\u0000rs.pdf'] },
    });
    expect(out.sujet).toBe('Les graphes');
    expect(out.contenu).toBe('# Titre\n\n\tLigne\r\n[31m');
    expect(out.sources[0]).toEqual({ n: 1, kind: 'web', title: 'Titre', authors: ['Auteur'], url: 'https://exemple.fr/a' });
    expect(out.params).toEqual({ documents: ['cours.pdf'] });
  });

  it('paramètres : clés inconnues ignorées, listes dédoublonnées, jamais le texte d’un élève ni d’un document', () => {
    const out = validateGenerationRecordDraft(withParams({
      texteEleve: 'Copie de l’élève', passages: ['secret'], apiKey: 'sk-x', documents: ['cours.pdf', 'cours.pdf'], profilsDifferenciation: ['renforce', 'renforce'],
    }));
    expect(out.params).not.toHaveProperty('texteEleve');
    expect(out.params).not.toHaveProperty('passages');
    expect(out.params).not.toHaveProperty('apiKey');
    expect(out.params.documents).toEqual(['cours.pdf']);
    expect(out.params.profilsDifferenciation).toEqual(['renforce']);
    expect(validateGenerationRecordDraft({ ...record, params: null }).params).toEqual({});
  });

  it('emplacement : « extrait » conservé seulement s’il vaut true, étiquettes invalides retirées', () => {
    const loc = (locator: Record<string, unknown>) => validateGenerationRecordDraft(withSource({ locator }, 0)).sources[0].locator;
    expect(loc({ type: 'slides', start: 2, end: 2, partial: 'oui' })).toEqual({ type: 'slides', start: 2, end: 2 });
    expect(loc({ type: 'pages', start: 1, end: 2, labels: { start: '<script>', end: 'x' } })).toEqual({ type: 'pages', start: 1, end: 2 });
    expect(loc({ type: 'section', start: 0, end: 0, title: '  Introduction  ', partial: true })).toEqual({ type: 'section', start: 0, end: 0, title: 'Introduction', partial: true });
  });
});

describe('validateGenerationRecordDraft — refus explicites', () => {
  it('entrée, type, niveau, matière, sujet et contenu', () => {
    for (const bad of [null, undefined, 'record', 42, [record]]) expect(refused(bad)).toMatchObject({ code: 'INVALID_REQUEST', message: 'Contenu à enregistrer invalide.' });
    expect(refused({ ...record, type: 'poeme' }).message).toBe('Type de contenu inconnu.');
    expect(refused({ ...record, niveau: 'terminale_s' }).message).toBe('Niveau inconnu.');
    // Jamais de matière par défaut : une génération enregistrée garde la sienne, ou rien.
    expect(refused({ ...record, matiere: 'alchimie' }).message).toBe('Matière inconnue.');
    expect(refused({ ...record, matiere: undefined }).message).toBe('Matière inconnue.');
    expect(refused({ ...record, sujet: '  ' }).message).toBe('Sujet manquant.');
    expect(refused({ ...record, sujet: 's'.repeat(RECORD_LIMITS.sujet + 1) }).message).toBe(`Le champ « sujet » est trop long (${RECORD_LIMITS.sujet} caractères maximum).`);
    expect(refused({ ...record, contenu: undefined }).message).toBe('Contenu vide : rien à enregistrer.');
    expect(refused({ ...record, contenu: '\u0000 \n\t' }).message).toBe('Contenu vide : rien à enregistrer.');
    expect(refused({ ...record, contenu: { $ne: '' } }).message).toBe('Champ « contenu » invalide.');
    expect(refused({ ...record, contenu: 'c'.repeat(RECORD_LIMITS.contenu + 1) }).message).toBe(`Le champ « contenu » est trop long (${RECORD_LIMITS.contenu} caractères maximum).`);
    expect(refused({ ...record, discipline: 'd'.repeat(RECORD_LIMITS.discipline + 1) }).message).toMatch(/discipline.*trop long/);
    expect(refused({ ...record, model: 'm'.repeat(RECORD_LIMITS.model + 1) }).message).toMatch(/modèle.*trop long/);
    expect(refused({ ...record, truncated: 'false' }).message).toBe('Champ « contenu tronqué » invalide.');
    expect(refused({ ...record, internetUsed: 1 }).message).toBe('Champ « recherche Internet utilisée » invalide.');
  });

  it('sources : nombre, numéro, type, titre, auteurs, année, textes bornés', () => {
    expect(refused({ ...record, sources: 'aucune' }).message).toBe('Sources invalides.');
    expect(refused({ ...record, sources: Array.from({ length: RECORD_LIMITS.maxSources + 1 }, (_, i) => ({ n: i + 1, kind: 'web', title: 'x' })) }).message)
      .toBe(`Trop de sources (${RECORD_LIMITS.maxSources} au plus).`);
    expect(refused({ ...record, sources: [null] }).message).toBe('Source invalide.');
    for (const n of [0, 1_000, 1.5, '1', -1, Number.NaN]) expect(refused(withSource({ n })).message, String(n)).toMatch(/numéro de source/);
    expect(refused(withSource({ n: undefined })).message).toBe('Numéro de source manquant.');
    for (const kind of ['blog', 'Document', '', undefined, '__proto__', 'toString']) expect(refused(withSource({ kind })).message, String(kind)).toBe('Type de source inconnu.');
    expect(refused(withSource({ title: ' ' })).message).toBe('Titre de source manquant.');
    expect(refused(withSource({ title: 't'.repeat(RECORD_LIMITS.sourceTitle + 1) })).message).toMatch(/titre de la source.*trop long/);
    expect(refused(withSource({ authors: 'A. Martin' })).message).toBe('Champ « auteurs » invalide.');
    expect(refused(withSource({ authors: Array.from({ length: RECORD_LIMITS.maxAuthors + 1 }, (_, i) => `Auteur ${i}`) })).message).toBe('Champ « auteurs » invalide.');
    expect(refused(withSource({ authors: ['a'.repeat(RECORD_LIMITS.author + 1)] })).message).toMatch(/auteurs.*trop long/);
    expect(refused(withSource({ authors: [42] })).message).toBe('Champ « auteurs » invalide.');
    for (const year of [2019.5, '2019', -1, 10_000]) expect(refused(withSource({ year })).message, String(year)).toBe('Champ « année » invalide.');
    expect(refused(withSource({ venue: 'v'.repeat(RECORD_LIMITS.venue + 1) })).message).toMatch(/revue.*trop long/);
    expect(refused(withSource({ doi: 'd'.repeat(RECORD_LIMITS.doi + 1) })).message).toMatch(/DOI.*trop long/);
    expect(refused(withSource({ docName: 'n'.repeat(RECORD_LIMITS.docName + 1) }, 0)).message).toMatch(/nom de document.*trop long/);
  });

  it('adresse d’une source : http(s) uniquement, sans identifiants, bornée', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,<script>', 'ftp://exemple.fr/x', 'file:///etc/passwd', 'https://user:mdp@exemple.fr/', 'exemple.fr', '//exemple.fr']) {
      expect(refused(withSource({ url })).message, url).toBe('Adresse de source invalide.');
    }
    expect(refused(withSource({ url: `https://exemple.fr/${'p'.repeat(RECORD_LIMITS.url)}` })).message).toMatch(/adresse de la source.*trop long/);
    expect(validateGenerationRecordDraft(withSource({ url: 'HTTP://Exemple.fr/Page' })).sources[1].url).toBe('HTTP://Exemple.fr/Page');
  });

  it('emplacement de document invalide', () => {
    for (const locator of [{ type: 'pages', start: 5, end: 2 }, { type: 'chapitres', start: 1, end: 1 }, { type: 'pages', start: -1, end: 1 }, 'p. 3', [3, 4]]) {
      expect(refused(withSource({ locator }, 0)).message, JSON.stringify(locator)).toBe('Localisation de document invalide.');
    }
    expect(refused(withSource({ locator: { type: 'pages', start: 1, end: 1, title: 't'.repeat(RECORD_LIMITS.locatorTitle + 1) } }, 0)).message)
      .toMatch(/titre de section.*trop long/);
  });

  it('paramètres : types et valeurs des clés connues vérifiés', () => {
    expect(refused({ ...record, params: 'x' }).message).toBe('Paramètres de la génération invalides.');
    expect(refused({ ...record, params: [1] }).message).toBe('Paramètres de la génération invalides.');
    const cases: [Record<string, unknown>, string][] = [
      [{ researchMode: 'web' }, 'mode de recherche'],
      [{ difficulte: 'extreme' }, 'difficulté'],
      [{ format: 'amphi' }, 'format'],
      [{ trimestre: '4' }, 'trimestre'],
      [{ trimestre: 2 }, 'trimestre'],
      [{ profilEleve: 'génie' }, 'profil d’élève'],
      [{ nombreAppreciations: 0 }, 'nombre d’appréciations'],
      [{ nombreAppreciations: REQUEST_LIMITS.maxAppreciations + 1 }, 'nombre d’appréciations'],
      [{ nombreAppreciations: '10' }, 'nombre d’appréciations'],
      [{ profilsDifferenciation: ['hpi'] }, 'profils de différenciation'],
      [{ profilsDifferenciation: 'renforce' }, 'profils de différenciation'],
      [{ profilsDifferenciation: ['renforce', 'standard', 'approfondissement', 'renforce'] }, 'profils de différenciation'],
      [{ typeLettre: 'menace' }, 'type de lettre'],
      [{ texteEleveLength: 0 }, 'longueur du travail corrigé'],
      [{ texteEleveLength: REQUEST_LIMITS.texteEleve + 1 }, 'longueur du travail corrigé'],
      [{ documents: 'cours.pdf' }, 'documents'],
      [{ documents: Array.from({ length: RECORD_LIMITS.maxDocumentNames + 1 }, (_, i) => `d${i}.pdf`) }, 'documents'],
      [{ documents: [{ name: 'x' }] }, 'documents'],
    ];
    for (const [extra, field] of cases) {
      expect(refused(withParams(extra)), JSON.stringify(extra).slice(0, 80)).toMatchObject({ code: 'INVALID_REQUEST', message: `Champ « ${field} » invalide.` });
    }
    expect(refused(withParams({ documents: ['n'.repeat(RECORD_LIMITS.docName + 1)] })).message).toMatch(/documents.*trop long/);
    expect(refused(withParams({ duree: 'd'.repeat(REQUEST_LIMITS.duree + 1) })).message).toMatch(/durée.*trop long/);
    expect(refused(withParams({ objectifs: 'o'.repeat(REQUEST_LIMITS.objectifs + 1) })).message).toMatch(/objectifs.*trop long/);
    expect(refused(withParams({ consignes: 'c'.repeat(REQUEST_LIMITS.consignes + 1) })).message).toMatch(/consignes.*trop long/);
    expect(refused(withParams({ contenuSource: 'c'.repeat(REQUEST_LIMITS.contenuSource + 1) })).message).toMatch(/contenu à adapter.*trop long/);
  });
});
