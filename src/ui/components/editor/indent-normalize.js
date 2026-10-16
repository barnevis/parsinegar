// Display-level indent normalization for nested list items.
//
// Space-indented items render narrower than tab-indented siblings at the
// same level (`tab-size` only stretches tabs), so old or pasted content with
// pure space indents sits off-column. The bytes stay untouched: a
// `Decoration.replace` widget paints the indent width over the raw indent
// run, where `depth` comes from the syntax tree (the same authority folding
// uses). Copy, search and `getValue()` keep seeing the raw text.
//
// The widget holds spaces, never tabs, on purpose: a leading raw tab
// misrenders under the hanging indent (`margin` plus negative `text-indent`
// shift the tab-stop grid, so the tab advances short and the overmeasured
// hang drags the first row sideways — depth-1 ordered children sat
// half a tab off). Spaces have no tab stops, so they render exactly the
// canvas-measured width under any hang, and the measured hang lands true.
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { LIST_PATTERN, QUOTE_PATTERN } from './live-preview.js';

const INDENT_RUN_PATTERN = /^[ \t]+/;

/**
 * Paints the indent width over a raw indent run: `depth` levels of
 * `tabSize` spaces. Tabs inherit nothing here — spaces match the canvas
 * tab expansion (`rawWidth` in list-hang.js) by construction, so the
 * measured hang and the rendered indent always agree. Clicks fall through
 * to the default cursor handling (no override: the base `ignoreEvent`
 * already ignores).
 */
class IndentWidget extends WidgetType {
  constructor(depth, tabSize) {
    super();
    this.depth = depth;
    this.tabSize = tabSize;
  }

  eq(other) {
    return other instanceof IndentWidget && other.depth === this.depth && other.tabSize === this.tabSize;
  }

  toDOM() {
    const span = document.createElement('span');
    span.className = 'parsi-indent';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = ' '.repeat(this.depth * this.tabSize);
    return span;
  }
}

/**
 * Counts enclosing list levels for a marker position: top-level items read
 * 0, once-nested 1, and so on. Anything outside a list reads below 0.
 * @param {object} tree Lezer syntax tree.
 * @param {number} markerPos Document offset of the item marker.
 * @returns {number} Nesting depth, or -1 outside any list.
 */
export function listDepthAt(tree, markerPos) {
  let node = tree.resolveInner(markerPos, 1);
  let depth = -1;
  while (node) {
    if (node.name === 'BulletList' || node.name === 'OrderedList') {
      depth += 1;
    }
    node = node.parent;
  }
  return depth;
}

/**
 * Queues one indent replacement for a nested item line: every nested run
 * gets the spaces widget, even a canonically tab-indented one — raw
 * leading tabs misrender under the hang (see the module note), so only
 * top-level items, quotes and non-list lines skip. The tree is the
 * authority, so fenced code never matches either.
 * @param {object} tree Lezer syntax tree.
 * @param {object} line CodeMirror line object.
 * @param {Array} builder Decoration array, ascending.
 * @param {number} tabSize Editor tab size in spaces.
 * @returns {void}
 */
function pushIndentForLine(tree, line, builder, tabSize) {
  const run = INDENT_RUN_PATTERN.exec(line.text);
  if (!run || QUOTE_PATTERN.test(line.text) || !LIST_PATTERN.test(line.text)) {
    return;
  }
  const depth = listDepthAt(tree, line.from + run[0].length);
  if (depth < 1) {
    return;
  }
  builder.push(
    Decoration.replace({ widget: new IndentWidget(depth, tabSize) }).range(line.from, line.from + run[0].length),
  );
}

/**
 * Builds indent-normalizing decorations for visible ranges.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
export function buildIndentDecorations(view) {
  ensureSyntaxTree(view.state, view.state.doc.length);
  const tree = syntaxTree(view.state);
  const builder = [];
  if (!tree) {
    return Decoration.set(builder);
  }
  const tabSize = view.state.tabSize;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      pushIndentForLine(tree, line, builder, tabSize);
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

const indentNormalizePlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildIndentDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildIndentDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * Returns the indent-normalization extensions: display-only spaces painting
 * over raw indent runs, with the document bytes untouched.
 * @returns {Array} CodeMirror extensions.
 */
export function indentNormalizeExtensions() {
  return [indentNormalizePlugin];
}
