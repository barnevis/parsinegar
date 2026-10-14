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
 * Finds the fold range of the parent list item whose first line contains
 * a document position in its head zone (line start through marker end).
 * That covers the chevron gap and raw (unwidgetized) marker glyphs, which
 * carry no element to match. Tree-based, so fenced code never contributes;
 * task lines stay out (their box keeps checkbox behavior, their chevron
 * keeps the fold), as do plain and child lines.
 * @param {object} view Active editor view.
 * @param {number} position Document position.
 * @returns {object|null} `{ from, to }` fold range or null.
 */
export function parentFoldAt(view, position) {
  if (typeof position !== 'number' || !Number.isInteger(position)) {
    return null;
  }
  let line = null;
  try {
    if (position < 0 || position > view.state.doc.length) {
      return null;
    }
    line = view.state.doc.lineAt(position);
  } catch {
    return null;
  }
  for (const parent of collectListParents(view, line.from, line.to)) {
    if (view.state.doc.lineAt(parent.itemFrom).number !== line.number) {
      continue;
    }
    if (position < line.from || position >= parent.markerTo) {
      continue;
    }
    const afterMarker = line.text.slice(parent.markerTo - line.from);
    if (/^[ \t]*\[[ xX]\]/.test(afterMarker)) {
      return null;
    }
    return { from: parent.foldFrom, to: parent.foldTo };
  }
  return null;
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
  // The stock fold placeholder renders as a light pill (a white bar in
  // dark themes), but the marker color already signals the fold — so the
  // placeholder keeps its mapping role with zero paint.
  '& .cm-foldPlaceholder': {
    backgroundColor: 'transparent',
    border: '0',
    padding: '0',
    margin: '0',
    color: 'inherit',
  },
  // List chevrons overlay the row's inline-start padding instead of taking
  // flow space: the marker glyph never moves, in any state (widget or raw,
  // hovered or not). That keeps parent rows pixel-aligned with plain rows.
  '& .parsi-list-marker': { position: 'relative' },
  // Bullets sit slightly below the line middle (near the text baseline,
  // where bullets read best); the relative shift is paint-only, so cursor
  // mapping, folding and selection never notice it.
  '& .parsi-list-marker.parsi-list-bullet': { top: '0.25em' },
  '& .parsi-list-marker .parsi-list-chevron': { display: 'none' },
  '& .cm-line:hover .parsi-list-marker .parsi-list-chevron': { display: 'block' },
  '& .cm-line.parsi-list-active .parsi-list-marker .parsi-list-chevron': { display: 'block' },
  '& .parsi-list-marker .parsi-list-chevron': {
    position: 'absolute',
    insetInlineStart: '-1em',
    top: '50%',
    inlineSize: '0.3em',
    blockSize: '0.3em',
    borderRight: '2px solid currentColor',
    borderBottom: '2px solid currentColor',
    transform: 'translateY(-50%) rotate(45deg)',
    cursor: 'pointer',
  },
  '& .parsi-list-marker.parsi-list-collapsed .parsi-list-chevron': {
    transform: 'translateY(-50%) rotate(135deg)',
  },
  // A collapsed (left-pointing) chevron carries its tip at the box middle,
  // while the open one carries it below the box: the collapsed box drops by
  // the same tip offset so both tips land on the bullet glyph. Ordered rows
  // keep the shared position untouched.
  '& .parsi-list-marker.parsi-list-bullet.parsi-list-collapsed .parsi-list-chevron': {
    top: 'calc(50% - 0.25em + 0.28em)',
    transform: 'translateY(-50%) rotate(135deg)',
  },
  // The chevron inherits the bullet nudge through its relative parent, so
  // its own top cancels it back out: the open tip lands exactly where it
  // always was — now on the lowered bullet. Ordered rows keep the shared
  // rule untouched.
  '& .parsi-list-marker.parsi-list-bullet .parsi-list-chevron': {
    top: 'calc(50% - 0.25em)',
  },
  // Task chevrons overlay like bullet chevrons instead of taking flow
  // space: behind the box sits only the gap, the zero-size hidden dash and
  // blank indent, so nothing visible is ever covered, and parent task rows
  // stay pixel-aligned with leaf task rows in every state.
  '& .parsi-task-marker': { position: 'relative' },
  '& .parsi-task-marker .parsi-list-chevron': { display: 'none' },
  '& .cm-line:hover .parsi-task-marker .parsi-list-chevron': { display: 'block' },
  '& .cm-line.parsi-list-active .parsi-task-marker .parsi-list-chevron': { display: 'block' },
  '& .parsi-task-marker .parsi-list-chevron': {
    position: 'absolute',
    insetInlineStart: '-1em',
    top: '50%',
    inlineSize: '0.3em',
    blockSize: '0.3em',
    borderRight: '2px solid currentColor',
    borderBottom: '2px solid currentColor',
    transform: 'translateY(-50%) rotate(45deg)',
    cursor: 'pointer',
  },
  '& .parsi-task-marker.parsi-list-collapsed .parsi-list-chevron': {
    transform: 'translateY(-50%) rotate(135deg)',
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
        if (marker) {
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
        }
        // Position fallback for clicks with no marker element: the chevron
        // gap and raw (unwidgetized) glyphs. Trusted events only — synthetic
        // ones carry meaningless coordinates, and jsdom has no layout to
        // resolve them through.
        if (event.isTrusted !== true) {
          return false;
        }
        let position = null;
        try {
          position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        } catch {
          position = null;
        }
        const fold = parentFoldAt(view, position);
        if (!fold) {
          return false;
        }
        event.preventDefault();
        flipFold(view, fold.from, fold.to);
        return true;
      },
    }),
  ];
}
