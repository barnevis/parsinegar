// Base direction for letter-less lines.
//
// Chromium resolves `unicode-bidi: plaintext` lines that contain no strong
// character as left-to-right, ignoring the inherited base direction — so
// empty lines, digit-only lines and bare marks (e.g. `# `) would park the
// caret on the left even in rtl/auto mode. Lines that contain a letter keep
// the stylesheet `plaintext` handling untouched; only letter-less lines get
// an explicit base direction through a line decoration (stronger selector
// than the `plaintext` rule, so it always wins).
import { EditorView } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';

/**
 * Checks whether a line holds no Unicode letter (empty, digits,
 * punctuation or bare marks only).
 * @param {string} text Line text.
 * @returns {boolean} True when no letter is present.
 */
export function isNeutralLine(text) {
  return typeof text === 'string' && !/\p{L}/u.test(text);
}

/**
 * Builds line decorations pinning letter-less lines to the base direction.
 * @param {object} view Active editor view.
 * @param {string} baseDirection 'rtl' or 'ltr' base for neutral lines.
 * @returns {object} Decoration set.
 */
function buildBaseDecorations(view, baseDirection) {
  const builder = [];
  const lineClass = baseDirection === 'ltr' ? 'parsi-base-ltr' : 'parsi-base-rtl';
  // An empty document reports no visible ranges, yet its single line still
  // renders and needs pinning — fall back to the whole document then.
  const ranges = view.visibleRanges.length > 0
    ? view.visibleRanges
    : [{ from: 0, to: view.state.doc.length }];
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (isNeutralLine(line.text)) {
        builder.push(Decoration.line({ class: lineClass }).range(line.from));
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

const baseTheme = EditorView.theme({
  '& .cm-line.parsi-base-rtl': { direction: 'rtl', unicodeBidi: 'isolate' },
  '& .cm-line.parsi-base-ltr': { direction: 'ltr', unicodeBidi: 'isolate' },
});

/**
 * Returns the neutral-line direction extensions for a base direction.
 * @param {string} baseDirection 'rtl' or 'ltr' base for neutral lines.
 * @returns {Array} CodeMirror extensions.
 */
export function lineDirectionExtensions(baseDirection) {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildBaseDecorations(view, baseDirection);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildBaseDecorations(update.view, baseDirection);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [plugin, baseTheme];
}
