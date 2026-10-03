// Catalogue des sites officiels et académiques vérifiés : les seuls sites, avec Wikipédia (signalée), sur lesquels une
// recherche en ligne s'appuie. Institutions publiques, organisations intergouvernementales et infrastructures de la
// recherche uniquement. Fonctions pures : aucune requête, aucune dépendance.

/**
 * Nature du site, donc niveau de fiabilité affiché :
 * - « official » : administrations, organisations intergouvernementales et agences publiques (jamais autre chose) ;
 * - « scientific » : organismes de recherche, bibliothèques, bases de publications ;
 * - « open » : plateforme ouverte, dont n'importe quel contributeur peut déposer le contenu (HAL, data.gouv.fr, Canal-U) :
 *   reconnue et citée, mais toujours signalée « à recouper », jamais « officielle ».
 * Limite : le niveau est celui de l'HÔTE, jamais de l'auteur de la page. Un hôte réputé peut héberger des pages
 * personnelles ou libres (« cern.ch ») : seule la plateforme ouverte est signalée comme telle.
 */
export type TrustedTier = 'official' | 'scientific' | 'open';

export type TrustedCategory = 'education' | 'academie' | 'international' | 'administration' | 'recherche' | 'bibliotheque';

export interface TrustedSite {
  /** Nom de domaine ; ses sous-domaines réels (« .unesco.org ») sont reconnus aussi. */
  domain: string;
  /** Nom du site tel qu'il est cité (« UNESCO »). */
  label: string;
  tier: TrustedTier;
  category: TrustedCategory;
  /**
   * Le site ne fait que renvoyer ailleurs (« doi.org » vers l'éditeur) : reconnu, pour étiqueter un DOI, mais jamais
   * récupéré ni interrogé : l'ouvrir reviendrait à contacter un éditeur quelconque.
   */
  redirectOnly?: true;
}

function sites(tier: TrustedTier, category: TrustedCategory, entries: readonly (readonly [domain: string, label: string])[]): TrustedSite[] {
  return entries.map(([domain, label]) => ({ domain, label, tier, category }));
}

/**
 * Ordre de lecture ET d'interrogation (requêtes « site: », au plus 36 domaines : voir trustedSearchGroups) : ce qui sert
 * le plus un enseignant d'abord (ministères et Éduscol, UNESCO, ONU et ses agences, OCDE, Banque mondiale, Union
 * européenne, Conseil de l'Europe, recherche publique, Service-Public.fr, portails de publications), les plateformes
 * ouvertes et les sites des académies en dernier. Un domaine parent précède ses sous-domaines (« unesco.org » avant
 * « whc.unesco.org ») : la requête « site: » du parent les couvre.
 */
