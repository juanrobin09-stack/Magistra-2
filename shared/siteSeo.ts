import { AUTHOR_DEFAULT_PROFILE_URL, AUTHOR_NAME } from './author';
import { SITE_ORIGIN, siteUrl } from './site';
import { SITE_GUIDES, SITE_GUIDES_DESCRIPTION, SITE_GUIDES_TITLE, getSiteGuide } from './siteGuides';

export const SITE_TITLE = 'Magistra — IA gratuite pour enseignants, cours et examens';
export const SITE_DESCRIPTION = 'Préparez vos cours, exercices et examens avec Magistra, l’assistant IA gratuit pour enseignants. Application Windows, sans compte, avec une IA locale.';
export const SITE_IMAGE_PATH = '/assets/magistra-social.png';
export const SITE_ICON_PATH = '/assets/magistra-icon.png';
export const SITE_IMAGE_ALT = 'Magistra, assistant IA gratuit pour enseignants : cours, TD, examens et corrigés';
export const SITE_ROBOTS = 'index, follow, max-image-preview:large';

export interface SiteSeoPage { title: string; description: string; index: boolean; type: 'website' | 'article' }

export const SITE_SEO: Record<string, SiteSeoPage> = {
  '/': { title: SITE_TITLE, description: SITE_DESCRIPTION, index: true, type: 'website' },
  '/guides': { title: SITE_GUIDES_TITLE, description: SITE_GUIDES_DESCRIPTION, index: true, type: 'website' },
  ...Object.fromEntries(SITE_GUIDES.map(guide => [guide.path, {
    title: guide.title, description: guide.description, index: true, type: 'article' as const,
  }])),
  '/mentions-legales': {
    title: 'Mentions légales — Magistra',
    description: 'Éditeur, contact, hébergement et mentions légales du site officiel de Magistra, l’assistant pédagogique gratuit pour Windows.',
    index: false, type: 'website',
  },
  '/confidentialite': {
    title: 'Politique de confidentialité — Magistra',
    description: 'Découvrez comment le site Magistra traite les données techniques et les téléchargements, sans compte ni cookie de suivi.',
    index: false, type: 'website',
  },
  '/cgu': {
    title: "Conditions générales d'utilisation — Magistra",
    description: 'Conditions d’utilisation du site Magistra : accès gratuit, téléchargement de l’application Windows et responsabilités de l’utilisateur.',
    index: false, type: 'website',
  },
  '/404': {
    title: 'Page introuvable — Magistra',
    description: 'Cette page n’existe pas. Retrouvez Magistra et son application pédagogique gratuite sur le site officiel.',
    index: false, type: 'website',
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

const author = { '@type': 'Person', name: AUTHOR_NAME, url: AUTHOR_DEFAULT_PROFILE_URL };

/** Schéma factuel correspondant au contenu visible de chaque page ; aucun avis ni résultat enrichi garanti. */
export function siteStructuredData(pagePath: string): Record<string, unknown> | null {
  if (pagePath === '/') return SITE_STRUCTURED_DATA;
  if (pagePath === '/guides') return {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'CollectionPage', '@id': siteUrl('/guides#resources'), url: siteUrl('/guides'),
      name: SITE_GUIDES_TITLE, description: SITE_GUIDES_DESCRIPTION, inLanguage: 'fr-FR',
      isPartOf: { '@id': siteUrl('/#website') },
      mainEntity: { '@type': 'ItemList', itemListElement: SITE_GUIDES.map((guide, index) => ({
        '@type': 'ListItem', position: index + 1, name: guide.heading, url: siteUrl(guide.path),
      })) },
    }, {
      '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Magistra', item: siteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Guides pour enseignants', item: siteUrl('/guides') },
      ],
    }],
  };
  const guide = getSiteGuide(pagePath);
  if (!guide) return null;
  return {
    '@context': 'https://schema.org',
    '@graph': [{
      '@type': 'Article', '@id': siteUrl(`${pagePath}#article`), url: siteUrl(pagePath),
      headline: guide.heading, description: guide.description, inLanguage: 'fr-FR',
      mainEntityOfPage: { '@type': 'WebPage', '@id': siteUrl(pagePath) },
      author, publisher: author, image: siteUrl(SITE_IMAGE_PATH),
      isPartOf: { '@id': siteUrl('/#website') },
      about: { '@id': siteUrl('/#application') },
    }, {
      '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Magistra', item: siteUrl('/') },
        { '@type': 'ListItem', position: 2, name: 'Guides pour enseignants', item: siteUrl('/guides') },
        { '@type': 'ListItem', position: 3, name: guide.heading, item: siteUrl(pagePath) },
      ],
    }],
  };
}

/** Même sérialisation pour le pré-rendu, la navigation, la CSP et les contrôles. */
export function siteStructuredDataJson(pagePath: string): string | null {
  const data = siteStructuredData(pagePath);
  return data ? JSON.stringify(data).replace(/</g, '\\u003c') : null;
}

export const SITE_FAQ = [
  { question: 'Magistra est-il vraiment gratuit ?', answer: 'Oui. L’application Magistra est gratuite, sans abonnement et sans création de compte. Vous pouvez préparer vos supports pédagogiques avec une IA installée sur votre ordinateur.' },
  { question: 'À quels enseignants Magistra s’adresse-t-il ?', answer: 'Magistra accompagne les enseignants de la maternelle au doctorat, avec un accent sur le supérieur : cours, exercices, TD, examens, corrigés et syllabus. Les contenus proposés restent des brouillons à vérifier et à adapter.' },
  { question: 'Peut-on utiliser Magistra sans Internet ?', answer: 'L’installation de Magistra et le téléchargement initial du moteur et du modèle d’IA nécessitent Internet. Une fois l’IA locale activée, la génération peut fonctionner hors ligne. La recherche de sources sur le Web nécessite toujours une connexion.' },
  { question: 'Sur quelles sources l’IA peut-elle s’appuyer ?', answer: 'Vos documents restent prioritaires. Si vous activez la recherche, Magistra peut récupérer des publications via HAL, Crossref et OpenAlex, ainsi que des pages de sites institutionnels reconnus : le catalogue comprend notamment Éduscol, les ministères, l’UNESCO et le CNRS. Les pages effectivement trouvées dépendent du sujet, du mode de recherche et des services disponibles. L’IA reçoit leurs extraits ; une simple notice bibliographique n’est pas traitée comme un article lu. Wikipédia peut compléter une recherche Internet et reste signalée comme une encyclopédie à recouper.' },
  { question: 'Sur quels appareils peut-on installer Magistra ?', answer: 'La version disponible fonctionne sur Windows 10 et Windows 11 en 64 bits. Les performances de l’IA locale dépendent de la mémoire et de la puissance de votre ordinateur.' },
  { question: 'Que faire si une mise à jour bloque dans l’application ?', answer: 'Pour les versions 2.0.7 à 2.0.9, ouvrez Réglages → Rechercher une mise à jour, puis cliquez sur « Ouvrir la page de la nouvelle version ». Téléchargez l’installateur proposé et ouvrez-le après avoir enregistré votre travail et fermé Magistra. Vos documents, réglages, clés API et modèles sont conservés. Ce passage est nécessaire une fois ; la version corrigée permet ensuite de télécharger et installer les mises à jour depuis l’application.' },
  { question: 'Les cours générés sont-ils prêts à être distribués ?', answer: 'Vous gardez la main sur chaque production. Relisez les contenus, vérifiez les sources et adaptez les exercices à vos élèves avant de les utiliser en classe. Une IA peut commettre des erreurs.' },
];
