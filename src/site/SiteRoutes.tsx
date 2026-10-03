import { Route, Routes } from 'react-router-dom';
import ShowcaseLegalPage from '@/pages/legal/ShowcaseLegal';
import SiteLanding from './SiteLanding';
import SiteNotFound from './SiteNotFound';

export default function SiteRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SiteLanding />} />
      <Route path="/mentions-legales" element={<ShowcaseLegalPage page="mentions" />} />
      <Route path="/confidentialite" element={<ShowcaseLegalPage page="confidentialite" />} />
      <Route path="/cgu" element={<ShowcaseLegalPage page="cgu" />} />
      <Route path="*" element={<SiteNotFound />} />
    </Routes>
  );
}
