// Aides d'affichage des formules (KaTeX) : notations françaises.

/**
 * Virgule décimale française : en mode mathématique, KaTeX traite « , » comme une ponctuation et insère une espace
 * (« 3, 5 »). « 3{,}5 » s'affiche « 3,5 ». Seuls les décimaux isolés sont protégés : les listes (« 1,2,3 ») gardent
 * leurs espaces, et le texte des \text{…} (déjà correct) n'est pas touché.
 */
const TEXT_GROUP = String.raw`\\(?:text|textrm|textit|textbf|mathrm|mbox)\{[^{}]*\}`;
const DECIMAL_COMMA_RE = new RegExp(`(${TEXT_GROUP})|(?<![\\d,.])(\\d+),(\\d+)(?![\\d,])`, 'g');

export function protectDecimalCommas(tex: string): string {
  return tex.replace(DECIMAL_COMMA_RE, (match, text: string | undefined, int: string, frac: string) => (text ? match : `${int}{,}${frac}`));
}