export const TRUSTED_SITES: readonly TrustedSite[] = [
  ...sites('official', 'education', [
    ['education.gouv.fr', 'Ministère de l’Éducation nationale'],
    ['eduscol.education.fr', 'Éduscol'],
    ['enseignementsup-recherche.gouv.fr', 'Ministère de l’Enseignement supérieur et de la Recherche'],
    ['onisep.fr', 'Onisep'],
    ['reseau-canope.fr', 'Réseau Canopé'],
    ['lumni.fr', 'Lumni'],
  ]),
  ...sites('official', 'international', [
    ['unesco.org', 'UNESCO'],
    ['unesdoc.unesco.org', 'UNESDOC (UNESCO)'],
    ['whc.unesco.org', 'Patrimoine mondial (UNESCO)'],
    ['uis.unesco.org', 'Institut de statistique de l’UNESCO'],
    ['un.org', 'ONU'],
    ['who.int', 'OMS'],
    ['unicef.org', 'UNICEF'],
    ['fao.org', 'FAO'],
    ['ilo.org', 'OIT'],
    ['ipcc.ch', 'GIEC'],
    ['oecd.org', 'OCDE'],
    ['worldbank.org', 'Banque mondiale'],
    ['europa.eu', 'Union européenne'],
    ['ec.europa.eu', 'Commission européenne'],
    ['eur-lex.europa.eu', 'EUR-Lex (Union européenne)'],
    ['coe.int', 'Conseil de l’Europe'],
  ]),
  // Recherche publique française.
  ...sites('scientific', 'recherche', [
    ['cnrs.fr', 'CNRS'],
    ['inserm.fr', 'Inserm'],
    ['inria.fr', 'Inria'],
    ['cea.fr', 'CEA'],
    ['ird.fr', 'IRD'],
    ['ifremer.fr', 'Ifremer'],
    ['cnrtl.fr', 'CNRTL'],
  ]),
  ...sites('official', 'recherche', [
    ['insee.fr', 'Insee'],
    ['academie-sciences.fr', 'Académie des sciences'],
    ['academie-francaise.fr', 'Académie française'],
  ]),
  // Tout site « .gouv.fr » (ministères, préfectures, Légifrance…) ; les adresses connues sont nommées.
  ...sites('official', 'administration', [
    ['service-public.fr', 'Service-Public.fr'],
    ['gouv.fr', 'Administration française'],
    ['legifrance.gouv.fr', 'Légifrance'],
    ['culture.gouv.fr', 'Ministère de la Culture'],
  ]),
  // Bibliothèques et portails de publications.
  ...sites('scientific', 'bibliotheque', [
    ['bnf.fr', 'BnF'],
    ['gallica.bnf.fr', 'Gallica (BnF)'],
    ['persee.fr', 'Persée'],
    ['openedition.org', 'OpenEdition'],
    ['theses.fr', 'theses.fr'],
    ['europepmc.org', 'Europe PMC'],
    ['doaj.org', 'DOAJ'],
  ]),
  // Agences scientifiques et organisation de recherche étrangères ou internationales.
  ...sites('scientific', 'recherche', [
    ['nasa.gov', 'NASA'],
    ['esa.int', 'Agence spatiale européenne'],
    ['cern.ch', 'CERN'],
    ['noaa.gov', 'NOAA'],
    ['nih.gov', 'NIH'],
  ]),
  // Plateformes ouvertes : n'importe quel contributeur peut y déposer du contenu (jeux de données, dépôts de textes,
  // vidéos). Reconnues, citées et signalées « à recouper », jamais présentées comme officielles. « data.gouv.fr » est aussi
  // couvert par « gouv.fr » : l'entrée la plus précise l'emporte.
  ...sites('open', 'administration', [['data.gouv.fr', 'data.gouv.fr']]),
  ...sites('open', 'education', [['canal-u.tv', 'Canal-U']]),
  ...sites('open', 'bibliotheque', [
    ['hal.science', 'HAL'],
    ['archives-ouvertes.fr', 'HAL'],
  ]),
  // Infrastructures de publication, déjà interrogées par leurs propres connecteurs (HAL, Crossref, OpenAlex).
  ...sites('scientific', 'bibliotheque', [
    ['openalex.org', 'OpenAlex'],
    ['crossref.org', 'Crossref'],
  ]),
  // « doi.org » ne fait que renvoyer vers l'éditeur : reconnu pour étiqueter un DOI, jamais récupéré (n'importe qui peut
  // enregistrer un DOI qui mène à n'importe quel site).
  ...sites('scientific', 'bibliotheque', [['doi.org', 'DOI']]).map((site): TrustedSite => ({ ...site, redirectOnly: true })),
  // Sites des académies : reconnus, mais trop nombreux pour les requêtes « site: » (voir trustedSearchGroups).
  ...sites('official', 'academie', [
    ['ac-aix-marseille.fr', 'Académie d’Aix-Marseille'],
    ['ac-amiens.fr', 'Académie d’Amiens'],
    ['ac-besancon.fr', 'Académie de Besançon'],
    ['ac-bordeaux.fr', 'Académie de Bordeaux'],
    ['ac-clermont.fr', 'Académie de Clermont-Ferrand'],
    ['ac-corse.fr', 'Académie de Corse'],
    ['ac-creteil.fr', 'Académie de Créteil'],
    ['ac-dijon.fr', 'Académie de Dijon'],
    ['ac-grenoble.fr', 'Académie de Grenoble'],
    ['ac-guadeloupe.fr', 'Académie de la Guadeloupe'],
    ['ac-guyane.fr', 'Académie de la Guyane'],
    ['ac-lille.fr', 'Académie de Lille'],
    ['ac-limoges.fr', 'Académie de Limoges'],
    ['ac-lyon.fr', 'Académie de Lyon'],
    ['ac-martinique.fr', 'Académie de la Martinique'],
    ['ac-mayotte.fr', 'Académie de Mayotte'],
    ['ac-montpellier.fr', 'Académie de Montpellier'],
    ['ac-nancy-metz.fr', 'Académie de Nancy-Metz'],
    ['ac-nantes.fr', 'Académie de Nantes'],
    ['ac-nice.fr', 'Académie de Nice'],
    ['ac-normandie.fr', 'Académie de Normandie'],
    ['ac-orleans-tours.fr', 'Académie d’Orléans-Tours'],
    ['ac-paris.fr', 'Académie de Paris'],
    ['ac-poitiers.fr', 'Académie de Poitiers'],
    ['ac-reims.fr', 'Académie de Reims'],
    ['ac-rennes.fr', 'Académie de Rennes'],
    ['ac-reunion.fr', 'Académie de La Réunion'],
    ['ac-strasbourg.fr', 'Académie de Strasbourg'],
    ['ac-toulouse.fr', 'Académie de Toulouse'],
    ['ac-versailles.fr', 'Académie de Versailles'],
  ]),
];

