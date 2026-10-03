// Informations légales : hébergeur par défaut (nom ET adresse), adresse https de l'hébergeur extraite sans la
// ponctuation de la phrase, et conditions d'affichage de la phrase des éditeurs non professionnels (LCEN).
// Rendu des pages : tests/ui/legalDefaults.test.tsx et tests/site/legalShowcase.test.tsx.

import { describe, expect, it } from 'vitest';
import { AUTHOR_NAME } from '@shared/author';
import { findHostUrl, LEGAL_DEFAULT_HOST, readLegalInfo, showsNonProfessionalNotice } from '@/lib/legal';

describe('Hébergeur par défaut', () => {
  it('Vercel Inc. avec son adresse postale (la LCEN exige le nom ET l’adresse de l’hébergeur), son pays et son site', () => {
    expect(LEGAL_DEFAULT_HOST).toBe('Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis (https://vercel.com)');
    expect(readLegalInfo({}).host).toBe(LEGAL_DEFAULT_HOST);
    // Une adresse postale (numéro, ville, code postal) figure bien dans la valeur par défaut.
    expect(LEGAL_DEFAULT_HOST).toMatch(/\d+ [^,]+, [^,]+, [A-Z]{2} \d{5}, États-Unis/);
  });

  it('VITE_LEGAL_HOST le remplace, une valeur vide ou blanche laisse le défaut', () => {
    expect(readLegalInfo({ VITE_LEGAL_HOST: 'OVH SAS, 2 rue Kellermann, 59100 Roubaix, France' }).host)
      .toBe('OVH SAS, 2 rue Kellermann, 59100 Roubaix, France');
    expect(readLegalInfo({ VITE_LEGAL_HOST: '' }).host).toBe(LEGAL_DEFAULT_HOST);
    expect(readLegalInfo({ VITE_LEGAL_HOST: '  ' }).host).toBe(LEGAL_DEFAULT_HOST);
  });
});

describe('findHostUrl : l’adresse https de l’hébergeur, sans la ponctuation de la phrase', () => {
  it('l’adresse par défaut, entre parenthèses', () => {
    const found = findHostUrl(LEGAL_DEFAULT_HOST)!;
    expect(found.url).toBe('https://vercel.com');
    expect(LEGAL_DEFAULT_HOST.slice(found.index)).toBe('https://vercel.com)');
  });

  it('virgule après l’adresse : exclue (« OVH SAS, https://www.ovhcloud.com, 2 rue… »)', () => {
    const host = 'OVH SAS, https://www.ovhcloud.com, 2 rue Kellermann, 59100 Roubaix, France';
    const found = findHostUrl(host)!;
    expect(found.url).toBe('https://www.ovhcloud.com');
    expect(host.slice(found.index + found.url.length)).toBe(', 2 rue Kellermann, 59100 Roubaix, France');
  });

  it.each([
    ['point', 'Hébergeur Exemple, https://hebergeur.exemple/accueil. France', 'https://hebergeur.exemple/accueil'],
    ['point final', 'Hébergeur Exemple, voir https://hebergeur.exemple.', 'https://hebergeur.exemple'],
    ['point-virgule', 'Hébergeur Exemple https://hebergeur.exemple; France', 'https://hebergeur.exemple'],
    ['deux-points', 'Hébergeur Exemple https://hebergeur.exemple: France', 'https://hebergeur.exemple'],
    ['point d’exclamation', 'Hébergeur Exemple https://hebergeur.exemple!', 'https://hebergeur.exemple'],
    ['point d’interrogation', 'Hébergeur Exemple https://hebergeur.exemple?', 'https://hebergeur.exemple'],
    ['parenthèse fermante', 'Hébergeur Exemple (https://hebergeur.exemple), France', 'https://hebergeur.exemple'],
    ['plusieurs signes', 'Hébergeur Exemple (https://hebergeur.exemple/aide.),', 'https://hebergeur.exemple/aide'],
  ])('%s après l’adresse : exclu du lien', (_name, host, url) => {
    expect(findHostUrl(host)?.url).toBe(url);
  });

  it('un point DANS l’adresse (domaine, chemin, paramètre) reste dans le lien', () => {
    expect(findHostUrl('Exemple, https://www.hebergeur.exemple/a.b/c?x=1&y=2, France')?.url).toBe('https://www.hebergeur.exemple/a.b/c?x=1&y=2');
  });

  it('aucune adresse https : null (http, javascript: et texte seul ne sont jamais repérés)', () => {
    expect(findHostUrl('Hébergeur Exemple, 2 avenue du Cloud')).toBeNull();
    expect(findHostUrl('Hébergeur Exemple, http://pas-https.exemple')).toBeNull();
    expect(findHostUrl('Hébergeur Exemple, javascript:alert(1)')).toBeNull();
  });
});

describe('showsNonProfessionalNotice : la phrase LCEN suit l’éditeur et le directeur, pas seulement l’adresse', () => {
  const base = { publisher: AUTHOR_NAME, director: AUTHOR_NAME };

  it('éditeur et directeur par défaut, sans adresse : la phrase', () => {
    expect(showsNonProfessionalNotice(readLegalInfo({}))).toBe(true);
    // Variables présentes mais vides ou blanches : les défauts.
    expect(showsNonProfessionalNotice(readLegalInfo({ VITE_LEGAL_PUBLISHER: '', VITE_LEGAL_DIRECTOR: ' ' }))).toBe(true);
    // Surchargés avec la valeur par défaut : c'est le même éditeur, la même personne physique.
    expect(showsNonProfessionalNotice(readLegalInfo({ VITE_LEGAL_PUBLISHER: AUTHOR_NAME, VITE_LEGAL_DIRECTOR: AUTHOR_NAME }))).toBe(true);
  });

  it('adresse définie : pas de phrase', () => {
    expect(showsNonProfessionalNotice(readLegalInfo({ VITE_LEGAL_ADDRESS: '1 rue de la Paix, 33000 Bordeaux' }))).toBe(false);
    expect(showsNonProfessionalNotice({ ...base, address: '1 rue de la Paix' })).toBe(false);
  });

  it('éditeur surchargé, sans adresse : pas de phrase (une structure n’est pas une personne physique non professionnelle)', () => {
    expect(showsNonProfessionalNotice(readLegalInfo({ VITE_LEGAL_PUBLISHER: 'Association Exemple' }))).toBe(false);
    expect(showsNonProfessionalNotice({ ...base, publisher: 'Association Exemple' })).toBe(false);
  });

  it('directeur surchargé, sans adresse : pas de phrase non plus', () => {
    expect(showsNonProfessionalNotice(readLegalInfo({ VITE_LEGAL_DIRECTOR: 'Mme Dupont' }))).toBe(false);
  });

  it('éditeur et directeur surchargés, sans adresse : pas de phrase', () => {
    expect(showsNonProfessionalNotice(readLegalInfo({ VITE_LEGAL_PUBLISHER: 'Association Exemple', VITE_LEGAL_DIRECTOR: 'Mme Dupont' }))).toBe(false);
  });
});
