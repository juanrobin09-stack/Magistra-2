import { AUTHOR_DEFAULT_PROFILE_URL, AUTHOR_NAME } from './author';
import { SITE_ORIGIN, siteUrl } from './site';

export const SITE_TITLE = 'Magistra — IA gratuite pour enseignants, cours et examens';
export const SITE_DESCRIPTION = 'Préparez vos cours, exercices et examens avec Magistra, l’assistant IA gratuit pour enseignants. Application Windows, sans compte, avec une IA locale.';
export const SITE_IMAGE_PATH = '/assets/magistra-icon.png';
export const SITE_ROBOTS = 'index, follow, max-image-preview:large';

export const SITE_SEO: Record<string, { title: string; description: string; index: boolean }> = {
  '/': { title: SITE_TITLE, description: SITE_DESCRIPTION, index: true },
  '/mentions-legales': {
    title: 'Mentions légales — Magistra',
    description: 'Éditeur, contact, hébergement et mentions légales du site officiel de Magistra, l’assistant pédagogique gratuit pour Windows.',
    index: false,
  },
  '/confidentialite': {
    title: 'Politique de confidentialité — Magistra',
    description: 'Découvrez comment le site Magistra traite les données techniques et les téléchargements, sans compte ni cookie de suivi.',
    index: false,
  },
  '/cgu': {
    title: "Conditions générales d'utilisation — Magistra",
    description: 'Conditions d’utilisation du site Magistra : accès gratuit, téléchargement de l’application Windows et responsabilités de l’utilisateur.',
    index: false,
  },
  '/404': {
    title: 'Page introuvable — Magistra',
    description: 'Cette page n’existe pas. Retrouvez Magistra et son application pédagogique gratuite sur le site officiel.',
    index: false,
  },
};

/** Informations factuelles seulement : pas d’avis, de note ou de nombre d’utilisateurs inventé. */
export const SITE_STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', '@id': siteUrl('/#website'), name: 'Magistra', url: siteUrl('/'), inLanguage: 'fr-FR' },
    {
      '@type': 'SoftwareApplication', '@id': siteUrl('/#application'), name: 'Magistra',
      url: siteUrl('/'), description: SITE_DESCRIPTION, applicationCategory: 'EducationalApplication',
      operatingSystem: 'Windows 10, Windows 11', inLanguage: 'fr-FR', isAccessibleForFree: true,
      image: `${SITE_ORIGIN}${SITE_IMAGE_PATH}`, downloadUrl: siteUrl('/telecharger'),
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      author: { '@type': 'Person', name: AUTHOR_NAME, url: AUTHOR_DEFAULT_PROFILE_URL },
    },
  ],
};

export const SITE_FAQ = [
  { question: 'Magistra est-il vraiment gratuit ?', answer: 'Oui. L’application Magistra est gratuite, sans abonnement et sans création de compte. Vous pouvez préparer vos supports pédagogiques avec une IA installée sur votre ordinateur.' },
  { question: 'À quels enseignants Magistra s’adresse-t-il ?', answer: 'Magistra accompagne les enseignants de la maternelle au doctorat, avec un accent sur le supérieur : cours, exercices, TD, examens, corrigés et syllabus. Les contenus proposés restent des brouillons à vérifier et à adapter.' },
  { question: 'Peut-on utiliser Magistra sans Internet ?', answer: 'L’installation de Magistra et le téléchargement initial du moteur et du modèle d’IA nécessitent Internet. Une fois l’IA locale activée, la génération peut fonctionner hors ligne. La recherche de sources sur le Web nécessite toujours une connexion.' },
  { question: 'Sur quelles sources l’IA peut-elle s’appuyer ?', answer: 'Vos documents restent prioritaires. Si vous activez la recherche, Magistra peut récupérer des publications via HAL, Crossref et OpenAlex, ainsi que des pages de sites institutionnels reconnus : le catalogue comprend notamment Éduscol, les ministères, l’UNESCO et le CNRS. Les pages effectivement trouvées dépendent du sujet, du mode de recherche et des services disponibles. L’IA reçoit leurs extraits ; une simple notice bibliographique n’est pas traitée comme un article lu. Wikipédia peut compléter une recherche Internet et reste signalée comme une encyclopédie à recouper.' },
  { question: 'Sur quels appareils peut-on installer Magistra ?', answer: 'La version disponible fonctionne sur Windows 10 et Windows 11 en 64 bits. Les performances de l’IA locale dépendent de la mémoire et de la puissance de votre ordinateur.' },
  { question: 'Les cours générés sont-ils prêts à être distribués ?', answer: 'Vous gardez la main sur chaque production. Relisez les contenus, vérifiez les sources et adaptez les exercices à vos élèves avant de les utiliser en classe. Une IA peut commettre des erreurs.' },
];