/**
 * Rang de lecture d'une page : éducation (ministères), organisations internationales, recherche, le reste, dont les sites
 * des académies. Les plateformes ouvertes (contenu déposé par des tiers) passent après tout le reste.
 */
export function trustedPriority(site: TrustedSite): number {
  if (site.tier === 'open') return 4;
  switch (site.category) {
    case 'education':
      return 0;
    case 'international':
      return 1;
    case 'recherche':
      return 2;
    case 'academie':
      return 3;
    default:
      return 3;
  }
}

/** Nom d'hôte, quand l'adresse est une adresse web ordinaire (http ou https, sans identifiants ni port particulier). */
const HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

function hostOf(url: URL): string | null {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // « https://unesco.org@pirate.com/ » a pour hôte pirate.com ; « https://pirate@unesco.org/ » est écartée, comme tout port particulier.
  if (url.username || url.password || url.port) return null;
  // Point final (« unesco.org. ») ; l'analyseur d'adresses a déjà mis en minuscules et converti les noms internationaux (punycode).
  const host = url.hostname.replace(/\.$/, '');
  return HOST.test(host) ? host : null;
}

function parse(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

const SPECIFIC_FIRST: readonly TrustedSite[] = [...TRUSTED_SITES].sort((a, b) => b.domain.length - a.domain.length);

/**
 * Site vérifié d'une adresse : le nom d'hôte est EXACTEMENT un domaine du catalogue ou l'un de ses sous-domaines réels
 * (jamais une simple sous-chaîne : « evilunesco.org », « unesco.org.pirate.com »). Le plus précis l'emporte
 * (« whc.unesco.org » avant « unesco.org »). Null pour toute autre adresse.
 */
export function trustedSiteFor(url: string): TrustedSite | null {
  const parsed = parse(url);
  const host = parsed ? hostOf(parsed) : null;
  if (!host) return null;
  return SPECIFIC_FIRST.find(s => host === s.domain || host.endsWith(`.${s.domain}`)) ?? null;
}

export function isTrustedUrl(url: string): boolean {
  return trustedSiteFor(url) !== null;
}

/** Vrai pour un site vérifié servi en https : seule forme acceptée pour une source citée et un lien affiché. */
export function isTrustedHttpsUrl(url: string): boolean {
  return isTrustedUrl(url) && parse(url)?.protocol === 'https:';
}

/**
 * Site du catalogue qu'une recherche peut récupérer ou interroger : tous, sauf ceux qui ne font que renvoyer ailleurs
 * (« doi.org »). Null pour toute autre adresse.
 */
export function fetchableSiteFor(url: string): TrustedSite | null {
  const site = trustedSiteFor(url);
  return site && !site.redirectOnly ? site : null;
}

/**
 * Adresse qu'une recherche peut contacter sous la restriction aux sites vérifiés : https, site du catalogue, hors sites qui
 * ne font que renvoyer ailleurs. C'est le prédicat `allowUrl` de la récupération de pages : il refuse une redirection
 * AVANT toute connexion à l'hôte visé.
 */
export function isFetchableHttpsUrl(url: string): boolean {
  return fetchableSiteFor(url) !== null && parse(url)?.protocol === 'https:';
}

const GROUP_SIZE = 6;
const MAX_GROUPS = 6;

/**
 * Nombre de domaines interrogés DIRECTEMENT par les requêtes « site: » : 6 requêtes de 6 domaines au plus. Affiché dans les
 * réglages (SEARCH_SCOPE_TEXT) ; un test vérifie qu'il est exact.
 */
export const SEARCHED_DOMAIN_COUNT = GROUP_SIZE * MAX_GROUPS;

/**
 * Sites reconnus (cités, étiquetés) mais jamais interrogés directement par les requêtes « site: », en toutes lettres :
 * affiché dans les réglages, à tenir à jour avec le catalogue (un test le vérifie).
 */
export const NOT_SEARCHED_SITES = 'les sites des académies scolaires, Canal-U, HAL, OpenAlex, Crossref, l’Agence spatiale européenne, le CERN, la NOAA et le NIH (et doi.org, reconnu pour les DOI mais jamais consulté)';

/**
 * Ce que fait l'interrogation directe (moteur de recherche web), sans rien promettre de plus : les principaux sites, leur
 * nombre, et ce qui n'est pas interrogé. Complète « interroger directement » dans les réglages.
 */
export const SEARCH_SCOPE_TEXT =
  `les principaux sites officiels vérifiés (UNESCO, Éduscol, ministères, ONU…), soit ${SEARCHED_DOMAIN_COUNT} domaines. `
  + `Ne sont pas interrogés directement : ${NOT_SEARCHED_SITES}.`;

/**
 * Domaines des requêtes « site: », par lots de 5 à 6 (au plus 6 lots : SEARCHED_DOMAIN_COUNT domaines), dans l'ordre du
 * catalogue. Un sous-domaine déjà couvert par son parent n'est pas répété ; les sites des académies (une trentaine) et
 * ceux qui ne font que renvoyer ailleurs ne sont pas interrogés : reconnus seulement. Au-delà du plafond, la fin du
 * catalogue n'est pas interrogée (elle reste reconnue : NOT_SEARCHED_SITES).
 */
export function trustedSearchGroups(): string[][] {
  const domains: string[] = [];
  for (const site of TRUSTED_SITES) {
    if (site.category === 'academie' || site.redirectOnly) continue;
    if (domains.some(d => site.domain === d || site.domain.endsWith(`.${d}`))) continue;
    domains.push(site.domain);
  }
  const kept = domains.slice(0, SEARCHED_DOMAIN_COUNT);
  const count = Math.ceil(kept.length / GROUP_SIZE);
  const groups: string[][] = [];
  let from = 0;
  for (let i = 0; i < count; i++) {
    // Lots de taille presque égale (5 ou 6), les plus remplis en tête.
    const size = Math.floor(kept.length / count) + (i < kept.length % count ? 1 : 0);
    groups.push(kept.slice(from, from + size));
    from += size;
  }
  return groups;
}

/**
 * Racine d'un site, page de langue seule (« /fr ») ou page d'accueil nommée (« /index.html », « /fr/accueil ») : rien à
 * citer.
 */
const HOME_PATH = /^\/(?:[a-z]{2,3}(?:[-_][a-z]{2})?(?:\/|$))?(?:(?:index|home|accueil)(?:\.[a-z0-9]{2,5})?\/?)?$/i;
/** Page de recherche ou de connexion : jamais une source. */
const TOOL_PATH = /(?:^|\/)(?:search|rechercher|login|logon|signin|sign-in|connexion|se-connecter|auth|sso|cas|account|compte)(?:[/.]|$)/i;
/**
 * « recherche » est aussi une rubrique (« /fr/recherche/biologie » : un article sur la recherche) : elle n'est une page de
 * recherche qu'en dernier segment, sans suite (« /fr/recherche », « /recherche.php »).
 */
const SEARCH_PAGE = /(?:^|\/)recherche(?:\.[a-z0-9]{2,5})?\/?$/i;
const SEARCH_PARAMS = ['q', 's', 'search', 'query', 'recherche', 'keywords'];

/**
 * Chemin sous sa forme canonique : « %69ndex.html » devient « index.html », « // » une seule barre et « /login;jsessionid=1 »
 * « /login », pour qu'une écriture détournée de l'accueil ou de la connexion ne passe pas pour un article.
 */
function canonicalPath(pathname: string): string {
  let path = pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // Pourcentage mal formé : le chemin brut est contrôlé tel quel.
  }
  return path.split('/').map(segment => segment.replace(/;.*$/, '')).join('/').replace(/\/{2,}/g, '/');
}

