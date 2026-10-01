// Affichage du contenu généré (Markdown) : GFM (tableaux, listes de tâches, barré, notes),
// mathématiques KaTeX, liens sûrs, HTML brut neutralisé.
// Rendu progressif : le texte est découpé en blocs de premier niveau mémoïsés, si bien que
// pendant la génération seul le dernier bloc (celui qui s'allonge) est recalculé.
// Avant le découpage, prepareMarkdown convertit les formules « \( \) » / « \[ \] » et met en page les choix de QCM
// (même traitement que l'export PDF), y compris pendant la rédaction et pour l'historique ancien.

import { memo, useMemo, type MouseEvent, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import type { PluggableList } from 'unified';
import type { Element, ElementContent } from 'hast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import katex from 'katex';
// Macros chimiques \ce{…} et \pu{…} (mhchem) : les équations de réaction s'affichent au lieu d'une erreur rouge.
import 'katex/contrib/mhchem';
import 'katex/dist/katex.min.css';
import { getBridge } from '@/lib/runtime/local';
import { protectDecimalCommas } from '@/lib/mathText';
import { prepareMarkdown, remarkSafeMarkdown, splitMarkdownBlocks } from '@/lib/export/markdown';

// Remarque : les formules sont rendues avec le paquet `katex` de l'application (même version que
// la feuille de style importée ci-dessus). rehype-katex embarque sa propre copie de KaTeX 0.16,
// dont les noms de classes ne correspondent plus à la feuille de style de KaTeX 0.18.
const REMARK_PLUGINS: PluggableList = [remarkGfm, remarkMath, remarkSafeMarkdown];
const REMARK_REHYPE_OPTIONS = {
  footnoteLabel: 'Notes',
  footnoteBackLabel: 'Revenir au texte',
  clobberPrefix: 'note-',
};

// ─── Mathématiques ──────────────────────────────────────────────────────────

const mathCache = new Map<string, string>();
const MATH_CACHE_MAX = 400;

/**
 * Macros des paquets siunitx (\num, \SI, \si, \unit, \qty) que les modèles écrivent souvent : rendues en texte
 * simple (« 1200 », « 3 m ») au lieu d'une erreur. Objet recréé à chaque appel (KaTeX peut le modifier).
 */
function mathMacros(): Record<string, string> {
  return {
    '\\num': '#1',
    '\\SI': '#1\\,\\text{#2}',
    '\\qty': '#1\\,\\text{#2}',
    '\\si': '\\text{#1}',
    '\\unit': '\\text{#1}',
  };
}

function renderMath(tex: string, display: boolean): string {
  const key = `${display ? 'D' : 'I'}${tex}`;
  const cached = mathCache.get(key);
  if (cached !== undefined) return cached;
  let html: string;
  try {
    html = katex.renderToString(protectDecimalCommas(tex), {
      displayMode: display,
      throwOnError: false,
      // Formule non prise en charge (\\begin{tabular}…) : la source reste lisible, sans le rouge d'une erreur.
      errorColor: 'inherit',
      macros: mathMacros(),
      strict: 'ignore',
      trust: false,
      output: 'htmlAndMathml',
      maxSize: 40,
      maxExpand: 500,
    });
  } catch {
    // Formule impossible à analyser : on affiche la source, échappée par React.
    html = '';
  }
  if (mathCache.size >= MATH_CACHE_MAX) mathCache.delete(mathCache.keys().next().value as string);
  mathCache.set(key, html);
  return html;
}

function MathView({ tex, display }: { tex: string; display: boolean }) {
  const html = renderMath(tex, display);
  if (!html) {
    return display ? <pre className="math-source">{tex}</pre> : <code className="math-source">{tex}</code>;
  }
  // KaTeX (trust: false) échappe tout le texte de la formule : le HTML produit est sûr.
  return display
    ? <div className="math-display" dangerouslySetInnerHTML={{ __html: html }} />
    : <span className="math-inline" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ─── Utilitaires ─────────────────────────────────────────────────────────────

function hastText(node: ElementContent | Element): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(hastText).join('');
  return '';
}

function classList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/\s+/);
  return [];
}

function childrenText(children: ReactNode): string {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenText).join('');
  return '';
}

