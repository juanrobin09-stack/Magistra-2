import { describe, expect, it } from 'vitest';
import {
  fetchableSiteFor, isCitablePage, isFetchableHttpsUrl, isTrustedHttpsUrl, isTrustedUrl, NOT_SEARCHED_SITES, SEARCH_SCOPE_TEXT,
  SEARCHED_DOMAIN_COUNT, selectTrustedLinks, TRUSTED_SITES, trustedSearchGroups, trustedSiteFor,
} from '../../shared/research/trusted';
import { INSTITUTIONAL_SITES, isInstitutionalUrl } from '../../shared/research/providers';

/** Domaines que le catalogue doit contenir (institutions publiques, organisations intergouvernementales, recherche). */
const REQUIRED_DOMAINS = [
  'unesco.org', 'unesdoc.unesco.org', 'whc.unesco.org', 'uis.unesco.org',
  'un.org', 'who.int', 'unicef.org', 'fao.org', 'ilo.org', 'ipcc.ch', 'oecd.org', 'worldbank.org',
  'europa.eu', 'ec.europa.eu', 'eur-lex.europa.eu', 'coe.int',
  'education.gouv.fr', 'eduscol.education.fr', 'enseignementsup-recherche.gouv.fr', 'onisep.fr', 'reseau-canope.fr', 'lumni.fr', 'canal-u.tv',
  'gouv.fr', 'legifrance.gouv.fr', 'service-public.fr', 'data.gouv.fr', 'culture.gouv.fr',
  'cnrs.fr', 'inserm.fr', 'inria.fr', 'cea.fr', 'ird.fr', 'ifremer.fr', 'insee.fr', 'academie-sciences.fr', 'academie-francaise.fr', 'cnrtl.fr',
  'nasa.gov', 'esa.int', 'cern.ch', 'noaa.gov', 'nih.gov',
  'bnf.fr', 'gallica.bnf.fr', 'hal.science', 'archives-ouvertes.fr', 'theses.fr', 'persee.fr', 'openedition.org', 'doi.org', 'openalex.org',
  'crossref.org', 'doaj.org', 'europepmc.org',
  'ac-lyon.fr', 'ac-versailles.fr', 'ac-aix-marseille.fr',
];

describe('catalogue des sites vérifiés', () => {
  it('chaque entrée : domaine en minuscules sans schéma ni chemin, nom, niveau et catégorie connus ; aucun doublon', () => {
    const seen = new Set<string>();
    for (const site of TRUSTED_SITES) {
      expect(site.domain, site.domain).toMatch(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/);
      expect(site.label.trim(), site.domain).not.toBe('');
      expect(['official', 'scientific', 'open']).toContain(site.tier);
      expect(['education', 'academie', 'international', 'administration', 'recherche', 'bibliotheque']).toContain(site.category);
      expect(seen.has(site.domain), `doublon ${site.domain}`).toBe(false);
      seen.add(site.domain);
    }
  });

  it('contient les institutions demandées, dont l’UNESCO, et rien d’autre que des sites publics ou de la recherche', () => {
    const domains = TRUSTED_SITES.map(s => s.domain);
    for (const domain of REQUIRED_DOMAINS) expect(domains, domain).toContain(domain);
    expect(trustedSiteFor('https://www.unesco.org/fr/education')).toMatchObject({ domain: 'unesco.org', label: 'UNESCO', tier: 'official', category: 'international' });
    // Aucun site commercial, média ou réseau social.
    for (const domain of domains) expect(domain, domain).not.toMatch(/(^|\.)(wikipedia|facebook|twitter|youtube|google|amazon|medium|blogspot|wordpress)\./);
  });

  it('exports de providers.ts : INSTITUTIONAL_SITES et isInstitutionalUrl reposent sur le catalogue', () => {
    expect(INSTITUTIONAL_SITES).toEqual(TRUSTED_SITES.map(s => s.domain));
    expect(INSTITUTIONAL_SITES).toContain('eduscol.education.fr');
    expect(isInstitutionalUrl('https://www.unesco.org/fr')).toBe(true);
    expect(isInstitutionalUrl('https://blog.example.org/')).toBe(false);
  });
});

