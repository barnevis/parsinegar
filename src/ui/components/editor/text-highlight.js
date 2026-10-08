// `==highlight==` rendering for the Persian Markdown editor.
//
// Double-equals highlighting is not part of Markdown/GFM, so it is handled as
// a view-local decoration instead of parser syntax: the inner text receives
// the highlight style and the `==` delimiters are hidden. A span overlapped by
// the cursor (or selection) is left fully raw so that exact spot stays
// editable. Multiline spans are not supported. Code spans and fenced code
// stay neutral like every other mark: matches touching them are skipped.
import { EditorView } from 'codemirror';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';

const HIGHLIGHT_PATTERN = /==([^=\n]+?)==/g;
// Syntax nodes whose content is literal code (lezer markdown names).
const CODE_NODE_NAMES = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CodeText']);

const highlightTheme = EditorView.theme({
  // Structure only: the wash and ink live in the color-scheme theme, so no
  // selector collides across tags.
  '& .parsi-highlight': { borderRadius: '4px', paddingInline: '0.2em' },
  '& .parsi-delim': { fontSize: '0' },
});

/**
 * Collects literal-code ranges (inline spans and fenced blocks) in a
 * viewport slice, so highlight matches touching them stay neutral like
 * every other mark. Same forced parse as the live preview: the first
 * paint must already cover.
 * @param {object} view Active editor view.
 * @param {number} from Slice start.
 * @param {number} to Slice end.
 * @returns {Array<object>} `{ from, to }` code ranges (empty without a tree).
 */
function collectCodeRanges(view, from, to) {
  ensureSyntaxTree(view.state, view.state.doc.length);
  const tree = syntaxTree(view.state);
  if (!tree) {
    return [];
  }
  const ranges = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (CODE_NODE_NAMES.has(node.name)) {
        ranges.push({ from: node.from, to: node.to });
        return false;
      }
    },
  });
  return ranges;
}

/**
 * Builds highlight decorations for `==...==` spans, leaving spans overlapped
 * by the cursor (or selection) fully raw so that exact spot stays editable.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildHighlightDecorations(view) {
  const selection = view.state.selection.main;
  const builder = [];
  for (const { from, to } of view.visibleRanges) {
    const codeRanges = collectCodeRanges(view, from, to);
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      HIGHLIGHT_PATTERN.lastIndex = 0;
      let match = null;
      while ((match = HIGHLIGHT_PATTERN.exec(line.text)) !== null) {
        const matchStart = line.from + match.index;
        const matchEnd = matchStart + match[0].length;
        const inCode = codeRanges.some(({ from: codeFrom, to: codeTo }) => matchStart < codeTo && matchEnd > codeFrom);
        if (!inCode && (selection.from > matchEnd || selection.to < matchStart)) {
          builder.push(Decoration.mark({ class: 'parsi-delim' }).range(matchStart, matchStart + 2));
          builder.push(Decoration.mark({ class: 'parsi-highlight' }).range(matchStart + 2, matchEnd - 2));
          builder.push(Decoration.mark({ class: 'parsi-delim' }).range(matchEnd - 2, matchEnd));
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

const highlightPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildHighlightDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildHighlightDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * Returns the text-highlight extensions.
 * @returns {Array} CodeMirror extensions.
 */
export function textHighlightExtensions() {
  return [highlightPlugin, highlightTheme];
}
