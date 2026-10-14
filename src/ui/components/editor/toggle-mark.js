// Markdown toggle commands for editor shortcuts.
//
// Each command wraps or unwraps the selection with Markdown marks, so pressing
// the same shortcut twice restores the original text. Commands follow the
// CodeMirror `(view) => boolean` signature. Shortcut matching itself lives in
// `shortcutCommand`, which matches physical key positions (`event.code`) so
// shortcuts work on any keyboard layout, including Persian.
import { EditorSelection } from '@codemirror/state';
import { computeNumbers, formatDigits, inFencedCode, parseOrderedLine } from './list-continue.js';

/**
 * Toggles an inline mark (`**`, `*`, `~~`, `` ` ``) around the selection.
 * @param {object} view Active editor view.
 * @param {string} mark Mark text.
 * @returns {boolean} Always true (handled).
 */
function toggleInlineMark(view, mark) {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  if (range.empty) {
    const cursor = range.from + mark.length;
    view.dispatch({
      changes: { from: range.from, insert: mark + mark },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
    });
    return true;
  }
  if (text.length > mark.length * 2 && text.startsWith(mark) && text.endsWith(mark)) {
    const inner = text.slice(mark.length, text.length - mark.length);
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: inner },
      selection: EditorSelection.range(range.from, range.from + inner.length),
      scrollIntoView: true,
    });
    return true;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: mark + text + mark },
    selection: EditorSelection.range(range.from, range.to + mark.length * 2),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Collects the overlapped document lines for a list command, dropping a
 * trailing edge that merely touches the next line start.
 * @param {object} view Active editor view.
 * @returns {Array<object>} CodeMirror line objects, ascending.
 */
function targetLines(view) {
  const { state } = view;
  const selection = state.selection.main;
  const firstLine = state.doc.lineAt(selection.from).number;
  let lastLine = state.doc.lineAt(selection.to).number;
  if (selection.to > selection.from && state.doc.line(lastLine).from === selection.to) {
    lastLine -= 1;
  }
  const lines = [];
  for (let number = firstLine; number <= lastLine; number += 1) {
    lines.push(state.doc.line(number));
  }
  return lines;
}

/**
 * Classifies one line for list toggling. A run of consecutive list markers
 * (bullets, numbers, task boxes) counts as one previous marking, so stacked
 * markers from any source collapse together instead of piling up; the
 * family comes from the first marker. Blank lines and anything else stay
 * out so they break uniformity checks instead of joining either family.
 * @param {string} text Line text.
 * @returns {object} `{ family, blank, indent, headEnd, boxStart }` where
 *   family is `'unordered'`, `'ordered'` or null, indent the leading
 *   whitespace, headEnd the content offset, and boxStart the last `[`
 *   offset (or -1 without a box).
 */
function classifyListLine(text) {
  const indent = /^([ \t]*)/.exec(text)?.[1] ?? '';
  if (/^\s*$/.test(text)) {
    return { family: null, blank: true, indent, headEnd: 0, boxStart: -1 };
  }
  let offset = indent.length;
  let family = null;
  let boxStart = -1;
  for (;;) {
    const rest = text.slice(offset);
    const bullet = /^([*+-])(?=\s)/.exec(rest);
    const number = /^([0-9\u06F0-\u06F9]+[.)])(?=\s|$)/.exec(rest);
    // A box counts even glued to content (`- [ ]x` renders checked, like
    // the preview): only the brackets and the mark inside decide. A box
    // terminates the run: it binds to its own marker, so anything after it
    // is content even when marker-shaped (`- [ ] - x` keeps its tail).
    const box = /^(\[[ xX]\])/.exec(rest);
    const token = bullet ?? number ?? box;
    if (!token) {
      break;
    }
    if (family === null) {
      if (bullet) {
        family = 'unordered';
      } else if (number) {
        family = 'ordered';
      } else {
        break;
      }
    }
    if (box) {
      boxStart = offset;
    }
    offset += token[0].length;
    offset += /^[ \t]*/.exec(text.slice(offset))?.[0].length ?? 0;
    if (box) {
      break;
    }
  }
  if (family === null) {
    return { family: null, blank: false, indent, headEnd: indent.length, boxStart: -1 };
  }
  return { family, blank: false, indent, headEnd: offset, boxStart };
}

/**
 * Toggles a line prefix (`# `, `> `, `- `, `1. `) on every overlapped line.
 * @param {object} view Active editor view.
 * @param {RegExp} pattern Matches an existing prefix with indent in group 1.
 * @param {string} prefix Prefix to insert (after indentation).
 * @returns {boolean} Always true (handled).
 */
