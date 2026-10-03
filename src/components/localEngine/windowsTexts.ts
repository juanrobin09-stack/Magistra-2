// Textes du téléchargement de Magistra pour Windows, sans aucune dépendance : le site vitrine, l'accueil, les réglages et
// la carte du mode démonstration disent la même chose, et le site n'embarque rien du connecteur local (texts.ts).
//
// Mêmes trois étapes partout où l'on télécharge : l'installateur est un NSIS « oneClick », par utilisateur
// (perMachine: false, allowElevation: false), qui lance Magistra à la fin (runAfterFinish: true) — electron-builder.json.
// Il n'est pas encore signé : SmartScreen l'annonce, avec les libellés exacts de Windows en français.

export const DOWNLOAD_WINDOWS_LABEL = 'Télécharger Magistra pour Windows';
/** Aucune version stable publiée : le bouton de téléchargement est inactif (jamais un renvoi vers une page vide). */
export const NOT_PUBLISHED_TEXT = 'Pas encore disponible : la première version de Magistra pour Windows n’est pas encore publiée. Le téléchargement s’activera ici dès sa publication.';
export const OPEN_APP_LABEL = 'Ouvrir Magistra';
/**
 * Adresse que l'installateur enregistre pour ouvrir l'application (OPEN_APP_URL de shared/localConnector.ts, qu'un test
 * compare) : recopiée ici pour que le site vitrine n'importe rien du protocole du connecteur local.
 */
export const OPEN_APP_HREF = 'magistra://open';

export const INSTALL_STEPS: readonly string[] = [
  'Téléchargez Magistra.',
  'Ouvrez le fichier téléchargé. Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur « Informations complémentaires » puis « Exécuter quand même ».',
  'Magistra s’installe en quelques secondes, sans droits d’administrateur, et s’ouvre toute seule.',
];
export const INSTALL_STEPS_LABEL = 'Installation en trois étapes';
/**
 * Ce qui suit l'installation, dit honnêtement : l'IA n'est pas dans l'installateur. L'application propose de
 * l'activer (moteur et modèle) et annonce la taille AVANT tout téléchargement ; jamais sans ce clic.
 */
export const ACTIVATE_AI_NOTE =
  'Ensuite, Magistra vous propose d’activer l’IA : un seul téléchargement de plusieurs Go, dont la taille est annoncée avant. L’IA fonctionne ensuite même sans Internet.';
export const ALREADY_INSTALLED_TEXT = 'Déjà installée ?';
