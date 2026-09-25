// Copy buttons for fenced code blocks in the Persian Markdown editor.
//
// Every fenced block (any info string, or none) gets a block widget above
// its opening fence with an icon button copying the block content without
// the delimiters. Clicking reports success briefly (check icon); failures
// stay silent in the UI and loud in the console, like the other editor
// handlers. No services, no events — view-local decorations only.
import { EditorView } from 'codemirror';
import { Decoration, ViewPlugin, WidgetType } from '@codemirror/view';
import { FENCE_PATTERN } from './live-preview.js';
import { iconMarkup } from '../workbench/html.js';

const COPIED_TIMEOUT_MS = 1500;

/**
 * Copies text to the clipboard, falling back to a temporary textarea where
 * the async API is unavailable or rejects.
 * @param {string} text Text to copy.
 * @returns {Promise<boolean>} True when the text is on the clipboard.
 */
export async function copyText(text) {
  try {
    if (typeof globalThis.navigator?.clipboard?.writeText === 'function') {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    try {
      area.select();
      if (typeof document.execCommand === 'function' && document.execCommand('copy')) {
        return true;
      }
    } finally {
      area.remove();
    }
  } catch {
    // No clipboard available at all.
  }
  return false;
}

/**
 * Collects fenced code blocks in visible ranges: opening fence line plus
 * the content range between the delimiters (empty blocks skipped).
 * @param {object} view Active editor view.
 * @returns {Array<object>} `{ openFrom, from, to }` block ranges.
 */
export function collectCodeBlocks(view) {
  const blocks = [];
  let inFence = false;
  let fenceCheckedUntil = 1;
  let openLineFrom = 0;
  let contentFrom = 0;
  const trackFence = (number) => {
    if (!FENCE_PATTERN.test(view.state.doc.line(number).text)) {
      return;
    }
    if (inFence) {
      inFence = false;
    } else {
      inFence = true;
      const opener = view.state.doc.line(number);
      openLineFrom = opener.from;
      contentFrom = opener.to + 1;
    }
  };
  for (const { from, to } of view.visibleRanges) {
    const firstLine = view.state.doc.lineAt(from).number;
    for (let number = fenceCheckedUntil; number < firstLine; number += 1) {
      trackFence(number);
    }
    fenceCheckedUntil = Math.max(fenceCheckedUntil, firstLine);
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (FENCE_PATTERN.test(line.text)) {
        const wasOpen = inFence;
        trackFence(line.number);
        if (wasOpen && contentFrom < line.from) {
          blocks.push({ openFrom: openLineFrom, from: contentFrom, to: line.from });
        }
      }
      pos = line.to + 1;
    }
  }
  if (inFence) {
    const end = view.state.doc.length;
    if (contentFrom < end) {
      blocks.push({ openFrom: openLineFrom, from: contentFrom, to: end });
    }
  }
  return blocks;
}

/**
 * Copy button rendered above a fenced block. Carries the content range so
 * the click handler needs no DOM measurement.
 */
class CopyButtonWidget extends WidgetType {
  constructor({ copied, from, to, copyIcon, checkIcon, copyLabel, copiedLabel }) {
    super();
    this.copied = copied;
    this.from = from;
    this.to = to;
    this.copyIcon = copyIcon;
    this.checkIcon = checkIcon;
    this.copyLabel = copyLabel;
    this.copiedLabel = copiedLabel;
  }

  eq(other) {
    return other instanceof CopyButtonWidget
      && other.copied === this.copied
      && other.from === this.from
      && other.to === this.to;
  }

  toDOM() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'parsi-code-copy';
    button.setAttribute('aria-label', this.copied ? this.copiedLabel : this.copyLabel);
    button.dataset.copyFrom = String(this.from);
    button.dataset.copyTo = String(this.to);
    button.innerHTML = this.copied ? this.checkIcon : this.copyIcon;
    return button;
  }

  ignoreEvent() {
    return false;
  }
}

