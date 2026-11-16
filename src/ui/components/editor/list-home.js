// List-aware Home cursor: the first press parks the cursor at the item's
// text start (after the `- `, `۱. ` or `- [ ] ` marker), and when already
// parked there the next press goes to the absolute line start — the cycle
// repeats from anywhere. Plain (non-list) lines keep the one-press line
// start the editor always had. Position-based like the other Home/End
// bindings: no measurement, identical in rtl and ltr.
import { EditorSelection } from '@codemirror/state';
import { inFencedCode } from './list-continue.js';

// The item head: indent, marker (bullet, or ASCII/Persian ordered digits
// with `.`/`)`), the gap, and an optional task box. The match length is the
// text-start offset, so empty items (`- `, `- [x]` alone) park at the line
// end and stay toggleable.
const LIST_HEAD_PATTERN = /^[ \t]*(?:[*+-]|[0-9\u06F0-\u06F9]+[.)])[ \t]+(?:\[[ xX]\])?[ \t]*/;

/**
 * Computes where Home parks the head on one line: the item's text start when
 * the line is a list item (outside fenced code) and the head is not already
 * parked there, the absolute line start otherwise.
 * @param {object} state Editor state.
 * @param {number} head Cursor position on the line.
 * @returns {number} Target position for the head.
 */
function homeTarget(state, head) {
  const line = state.doc.lineAt(head);
  if (!inFencedCode(state, line.number)) {
    const match = LIST_HEAD_PATTERN.exec(line.text);
    if (match) {
      const contentStart = line.from + match[0].length;
      if (head !== contentStart) {
        return contentStart;
      }
    }
  }
  return line.from;
}

/**
 * The list-aware Home command. Each selection range cycles independently:
 * head to the item's text start, or to the line start when already there.
 * The anchor stays put, so an active selection stretches toward the target
 * exactly like the stock cursorLineStart.
 * @param {object} view Active editor view.
 * @returns {boolean} True when any head moved.
 */
export function listHomeCursor(view) {
  const selection = view.state.selection;
  const ranges = selection.ranges.map((range) => {
    const target = homeTarget(view.state, range.head);
    return target === range.head ? range : EditorSelection.range(range.anchor, target);
  });
  if (ranges.every((range, index) => range === selection.ranges[index])) {
    return false;
  }
  view.dispatch({ selection: EditorSelection.create(ranges) });
  return true;
}
