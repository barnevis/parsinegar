// Renders Markdown horizontal rules as real rules (live preview).
//
// A thematic break (`---`, `***` or `___` on its own line) is read from the
// syntax tree, so lookalikes never match: a setext underline (`عنوان` + `---`)
// parses as SetextHeading, and `---` inside fenced code parses as code text.
// The raw marks hide through a zero-size mark over the node range while the
// line itself carries the rule styling — except where the cursor or a
// selection touches the node, which reopens the raw source for editing
// (line-level reveal: clicking the rule shows `---`).
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

/**
 * Checks whether any selection range touches `from`..`to` (boundaries
 * inclusive). Touched rules reopen for editing.
 * @param {object} selection Editor selection state.
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {boolean} True when a range touches.
 */
function selectionTouches(selection, from, to) {
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Collects horizontal-rule node ranges, skipping any touched by the
 * selection so the source under edit stays readable.
 * @param {object} state Editor state (needs the Markdown language for the tree).
 * @returns {Array} `{ from, to }` rule ranges, ascending.
 */
export function collectHrHides(state) {
  ensureSyntaxTree(state, state.doc.length);
  const tree = syntaxTree(state);
  if (!tree) {
    return [];
  }
  const hidden = [];
  tree.iterate({
    enter: (node) => {
      if (node.name === 'HorizontalRule') {
        if (!selectionTouches(state.selection, node.from, node.to)) {
          hidden.push({ from: node.from, to: node.to });
        }
      }
    },
  });
  return hidden;
}

/**
 * Builds rule decorations: a hidden mark over each rule plus a line class
 * that paints the rule itself.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildHrDecorations(view) {
  const ranges = [];
  for (const { from, to } of collectHrHides(view.state)) {
    const line = view.state.doc.lineAt(from);
    ranges.push({ from: line.from, to: null, deco: Decoration.line({ class: 'parsi-hr-line' }) });
    ranges.push({ from, to, deco: Decoration.mark({ class: 'parsi-hr-hidden' }) });
  }
  // RangeSet needs ascending ranges; each line point precedes its own mark.
  ranges.sort((a, b) => a.from - b.from);
  return Decoration.set(ranges.map(({ from, to, deco }) => (to === null ? deco.range(from) : deco.range(from, to))));
}

const hrDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildHrDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildHrDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const hrTheme = EditorView.theme({
  '& .parsi-hr-hidden': { fontSize: '0' },
  // The hidden marks leave no ink, so the line gets breathing room plus a
  // full-width rule in the single-source border color (same token as quotes).
  '& .cm-line.parsi-hr-line': {
    borderBottom: '2px solid var(--pey-color-border, #b9b9c4)',
    paddingBlock: '0.4em',
  },
});

/**
 * Returns the horizontal-rule extensions for the editor.
 * @returns {Array} View plugin plus theme.
 */
export function hrViewExtensions() {
  return [hrDecorationPlugin, hrTheme];
}