function isArticleUrl(url: URL): boolean {
  const path = canonicalPath(url.pathname);
  if (HOME_PATH.test(path) || TOOL_PATH.test(path) || SEARCH_PAGE.test(path)) return false;
  return !SEARCH_PARAMS.some(p => url.searchParams.has(p));
}

/**
 * Page qu'une source peut citer : site du catalogue servi en https, ni accueil ni recherche ni connexion. À appliquer à
 * l'adresse FINALE d'une page récupérée : une redirection peut mener d'un article à l'accueil du site ou à une page de
 * connexion, dont le texte (menus) ne serait pas une source.
 */
export function isCitablePage(url: string | URL): boolean {
  const parsed = parse(typeof url === 'string' ? url : url.href);
  return parsed !== null && parsed.protocol === 'https:' && fetchableSiteFor(parsed.href) !== null && isArticleUrl(parsed);
}

export interface TrustedLink {
  url: string;
  site: TrustedSite;
}

/**
 * Pages à citer parmi des liens (références d'un article) : sites vérifiés en https seulement, ni page d'accueil ni
 * page de recherche ou de connexion, ni « doi.org » (qui ne fait que renvoyer vers un éditeur quelconque), classées
 * éducation > organisations internationales > recherche > reste > plateformes ouvertes (à rang égal, dans l'ordre des
 * liens), une seule par hôte, `max` au plus.
 */
export function selectTrustedLinks(urls: readonly string[], max: number): TrustedLink[] {
  const found: { link: TrustedLink; host: string; rank: number; order: number }[] = [];
  urls.forEach((raw, order) => {
    const site = fetchableSiteFor(raw);
    const parsed = parse(raw);
    if (!site || !parsed || parsed.protocol !== 'https:' || !isArticleUrl(parsed)) return;
    parsed.hash = '';
    found.push({ link: { url: parsed.href, site }, host: parsed.hostname.replace(/\.$/, '').replace(/^www\./, ''), rank: trustedPriority(site), order });
  });
  found.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const hosts = new Set<string>();
  const out: TrustedLink[] = [];
  for (const f of found) {
    if (out.length >= max) break;
    if (hosts.has(f.host)) continue;
    hosts.add(f.host);
    out.push(f.link);
  }
  return out;
}