describe('trustedSiteFor — correspondance stricte du nom d’hôte', () => {
  it.each([
    ['https://unesco.org', 'unesco.org'],
    ['https://www.unesco.org/fr/articles/x?y=1#z', 'unesco.org'],
    ['https://en.unesco.org/', 'unesco.org'],
    ['http://unesco.org/', 'unesco.org'],
    ['HTTPS://UNESCO.ORG/FR', 'unesco.org'],
    ['https://Www.UNESCO.org./fr', 'unesco.org'],
    ['https://unesco.org:443/fr', 'unesco.org'],
    ['  https://unesco.org/fr  ', 'unesco.org'],
    ['https://whc.unesco.org/fr/list/', 'whc.unesco.org'],
    ['https://unesdoc.unesco.org/ark:/48223/pf0000375452', 'unesdoc.unesco.org'],
    ['https://eduscol.education.fr/1234/programmes', 'eduscol.education.fr'],
    ['https://cache.eduscol.education.fr/x', 'eduscol.education.fr'],
    ['https://www.education.gouv.fr/bo/2024', 'education.gouv.fr'],
    ['https://www.legifrance.gouv.fr/codes', 'legifrance.gouv.fr'],
    ['https://www.ecologie.gouv.fr/x', 'gouv.fr'],
    ['https://prefecture.region.gouv.fr/', 'gouv.fr'],
    ['https://ec.europa.eu/eurostat', 'ec.europa.eu'],
    ['https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679', 'eur-lex.europa.eu'],
    ['https://op.europa.eu/fr/publication-detail/-/publication/x', 'europa.eu'],
    ['https://www.ac-lyon.fr/mathematiques', 'ac-lyon.fr'],
    ['https://hal.science/hal-01234567', 'hal.science'],
    ['https://cel.hal.science/cel-00000000', 'hal.science'],
    ['https://hal.archives-ouvertes.fr/hal-00000000', 'archives-ouvertes.fr'],
    ['https://gallica.bnf.fr/ark:/12148/x', 'gallica.bnf.fr'],
    ['https://www.bnf.fr/fr', 'bnf.fr'],
  ])('%s → %s', (url, domain) => {
    expect(trustedSiteFor(url)?.domain).toBe(domain);
    expect(isTrustedUrl(url)).toBe(true);
  });

  it('le site le plus précis l’emporte (« whc.unesco.org » avant « unesco.org », « legifrance.gouv.fr » avant « gouv.fr »)', () => {
    expect(trustedSiteFor('https://whc.unesco.org/')?.label).toBe('Patrimoine mondial (UNESCO)');
    expect(trustedSiteFor('https://www.legifrance.gouv.fr/')?.label).toBe('Légifrance');
    expect(trustedSiteFor('https://www.sante.gouv.fr/')?.label).toBe('Administration française');
  });

  it.each([
    // Sous-chaîne ou suffixe collé.
    'https://evilunesco.org/',
    'https://unesco.org.evil.com/',
    'https://unesco.org-evil.com/',
    'https://www.unesco.org.evil.com/fr',
    'https://notun.org/',
    'https://un.org.cn/',
    'https://fakegouv.fr/',
    'https://gouv.fr.evil.com/',
    'https://xgouv.fr/',
    'https://eduscol.education.fr.pirate.com/x',
    'https://education.fr/',
    'https://ac-evil.fr/',
    'https://ac-lyon.fr.evil.com/',
    'https://who.int.evil.com/',
    'https://awho.int/',
    // Identifiants dans l'adresse : l'hôte réel n'est pas celui qu'on lit.
    'https://unesco.org@evil.com/',
    'https://unesco.org:pass@evil.com/',
    'https://evil.com@unesco.org/',
    'https://evil.com\\@unesco.org/',
    'https://evil.com/?https://unesco.org',
    'https://evil.com/#@unesco.org',
    'https://evil.com/unesco.org',
    // Port particulier.
    'https://unesco.org:8443/',
    'https://unesco.org:80/x',
    'https://unesco.org:evil/',
    // Noms internationaux : un homographe n'est pas le domaine.
    'https://unesсo.org/',
    'https://xn--unesco-9d.org/',
    'https://xn--nesco-5fe.org/',
    // Étiquettes vides, adresses IP, hôtes sans point.
    'https://.unesco.org/',
    'https://unesco..org/',
    'https://unesco.org../',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://unesco/',
    // Schémas qui ne sont pas http(s).
    'ftp://unesco.org/',
    'javascript:alert(1)//unesco.org',
    'data:text/html,https://unesco.org',
    'file:///etc/passwd',
    'mailto:contact@unesco.org',
    'ws://unesco.org/',
    // Pas une adresse.
    'unesco.org',
    '//unesco.org/',
    'https://',
    '',
    '   ',
  ])('refusée : %j', url => {
    expect(trustedSiteFor(url)).toBeNull();
    expect(isTrustedUrl(url)).toBe(false);
  });

  it('valeur qui n’est pas une chaîne : refusée sans exception', () => {
    for (const value of [undefined, null, 42, {}, [], ['https://unesco.org']]) {
      expect(trustedSiteFor(value as unknown as string)).toBeNull();
    }
  });

  it('isTrustedHttpsUrl : https seulement', () => {
    expect(isTrustedHttpsUrl('https://www.unesco.org/fr')).toBe(true);
    expect(isTrustedHttpsUrl('http://www.unesco.org/fr')).toBe(false);
    expect(isTrustedHttpsUrl('https://evilunesco.org/')).toBe(false);
  });
});

