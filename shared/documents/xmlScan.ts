// Balayage linéaire du XML des DOCX / PPTX. Les expressions rationnelles paresseuses (`[\s\S]*?`)
// reparcourent tout le reste du fichier à chaque balise jamais refermée : coût quadratique (fichier piégé).
// Ici chaque recherche est bornée à la fenêtre `[from, to[` demandée : un bloc intérieur sans la balise cherchée
// (`<a:p><a:endParaRPr/></a:p>` sans `<a:t>`) ou dont la balise n'est jamais refermée ne fait donc pas reparcourir
// le reste du document, et chaque position n'est lue qu'un nombre borné de fois par niveau d'imbrication.

/** Bloc `<nom …>…</nom>` (ou balise auto-fermante `<nom …/>`) trouvé dans le XML. */
export interface XmlBlock {
  /** Début de la balise ouvrante. */
  start: number;
  /** Fin du bloc entier (balise fermante comprise). */
  end: number;
  /** Contenu entre la balise ouvrante et la balise fermante (vide si auto-fermante). */
  innerStart: number;
  innerEnd: number;
  selfClosing: boolean;
}

function isNameBoundary(ch: string): boolean {
  return ch === '>' || ch === '/' || ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
}

/** Position de la prochaine balise ouvrante `<nom` (nom exact, pas `<nomPr`) à partir de `from`, ou -1. */
export function indexOfOpenTag(xml: string, name: string, from: number): number {
  const needle = `<${name}`;
  let i = xml.indexOf(needle, from);
  while (i !== -1) {
    const next = xml[i + needle.length];
    if (next !== undefined && isNameBoundary(next)) return i;
    i = xml.indexOf(needle, i + 1);
  }
  return -1;
}

/**
 * Blocs `<nom …>…</nom>` successifs de `xml[from..to]`, sans chevauchement, dans l'ordre. Les balises
 * auto-fermantes sont signalées (`selfClosing`). Un bloc jamais refermé dans la fenêtre met fin au balayage.
 */
export function* xmlBlocks(xml: string, name: string, from = 0, to = xml.length): Generator<XmlBlock> {
  // Toutes les recherches (`indexOf` ne sait pas s'arrêter à `to`) se font dans la fenêtre extraite une seule fois :
  // aucune ne peut lire au-delà, ni parcourir tout le reste du document pour rien.
  const base = Math.max(0, from);
  const text = base === 0 && to >= xml.length ? xml : xml.slice(base, to);
  const closeTag = `</${name}>`;
  let pos = 0;
  while (pos < text.length) {
    const start = indexOfOpenTag(text, name, pos);
    if (start === -1) return;
    const gt = text.indexOf('>', start);
    if (gt === -1) return;
    if (text.charCodeAt(gt - 1) === 47 /* / */) {
      yield { start: base + start, end: base + gt + 1, innerStart: base + gt + 1, innerEnd: base + gt + 1, selfClosing: true };
      pos = gt + 1;
      continue;
    }
    const close = text.indexOf(closeTag, gt + 1);
    if (close === -1) return;
    yield { start: base + start, end: base + close + closeTag.length, innerStart: base + gt + 1, innerEnd: base + close, selfClosing: false };
    pos = close + closeTag.length;
  }
}

/** Texte des balises ouvrantes `<nom …>` (sans leur contenu), par exemple `<Relationship …>`. */
export function* xmlOpenTags(xml: string, name: string): Generator<string> {
  let pos = 0;
  for (;;) {
    const start = indexOfOpenTag(xml, name, pos);
    if (start === -1) return;
    const gt = xml.indexOf('>', start);
    if (gt === -1) return;
    yield xml.slice(start, gt + 1);
    pos = gt + 1;
  }
}
