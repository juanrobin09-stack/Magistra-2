// Conversion d'expressions TeX simples en texte Unicode lisible (export PDF).
// Principe : on ne convertit que ce que l'on sait convertir fidèlement. Dès qu'une commande
// inconnue ou une construction ambiguë apparaît (environnements, \binom, alignements…),
// la fonction renvoie null et l'appelant conserve la source TeX telle quelle.

const SYMBOLS: Record<string, string> = {
  // Lettres grecques
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο',
  pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // Relations
  leq: '≤', le: '≤', leqslant: '≤', geq: '≥', ge: '≥', geqslant: '≥', neq: '≠', ne: '≠',
  approx: '≈', simeq: '≃', sim: '∼', cong: '≅', equiv: '≡', propto: '∝', ll: '≪', gg: '≫',
  prec: '≺', succ: '≻', mid: '|', parallel: '∥', perp: '⊥',
  // Ensembles et logique
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', subsetneq: '⊊', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', setminus: '∖', emptyset: '∅', varnothing: '∅', forall: '∀', exists: '∃',
  nexists: '∄', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  // Flèches
  to: '→', rightarrow: '→', longrightarrow: '⟶', leftarrow: '←', gets: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', implies: '⇒', Longrightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', iff: '⇔',
  mapsto: '↦', uparrow: '↑', downarrow: '↓',
  // Opérateurs
  times: '×', div: '÷', pm: '±', mp: '∓', cdot: '·', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  oplus: '⊕', otimes: '⊗', infty: '∞', partial: '∂', nabla: '∇', sum: '∑', prod: '∏', int: '∫',
  iint: '∬', oint: '∮',
  // Divers
  ldots: '…', dots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', angle: '∠', degree: '°', prime: '′',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', ell: 'ℓ', hbar: 'ℏ',
  aleph: 'ℵ', lbrace: '{', rbrace: '}', vert: '|', lvert: '|', rvert: '|', Vert: '‖', lVert: '‖',
  rVert: '‖', backslash: '\\', checkmark: '✓', euro: '€', quad: '  ', qquad: '    ',
  // Fonctions usuelles (écrites en romain)
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc', arcsin: 'arcsin',
  arccos: 'arccos', arctan: 'arctan', sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', exp: 'exp',
  log: 'log', ln: 'ln', lg: 'lg', lim: 'lim', max: 'max', min: 'min', sup: 'sup', inf: 'inf',
  det: 'det', dim: 'dim', ker: 'ker', deg: 'deg', gcd: 'gcd', arg: 'arg', Pr: 'Pr',
};

/** Commandes d'un seul caractère non alphabétique (\, \; \{ …). */
const SHORT_COMMANDS: Record<string, string> = {
  ',': ' ', ';': ' ', ':': ' ', '>': ' ', '!': '', ' ': ' ', '%': '%', '$': '$', '&': '&', '#': '#',
  '_': '_', '{': '{', '}': '}', '|': '‖',
};

/** Commandes sans effet sur le texte (tailles, styles d'affichage). */
const IGNORED = new Set([
  'left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr',
  'Biggl', 'Biggr', 'middle', 'displaystyle', 'textstyle', 'scriptstyle', 'limits', 'nolimits', 'nonumber',
]);

/** Commandes à un argument dont on garde simplement le contenu. */
const TEXT_WRAPPERS = new Set([
  'text', 'textrm', 'textnormal', 'textit', 'textbf', 'textsf', 'texttt', 'mathrm', 'mathit', 'mathbf',
  'mathsf', 'mathtt', 'mathnormal', 'operatorname', 'mbox', 'boldsymbol', 'bm', 'emph',
]);

const BLACKBOARD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ', H: 'ℍ' };

const ACCENTS: Record<string, string> = {
  vec: '\u20d7', overrightarrow: '\u20d7', hat: '\u0302', widehat: '\u0302', bar: '\u0304', overline: '\u0305',
  dot: '\u0307', ddot: '\u0308', tilde: '\u0303', widetilde: '\u0303',
};

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ',
  d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ',
  s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ', '∘': '°', '°': '°', '′': '′', "'": '′',
  '*': '*', '∗': '*',
};

