import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { siteUrl } from '@shared/site';
import { SITE_ROBOTS, SITE_SEO, siteStructuredDataJson } from '@shared/siteSeo';

/** Maintient les métadonnées identiques au HTML pré-rendu lors d’une navigation interne. */
export default function SiteMetadata() {
  const { pathname } = useLocation();
  useEffect(() => {
    const path = pathname.replace(/\/+$/, '') || '/';
    const canonicalPath = Object.hasOwn(SITE_SEO, path) ? path : '/404';
    const page = SITE_SEO[canonicalPath];
    document.title = page.title;
    const set = (selector: string, value: string) => document.querySelector(selector)?.setAttribute('content', value);
    set('meta[name="description"]', page.description);
    set('meta[name="robots"]', page.index ? SITE_ROBOTS : 'noindex, follow');
    set('meta[property="og:title"]', page.title);
    set('meta[property="og:description"]', page.description);
    set('meta[property="og:type"]', page.type);
    set('meta[property="og:url"]', siteUrl(canonicalPath));
    set('meta[name="twitter:title"]', page.title);
    set('meta[name="twitter:description"]', page.description);
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', siteUrl(canonicalPath));
    const json = siteStructuredDataJson(canonicalPath);
    const previous = document.querySelector('script[type="application/ld+json"]');
    if (json) {
      const script = previous ?? document.createElement('script');
      script.setAttribute('type', 'application/ld+json');
      script.textContent = json;
      if (!previous) document.head.appendChild(script);
    } else previous?.remove();
  }, [pathname]);
  return null;
}
