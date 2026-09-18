// `==highlight==` rendering for the Persian Markdown editor.
//
// Double-equals highlighting is not part of Markdown/GFM, so it is handled as
// a view-local decoration instead of parser syntax: the inner text receives
// the highlight style and the `==` delimiters are hidden. A span overlapped by
// the cursor (or selection) is left fully raw so that exact spot stays
// editable. Multiline spans are not supported.
import { EditorView } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';

const HIGHLIGHT_PATTERN = /==([^=\n]+?)==/g;

const highlightTheme = EditorView.theme({
  // Fixed ink: the yellow wash is identical in both color schemes, so the
  // text color is pinned to dark instead of inheriting the editor color.
  '& .parsi-highlight': { backgroundColor: '#fff3b0', color: '#1c2026', borderRadius: '4px', paddingInline: '0.2em' },
  '& .parsi-delim': { fontSize: '0' },
});

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
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      HIGHLIGHT_PATTERN.lastIndex = 0;
      let match = null;
      while ((match = HIGHLIGHT_PATTERN.exec(line.text)) !== null) {
        const matchStart = line.from + match.index;
        const matchEnd = matchStart + match[0].length;
        if (selection.from > matchEnd || selection.to < matchStart) {
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
