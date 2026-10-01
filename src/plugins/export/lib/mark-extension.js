// `==highlight==` syntax and HTML extensions for micromark (live in this
// plugin because neither CommonMark, GFM nor Parsneshan covers them).
//
// Pairing reuses micromark's attention machinery (adapted from
// `micromark-extension-gfm-strikethrough` for `=`), so `==see **this**==`
// still bolds inside the mark. Two deliberate divergences from the editor's
// plain regex (`HIGHLIGHT_PATTERN`): runs of three or more signs stay fully
// literal (the overlap guard, like GFM `~~~`), and delimiter-adjacent spaces
// follow the standard flanking rules — both limited to odd input.
import { classifyCharacter } from 'micromark-util-classify-character';
import { resolveAll } from 'micromark-util-resolve-all';

/**
 * Create a `==highlight==` syntax extension for micromark.
 * @returns {object} Extension for `extensions` (exactly-double markers only).
 */
export function highlight() {
  return {
    text: { 61: highlightTokenizer },
    insideSpan: { null: [highlightTokenizer] },
    attentionMarkers: { null: [61] },
  }
}

/**
 * Create the `<mark>` HTML extension for `==highlight==`.
 * @returns {object} Extension for `htmlExtensions`.
 */
export function highlightHtml() {
  return {
    enter: {
      highlight() {
        this.tag('<mark>')
      },
    },
    exit: {
      highlight() {
        this.tag('</mark>')
      },
    },
  }
}

const highlightTokenizer = {
  name: 'highlight',
  tokenize: tokenizeHighlight,
  resolveAll: resolveAllHighlight,
}

/**
 * Pair equal-size `==` sequences into highlight spans.
 * @param {Array} events Token events.
 * @param {object} context Tokenize context.
 * @returns {Array} Resolved events.
 */
function resolveAllHighlight(events, context) {
  let index = -1
  while (++index < events.length) {
    if (
      events[index][0] === 'enter' &&
      events[index][1].type === 'highlightSequenceTemporary' &&
      events[index][1]._close
    ) {
      let open = index
      while (open--) {
        if (
          events[open][0] === 'exit' &&
          events[open][1].type === 'highlightSequenceTemporary' &&
          events[open][1]._open &&
          events[index][1].end.offset - events[index][1].start.offset ===
            events[open][1].end.offset - events[open][1].start.offset
        ) {
          events[index][1].type = 'highlightSequence'
          events[open][1].type = 'highlightSequence'
          const highlight = {
            type: 'highlight',
            start: { ...events[open][1].start },
            end: { ...events[index][1].end },
          }
          const text = {
            type: 'highlightText',
            start: { ...events[open][1].end },
            end: { ...events[index][1].start },
          }
          const nextEvents = [
            ['enter', highlight, context],
            ['enter', events[open][1], context],
            ['exit', events[open][1], context],
            ['enter', text, context],
          ]
          const insideSpan = context.parser.constructs.insideSpan.null
          if (insideSpan) {
            nextEvents.push(
              ...resolveAll(insideSpan, events.slice(open + 1, index), context),
            )
          }
          nextEvents.push(
            ['exit', text, context],
            ['enter', events[index][1], context],
            ['exit', events[index][1], context],
            ['exit', highlight, context],
          )
          events.splice(open - 1, index - open + 3, ...nextEvents)
          index = open + nextEvents.length - 2
          break
        }
      }
    }
  }
  index = -1
  while (++index < events.length) {
    if (events[index][1].type === 'highlightSequenceTemporary') {
      events[index][1].type = 'data'
    }
  }
  return events
}

/**
 * Tokenize a potential `==` marker run (exactly two signs, like the editor).
 * @this {object} Micromark tokenize context (provides `previous`).
 * @param {object} effects Tokenizer effects.
 * @param {Function} ok Accept state.
 * @param {Function} nok Reject state.
 * @returns {Function} Start state.
 */
function tokenizeHighlight(effects, ok, nok) {
  const { previous } = this
  const events = this.events
  let size = 0
  return start

  /** @param {number} code Current character code. */
  function start(code) {
    if (previous === 61 && events[events.length - 1][1].type !== 'characterEscape') {
      return nok(code)
    }
    effects.enter('highlightSequenceTemporary')
    return more(code)
  }

  /** @param {number} code Current character code. */
  function more(code) {
    const before = classifyCharacter(previous)
    if (code === 61) {
      // A third sign belongs to a longer run: reject, the next position retries.
      if (size > 1) return nok(code)
      effects.consume(code)
      size += 1
      return more
    }
    // Single `=` is literal text here.
    if (size < 2) return nok(code)
    const token = effects.exit('highlightSequenceTemporary')
    const after = classifyCharacter(code)
    token._open = !after || (after === 2 && Boolean(before))
    token._close = !before || (before === 2 && Boolean(after))
    return ok(code)
  }
}