const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', o: 'ₒ', x: 'ₓ', h: 'ₕ',
  k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', p: 'ₚ', s: 'ₛ', t: 'ₜ', i: 'ᵢ', j: 'ⱼ', r: 'ᵣ', u: 'ᵤ', v: 'ᵥ',
};

/** Caractères produits par les tables ci-dessus (vérifiés contre la police du PDF par les tests). */
export const TEX_OUTPUT_CHARACTERS: string = [
  ...Object.values(SYMBOLS), ...Object.values(SHORT_COMMANDS), ...Object.values(BLACKBOARD),
  ...Object.values(ACCENTS), ...Object.values(SUPERSCRIPT), ...Object.values(SUBSCRIPT), '√∛∜',
].join('');

class Unsupported extends Error {}

class TexParser {
  private pos = 0;
  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  parse(): string {
    const out = this.sequence(null);
    if (this.pos < this.src.length) throw new Unsupported();
    return out;
  }

  /** Lit une suite d'éléments jusqu'à `}` (si stop = '}') ou la fin. */
  private sequence(stop: '}' | null): string {
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '}') {
        if (stop === '}') return out;
        throw new Unsupported();
      }
      if (ch === '^' || ch === '_') {
        this.pos++;
        const arg = this.argument();
        out += ch === '^' ? scripted(arg, SUPERSCRIPT, '^') : scripted(arg, SUBSCRIPT, '_');
        continue;
      }
      out += this.atom();
    }
    if (stop === '}') throw new Unsupported();
    return out;
  }

  /** Un élément : groupe, commande, espace ou caractère. */
  private atom(): string {
    const ch = this.src[this.pos];
    if (ch === '{') {
      this.pos++;
      const inner = this.sequence('}');
      this.pos++; // '}'
      return inner;
    }
    if (ch === '\\') return this.command();
    if (/\s/.test(ch)) {
      while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
      return ' ';
    }
    if (ch === '&' || ch === '#' || ch === '%') throw new Unsupported();
    this.pos++;
    if (ch === '~') return '\u00a0';
    return ch;
  }

  /** Argument d'une commande ou d'un exposant : groupe `{…}` ou élément unique. */
  private argument(): string {
    this.skipSpaces();
    if (this.pos >= this.src.length) throw new Unsupported();
    const ch = this.src[this.pos];
    if (ch === '{') {
      this.pos++;
      const inner = this.sequence('}');
      this.pos++;
      return inner;
    }
    if (ch === '\\') return this.command();
    if (ch === '}' || ch === '^' || ch === '_') throw new Unsupported();
    this.pos++;
    return ch;
  }

  /** Argument brut (texte de \text{…}) : on garde les espaces tels quels. */
  private rawGroup(): string {
    this.skipSpaces();
    if (this.src[this.pos] !== '{') return this.argument();
    let depth = 0;
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos++];
      if (ch === '{') {
        if (depth++ > 0) out += ch;
      } else if (ch === '}') {
        if (--depth === 0) return out;
        out += ch;
      } else if (ch === '\\') {
        const next = this.src[this.pos++] ?? '';
        if (next in SHORT_COMMANDS) out += SHORT_COMMANDS[next];
        else throw new Unsupported();
      } else {
        out += ch;
      }
    }
    throw new Unsupported();
  }

  private optionalArgument(): string | null {
    this.skipSpaces();
    if (this.src[this.pos] !== '[') return null;
    const end = this.src.indexOf(']', this.pos);
    if (end < 0) throw new Unsupported();
    const inner = new TexParser(this.src.slice(this.pos + 1, end)).parse();
    this.pos = end + 1;
    return inner;
  }

  private skipSpaces(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++;
  }

  private command(): string {
    this.pos++; // '\'
    if (this.pos >= this.src.length) throw new Unsupported();
    const first = this.src[this.pos];
    if (!/[a-zA-Z]/.test(first)) {
      this.pos++;
      if (first === '\\') throw new Unsupported(); // retour à la ligne : mise en page non linéaire
      if (first in SHORT_COMMANDS) return SHORT_COMMANDS[first];
      throw new Unsupported();
    }
    let name = '';
    while (this.pos < this.src.length && /[a-zA-Z]/.test(this.src[this.pos])) name += this.src[this.pos++];

    if (IGNORED.has(name)) {
      // \left. et \right. : délimiteur invisible.
      if ((name === 'left' || name === 'right') && this.src[this.pos] === '.') this.pos++;
      return '';
    }
    if (name in SYMBOLS) return SYMBOLS[name];
    if (TEXT_WRAPPERS.has(name)) {
      return name.startsWith('text') || name === 'mbox' ? this.rawGroup() : this.argument();
    }
    if (name === 'mathbb' || name === 'Bbb') {
      const arg = this.argument();
      return [...arg].map(c => BLACKBOARD[c] ?? c).join('');
    }
    if (name in ACCENTS) {
      const arg = this.argument();
      if (!arg) throw new Unsupported();
      const mark = ACCENTS[name];
      if (mark === '\u0305') return [...arg].map(c => c + mark).join('');
      return arg + mark;
    }
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
      const num = this.argument();
      const den = this.argument();
      return `${wrap(num)}/${wrap(den)}`;
    }
    if (name === 'sqrt') {
      const index = this.optionalArgument();
      const radicand = this.argument();
      const body = wrap(radicand);
      if (index === null || index === '2') return `√${body}`;
      if (index === '3') return `∛${body}`;
      if (index === '4') return `∜${body}`;
      return `${scripted(index, SUPERSCRIPT, '^')}√${body}`;
    }
    if (name === 'not') {
      const next = this.argument();
      if (next === '=') return '≠';
      if (next === '∈') return '∉';
      if (next === '⊂') return '⊄';
      throw new Unsupported();
    }
    throw new Unsupported();
  }
}

