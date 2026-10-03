// Catalogue des sites officiels et académiques vérifiés : les seuls sites, avec Wikipédia (signalée), sur lesquels une
// recherche en ligne s'appuie. Institutions publiques, organisations intergouvernementales et infrastructures de la
// recherche uniquement. Fonctions pures : aucune requête, aucune dépendance.

export type TrustedTier = 'official' | 'scientific';

export type TrustedCategory = 'education' | 'academie' | 'international' | 'administration' | 'recherche' | 'bibliotheque';

export interface TrustedSite {
  /** Nom de domaine ; ses sous-domaines réels (« .unesco.org ») sont reconnus aussi. */
  domain: string;
  /** Nom du site tel qu'il est cité (« UNESCO »). */
  label: string;
  /** Source officielle (institutions, organisations internationales) ou scientifique (recherche, archives ouvertes). */
  tier: TrustedTier;
  category: TrustedCategory;
}

function sites(tier: TrustedTier, category: TrustedCategory, entries: readonly (readonly [domain: string, label: string])[]): TrustedSite[] {
  return entries.map(([domain, label]) => ({ domain, label, tier, category }));
}

/**
 * Ordre de lecture : éducation, puis organisations internationales, recherche, et le reste. Un domaine parent précède
 * ses sous-domaines (« unesco.org » avant « whc.unesco.org ») : la requête « site: » du parent les couvre.
 */
export const TRUSTED_SITES: readonly TrustedSite[] = [
  ...sites('official', 'education', [
    ['education.gouv.fr', 'Ministère de l’Éducation nationale'],
    ['eduscol.education.fr', 'Éduscol'],
    ['enseignementsup-recherche.gouv.fr', 'Ministère de l’Enseignement supérieur et de la Recherche'],
    ['onisep.fr', 'Onisep'],
    ['reseau-canope.fr', 'Réseau Canopé'],
    ['lumni.fr', 'Lumni'],
    ['canal-u.tv', 'Canal-U'],
  ]),
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
  ...sites('scientific', 'recherche', [
    ['cnrs.fr', 'CNRS'],
    ['inserm.fr', 'Inserm'],
    ['inria.fr', 'Inria'],
    ['cea.fr', 'CEA'],
    ['ird.fr', 'IRD'],
    ['ifremer.fr', 'Ifremer'],
    ['cnrtl.fr', 'CNRTL'],
    ['nasa.gov', 'NASA'],
    ['esa.int', 'Agence spatiale européenne'],
    ['cern.ch', 'CERN'],
    ['noaa.gov', 'NOAA'],
    ['nih.gov', 'NIH'],
  ]),
  ...sites('official', 'recherche', [
    ['insee.fr', 'Insee'],
    ['academie-sciences.fr', 'Académie des sciences'],
    ['academie-francaise.fr', 'Académie française'],
  ]),
  // Tout site « .gouv.fr » (ministères, préfectures, Légifrance…) ; les adresses connues sont nommées.
  ...sites('official', 'administration', [
    ['gouv.fr', 'Administration française'],
    ['legifrance.gouv.fr', 'Légifrance'],
    ['data.gouv.fr', 'data.gouv.fr'],
    ['culture.gouv.fr', 'Ministère de la Culture'],
  ]),
  ...sites('scientific', 'bibliotheque', [
    ['bnf.fr', 'BnF'],
    ['gallica.bnf.fr', 'Gallica (BnF)'],
    ['persee.fr', 'Persée'],
    ['openedition.org', 'OpenEdition'],
    ['theses.fr', 'theses.fr'],
    ['europepmc.org', 'Europe PMC'],
    ['doaj.org', 'DOAJ'],
    ['hal.science', 'HAL'],
    ['archives-ouvertes.fr', 'HAL'],
    ['openalex.org', 'OpenAlex'],
    ['crossref.org', 'Crossref'],
    ['doi.org', 'DOI'],
  ]),
  ...sites('official', 'administration', [['service-public.fr', 'Service-Public.fr']]),
];

/**
 * Rang de lecture d'un site : éducation, organisations internationales, recherche, le reste. « doi.org » passe après
 * tout : il ne fait que renvoyer vers l'éditeur de l'article.
 */
export function trustedPriority(site: TrustedSite): number {
  if (site.domain === 'doi.org') return 4;
  switch (site.category) {
    case 'education':
    case 'academie':
      return 0;
    case 'international':
      return 1;
    case 'recherche':
      return 2;
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

const GROUP_SIZE = 6;
const MAX_GROUPS = 6;

/**
 * Domaines des requêtes « site: », par lots de 5 à 6 (au plus 6 lots : 36 domaines), dans l'ordre éducation,
 * organisations internationales, recherche, le reste. Un sous-domaine déjà couvert par son parent n'est pas répété, et
 * les sites des académies (une trentaine) ne sont pas interrogés : reconnus seulement. Au-delà de 36 domaines, la fin du
 * catalogue n'est pas interrogée (elle reste reconnue).
 */
export function trustedSearchGroups(): string[][] {
  const ordered = [...TRUSTED_SITES].sort((a, b) => trustedPriority(a) - trustedPriority(b));
  const domains: string[] = [];
  for (const site of ordered) {
    if (site.category === 'academie') continue;
    if (domains.some(d => site.domain === d || site.domain.endsWith(`.${d}`))) continue;
    domains.push(site.domain);
  }
  const kept = domains.slice(0, GROUP_SIZE * MAX_GROUPS);
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

/** Racine d'un site, ou page de langue seule (« /fr ») : rien à citer. */
const HOME_PATH = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?)?\/?$/i;
/** Page de recherche ou de connexion : jamais une source. */
const TOOL_PATH = /(?:^|\/)(?:search|recherche|rechercher|login|logon|signin|sign-in|connexion|se-connecter|auth|sso|cas|account|compte)(?:[/.]|$)/i;
const SEARCH_PARAMS = ['q', 's', 'search', 'query', 'recherche', 'keywords'];

function isArticleUrl(url: URL): boolean {
  if (HOME_PATH.test(url.pathname) || TOOL_PATH.test(url.pathname)) return false;
  return !SEARCH_PARAMS.some(p => url.searchParams.has(p));
}

export interface TrustedLink {
  url: string;
  site: TrustedSite;
}

/**
 * Pages à citer parmi des liens (références d'un article) : sites vérifiés en https seulement, ni page d'accueil ni
 * page de recherche ou de connexion, classées éducation > organisations internationales > recherche > reste (à rang
 * égal, dans l'ordre des liens), une seule par hôte, `max` au plus.
 */
export function selectTrustedLinks(urls: readonly string[], max: number): TrustedLink[] {
  const found: { link: TrustedLink; host: string; rank: number; order: number }[] = [];
  urls.forEach((raw, order) => {
    const site = trustedSiteFor(raw);
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