const copyTheme = EditorView.theme({
  '& .parsi-code-copy-row': { textAlign: 'end' },
  '& .parsi-code-copy': {
    font: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    inlineSize: '2rem',
    blockSize: '2rem',
    border: '1px solid var(--pey-color-border, #d8d8de)',
    borderRadius: '8px',
    backgroundColor: 'var(--pey-color-canvas, #ffffff)',
    padding: '0.3rem',
    cursor: 'pointer',
    color: 'inherit',
  },
  '& .parsi-code-copy svg': { inlineSize: '18px', blockSize: '18px' },
  '& .parsi-code-copy:hover': { borderColor: 'var(--pey-color-border, #c8c8d2)' },
  '& .parsi-code-copy:focus-visible': {
    outline: '2px solid var(--pey-color-focus-ring, #5eead4)',
    outlineOffset: '2px',
  },
});

/**
 * Builds copy-button widgets for visible fenced blocks.
 * @param {object} view Active editor view.
 * @param {object} options Widget options.
 * @returns {object} Decoration set.
 */
function buildCopyDecorations(view, options) {
  const builder = [];
  for (const block of collectCodeBlocks(view)) {
    builder.push(Decoration.widget({
      widget: new CopyButtonWidget({
        copied: options.copiedKey !== null && options.copiedKey === block.from,
        from: block.from,
        to: block.to,
        copyIcon: options.copyIcon,
        checkIcon: options.checkIcon,
        copyLabel: options.copyLabel,
        copiedLabel: options.copiedLabel,
      }),
      side: -1,
    }).range(block.openFrom));
  }
  return Decoration.set(builder);
}

/**
 * Returns the copy-button extensions for fenced code blocks.
 * @param {object} [options] Widget options.
 * @param {Function} [options.t] Translation function (falls back to identity).
 * @param {string|null} [options.assetBaseUrl] Resolved asset directory URL.
 * @returns {Array} CodeMirror extensions.
 */
export function codeCopyExtensions({ t = (key) => key, assetBaseUrl = null } = {}) {
  const copyIcon = iconMarkup(assetBaseUrl, 'content-copy') || t('parsinegar.code.copy');
  const checkIcon = iconMarkup(assetBaseUrl, 'check') || '✓';
  const copyLabel = t('parsinegar.code.copy');
  const copiedLabel = t('parsinegar.code.copied');
  let copiedKey = null;
  let copiedTimer = null;
  let destroyed = false;
  let builtKey = null;
  const rebuild = (view) => {
    builtKey = copiedKey;
    return buildCopyDecorations(view, {
      copiedKey, copyIcon, checkIcon, copyLabel, copiedLabel,
    });
  };
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.decorations = rebuild(view);
      }

      update(update) {
        if (update.docChanged || update.viewportChanged || copiedKey !== builtKey) {
          if (update.docChanged) {
            copiedKey = null;
          }
          this.decorations = rebuild(update.view);
        }
      }

      destroy() {
        destroyed = true;
        if (copiedTimer !== null) {
          clearTimeout(copiedTimer);
          copiedTimer = null;
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
  const clickHandler = EditorView.domEventHandlers({
    mousedown(event, view) {
      const button = event.target?.closest?.('.parsi-code-copy');
      if (!button) {
        return false;
      }
      event.preventDefault();
      const from = Number(button.dataset?.copyFrom);
      const to = Number(button.dataset?.copyTo);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) {
        return true;
      }
      const pluginView = view;
      copyText(view.state.sliceDoc(from, to)).then((ok) => {
        if (!ok || destroyed) {
          if (!ok) {
            console.error('[parsi-code-copy] clipboard copy failed');
          }
          return;
        }
        copiedKey = from;
        if (copiedTimer !== null) {
          clearTimeout(copiedTimer);
        }
        copiedTimer = setTimeout(() => {
          copiedKey = null;
          copiedTimer = null;
          if (!destroyed) {
            pluginView.dispatch({});
          }
        }, COPIED_TIMEOUT_MS);
        pluginView.dispatch({});
      });
      return true;
    },
  });
  return [plugin, copyTheme, clickHandler];
}
