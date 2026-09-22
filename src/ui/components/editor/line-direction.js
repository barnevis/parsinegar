// Explicit per-line direction for every editor line.
//
// Chromium resolves `unicode-bidi: plaintext` lines that contain no strong
// character as left-to-right, ignoring the inherited base direction — so
// empty lines, digit-only lines and bare marks (e.g. `# `) would park the
// caret on the left even in rtl/auto mode. Firefox has the mirror defect:
// under `plaintext` plus `text-align: start`, a wrapped continuation row
// that breaks inside an inline span aligns to the wrong side (left in an
// rtl line), while the first row stays correct. Both engines therefore get
// the same explicit treatment, and no stylesheet `plaintext` remains on
// `.cm-line`.
//
// Direction resolution has two modes. In `auto` mode the first strong letter
// of each line decides its direction (mirroring the `plaintext` heuristic).
// In a forced (`rtl`/`ltr`) mode every line takes the chosen direction —
// even English lines under `rtl` — except fenced code content, which always
// stays left-to-right.
import { EditorView } from 'codemirror';
import { Decoration, ViewPlugin } from '@codemirror/view';
import { FENCE_PATTERN } from './live-preview.js';

/**
 * Matches letters of right-to-left scripts (Hebrew, Arabic, its supplements
 * and presentation forms). Any other Unicode letter counts as
 * left-to-right.
 */
const RTL_LETTER_PATTERN = /[֐-ٟ؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;
const ANY_LETTER_PATTERN = /\p{L}/u;

/**
 * Checks whether a line holds no Unicode letter (empty, digits,
 * punctuation or bare marks only).
 * @param {string} text Line text.
 * @returns {boolean} True when no letter is present.
 */
export function isNeutralLine(text) {
  return typeof text === 'string' && !ANY_LETTER_PATTERN.test(text);
}

/**
 * Resolves a line to an explicit direction from its first strong letter,
 * mirroring the `unicode-bidi: plaintext` heuristic without the stylesheet
 * rule (which Firefox misaligns on wrapped continuation rows).
 * @param {string} text Line text.
 * @returns {string|null} 'rtl', 'ltr', or null when the line has no letter.
 */
export function resolveLineDirection(text) {
  if (typeof text !== 'string') {
    return null;
  }
  for (const character of text) {
    if (!ANY_LETTER_PATTERN.test(character)) {
      continue;
    }
    return RTL_LETTER_PATTERN.test(character) ? 'rtl' : 'ltr';
  }
  return null;
}

/**
 * Builds line decorations pinning every visible line to its resolved
 * direction. In `auto` mode lettered lines take their own script direction
 * and letter-less lines take the base direction; in a forced mode every line
 * takes the forced direction except fenced code content, which stays
 * left-to-right. Fence parity is resolved by scanning from the document
 * start, mirroring `live-preview.js`.
 * @param {object} view Active editor view.
 * @param {string} baseDirection 'rtl' or 'ltr' base for neutral lines.
 * @param {string|null} forcedDirection 'rtl'/'ltr' to lock every line, or null for per-line detection.
 * @returns {object} Decoration set.
 */
function buildDirectionDecorations(view, baseDirection, forcedDirection) {
  const builder = [];
  const baseClass = baseDirection === 'ltr' ? 'parsi-base-ltr' : 'parsi-base-rtl';
  const forcedClass = forcedDirection === 'ltr' ? 'parsi-base-ltr' : 'parsi-base-rtl';
  // An empty document reports no visible ranges, yet its single line still
  // renders and needs pinning — fall back to the whole document then.
  const ranges = view.visibleRanges.length > 0
    ? view.visibleRanges
    : [{ from: 0, to: view.state.doc.length }];
  let inFence = false;
  let fenceCheckedUntil = 1;
  for (const { from, to } of ranges) {
    const firstLine = view.state.doc.lineAt(from).number;
    for (let number = fenceCheckedUntil; number < firstLine; number += 1) {
      if (FENCE_PATTERN.test(view.state.doc.line(number).text)) {
        inFence = !inFence;
      }
    }
    fenceCheckedUntil = Math.max(fenceCheckedUntil, firstLine);
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      let lineClass;
      if (FENCE_PATTERN.test(line.text)) {
        inFence = !inFence;
        lineClass = forcedDirection ? forcedClass : classForText(line.text, baseClass);
      } else if (forcedDirection && inFence) {
        lineClass = 'parsi-dir-ltr';
      } else if (forcedDirection) {
        lineClass = forcedClass;
      } else {
        lineClass = classForText(line.text, baseClass);
      }
      builder.push(Decoration.line({ class: lineClass }).range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(builder);
}

/**
 * Maps line text to a direction class for per-line detection.
 * @param {string} text Line text.
 * @param {string} baseClass Class for letter-less lines.
 * @returns {string} Direction class name.
 */
function classForText(text, baseClass) {
  const resolved = resolveLineDirection(text);
  if (resolved === 'ltr') {
    return 'parsi-dir-ltr';
  }
  if (resolved === 'rtl') {
    return 'parsi-dir-rtl';
  }
  return baseClass;
}

const directionTheme = EditorView.theme({
  '& .cm-line.parsi-dir-rtl': { direction: 'rtl', textAlign: 'right', unicodeBidi: 'isolate' },
  '& .cm-line.parsi-dir-ltr': { direction: 'ltr', textAlign: 'left', unicodeBidi: 'isolate' },
  '& .cm-line.parsi-base-rtl': { direction: 'rtl', textAlign: 'right', unicodeBidi: 'isolate' },
  '& .cm-line.parsi-base-ltr': { direction: 'ltr', textAlign: 'left', unicodeBidi: 'isolate' },
});

/**
 * Returns the per-line direction extensions for a base direction.
 * @param {string} baseDirection 'rtl' or 'ltr' base for neutral lines.
 * @param {string|null} [forcedDirection] 'rtl'/'ltr' to lock every line (fenced code stays ltr), or null for per-line detection.
 * @returns {Array} CodeMirror extensions.
 */
export function lineDirectionExtensions(baseDirection, forcedDirection = null) {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = buildDirectionDecorations(view, baseDirection, forcedDirection);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDirectionDecorations(update.view, baseDirection, forcedDirection);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
  return [plugin, directionTheme];
}
