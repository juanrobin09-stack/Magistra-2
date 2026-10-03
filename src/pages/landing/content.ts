// Textes et chiffres de la page d'accueil, communs à l'application (LandingPage) et au site vitrine (SiteLanding).

import { BookOpenCheck, Folders, FilePenLine, GraduationCap, Monitor, WifiOff, type LucideIcon } from 'lucide-react';
import { ALL_MATIERES, ALL_TYPES, type TypeContenu } from '@shared/catalog';
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

interface ToolFeature {
  tool: TypeContenu;
  title: string;
  desc: string;
}

export const FEATURES_CREATION: ToolFeature[] = [
  { tool: 'cours', title: 'Cours', desc: 'Entrez un sujet, un niveau, une durée : Magistra propose un cours structuré (objectifs, plan, déroulé, trace écrite — ou CM problématisé dans le supérieur).' },
  { tool: 'exercices', title: 'Exercices et TD', desc: 'Séries progressives avec éléments de correction ; versions différenciées quand vous le demandez.' },
  { tool: 'evaluation', title: 'Évaluations et examens', desc: 'Sujet, corrigé et barème ou grille d’évaluation, à vérifier avant de les donner à vos élèves ou étudiants.' },
  { tool: 'sequence', title: 'Séquences et plans de module', desc: 'Organisation multi-séances, ou d’une UE en CM, TD et TP, avec objectifs, activités et modalités d’évaluation.' },
  { tool: 'fiche_prep', title: 'Fiches de séance', desc: 'Déroulé minuté, objectifs, matériel et modalités de travail, prêts à être ajustés à votre classe.' },
  { tool: 'progression', title: 'Progressions et syllabus', desc: 'Planification annuelle ou semestrielle, à ajuster à votre programme, à votre maquette et à votre calendrier.' },
];

export const FEATURES_OUTILS: ToolFeature[] = [
  { tool: 'appreciations', title: 'Appréciations et commentaires', desc: 'Choisissez un profil et un nombre d’appréciations : Magistra propose des formulations variées, à copier puis personnaliser dans votre logiciel de vie scolaire.' },
  { tool: 'differenciation', title: 'Différenciation', desc: 'Un exercice décliné selon les profils que vous cochez : accompagnement renforcé, standard, approfondissement. Mêmes objectifs, chemins adaptés.' },
  { tool: 'lettre_parents', title: 'Courriers aux familles et aux étudiants', desc: 'Absences, félicitations, réunion, orientation… des brouillons clairs et bienveillants, à relire avant envoi.' },
  { tool: 'cahier_journal', title: 'Cahier journal et planning', desc: 'Journée de classe ou d’enseignement détaillée : horaires, disciplines, objectifs et déroulement.' },
  { tool: 'corrige', title: 'Corrigé annoté', desc: 'Collez un travail d’élève ou une copie : Magistra repère les erreurs et propose une correction commentée. Avec l’IA locale, la copie reste sur votre ordinateur.' },
];

export const FEATURES_PLUS: { icon: LucideIcon; iconColor: string; title: string; desc: string; link?: { href: string; label: string } }[] = [
  { icon: GraduationCap, iconColor: 'text-accent', title: 'De la maternelle au doctorat', desc: `${NB_NIVEAUX} niveaux et ${NB_MATIERES} matières, avec un accent sur le supérieur : CM, TD, examens, syllabus, vocabulaire universitaire.` },
  {
    icon: Monitor,
    iconColor: 'text-sky-300',
    title: 'IA locale gratuite sur Windows',
    desc: 'L’application Windows fait tourner un modèle open weights sur votre ordinateur : vos documents restent sur votre ordinateur.',
    link: { href: WINDOWS_SECTION_HREF, label: 'Télécharger pour Windows' },
  },
  { icon: WifiOff, iconColor: 'text-teal-300', title: 'Gratuit, sans compte, hors connexion', desc: 'L’application Windows est gratuite : ni abonnement, ni compte à créer. Une fois l’IA activée, elle fonctionne sur votre ordinateur, même sans Internet.' },
  { icon: BookOpenCheck, iconColor: 'text-gold', title: 'Sources officielles et académiques', desc: 'Avec la recherche activée, l’IA reçoit les extraits trouvés dans des publications (HAL, Crossref, OpenAlex) et sur des sites institutionnels reconnus, en complément de vos documents. Les sources utilisées sont identifiées, selon le mode choisi et leur disponibilité.' },
  { icon: Folders, iconColor: 'text-accent', title: 'Votre espace pédagogique', desc: 'Retrouvez vos préparations dans votre historique et adaptez votre profil à vos niveaux et à vos matières.' },
  { icon: FilePenLine, iconColor: 'text-rose-300', title: 'À relire et adapter', desc: 'Magistra propose des brouillons structurés ; vous restez l’auteur. Relisez et vérifiez, puis copiez ou exportez (Markdown, PDF) pour adapter le texte dans votre traitement de texte. Besoin d’un autre angle ? Précisez vos consignes et relancez.' },
];

export const STEPS = [
  { num: '1', title: 'Créez votre profil', desc: 'Niveaux, matière, discipline : Magistra adapte le vocabulaire et les exigences à votre contexte. Votre profil reste propre à votre ordinateur.' },
  { num: '2', title: 'Choisissez un outil et vos sources', desc: `${NB_OUTILS} outils : cours, TD, examens, syllabus, appréciations, différenciation, courriers… Ajoutez vos documents et, si besoin, activez la recherche de sources officielles et académiques. Magistra transmet à l’IA les extraits disponibles pour étayer votre préparation.` },
  { num: '3', title: 'Relisez, exportez, adaptez', desc: 'Magistra rédige un brouillon structuré qui cite ses sources. Vous le relisez, le copiez ou l’exportez en Markdown ou en PDF, puis l’adaptez dans votre traitement de texte.' },
];

export const STATS = [
  { value: String(NB_OUTILS), label: 'Outils pédagogiques : cours, exercices et TD, évaluations, séquences, fiches de séance, progressions, appréciations, différenciation, courriers, cahier journal, corrigés.' },
  { value: String(NB_NIVEAUX), label: `Niveaux, de la Toute Petite Section au doctorat, et ${NB_MATIERES} matières. Dans le supérieur, les outils parlent CM, TD, examens et syllabus.` },
  { value: '0 €', label: 'Application gratuite, sans abonnement. Les contenus produits sont à relire et adapter par l’enseignant.' },
];
