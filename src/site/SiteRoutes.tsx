import { Route, Routes } from 'react-router-dom';
import ShowcaseLegalPage from '@/pages/legal/ShowcaseLegal';
import SiteLanding from './SiteLanding';
import SiteNotFound from './SiteNotFound';
import SiteGuide from './SiteGuide';
import SiteResources from './SiteResources';
import { SITE_GUIDES } from '@shared/siteGuides';

export default function SiteRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SiteLanding />} />
      <Route path="/guides" element={<SiteResources />} />
      {SITE_GUIDES.map(guide => <Route key={guide.path} path={guide.path} element={<SiteGuide guide={guide} />} />)}
      <Route path="/mentions-legales" element={<ShowcaseLegalPage page="mentions" />} />
      <Route path="/confidentialite" element={<ShowcaseLegalPage page="confidentialite" />} />
      <Route path="/cgu" element={<ShowcaseLegalPage page="cgu" />} />
      <Route path="*" element={<SiteNotFound />} />
    </Routes>
  );
}