describe('trustedSearchGroups — lots pour les requêtes « site: »', () => {
  const groups = trustedSearchGroups();
  const all = groups.flat();

  it('6 lots au plus, de 5 à 6 domaines, sans doublon, tous dans le catalogue', () => {
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.length).toBeLessThanOrEqual(6);
    for (const group of groups) {
      expect(group.length).toBeGreaterThanOrEqual(5);
      expect(group.length).toBeLessThanOrEqual(6);
    }
    expect(new Set(all).size).toBe(all.length);
    for (const domain of all) expect(trustedSiteFor(`https://${domain}/`)?.domain, domain).toBeTruthy();
  });

  it('ordre : éducation, puis organisations internationales, recherche publique, Service-Public.fr et portails de publications', () => {
    expect(groups[0].slice(0, 3)).toEqual(['education.gouv.fr', 'eduscol.education.fr', 'enseignementsup-recherche.gouv.fr']);
    const at = (domain: string) => all.indexOf(domain);
    // Éducation avant UNESCO et agences de l'ONU, avant OCDE, Banque mondiale, UE, Conseil de l'Europe, avant la recherche publique.
    const order = ['education.gouv.fr', 'lumni.fr', 'unesco.org', 'un.org', 'who.int', 'oecd.org', 'worldbank.org', 'europa.eu', 'coe.int', 'cnrs.fr', 'academie-francaise.fr'];
    for (const domain of order) expect(at(domain), domain).toBeGreaterThanOrEqual(0);
    expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
    // Puis Service-Public.fr et les portails de publications.
    for (const domain of ['service-public.fr', 'gouv.fr', 'openedition.org', 'theses.fr', 'europepmc.org', 'doaj.org']) {
      expect(at(domain), domain).toBeGreaterThan(at('academie-francaise.fr'));
    }
    expect(at('service-public.fr')).toBeLessThan(at('openedition.org'));
    // Dernier lot : le dernier portail de publications, puis la seule agence étrangère qui tient dans le plafond.
    expect(at('doaj.org')).toBe(all.length - 2);
    expect(at('nasa.gov')).toBe(all.length - 1);
  });

  it('les sites les plus utiles à un enseignant sont interrogés avant les moins utiles ; les autres sont reconnus mais non interrogés', () => {
    for (const domain of ['service-public.fr', 'openedition.org', 'theses.fr', 'europepmc.org', 'doaj.org', 'bnf.fr', 'persee.fr']) {
      expect(all, domain).toContain(domain);
    }
    // Reconnus mais non interrogés directement : plateformes ouvertes, infrastructures, agences étrangères, académies.
    for (const domain of ['hal.science', 'archives-ouvertes.fr', 'openalex.org', 'crossref.org', 'doi.org', 'canal-u.tv', 'esa.int', 'cern.ch', 'noaa.gov', 'nih.gov']) {
      expect(all, domain).not.toContain(domain);
      expect(trustedSiteFor(`https://${domain}/`), domain).not.toBeNull();
    }
    // Le plafond de 6 requêtes est conservé.
    expect(groups).toHaveLength(6);
  });

  it('le nombre de domaines interrogés est exactement celui que les réglages annoncent (SEARCHED_DOMAIN_COUNT)', () => {
    expect(all).toHaveLength(SEARCHED_DOMAIN_COUNT);
    expect(SEARCH_SCOPE_TEXT).toContain(`${SEARCHED_DOMAIN_COUNT} domaines`);
    expect(SEARCH_SCOPE_TEXT).toContain(NOT_SEARCHED_SITES);
    expect(SEARCH_SCOPE_TEXT).not.toMatch(/\btous\b|tout le catalogue/i);
  });

  it('ce qui n’est pas interrogé directement est dit exactement : tout site non couvert est nommé, aucun site couvert ne l’est', () => {
    const covered = (domain: string) => all.some(d => domain === d || domain.endsWith(`.${d}`));
    const escape = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const named = (label: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escape(label)}(?![\\p{L}\\p{N}])`, 'u').test(NOT_SEARCHED_SITES);
    for (const site of TRUSTED_SITES) {
      if (site.category === 'academie') expect(NOT_SEARCHED_SITES, site.domain).toContain('académies scolaires');
      else if (site.redirectOnly) continue;
      else if (covered(site.domain)) expect(named(site.label), `${site.label} est interrogé`).toBe(false);
      else expect(named(site.label), `${site.label} n’est pas interrogé`).toBe(true);
    }
  });

  it('tout le catalogue d’éducation, des organisations internationales et de la recherche française est interrogé (un parent couvre ses sous-domaines)', () => {
    const covered = (domain: string) => all.some(d => domain === d || domain.endsWith(`.${d}`));
    const foreignAgencies = ['nasa.gov', 'esa.int', 'cern.ch', 'noaa.gov', 'nih.gov'];
    const wanted = TRUSTED_SITES.filter(s => ['education', 'international', 'recherche'].includes(s.category) && s.tier !== 'open' && !foreignAgencies.slice(1).includes(s.domain));
    for (const site of wanted) expect(covered(site.domain), site.domain).toBe(true);
    // Les sous-domaines déjà couverts ne sont pas répétés.
    for (const domain of ['unesdoc.unesco.org', 'whc.unesco.org', 'ec.europa.eu', 'eur-lex.europa.eu', 'legifrance.gouv.fr', 'data.gouv.fr', 'culture.gouv.fr', 'gallica.bnf.fr']) {
      expect(all, domain).not.toContain(domain);
    }
    expect(all).toContain('unesco.org');
    expect(all).toContain('europa.eu');
    expect(all).toContain('gouv.fr');
  });

  it('les sites des académies (une trentaine) sont reconnus mais ne sont pas interrogés par « site: »', () => {
    expect(TRUSTED_SITES.filter(s => s.category === 'academie').length).toBeGreaterThanOrEqual(25);
    expect(all.some(d => d.startsWith('ac-'))).toBe(false);
  });

  it('résultat stable d’un appel à l’autre', () => {
    expect(trustedSearchGroups()).toEqual(groups);
  });
});

describe('selectTrustedLinks — pages à citer parmi les références d’un article', () => {
  it('écarte les hôtes hors catalogue, les pages d’accueil, de recherche et de connexion, et le http', () => {
    const links = [
      'https://example.org/article',
      'https://www.unesco.org/',
      'https://www.unesco.org',
      'https://www.unesco.org/fr',
      'https://www.unesco.org/fr/',
      'https://www.unesco.org/fr/search?q=eau',
      'https://www.unesco.org/fr/articles?s=eau',
      'https://www.unesco.org/fr/login',
      'https://www.unesco.org/fr/connexion',
      'http://www.unesco.org/fr/articles/eau',
      'https://evilunesco.org/fr/articles/eau',
      'https://www.unesco.org/fr/articles/eau-et-assainissement',
    ];
    expect(selectTrustedLinks(links, 3).map(l => l.url)).toEqual(['https://www.unesco.org/fr/articles/eau-et-assainissement']);
  });

  it('classe éducation > organisations internationales > recherche > reste, à rang égal dans l’ordre des liens', () => {
    const links = [
      'https://theses.fr/2019SACLS001',
      'https://www.cnrs.fr/fr/photosynthese',
      'https://www.unesco.org/fr/articles/eau',
      'https://www.who.int/fr/news/item/x',
      'https://eduscol.education.fr/sciences/photosynthese',
      'https://www.ac-lyon.fr/ressources/x',
    ];
    const picked = selectTrustedLinks(links, 10);
    expect(picked.map(l => l.site.domain)).toEqual(['eduscol.education.fr', 'ac-lyon.fr', 'unesco.org', 'who.int', 'cnrs.fr', 'theses.fr']);
  });

  it('une seule page par hôte (« www. » compris), au plus `max` pages', () => {
    const links = [
      'https://www.unesco.org/fr/articles/a',
      'https://unesco.org/fr/articles/b',
      'https://www.unesco.org/fr/articles/c',
      'https://en.unesco.org/articles/d',
      'https://www.who.int/fr/a',
      'https://www.fao.org/fr/a',
      'https://www.ilo.org/fr/a',
    ];
    const picked = selectTrustedLinks(links, 3);
    expect(picked.map(l => l.url)).toEqual(['https://www.unesco.org/fr/articles/a', 'https://en.unesco.org/articles/d', 'https://www.who.int/fr/a']);
    expect(selectTrustedLinks(links, 0)).toEqual([]);
  });

  it('adresse normalisée sans fragment, avec le site du catalogue', () => {
    const picked = selectTrustedLinks(['https://www.persee.fr/doc/x#page_1'], 3);
    expect(picked.map(l => l.url)).toEqual(['https://www.persee.fr/doc/x']);
    expect(picked[0].site.label).toBe('Persée');
  });

  it('« doi.org » n’est jamais sélectionné : il ne fait que renvoyer vers un éditeur quelconque (reconnu, mais ni récupéré ni compté parmi les 3 pages)', () => {
    const links = ['https://doi.org/10.5555/attacker', 'https://dx.doi.org/10.1000/xyz123', 'https://www.persee.fr/doc/x'];
    expect(selectTrustedLinks(links, 3).map(l => l.url)).toEqual(['https://www.persee.fr/doc/x']);
    expect(selectTrustedLinks(links.slice(0, 2), 3)).toEqual([]);
    // Toujours reconnu pour étiqueter un DOI.
    expect(trustedSiteFor('https://doi.org/10.1000/xyz123')).toMatchObject({ domain: 'doi.org', redirectOnly: true });
    expect(fetchableSiteFor('https://doi.org/10.1000/xyz123')).toBeNull();
    expect(isFetchableHttpsUrl('https://doi.org/10.1000/xyz123')).toBe(false);
    expect(isCitablePage('https://doi.org/10.1000/xyz123')).toBe(false);
    expect(fetchableSiteFor('https://www.persee.fr/doc/x')?.domain).toBe('persee.fr');
    expect(isFetchableHttpsUrl('https://www.persee.fr/doc/x')).toBe(true);
    expect(isFetchableHttpsUrl('http://www.persee.fr/doc/x')).toBe(false);
    expect(isFetchableHttpsUrl('https://persee.fr.pirate.example/x')).toBe(false);
  });

  it('une plateforme ouverte (HAL, data.gouv.fr, Canal-U) passe après tout le reste, jamais « officielle »', () => {
    const links = ['https://hal.science/hal-01234567', 'https://data.gouv.fr/fr/datasets/x', 'https://www.canal-u.tv/video/x', 'https://theses.fr/2019SACLS001'];
    const picked = selectTrustedLinks(links, 4);
    expect(picked.map(l => l.site.domain)).toEqual(['theses.fr', 'hal.science', 'data.gouv.fr', 'canal-u.tv']);
    expect(picked.slice(1).map(l => l.site.tier)).toEqual(['open', 'open', 'open']);
  });

  it('tiers : « officiel » réservé aux administrations, organisations intergouvernementales et agences publiques', () => {
    for (const domain of ['data.gouv.fr', 'hal.science', 'archives-ouvertes.fr', 'canal-u.tv']) {
      expect(trustedSiteFor(`https://www.${domain}/x`)?.tier, domain).toBe('open');
    }
    // data.gouv.fr est aussi couvert par « gouv.fr » (administration, officielle) : l'entrée la plus précise l'emporte.
    expect(trustedSiteFor('https://www.sante.gouv.fr/')?.tier).toBe('official');
    expect(trustedSiteFor('https://static.data.gouv.fr/resources/x.csv')?.tier).toBe('open');
    for (const site of TRUSTED_SITES.filter(s => s.tier === 'official')) {
      expect(['education', 'academie', 'international', 'administration', 'recherche'], site.domain).toContain(site.category);
      expect(['data.gouv.fr', 'hal.science', 'archives-ouvertes.fr', 'canal-u.tv']).not.toContain(site.domain);
    }
  });

  it('entrées inattendues ignorées sans exception', () => {
    expect(selectTrustedLinks(['', 'pas une adresse', 'javascript:alert(1)', 'https://unesco.org@evil.com/x'], 3)).toEqual([]);
  });
});

