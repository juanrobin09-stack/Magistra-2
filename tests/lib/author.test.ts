// Attribution de l'auteur : le nom et la phrase sont fixes ; le lien de profil (VITE_AUTHOR_PROFILE_URL) n'est retenu
// qu'en https, sans identifiants, sans caractère de contrôle, 300 caractères au plus ; sinon le profil par défaut.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUTHOR_CREDIT, AUTHOR_DEFAULT_PROFILE_URL, AUTHOR_NAME, authorProfile } from '@shared/author';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const env = (VITE_AUTHOR_PROFILE_URL: unknown) => ({ VITE_AUTHOR_PROFILE_URL });

describe('Attribution : texte fixe', () => {
  it('nom et phrase d’attribution', () => {
    expect(AUTHOR_NAME).toBe('Juan Robin');
    expect(AUTHOR_CREDIT).toBe('Magistra, créé par Juan Robin');
  });

  it('package.json : auteur Juan Robin, avec le profil par défaut', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { author: { name: string; url: string } };
    expect(pkg.author).toEqual({ name: AUTHOR_NAME, url: AUTHOR_DEFAULT_PROFILE_URL });
  });

  it('les pages d’entrée déclarent l’auteur (meta author)', () => {
    for (const file of ['index.html', 'site/index.html']) {
      expect(readFileSync(path.join(root, file), 'utf8'), file).toContain('<meta name="author" content="Juan Robin" />');
    }
  });
});

describe('authorProfile : profil par défaut', () => {
  it.each([
    ['sans environnement', undefined],
    ['variable absente', {}],
    ['variable vide', env('')],
    ['espaces seuls', env('   ')],
    ['valeur qui n’est pas du texte', env(42)],
    ['null', env(null)],
  ])('%s : profil GitHub par défaut', (_name, value) => {
    expect(authorProfile(value as Record<string, unknown> | undefined)).toEqual({
      url: 'https://github.com/juanrobin09-stack',
      label: 'Profil GitHub',
    });
  });
});

describe('authorProfile : adresses valides et étiquettes', () => {
  it('LinkedIn (y compris sous-domaine) : « Profil LinkedIn »', () => {
    expect(authorProfile(env('https://www.linkedin.com/in/juan-robin/'))).toEqual({ url: 'https://www.linkedin.com/in/juan-robin/', label: 'Profil LinkedIn' });
    expect(authorProfile(env('https://fr.linkedin.com/in/juan-robin')).label).toBe('Profil LinkedIn');
    expect(authorProfile(env('https://linkedin.com/in/juan-robin')).label).toBe('Profil LinkedIn');
  });

  it('GitHub : « Profil GitHub »', () => {
    expect(authorProfile(env('https://github.com/un-autre-profil'))).toEqual({ url: 'https://github.com/un-autre-profil', label: 'Profil GitHub' });
  });

  it('autre site : « Profil professionnel »', () => {
    expect(authorProfile(env('https://exemple.fr/juan-robin'))).toEqual({ url: 'https://exemple.fr/juan-robin', label: 'Profil professionnel' });
  });

  it('un nom de domaine qui ressemble à LinkedIn ou GitHub n’en reçoit pas l’étiquette', () => {
    for (const url of ['https://evil-linkedin.com/in/x', 'https://linkedin.com.evil.example/in/x', 'https://notgithub.com/x', 'https://github.com.evil.example/x']) {
      expect(authorProfile(env(url)).label, url).toBe('Profil professionnel');
    }
  });

  it('adresse nettoyée : espaces de bord retirés, schéma et domaine en minuscules', () => {
    expect(authorProfile(env('  HTTPS://GitHub.com/Juan  \n'))).toEqual({ url: 'https://github.com/Juan', label: 'Profil GitHub' });
  });
});

describe('authorProfile : adresses refusées (retour au profil par défaut)', () => {
  const REFUSED = [
    ['javascript:', 'javascript:alert(1)'],
    ['javascript: majuscules', 'JavaScript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['http: (non chiffré)', 'http://www.linkedin.com/in/juan-robin'],
    ['ftp:', 'ftp://exemple.fr/juan'],
    ['sans schéma', 'www.linkedin.com/in/juan-robin'],
    ['schéma relatif', '//evil.example/x'],
    ['identifiant', 'https://juan@exemple.fr/profil'],
    ['identifiant et mot de passe', 'https://juan:secret@exemple.fr/profil'],
    ['espace dans l’adresse', 'https://exemple.fr/mon profil'],
    ['retour à la ligne dans l’adresse', 'https://exemple.fr/a\nb'],
    ['caractère de contrôle', 'https://exemple.fr/a\u0007b'],
    ['adresse illisible', 'https://'],
  ] as const;

  it.each(REFUSED)('%s', (_name, value) => {
    expect(authorProfile(env(value))).toEqual({ url: AUTHOR_DEFAULT_PROFILE_URL, label: 'Profil GitHub' });
  });

  it('300 caractères au plus : 300 acceptés, 301 refusés', () => {
    const base = 'https://exemple.fr/';
    const ok = base + 'a'.repeat(300 - base.length);
    expect(ok).toHaveLength(300);
    expect(authorProfile(env(ok)).url).toBe(ok);
    expect(authorProfile(env(`${ok}a`)).url).toBe(AUTHOR_DEFAULT_PROFILE_URL);
  });

  it('une adresse qui s’allonge une fois normalisée (caractères encodés) dépasse la limite : refusée', () => {
    const base = 'https://exemple.fr/';
    const raw = base + 'é'.repeat(100);
    expect(raw.length).toBeLessThan(300);
    expect(new URL(raw).href.length).toBeGreaterThan(300);
    expect(authorProfile(env(raw)).url).toBe(AUTHOR_DEFAULT_PROFILE_URL);
  });
});
