import { Link } from 'react-router-dom';

export default function SiteNotFound() {
  return (
    <main className="min-h-screen bg-mg-900 flex items-center justify-center px-6">
      <div className="max-w-xl text-center">
        <p className="text-accent mb-4">Magistra · 404</p>
        <h1 className="text-3xl text-white mb-4">Cette page est introuvable</h1>
        <p className="text-mg-200 mb-8">Retrouvez notre assistant pédagogique gratuit et le téléchargement pour Windows sur l’accueil.</p>
        <Link to="/" className="btn-primary inline-flex">Retour à l’accueil</Link>
      </div>
    </main>
  );
}
