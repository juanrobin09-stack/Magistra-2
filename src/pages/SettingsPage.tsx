import { useCurrentUser } from '@/lib/auth';
import { useNavigate } from 'react-router-dom';
import { Settings, User, RefreshCw, Key, CheckCircle, AlertCircle } from 'lucide-react';
import { getMatieresForNiveau, getNiveauLabel } from '@/types';
import { getTeacherProfile, resetOnboarding } from '@/hooks/useTeacherProfile';
import { useState, useEffect } from 'react';

const isElectron = !!window.electronAPI?.isElectron;

function ApiKeysSection() {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [hasKeys, setHasKeys] = useState(false);

  useEffect(() => {
    async function load() {
      if (!window.electronAPI) return;
      const [ak, su, sk] = await Promise.all([
        window.electronAPI.getConfig('anthropicKey'),
        window.electronAPI.getConfig('supabaseUrl'),
        window.electronAPI.getConfig('supabaseServiceKey'),
      ]);
      setAnthropicKey(ak);
      setSupabaseUrl(su);
      setSupabaseKey(sk);
      setHasKeys(Boolean(ak && su && sk));
    }
    load();
  }, []);

  async function handleSave() {
    if (!window.electronAPI) return;
    // Only save non-masked values (user typed something new)
    if (!anthropicKey.includes('••')) await window.electronAPI.setConfig('anthropicKey', anthropicKey);
    if (supabaseUrl) await window.electronAPI.setConfig('supabaseUrl', supabaseUrl);
    if (!supabaseKey.includes('••')) await window.electronAPI.setConfig('supabaseServiceKey', supabaseKey);
    setHasKeys(true);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="card p-6 mb-6 animate-fade-in" style={{ animationDelay: '0.15s' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-accent" />
          <h2 className="text-base font-semibold text-white">Clés API</h2>
        </div>
        {hasKeys
          ? <span className="flex items-center gap-1 text-xs text-emerald-400"><CheckCircle size={12} /> Configurées</span>
          : <span className="flex items-center gap-1 text-xs text-amber-400"><AlertCircle size={12} /> Non configurées</span>
        }
      </div>
      <p className="text-xs text-mg-400 mb-4">
        Ces clés sont stockées localement sur votre PC, jamais envoyées à nos serveurs.
      </p>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-mg-300 mb-1 uppercase tracking-wider">Clé Anthropic (Claude AI)</label>
          <input
            type="password"
            value={anthropicKey}
            onChange={e => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-api03-..."
            className="input-field text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-mg-300 mb-1 uppercase tracking-wider">URL Supabase</label>
          <input
            type="text"
            value={supabaseUrl}
            onChange={e => setSupabaseUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co"
            className="input-field text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-mg-300 mb-1 uppercase tracking-wider">Clé Service Supabase</label>
          <input
            type="password"
            value={supabaseKey}
            onChange={e => setSupabaseKey(e.target.value)}
            placeholder="eyJ..."
            className="input-field text-sm font-mono"
          />
        </div>
      </div>
      <button onClick={handleSave} className="btn-primary text-sm py-2 mt-4">
        {saved ? <><CheckCircle size={14} /> Sauvegardé !</> : <><Key size={14} /> Sauvegarder les clés</>}
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
      <div className="mb-10 animate-fade-in">
        <div className="flex items-center gap-2 mb-1">
          <Settings size={18} className="text-accent" />
          <h1 className="text-2xl text-white" style={{ fontFamily: 'var(--font-display)' }}>Réglages</h1>
        </div>
        <p className="text-sm text-mg-300">Personnalisez votre expérience Magistra</p>
      </div>

      {/* API Keys — Electron only */}
      {isElectron && <ApiKeysSection />}

      {/* Profile */}
      <div className="card p-6 mb-6 animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-accent" />
          <h2 className="text-base font-semibold text-white">Compte</h2>
        </div>
        <div>
          <label className="block text-xs font-medium text-mg-300 mb-2 uppercase tracking-wider">Email</label>
          <input type="text" value={user?.emailAddresses[0]?.emailAddress ?? '—'} disabled
            className="input-field opacity-60 cursor-not-allowed" />
        </div>
      </div>

      {/* Usage */}
      <div className="card p-6 mb-6 animate-fade-in" style={{ animationDelay: '0.2s' }}>
        <h2 className="text-base font-semibold text-white mb-3">Utilisation</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg bg-mg-700/50">
            <span className="text-sm text-mg-200">Générations par jour</span>
            <span className="badge badge-accent">20 / jour</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-mg-700/50">
            <span className="text-sm text-mg-200">Types de contenu</span>
            <span className="badge badge-accent">Cours · Exercices · Évaluations · Séquences</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-mg-700/50">
            <span className="text-sm text-mg-200">Export</span>
            <span className="badge badge-accent">PDF · Markdown · Copier</span>
          </div>
        </div>
      </div>

      {/* Reconfigure */}
      <div className="card p-6 mb-6 animate-fade-in" style={{ animationDelay: '0.25s' }}>
        <h2 className="text-base font-semibold text-white mb-3">Profil enseignant</h2>
        {(() => {
          const tp = getTeacherProfile();
          if (!tp) return <p className="text-sm text-mg-400">Aucun profil configuré.</p>;
          return (
            <div className="space-y-2 text-sm mb-4">
              <div className="flex justify-between"><span className="text-mg-400">Établissement</span><span className="text-mg-200">{tp.etablissement}</span></div>
              <div className="flex justify-between"><span className="text-mg-400">Classes</span><span className="text-mg-200">{tp.niveaux.map(n => getNiveauLabel(n)).join(', ')}</span></div>
              <div className="flex justify-between"><span className="text-mg-400">Matière principale</span><span className="text-mg-200">{tp.niveaux[0] ? getMatieresForNiveau(tp.niveaux[0]).find(m => m.value === tp.matierePrincipale)?.label ?? tp.matierePrincipale : tp.matierePrincipale}</span></div>
            </div>
          );
        })()}
        <button onClick={() => { resetOnboarding(); navigate('/onboarding'); }} className="btn-secondary text-sm py-2">
          <RefreshCw size={14} /> Reconfigurer mon profil
        </button>
      </div>

      {/* About */}
      <div className="mt-8 text-center animate-fade-in" style={{ animationDelay: '0.3s' }}>
        <p className="text-xs text-mg-500">
          Magistra — Un projet{' '}
          <a href="https://futurai.space" target="_blank" className="text-accent hover:underline">FutureAI</a>
          {' '}· Bordeaux, France · 2026
        </p>
        <p className="text-xs text-mg-600 mt-1">Open-source · RGPD-compliant · Fait pour l'éducation publique</p>
      </div>
    </div>
  );
}
