// Collapsible nested lists for the Persian Markdown editor.
//
// A list item that owns a nested list folds its children through CodeMirror's
// fold machinery (`foldState` plus `foldEffect`/`unfoldEffect`); the folded
// placeholder is empty, so the parent row reads unchanged and only the
// marker color signals the state. Plain parent markers toggle on click; task
// boxes keep their checkbox behavior and fold through the chevron instead.
// An extra chevron appears on hover or while the cursor sits anywhere inside
// the parent item, for discoverability. Fold state lives in the editor state:
// it maps through typing and clears on touched deletions, but resets on
// remount like the other view-local state.
import { EditorView } from 'codemirror';
import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

/**
 * Collects parent list items (those owning a nested list) in a document
 * slice, with the marker range to anchor widgets and the line range their
 * children fold into. Tree-based, so fenced code never contributes.
 * @param {object} view Active editor view.
 * @param {number} from Slice start.
 * @param {number} to Slice end.
 * @returns {Array<object>} `{ itemFrom, itemTo, markerFrom, markerTo, foldFrom, foldTo }`.
 */
export function collectListParents(view, from, to) {
  ensureSyntaxTree(view.state, view.state.doc.length);
  const tree = syntaxTree(view.state);
  if (!tree) {
    return [];
  }
  const parents = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'ListItem') {
        return;
      }
      let nested = null;
      let mark = null;
      for (let child = node.node.firstChild; child; child = child.nextSibling) {
        if ((child.name === 'BulletList' || child.name === 'OrderedList') && nested === null) {
          nested = child;
        }
        if (child.name === 'ListMark' && mark === null) {
          mark = child;
        }
      }
      if (nested === null || mark === null) {
        return false;
      }
      const firstLine = view.state.doc.lineAt(node.from);
      const lastLine = view.state.doc.lineAt(node.to);
      if (lastLine.to <= firstLine.to) {
        return false;
      }
      parents.push({
        itemFrom: node.from,
        itemTo: node.to,
        markerFrom: mark.from,
        markerTo: mark.to,
        foldFrom: firstLine.to,
        foldTo: lastLine.to,
      });
      return undefined;
    },
  });
  return parents;
}

/**
 * Reports whether an exact fold range is currently folded.
 * @param {object} state Editor state.
 * @param {number} from Fold start.
 * @param {number} to Fold end.
 * @returns {boolean} True when the range is folded.
 */
export function isFoldedRange(state, from, to) {
  const folded = foldedRanges(state);
  if (!folded) {
    return false;
  }
  let found = false;
  folded.between(from, from, (rangeFrom, rangeTo) => {
    if (rangeFrom === from && rangeTo === to) {
      found = true;
    }
  });
  return found;
}

/**
 * Reports whether an update toggled any fold (fold effects change neither
 * the document, the viewport nor the selection, so decoration plugins must
 * watch for them explicitly).
 * @param {object} update View update.
 * @returns {boolean} True when a fold effect ran.
 */
export function hasFoldEffects(update) {
  return update.transactions.some((transaction) => transaction.effects.some(
    (effect) => effect.is(foldEffect) || effect.is(unfoldEffect),
  ));
}

/**
 * Flips one exact fold range.
 * @param {object} view Active editor view.
 * @param {number} from Fold start.
 * @param {number} to Fold end.
 * @returns {void}
 */
export function flipFold(view, from, to) {
  if (isFoldedRange(view.state, from, to)) {
    view.dispatch({ effects: unfoldEffect.of({ from, to }) });
  } else {
    view.dispatch({ effects: foldEffect.of({ from, to }) });
  }
}

const foldTheme = EditorView.theme({
  // Collapsed markers borrow the accent: the color (not a placeholder) is
  // the collapse signal, so expanded rows read exactly as before.
  '& .parsi-list-marker.parsi-list-collapsed': { color: 'var(--pey-color-accent, #5eead4)' },
  '& .parsi-task-marker.parsi-list-collapsed': { color: 'var(--pey-color-accent, #5eead4)' },
  // The chevron lives inside the marker widget, so the two never drift apart
  // (and it hides with the marker under the cursor). It stays out of the
  // way until needed: hovered line, or the cursor sitting anywhere inside
  // the parent item (which pins `parsi-list-active` on the parent row).
  // Touch users get it through the cursor, since tapping parks it there.
  '& .parsi-list-marker .parsi-list-chevron, & .parsi-task-marker .parsi-list-chevron': { display: 'none' },
  '& .cm-line:hover .parsi-list-chevron': { display: 'inline-block' },
  '& .cm-line.parsi-list-active .parsi-list-chevron': { display: 'inline-block' },
  '& .parsi-list-chevron': {
    display: 'inline-block',
    inlineSize: '0.3em',
    blockSize: '0.3em',
    marginInlineEnd: '0.3em',
    borderRight: '2px solid currentColor',
    borderBottom: '2px solid currentColor',
    transform: 'rotate(225deg)',
    cursor: 'pointer',
  },
});

/**
 * Builds the active-row class on parent rows holding the cursor, which
 * reveals their chevrons through CSS.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildFoldDecorations(view) {
  const head = view.state.selection.main.head;
  const builder = [];
  for (const { from, to } of view.visibleRanges) {
    for (const parent of collectListParents(view, from, to)) {
      if (head >= parent.itemFrom && head <= parent.itemTo) {
        const line = view.state.doc.lineAt(parent.itemFrom);
        builder.push(Decoration.line({ class: 'parsi-list-active' }).range(line.from));
      }
    }
  }
  return Decoration.set(builder);
}

const foldDecorationsPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildFoldDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || hasFoldEffects(update)) {
        this.decorations = buildFoldDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

/**
 * Returns the list-fold extensions: real folding with an empty placeholder,
 * chevron toggles, the active-row class, and marker click-to-toggle.
 * @returns {Array} CodeMirror extensions.
 */
export function listFoldExtensions() {
  return [
    codeFolding({ placeholderText: '' }),
    foldDecorationsPlugin,
    foldTheme,
    EditorView.domEventHandlers({
      mousedown(event, view) {
        // Frozen while locked for reading: folding edits nothing, but the
        // toggle is an editing affordance and stays dead like the rest.
        if (!view.state.facet(EditorView.editable)) {
          return false;
        }
        // The chevron lives inside its marker, so any chevron click resolves
        // through the enclosing marker below. A bare task box keeps its
        // checkbox behavior untouched.
        if (event.target?.closest?.('.parsi-task-marker')
          && !event.target?.closest?.('.parsi-list-chevron')) {
          return false;
        }
        const marker = event.target?.closest?.('.parsi-list-marker,.parsi-task-marker');
        if (!marker) {
          return false;
        }
        // Only parent markers carry fold data; plain ones keep the stock
        // cursor behavior.
        const from = Number(marker.dataset?.foldFrom ?? Number.NaN);
        const to = Number(marker.dataset?.foldTo ?? Number.NaN);
        if (!Number.isInteger(from) || !Number.isInteger(to)) {
          return false;
        }
        event.preventDefault();
        flipFold(view, from, to);
        return true;
      },
    }),
  ];
}