/**
 * Entoure de parenthèses un opérande composé (numérateur, dénominateur, radicande) :
 * seulement s'il contient, hors parenthèses, un opérateur ou un espace (« x+1 » → « (x+1) »,
 * mais « n(n+1) », « 2x » ou « π » restent tels quels).
 */
function wrap(text: string): string {
  const t = text.trim();
  if (!t) return '()';
  let depth = 0;
  let needs = false;
  for (const c of t) {
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && /[\s+\-−±∓=<>≤≥≠≈/÷×·*,;:|]/.test(c)) needs = true;
  }
  if (!needs) return t;
  if (/^\(.*\)$/.test(t) && balanced(t.slice(1, -1))) return t;
  return `(${t})`;
}

function balanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Exposant ou indice : caractères Unicode dédiés si possible, sinon notation linéaire ^(…) / _(…). */
function scripted(arg: string, table: Record<string, string>, marker: '^' | '_'): string {
  const compact = arg.replace(/\s+/g, '');
  if (!compact) return '';
  if (marker === '^' && (compact === '∘' || compact === '°')) return '°';
  if ([...compact].every(c => c in table)) return [...compact].map(c => table[c]).join('');
  return [...compact].length === 1 ? `${marker}${compact}` : `${marker}(${compact})`;
}

/**
 * Convertit une expression TeX en texte Unicode. Renvoie null si l'expression contient
 * une construction non prise en charge : l'appelant doit alors afficher la source telle quelle.
 */
export function texToUnicode(tex: string): string | null {
  const source = tex.trim();
  if (!source) return '';
  if (source.length > 2_000) return null;
  try {
    const out = new TexParser(source).parse();
    return out.replace(/[ \t]{2,}/g, match => (match.length >= 4 ? match : ' ')).trim();
  } catch (err) {
    if (err instanceof Unsupported) return null;
    throw err;
  }
}
