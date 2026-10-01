// Balayage linéaire du XML des DOCX / PPTX. Les expressions rationnelles paresseuses (`[\s\S]*?`)
// reparcourent tout le reste du fichier à chaque balise jamais refermée : coût quadratique (fichier piégé).
// Ici chaque position du texte n'est examinée qu'un nombre borné de fois : si une balise fermante
// est introuvable à partir d'ici, elle l'est aussi pour toutes les suivantes, et l'on s'arrête.

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
 * auto-fermantes sont signalées (`selfClosing`). Un bloc jamais refermé met fin au balayage.
 */
export function* xmlBlocks(xml: string, name: string, from = 0, to = xml.length): Generator<XmlBlock> {
  const closeTag = `</${name}>`;
  let pos = from;
  while (pos < to) {
    const start = indexOfOpenTag(xml, name, pos);
    if (start === -1 || start >= to) return;
    const gt = xml.indexOf('>', start);
    if (gt === -1 || gt >= to) return;
    if (xml.charCodeAt(gt - 1) === 47 /* / */) {
      yield { start, end: gt + 1, innerStart: gt + 1, innerEnd: gt + 1, selfClosing: true };
      pos = gt + 1;
      continue;
    }
    const close = xml.indexOf(closeTag, gt + 1);
    if (close === -1 || close + closeTag.length > to) return;
    yield { start, end: close + closeTag.length, innerStart: gt + 1, innerEnd: close, selfClosing: false };
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
