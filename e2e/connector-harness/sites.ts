// Adresses des tests E2E du connecteur local (projet Playwright « connector ») : le harnais est servi comme le
// « site officiel » (origine autorisée par l'application via MAGISTRA_CONNECTOR_DEV_ORIGINS) et comme un « autre
// site » (jamais autorisé). Partagé par playwright.config.ts et e2e/connector-local.spec.ts.

export const SITE_PORT = 4175;
export const OTHER_SITE_PORT = 4176;
export const SITE_ORIGIN = `http://127.0.0.1:${SITE_PORT}`;
export const OTHER_SITE_ORIGIN = `http://127.0.0.1:${OTHER_SITE_PORT}`;
// Les origines officielles du site public (https://www.mag-istra.fr et l'ancienne adresse) ne peuvent pas être jouées dans un
// navigateur ici (aucun accès au réseau, protocole https) : e2e/connector-local.spec.ts les vérifie auprès de l'application
// réelle par des requêtes directes (en-tête Origin) et par des URL magistra://pair, sans lancement supplémentaire.

/**
 * Protection RÉELLE « Local Network Access » de Chromium : les deux sites de test sont traités comme des sites PUBLICS
 * (comme https://www.mag-istra.fr, ou l'ancienne adresse https://magistra-2.vercel.app), si bien que toute requête vers la
 * boucle locale (le connecteur) exige l'autorisation « local-network-access » du navigateur. Rien n'est contourné dans le
 * code du site : seuls les tests accordent (context.grantPermissions) ou refusent (Browser.setPermission) cette
 * autorisation, comme l'enseignant.
 */
export const LOCAL_NETWORK_ACCESS_ARGS: readonly string[] = [
  '--enable-features=LocalNetworkAccessChecks',
  `--ip-address-space-overrides=127.0.0.1:${SITE_PORT}=public,127.0.0.1:${OTHER_SITE_PORT}=public`,
];
