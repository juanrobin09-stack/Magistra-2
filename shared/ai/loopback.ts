// Prédicat UNIQUE « adresse de cet ordinateur » : il décide si le moteur est local (étiquette de confidentialité,
// garde-fou « moteur local uniquement » du connecteur web, choix du client réseau). Ne pas dupliquer.

/**
 * Vrai pour `localhost`, `::1` et une adresse IPv4 complète en 127.x.x.x. Un nom de domaine qui commence par
 * « 127. » (127.evil.com, 127.0.0.1.nip.io) n'est PAS une boucle locale. `new URL()` normalise déjà 127.1 en 127.0.0.1.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  return m !== null && m.slice(1).every(octet => Number(octet) <= 255);
}

export function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}