/** Protocoles autorisés : http(s), mailto, ancres internes. Tout le reste est neutralisé. */
function safeUrl(url: string): string {
  const cleaned = defaultUrlTransform(url.trim());
  if (!cleaned) return '';
  if (/^(https?:|mailto:)/i.test(cleaned) || cleaned.startsWith('#')) return cleaned;
  // Liens relatifs (« /app/… », « page.html ») : sans objet dans un contenu généré.
  return '';
}

function openExternal(event: MouseEvent<HTMLAnchorElement>, url: string): void {
  const bridge = getBridge();
  if (!bridge) return; // Navigateur : target="_blank" + rel="noopener noreferrer".
  event.preventDefault();
  try {
    void bridge.app.openExternal(url).catch(() => undefined);
  } catch {
    // Pont indisponible : rien à faire, le lien reste visible.
  }
}

// ─── Composants ──────────────────────────────────────────────────────────────

/**
 * dir="auto" : la direction de chaque bloc se déduit de son premier caractère fort. Un paragraphe arabe s'aligne à droite
 * avec sa ponctuation du bon côté ; le français n'est pas touché. L'attribut `node` (hast) n'est pas transmis au DOM ;
 * les autres propriétés (alignement GFM des cellules…) le sont.
 */
const auto = {
  p: ({ node: _node, ...props }) => <p dir="auto" {...props} />,
  li: ({ node: _node, ...props }) => <li dir="auto" {...props} />,
  h1: ({ node: _node, ...props }) => <h1 dir="auto" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 dir="auto" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 dir="auto" {...props} />,
  h4: ({ node: _node, ...props }) => <h4 dir="auto" {...props} />,
  h5: ({ node: _node, ...props }) => <h5 dir="auto" {...props} />,
  h6: ({ node: _node, ...props }) => <h6 dir="auto" {...props} />,
  blockquote: ({ node: _node, ...props }) => <blockquote dir="auto" {...props} />,
  td: ({ node: _node, ...props }) => <td dir="auto" {...props} />,
  th: ({ node: _node, ...props }) => <th dir="auto" {...props} />,
} satisfies Components;

const COMPONENTS: Components = {
  ...auto,
  a({ href, title, children }) {
    const url = href ?? '';
    if (!url) return <span className="md-link-disabled" title={title}>{children}</span>;
    if (url.startsWith('#')) return <a href={url} title={title}>{children}</a>;
    return (
      <a
        href={url}
        title={title ?? url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={event => openExternal(event, url)}
      >
        {children}
      </a>
    );
  },
  img({ src, alt }) {
    // Aucune image distante n'est chargée (confidentialité, fonctionnement hors ligne).
    const label = alt ? `Image : ${alt}` : 'Image';
    return <span className="md-image" title={typeof src === 'string' ? src : undefined}>[{label}]</span>;
  },
  table({ children }) {
    return (
      <div className="table-wrap" role="region" aria-label="Tableau" tabIndex={0} dir="auto">
        <table>{children}</table>
      </div>
    );
  },
  pre({ node, children }) {
    const first = node?.children.find((c): c is Element => c.type === 'element');
    if (first && first.tagName === 'code') {
      const classes = classList(first.properties?.className);
      if (classes.includes('math-display') || classes.includes('language-math')) {
        return <MathView tex={hastText(first)} display />;
      }
    }
    return <pre tabIndex={0}>{children}</pre>;
  },
  code({ className, children }) {
    const classes = classList(className);
    if (classes.includes('math-inline')) return <MathView tex={childrenText(children)} display={false} />;
    return <code className={className}>{children}</code>;
  },
  input({ type, checked }) {
    if (type !== 'checkbox') return null;
    return (
      <input
        type="checkbox"
        checked={Boolean(checked)}
        readOnly
        disabled
        aria-label={checked ? 'Tâche faite' : 'Tâche à faire'}
      />
    );
  },
};

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
      components={COMPONENTS}
      urlTransform={safeUrl}
      skipHtml
    >
      {source}
    </Markdown>
  );
});

export default function MarkdownView({ content, className }: { content: string; className?: string }) {
  const blocks = useMemo(() => splitMarkdownBlocks(prepareMarkdown(typeof content === 'string' ? content : '')), [content]);
  return (
    <div className={className ? `prose-content ${className}` : 'prose-content'}>
      {blocks.map((block, index) => (
        // L'index est une clé stable : les blocs précédents ne changent pas pendant la génération.
        <MarkdownBlock key={index} source={block} />
      ))}
    </div>
  );
}
