/* eslint-disable react-refresh/only-export-components -- Point d’entrée réservé au pré-rendu, jamais chargé par le navigateur. */
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import SiteRoutes from './SiteRoutes';
export { SITE_SEO, SITE_STRUCTURED_DATA, SITE_IMAGE_PATH, SITE_ICON_PATH, SITE_IMAGE_ALT, SITE_ROBOTS, siteStructuredDataJson } from '../../shared/siteSeo';
export { SITE_ORIGIN } from '../../shared/site';

export function renderPage(path: string): string {
  return renderToString(<MemoryRouter initialEntries={[path]}><SiteRoutes /></MemoryRouter>);
}