describe('isCitablePage — page qu’une source peut citer (adresse FINALE d’une page récupérée)', () => {
  it.each([
    'https://www.education.gouv.fr/bo/2024/Hebdo1',
    'https://eduscol.education.fr/1234/programme-cycle-3',
    'https://www.unesco.org/fr/articles/eau',
    // « recherche » est une rubrique avant d'être une page de recherche (P3).
    'https://www.cnrs.fr/fr/recherche/biologie',
    'https://www.cnrs.fr/recherche/biologie/genomique',
    'https://www.education.gouv.fr/accueil-des-eleves-allophones',
    'https://www.education.gouv.fr/home-economics',
    'https://www.unesco.org/fr/index-des-themes',
  ])('citable : %s', url => {
    expect(isCitablePage(url)).toBe(true);
    expect(isCitablePage(new URL(url))).toBe(true);
  });

  it.each([
    // Accueil (S2) et variantes d'accueil nommées (P3).
    'https://www.education.gouv.fr/',
    'https://www.education.gouv.fr',
    'https://www.education.gouv.fr/fr',
    'https://www.education.gouv.fr/fr/',
    'https://www.education.gouv.fr/index.html',
    'https://www.education.gouv.fr/index.php',
    'https://www.education.gouv.fr/index.htm',
    'https://www.education.gouv.fr/index',
    'https://www.education.gouv.fr/fr/index.html',
    'https://www.education.gouv.fr/home',
    'https://www.education.gouv.fr/accueil',
    'https://www.education.gouv.fr/accueil/',
    'https://www.unesco.org/en/home',
    'https://www.unesco.org/fr-ca/accueil',
    // Connexion et authentification (S2).
    'https://cas.education.gouv.fr/login?service=x',
    'https://www.education.gouv.fr/login',
    'https://www.education.gouv.fr/cas/',
    'https://www.education.gouv.fr/cas/login',
    'https://www.ac-lyon.fr/connexion',
    'https://www.ac-lyon.fr/compte/mes-informations',
    'https://www.unesco.org/account/profile',
    'https://www.unesco.org/sso/start',
    // Recherche (en dernier segment, sans suite, ou avec un paramètre de requête).
    'https://www.unesco.org/fr/search?q=eau',
    'https://www.unesco.org/search/all',
    'https://www.cnrs.fr/fr/recherche',
    'https://www.cnrs.fr/fr/recherche/',
    'https://www.cnrs.fr/recherche.php',
    'https://www.cnrs.fr/fr/recherche?q=biologie',
    'https://www.cnrs.fr/fr/recherche/biologie?s=eau',
    // Hors catalogue, http, redirection seule.
    'https://example.org/article',
    'http://www.unesco.org/fr/articles/eau',
    'https://unesco.org.pirate.example/fr/articles/eau',
    'https://doi.org/10.1000/xyz123',
    // Pas une adresse.
    'unesco.org',
    '',
  ])('non citable : %j', url => {
    expect(isCitablePage(url)).toBe(false);
  });

  it('même contrôle que la sélection des liens (références de Wikipédia)', () => {
    const links = ['https://www.cnrs.fr/fr/recherche/biologie', 'https://www.education.gouv.fr/index.html', 'https://www.unesco.org/fr/home'];
    expect(selectTrustedLinks(links, 3).map(l => l.url)).toEqual(['https://www.cnrs.fr/fr/recherche/biologie']);
  });
});
