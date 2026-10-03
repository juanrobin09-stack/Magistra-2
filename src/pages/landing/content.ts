// Textes et chiffres de la page d'accueil, communs à l'application (LandingPage) et au site vitrine (SiteLanding).

import { ALL_MATIERES, ALL_TYPES } from '@shared/catalog';
import { ALL_NIVEAUX } from '@shared/levels';

// Chiffres réels, calculés à partir du référentiel (jamais saisis à la main).
const NB_NIVEAUX = ALL_NIVEAUX.length;
const NB_MATIERES = ALL_MATIERES.filter(m => m.value !== 'autre').length;
const NB_OUTILS = ALL_TYPES.length;

export type CtaSize = 'nav' | 'hero';

/** Boutons principaux (barre de navigation, héros, appel à l'action final) : mêmes classes sur le site et dans l'application. */
export const CTA_CLASS: Record<CtaSize, string> = {
  nav: 'btn-primary text-sm py-2 px-5',
  hero: 'btn-primary text-base py-3 px-8',
};

/**
 * Section « Magistra pour Windows » de cette page : tous les liens « Télécharger pour Windows » y mènent (téléchargement
 * direct de la dernière version, trois étapes avec l'avertissement SmartScreen, « Déjà installée ? Ouvrir Magistra »)
 * plutôt que vers la page des versions de GitHub, où l'enseignant devrait choisir le bon fichier.
 */
export const WINDOWS_SECTION_HREF = '#magistra-windows';

export const FEATURES_CREATION = [
  { icon: '✦', title: 'Cours', desc: 'Entrez un sujet, un niveau, une durée : Magistra propose un cours structuré (objectifs, plan, déroulé, trace écrite — ou CM problématisé dans le supérieur).' },
  { icon: '◈', title: 'Exercices et TD', desc: 'Séries progressives avec éléments de correction ; versions différenciées quand vous le demandez.' },
  { icon: '◎', title: 'Évaluations et examens', desc: 'Sujet, corrigé et barème ou grille d’évaluation, à vérifier avant de les donner à vos élèves ou étudiants.' },
  { icon: '⬡', title: 'Séquences et plans de module', desc: 'Organisation multi-séances, ou d’une UE en CM, TD et TP, avec objectifs, activités et modalités d’évaluation.' },
  { icon: '◇', title: 'Fiches de séance', desc: 'Déroulé minuté, objectifs, matériel et modalités de travail, prêts à être ajustés à votre classe.' },
  { icon: '📅', title: 'Progressions et syllabus', desc: 'Planification annuelle ou semestrielle, à ajuster à votre programme, à votre maquette et à votre calendrier.' },
];

export const FEATURES_OUTILS = [
  { icon: '💬', title: 'Appréciations et commentaires', desc: 'Choisissez un profil et un nombre d’appréciations : Magistra propose des formulations variées, à copier puis personnaliser dans votre logiciel de vie scolaire.' },
  { icon: '🎯', title: 'Différenciation', desc: 'Un exercice décliné selon les profils que vous cochez : accompagnement renforcé, standard, approfondissement. Mêmes objectifs, chemins adaptés.' },
  { icon: '✉️', title: 'Courriers aux familles et aux étudiants', desc: 'Absences, félicitations, réunion, orientation… des brouillons clairs et bienveillants, à relire avant envoi.' },
  { icon: '📓', title: 'Cahier journal et planning', desc: 'Journée de classe ou d’enseignement détaillée : horaires, disciplines, objectifs et déroulement.' },
  { icon: '🔍', title: 'Corrigé annoté', desc: 'Collez un travail d’élève ou une copie : Magistra repère les erreurs et propose une correction commentée. Avec l’IA locale, la copie reste sur votre ordinateur.' },
];

export const FEATURES_PLUS: { icon: string; title: string; desc: string; link?: { href: string; label: string } }[] = [
  { icon: '🏫', title: 'De la maternelle au doctorat', desc: `${NB_NIVEAUX} niveaux et ${NB_MATIERES} matières, avec un accent sur le supérieur : CM, TD, examens, syllabus, vocabulaire universitaire.` },
  {
    icon: '💻',
    title: 'IA locale gratuite sur Windows',
    desc: 'L’application Windows fait tourner un modèle open weights sur votre ordinateur : vos documents restent sur votre ordinateur.',
    link: { href: WINDOWS_SECTION_HREF, label: 'Télécharger pour Windows' },
  },
  { icon: '🏛️', title: 'Gratuit, sans compte, hors connexion', desc: 'L’application Windows est gratuite : ni abonnement, ni compte à créer. Une fois l’IA activée, elle fonctionne sur votre ordinateur, même sans Internet.' },
  { icon: '📚', title: 'Sources vérifiables', desc: 'Vos documents (PDF, Word, PowerPoint…), HAL, Crossref, OpenAlex et des sites officiels vérifiés (UNESCO, Éduscol…) : les citations renvoient aux sources réellement utilisées, avec leur niveau de fiabilité.' },
  { icon: '◉', title: 'Open source, licence MIT', desc: 'Code public et auditable, projet non lucratif : pas d’abonnement, pas de quota commercial.' },
  { icon: '✧', title: 'À relire et adapter', desc: 'Magistra propose des brouillons structurés ; vous restez l’auteur. Relisez et vérifiez, puis copiez ou exportez (Markdown, PDF) pour adapter le texte dans votre traitement de texte. Besoin d’un autre angle ? Précisez vos consignes et relancez.' },
];

export const STEPS = [
  { num: '1', title: 'Créez votre profil', desc: 'Niveaux, matière, discipline : Magistra adapte le vocabulaire et les exigences à votre contexte. Votre profil reste propre à votre ordinateur.' },
  { num: '2', title: 'Choisissez un outil et vos sources', desc: `${NB_OUTILS} outils : cours, TD, examens, syllabus, appréciations, différenciation, courriers… Ajoutez vos documents ou activez la recherche HAL, Crossref, OpenAlex ou sur les sites officiels vérifiés.` },
  { num: '3', title: 'Relisez, exportez, adaptez', desc: 'Magistra rédige un brouillon structuré qui cite ses sources. Vous le relisez, le copiez ou l’exportez en Markdown ou en PDF, puis l’adaptez dans votre traitement de texte.' },
];

export const STATS = [
  { value: String(NB_OUTILS), label: 'Outils pédagogiques : cours, exercices et TD, évaluations, séquences, fiches de séance, progressions, appréciations, différenciation, courriers, cahier journal, corrigés.' },
  { value: String(NB_NIVEAUX), label: `Niveaux, de la Toute Petite Section au doctorat, et ${NB_MATIERES} matières. Dans le supérieur, les outils parlent CM, TD, examens et syllabus.` },
  { value: 'MIT', label: 'Open source sous licence MIT : code public et auditable, projet non lucratif. Les contenus produits sont à relire et adapter par l’enseignant.' },
];
