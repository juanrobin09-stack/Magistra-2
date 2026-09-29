// Animation d'ouverture « Magistra » (application Windows uniquement, jamais sur le site), une fois par lancement :
// carré arrondi à l'icône, mot « Magistra. » lettre par lettre, balayage lumineux, ligne lumineuse, sous-titre, puis
// fondu vers l'application (≈ 2,1 s ; prolongée jusqu'à 4 s au plus si le profil n'est pas encore chargé, pour ne
// jamais découvrir un écran d'attente). Passable par un clic, Échap ou toute touche. Mouvement réduit
// (prefers-reduced-motion) : image fixe très courte (≈ 0,4 s), sans aucun mouvement.
// Aucune ressource réseau ni script en ligne (CSP de l'application : 'self') : classes .intro-* de src/index.css.
// Un rechargement de la fenêtre ne la rejoue pas (stockage de session de la fenêtre).

import { useEffect, useLayoutEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { useOptionalRuntime } from '@/lib/runtime/context';

const INTRO_SEEN_KEY = 'magistra_intro_seen';
const WORD = 'Magistra';

/** Affichage complet (ms), puis fondu de sortie : ≈ 2,1 s en tout. */
export const INTRO_HOLD_MS = 1650;
export const INTRO_FADE_MS = 450;
/** Profil toujours en chargement : l'animation reste affichée au plus jusque-là. */
export const INTRO_MAX_HOLD_MS = 4000;
/** Mouvement réduit : image fixe, ≈ 0,4 s en tout. */
export const INTRO_REDUCED_HOLD_MS = 250;
export const INTRO_REDUCED_FADE_MS = 150;
/** Passée par l'enseignant (clic, touche) : fondu bref. */
export const INTRO_SKIP_FADE_MS = 220;

function introAlreadySeen(): boolean {
  try {
    return sessionStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    sessionStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    // Stockage de session indisponible : l'animation serait rejouée au rechargement, sans autre conséquence.
  }
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function AppIntro() {
  const [gone, setGone] = useState(introAlreadySeen);
  const [reduced] = useState(prefersReducedMotion);
  const [skipped, setSkipped] = useState(false);
  const [elapsed, setElapsed] = useState<'min' | 'max' | null>(null);
  const loading = useOptionalRuntime()?.profileStatus === 'loading';
  const leaving = skipped || elapsed === 'max' || (elapsed === 'min' && !loading);

  // Durée d'affichage : minimale, puis maximale (profil encore en chargement).
  useEffect(() => {
    if (gone) return;
    markIntroSeen();
    const min = window.setTimeout(() => setElapsed(e => e ?? 'min'), reduced ? INTRO_REDUCED_HOLD_MS : INTRO_HOLD_MS);
    const max = window.setTimeout(() => setElapsed('max'), INTRO_MAX_HOLD_MS);
    return () => {
      window.clearTimeout(min);
      window.clearTimeout(max);
    };
    // Une seule fois, à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Barre de défilement de la page chargée en dessous : retirée pendant l'animation, rendue dès le début du fondu
  // (le léger recalage de la page se fait sous l'écran d'ouverture encore opaque).
  useLayoutEffect(() => {
    if (gone || leaving) return;
    const root = document.documentElement;
    root.classList.add('intro-active');
    return () => root.classList.remove('intro-active');
  }, [gone, leaving]);

  // Toute touche (Échap comprise) passe l'animation ; la touche n'est pas retenue (elle agit aussi sur la page).
  useEffect(() => {
    if (gone || leaving) return;
    const onKey = () => setSkipped(true);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [gone, leaving]);

  // Fondu de sortie, puis retrait complet (plus rien ne recouvre l'application).
  useEffect(() => {
    if (!leaving || gone) return;
    const fade = reduced ? INTRO_REDUCED_FADE_MS : skipped ? INTRO_SKIP_FADE_MS : INTRO_FADE_MS;
    const id = window.setTimeout(() => setGone(true), fade);
    return () => window.clearTimeout(id);
  }, [leaving, gone, reduced, skipped]);

  if (gone) return null;
  return (
    <div
      role="img"
      aria-label="Magistra, votre assistant pédagogique"
      data-testid="app-intro"
      className={`intro-overlay${leaving ? ' intro-leaving' : ''}${skipped ? ' intro-skipped' : ''}${reduced ? ' intro-reduced' : ''}`}
      onClick={() => setSkipped(true)}
    >
      <div className="intro-halo" aria-hidden="true" />
      <div className="intro-content" aria-hidden="true">
        <div className="intro-logo">
          <GraduationCap size={40} strokeWidth={1.75} className="text-mg-900" />
        </div>
        <div className="intro-word" style={{ fontFamily: 'var(--font-display)' }}>
          <span className="intro-letters">
            {Array.from(WORD).map((letter, i) => (
              <span key={i} className="intro-letter" style={{ animationDelay: `${300 + i * 55}ms` }}>{letter}</span>
            ))}
            <span className="intro-dot">.</span>
          </span>
          {/* Même texte superposé : seul le reflet lumineux y est visible (balayage). */}
          <span className="intro-shine">{WORD}.</span>
        </div>
        <div className="glow-line intro-line" />
        <p className="intro-subtitle">Votre assistant pédagogique</p>
      </div>
    </div>
  );
}