function toggleLinePrefix(view, pattern, prefix) {
  const { state } = view;
  const selection = state.selection.main;
  const firstLine = state.doc.lineAt(selection.from).number;
  let lastLine = state.doc.lineAt(selection.to).number;
  if (selection.to > selection.from && state.doc.line(lastLine).from === selection.to) {
    lastLine -= 1;
  }
  const changes = [];
  for (let number = firstLine; number <= lastLine; number += 1) {
    const line = state.doc.line(number);
    const match = pattern.exec(line.text);
    if (match) {
      changes.push({ from: line.from + match[1].length, to: line.from + match[0].length, insert: '' });
    } else {
      const indent = /^(\s*)/.exec(line.text)?.[1] ?? '';
      changes.push({ from: line.from + indent.length, insert: prefix });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}

/**
 * Toggles bold (`**`) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleBold(view) {
  return toggleInlineMark(view, '**');
}

/**
 * Toggles italic (`*`) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleItalic(view) {
  return toggleInlineMark(view, '*');
}

/**
 * Toggles strikethrough (`~~`) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleStrikethrough(view) {
  return toggleInlineMark(view, '~~');
}

/**
 * Toggles inline code (`` ` ``) around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleCode(view) {
  return toggleInlineMark(view, '`');
}

/**
 * Toggles an `# ` heading prefix on every overlapped line.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleHeading(view) {
  return toggleLinePrefix(view, /^(\s*)#{1,6}\s+/, '# ');
}

/**
 * Toggles a `> ` quote prefix on every overlapped line.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleQuote(view) {
  return toggleLinePrefix(view, /^(\s*)>\s?/, '> ');
}

/**
 * Toggles an unordered list over the selection: a uniformly bulleted
 * selection (tasks included, boxes and all) turns back into plain lines,
 * otherwise every other line joins as `- ` (ordered markers are replaced,
 * task boxes kept, indentation kept).
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleUnorderedList(view) {
  const lines = targetLines(view);
  const infos = lines.map((line) => classifyListLine(line.text));
  const changes = [];
  if (lines.length > 0 && infos.every((info) => info.family === 'unordered')) {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const info = infos[index];
      changes.push({
        from: line.from + info.indent.length,
        to: line.from + info.headEnd,
        insert: '',
      });
    }
  } else {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const info = infos[index];
      if (!info.blank && info.family === 'unordered') {
        continue;
      }
      if (info.family === 'ordered') {
        changes.push({
          from: line.from + info.indent.length,
          to: line.from + (info.boxStart >= 0 ? info.boxStart : info.headEnd),
          insert: '- ',
        });
        continue;
      }
      changes.push({ from: line.from + info.indent.length, insert: '- ' });
    }
  }
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}

/**
 * Toggles an ordered list over the selection. When every line is already
 * ordered (tasks included, boxes and all) their prefixes come off;
 * otherwise the selection becomes sequential lists per indent level, with
 * unordered markers replaced (task boxes kept) and plain lines numbered.
 * New lines start ASCII `N. `, every line keeps its own digit style and
 * delimiter. Blank lines join like before.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleOrderedList(view) {
  const lines = targetLines(view);
  const infos = lines.map((line) => classifyListLine(line.text));
  if (lines.length > 0 && infos.every((info) => info.family === 'ordered')) {
    const changes = lines.map((line, index) => {
      const info = infos[index];
      return {
        from: line.from + info.indent.length,
        to: line.from + info.headEnd,
        insert: '',
      };
    });
    view.dispatch({ changes, scrollIntoView: true });
    return true;
  }
  const records = lines.map((line, index) => {
    const parsed = parseOrderedLine(line.text);
    if (parsed) {
      return {
        from: line.from,
        indent: parsed.indent,
        value: parsed.value,
        fa: parsed.fa,
        delimiter: parsed.delimiter,
        digitsLength: parsed.digitsLength,
        moved: index > 0,
      };
    }
    const indent = /^(\s*)/.exec(line.text)?.[1] ?? '';
    const info = infos[index];
    if (info.family === 'unordered') {
      // Replace the bullet in place (up to a task box, which stays), so
      // markers never stack.
      return {
        from: line.from,
        indent,
        value: 0,
        fa: false,
        delimiter: '.',
        digitsLength: 0,
        replaceFrom: indent.length,
        replaceTo: info.boxStart >= 0 ? info.boxStart : info.headEnd,
        moved: true,
      };
    }
    return { from: line.from, indent, value: 0, fa: false, delimiter: '.', digitsLength: 0, moved: true };
  });
  const computed = computeNumbers(records);
  const changes = [];
  for (const entry of computed) {
    const line = view.state.doc.lineAt(entry.from);
    const original = parseOrderedLine(line.text);
    const core = `${entry.indent}${formatDigits(entry.value, entry.fa)}${entry.delimiter}`;
    if (original) {
      const prefixLength = original.indent.length + original.digitsLength + original.delimiter.length;
      if (core !== line.text.slice(0, prefixLength)) {
        changes.push({ from: entry.from, to: entry.from + prefixLength, insert: core });
      }
    } else if (entry.replaceFrom !== undefined) {
      changes.push({ from: entry.from + entry.replaceFrom, to: entry.from + entry.replaceTo, insert: `${core} ` });
    } else {
      changes.push({ from: entry.from, to: entry.from + entry.indent.length, insert: `${core} ` });
    }
  }
  // Park the cursor after the whole marker run (prefix plus its trailing
  // gap): the marker widget covers exactly that range, and a cursor inside
  // it paints on the wrong side of the number.
  const [head] = computed;
  const headLine = view.state.doc.lineAt(head.from);
  const headParsed = parseOrderedLine(headLine.text);
  const headGap = headParsed
    ? (/^(\s*)/.exec(headLine.text.slice(headParsed.indent.length + headParsed.digitsLength + headParsed.delimiter.length))?.[1] ?? '')
    : ' ';
  const headPrefix = `${head.indent}${formatDigits(head.value, head.fa)}${head.delimiter}`;
  view.dispatch({
    changes,
    selection: EditorSelection.cursor(head.from + headPrefix.length + headGap.length),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Wraps the selection as `[text]()`, placing the cursor inside the parens,
 * or inserts `[]()` with the cursor inside the brackets when empty.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function insertLink(view) {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, insert: '[]()' },
      selection: EditorSelection.cursor(range.from + 1),
      scrollIntoView: true,
    });
    return true;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[${text}]()` },
    selection: EditorSelection.cursor(range.from + text.length + 3),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Toggles a `- [ ]` task box on every overlapped line: task lines lose the
 * box (the bullet stays), list lines gain one after the whole marker run,
 * plain lines become new task items. Text is never destroyed either way.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleTaskList(view) {
  const lines = targetLines(view);
  const changes = [];
  for (const line of lines) {
    const info = classifyListLine(line.text);
    if (info.boxStart >= 0) {
      changes.push({
        from: line.from + info.boxStart,
        to: line.from + info.headEnd,
        insert: '',
      });
      continue;
    }
    if (info.family) {
      changes.push({ from: line.from + info.headEnd, insert: '[ ] ' });
      continue;
    }
    changes.push({ from: line.from + info.indent.length, insert: '- [ ] ' });
  }
  view.dispatch({ changes, scrollIntoView: true });
  return true;
}

/**
 * Toggles `==` highlighting around the selection.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function toggleHighlight(view) {
  return toggleInlineMark(view, '==');
}

/**
 * Wraps the selection as `![text]()`, placing the cursor for the image
 * source, or inserts `![]()` with the cursor on the alt text when empty.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function insertImage(view) {
  const range = view.state.selection.main;
  const text = view.state.sliceDoc(range.from, range.to);
  if (range.empty) {
    view.dispatch({
      changes: { from: range.from, insert: '![]()' },
      selection: EditorSelection.cursor(range.from + 2),
      scrollIntoView: true,
    });
    return true;
  }
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `![${text}]()` },
    selection: EditorSelection.cursor(range.from + text.length + 4),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Inserts block-level template lines for the cursor line in one undoable
 * transaction. A blank cursor line is replaced; otherwise the template goes
 * on fresh lines below with a separating blank line. Templates that cannot
 * interrupt a paragraph (`needsGap`, e.g. `---` would parse as a setext
 * underline) additionally keep a blank line above them.
 * @param {object} view Active editor view.
 * @param {string} template Template text (may span lines).
 * @param {number} cursorAt Cursor offset from the template start.
 * @param {boolean} needsGap True when the template must not touch text above.
 * @returns {boolean} Always true.
 */
function insertBlockTemplate(view, template, cursorAt, needsGap) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  if (line.text.trim().length === 0 && (!needsGap || line.number === 1 || state.doc.line(line.number - 1).text.trim().length === 0)) {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: template },
      selection: EditorSelection.cursor(line.from + cursorAt),
      scrollIntoView: true,
    });
    return true;
  }
  // A blank line splits into itself plus the template with a single newline
  // (keeping one blank above); below text the gap template takes two.
  const pad = needsGap && line.text.trim().length > 0 ? '\n' : '';
  const base = line.to + 1 + pad.length;
  view.dispatch({
    changes: { from: line.to, insert: `\n${pad}${template}` },
    selection: EditorSelection.cursor(base + cursorAt),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Inserts a `---` rule below the cursor line (or in place of a blank one),
 * keeping a blank line above it so it never parses as a setext underline.
 * The cursor lands past the rule to continue writing.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function insertHorizontalRule(view) {
  return insertBlockTemplate(view, '---', 3, true);
}

/**
 * Inserts a 2x2 table skeleton below the cursor line (or in place of a
 * blank one) with the cursor in the first header cell.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function insertTable(view) {
  return insertBlockTemplate(view, '|  |  |\n|---|---|\n|  |  |', 2, true);
}

/**
 * Admonition kinds (action id plus the exact opener word per Parsneshan).
 */
export const ADMONITION_KINDS = [
  { id: 'warning', word: 'هشدار' },
  { id: 'caution', word: 'احتیاط' },
  { id: 'important', word: 'مهم' },
  { id: 'tip', word: 'راهنما' },
  { id: 'note', word: 'نکته' },
];

/**
 * Inserts an admonition block (`...kind`, blank, `...`) with the cursor on
 * the middle line for content.
 * @param {object} view Active editor view.
 * @param {string} word Exact kind word for the opener.
 * @returns {boolean} Always true.
 */
export function insertAdmonition(view, word) {
  const opener = `...${word}`;
  return insertBlockTemplate(view, `${opener}\n\n...`, opener.length + 1, false);
}

/**
 * Inserts a poem block (`...شعر`, blank, `...`) with the cursor on the
 * middle line for the first verse.
 * @param {object} view Active editor view.
 * @returns {boolean} Always true.
 */
export function insertPoem(view) {
  return insertAdmonition(view, 'شعر');
}

/**
 * Inserts an empty fenced code block with the cursor inside. Refused inside
 * fenced code, where a new fence would corrupt the block structure.
 * @param {object} view Active editor view.
 * @returns {boolean} True when inserted, false inside fenced code.
 */
export function insertCodeBlock(view) {
  const line = view.state.doc.lineAt(view.state.selection.main.from);
  if (inFencedCode(view.state, line.number)) {
    return false;
  }
  return insertBlockTemplate(view, '```\n\n```', 4, false);
}

const SHORTCUTS = [
  { code: 'KeyB', shift: false, command: toggleBold },
  { code: 'KeyI', shift: false, command: toggleItalic },
  { code: 'KeyS', shift: true, command: toggleStrikethrough },
  { code: 'KeyH', shift: false, command: toggleHeading },
  // Quote avoids Ctrl+Q (browser quit on some platforms, not always
  // interceptable) and Ctrl+Shift+Q (quit on Chrome); Ctrl+Alt+Q is free.
  { code: 'KeyQ', shift: false, alt: true, command: toggleQuote },
  { code: 'KeyK', shift: false, command: insertLink },
  // Backquote is matched by physical position, so it works on any layout;
  // the key sits by `1` (it prints another character on Persian layouts).
  { code: 'Backquote', shift: false, command: toggleCode },
  { code: 'KeyL', shift: true, command: toggleOrderedList },
  { code: 'KeyU', shift: true, command: toggleUnorderedList },
  { code: 'KeyT', shift: true, command: toggleTaskList },
  { code: 'KeyH', shift: true, command: toggleHighlight },
  { code: 'KeyM', shift: true, command: insertImage },
  { code: 'KeyY', shift: true, command: insertHorizontalRule },
  { code: 'KeyG', shift: true, command: insertTable },
  { code: 'KeyX', shift: true, command: insertPoem },
  { code: 'KeyE', shift: false, command: insertCodeBlock },
];

/**
 * Matches a keydown event to a toggle command by physical key position,
 * so shortcuts work on any keyboard layout. Ctrl/⌘ is required; Alt counts
 * only where the entry declares it.
 * @param {KeyboardEvent} event Keydown event.
 * @returns {Function|null} Matching command or null.
 */
export function shortcutCommand(event) {
  if (!(event.ctrlKey || event.metaKey)) {
    return null;
  }
  const shift = event.shiftKey === true;
  const alt = event.altKey === true;
  const entry = SHORTCUTS.find(({ code, shift: wantsShift, alt: wantsAlt }) => event.code === code && shift === wantsShift && alt === (wantsAlt === true));
  return entry?.command ?? null;
}
