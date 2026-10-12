// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Link, MemoryRouter } from 'react-router-dom';
import SiteMetadata from '@/site/SiteMetadata';
import { SITE_GUIDES } from '@shared/siteGuides';
import { SITE_SEO, SITE_ROBOTS, siteStructuredDataJson } from '@shared/siteSeo';
import { siteUrl } from '@shared/site';
import { click, cleanup, render } from '../ui/helpers';

const guide = SITE_GUIDES[0];
const head = () => document.head.querySelector('script[type="application/ld+json"]');
const meta = (name: string) => document.head.querySelector(`meta[${name}]`)?.getAttribute('content');

beforeEach(() => {
  document.head.innerHTML = '<title>Magistra</title><link rel="canonical" href="/">'
    + ['description', 'robots', 'twitter:title', 'twitter:description'].map(name => `<meta name="${name}" content="">`).join('')
    + ['og:title', 'og:description', 'og:url', 'og:type'].map(name => `<meta property="${name}" content="">`).join('');
});
afterEach(() => { cleanup(); document.head.innerHTML = ''; });

async function mount(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><SiteMetadata />
    <Link to={guide.path}>Guide</Link><Link to="/confidentialite">Confidentialité</Link>
    <Link to="/page-inconnue">Inconnue</Link><Link to="/guides">Ressources</Link>
  </MemoryRouter>);
}

describe('métadonnées pendant la navigation interne', () => {
  it('remplace le schéma de l’accueil par celui du guide, puis supprime les données sur une page légale', async () => {
    const { container } = await mount();
    expect(head()?.textContent).toBe(siteStructuredDataJson('/'));
    await click(container.querySelector(`a[href="${guide.path}"]`));
    expect(document.title).toBe(guide.title);
    expect(meta('property="og:type"')).toBe('article');
    expect(meta('property="og:url"')).toBe(siteUrl(guide.path));
    expect(meta('name="description"')).toBe(guide.description);
    expect(meta('name="robots"')).toBe(SITE_ROBOTS);
    expect(head()?.textContent).toBe(siteStructuredDataJson(guide.path));
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
    await click(container.querySelector('a[href="/confidentialite"]'));
    expect(meta('name="robots"')).toBe('noindex, follow');
    expect(meta('property="og:type"')).toBe('website');
    expect(head()).toBeNull();
  });

  it('une route inconnue garde la 404 canonique et noindex, sans ancien article', async () => {
    const { container } = await mount(guide.path);
    await click(container.querySelector('a[href="/page-inconnue"]'));
    expect(document.title).toBe(SITE_SEO['/404'].title);
    expect(meta('name="robots"')).toBe('noindex, follow');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(siteUrl('/404'));
    expect(meta('property="og:url"')).toBe(siteUrl('/404'));
    expect(head()).toBeNull();
  });

  it('recrée un seul schéma depuis une page sans données et normalise la barre finale', async () => {
    const { container } = await mount('/guides/');
    expect(head()?.textContent).toBe(siteStructuredDataJson('/guides'));
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(siteUrl('/guides'));
    await click(container.querySelector('a[href="/confidentialite"]'));
    await click(container.querySelector(`a[href="${guide.path}"]`));
    expect(document.head.querySelectorAll('script[type="application/ld+json"]')).toHaveLength(1);
    expect(head()?.textContent).toBe(siteStructuredDataJson(guide.path));
  });

  it('les noms hérités d’Object sont traités comme des URL inconnues', async () => {
    await mount('/constructor');
    expect(document.title).toBe(SITE_SEO['/404'].title);
    expect(meta('name="robots"')).toBe('noindex, follow');
    expect(head()).toBeNull();
  });
});
