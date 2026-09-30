// Document entier entouré d'un bloc de code « ```markdown … ``` ».
//
// Certains modèles (surtout les petits : Ministral 3 3B, vérifié avec un vrai Ollama par scripts/real-ai-check.mjs)
// entourent TOUT le document d'un tel bloc. Le code des citations ne touche jamais aux blocs de code : sans cette
// correction, aucune citation du document n'était vérifiée (une citation ou un DOI inventés restaient) et la liste
// « Sources utilisées » n'était pas ajoutée. La pipeline retire donc ce bloc englobant AVANT de vérifier les citations.
// La même fonction sert à l'affichage (réexportée par src/lib/generation/result.ts) :
//  - seul un bloc ouvert tout au début est concerné : annoncé « markdown » ou « md », ou SANS langage (« ``` » seul,
//    observé avec un vrai Ministral 3 3B : tout un courrier affiché en code, citations non vérifiées et avertissement
//    « aucune source citée » à tort). Un bloc sans langage n'est retiré que si ce qu'il entoure est manifestement un
//    document rédigé (citation [Sn] ou gras, ou deux marques parmi titre, liste, citation « > ») et ne ressemble pas à
//    du code ; un document qui commence par un vrai bloc de code (```python…, ou ``` suivi de code) n'est jamais modifié ;
//  - la clôture n'est retirée que si elle n'appartient pas à un bloc intérieur ; un bloc jamais refermé (texte
//    tronqué, génération arrêtée) est ouvert quand même (sans langage : seulement s'il ne contient aucune autre ligne
//    de clôture, sinon « ```\ncode\n```\n\nTexte » ferait passer la prose dans un bloc de code) ;
//  - texte COMPLET (option `complete`, génération terminée normalement) : le modèle peut refermer le bloc englobant
//    puis ajouter quelques lignes (« Note pour l'enseignant… », constaté avec un vrai Ministral 3 3B). Cette clôture
//    isolée ouvrait alors un bloc de code jusqu'à la fin : la note ET la liste « Sources utilisées » s'affichaient en
//    texte brut. Elle est retirée elle aussi. (Jamais pendant le flux ni pour un texte tronqué : la dernière clôture
//    pourrait y ouvrir un vrai bloc intérieur pas encore refermé.)

const WRAPPER_OPEN_RE = /^\s*(`{3,}|~{3,})[ \t]*(markdown|md)?[ \t]*\r?\n/i;
const FENCE_LINE_RE = /^[ \t]{0,3}(`{3,}|~{3,})/;
/** Marques fortes d'un document rédigé : citation [Sn] ou texte en gras. */
const STRONG_DOC_RE = /\[S\d{1,3}\b|\*\*[^*\n]*\p{L}[^*\n]*\*\*/u;
/** Marques faibles (deux différentes exigées) : titre, liste, citation « > ». */
const WEAK_DOC_RES = [/^[ \t]{0,3}#{1,6}[ \t]+\p{Lu}/mu, /^[ \t]*[-*][ \t]+\p{L}/mu, /^[ \t]{0,3}>[ \t]/m];
/** Texte qui ressemble à du code (jamais déballé). */
const CODE_RE = /[;{}][ \t]*$|^[ \t]*(?:def|class|import|from|return|function|const|let|var|public|private)\b|^[ \t]*#(?:include|!)|\bprint\(/m;

/** Vrai si ces lignes (hors blocs intérieurs) forment un document rédigé et non du code. */
function looksLikeDocument(lines: readonly string[]): boolean {
  const prose: string[] = [];
  let inner = false;
  for (const line of lines) {
    if (FENCE_LINE_RE.test(line)) inner = !inner;
    else if (!inner) prose.push(line);
  }
  const text = prose.join('\n');
  if (CODE_RE.test(text)) return false;
  return STRONG_DOC_RE.test(text) || WEAK_DOC_RES.filter(re => re.test(text)).length >= 2;
}

export interface UnwrapOptions {
  /** Texte complet (génération terminée normalement, et non partielle ou tronquée). */
  complete?: boolean;
}

/** Retire le bloc (« ```markdown » ou « ``` ») qui entoure tout le document, s'il existe ; sinon renvoie le texte inchangé. */
export function unwrapDocumentFence(text: string, options: UnwrapOptions = {}): string {
  const open = WRAPPER_OPEN_RE.exec(text);
  if (!open) return text;
  const marker = open[1];
  const bare = !open[2];
  const body = text.slice(open[0].length);
  const lines = body.split(/\r?\n/);
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  const fences = lines.filter(line => FENCE_LINE_RE.test(line)).length;
  const closesWrapperAt = (i: number) => {
    const closing = i >= 0 ? lines[i].trim() : '';
    return closing.length >= marker.length && closing === marker[0].repeat(closing.length);
  };
  // Nombre impair de lignes de clôture : la dernière ferme le bloc englobant (et non un bloc intérieur).
  if (closesWrapperAt(last) && fences % 2 === 1) {
    return !bare || looksLikeDocument(lines.slice(0, last)) ? lines.slice(0, last).join('\n').replace(/\s+$/, '') : text;
  }
  if (options.complete && fences % 2 === 1) {
    // Clôture du bloc englobant suivie de quelques lignes : la dernière ligne de clôture, en début de ligne.
    let i = last;
    while (i >= 0 && !FENCE_LINE_RE.test(lines[i])) i--;
    if (i >= 0 && !/^\s/.test(lines[i]) && closesWrapperAt(i) && (!bare || looksLikeDocument(lines.slice(0, i)))) {
      return [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n').replace(/\s+$/, '');
    }
  }
  // Bloc sans langage jamais refermé (flux, texte tronqué) : seulement s'il ne contient aucune autre ligne de clôture.
  if (bare) return fences === 0 && looksLikeDocument(lines) ? body : text;
  return body;
}
