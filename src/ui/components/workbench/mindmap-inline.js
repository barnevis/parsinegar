// Inline-markdown rendering for mindmap node labels.
//
// MindElixir renders labels as HTML when given a `markdown` callback, so
// this module turns one stripped item line into safe HTML: the same
// `markdownLanguage` parser the editor uses is the authority (parser
// parity, decisions §49 — the extended parser carries GFM, so
// strikethrough is part of the parity set), and the serializer escapes
// every character that is not part of a recognized span — raw HTML,
// entities and exotic nodes stay literal, links only open
// http(s)/mailto/relative targets.
import { markdownLanguage } from '@codemirror/lang-markdown';

const TAG_BY_NAME = new Map([
  ['StrongEmphasis', 'strong'],
  ['Emphasis', 'em'],
  ['Strikethrough', 'del'],
  ['InlineCode', 'code'],
]);

const MAX_INLINE_DEPTH = 6;

/**
 * Escapes a text fragment for safe interpolation into HTML.
 * @param {string} value Source fragment.
 * @returns {string} Escaped fragment.
 */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Normalizes a link target and refuses dangerous schemes.
 * @param {string} rawUrl URL token source (optionally `<…>`-wrapped).
 * @returns {string|null} Safe href, or null for disallowed targets.
 */
function safeHref(rawUrl) {
  const url = rawUrl.trim().replace(/^<(.*)>$/s, '$1').trim();
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(url);
  if (scheme && !/^(?:https?|mailto):/i.test(url)) {
    return null;
  }
  return url;
}

/**
 * Renders the label slice of a link or image: everything between the
 * opening mark and the mark closing the label.
 * @param {object} node Link/Autolink/Image syntax node.
 * @param {string} source Slice the node came from.
 * @param {number} depth Current recursion depth.
 * @returns {string} Label HTML.
 */
function renderLinkLabel(node, source, depth) {
  let closing = node.firstChild.nextSibling;
  while (closing && !(closing.name === 'LinkMark' && source[closing.from] === ']')) {
    closing = closing.nextSibling;
  }
  const start = node.firstChild.to;
  const end = closing ? closing.from : node.to;
  return renderSlice(source.slice(start, end), depth + 1);
}

/**
 * Renders one marked span (the tree carries only marks, plain text lives
 * in the gaps between children).
 * @param {object} node Inline syntax node.
 * @param {string} source Slice the node came from.
 * @param {number} depth Current recursion depth.
 * @returns {string} HTML for the span.
 */
function renderSpan(node, source, depth) {
  const slice = source.slice(node.from, node.to);
  if (node.name === 'Link' || node.name === 'Autolink') {
    const urlNode = node.getChild('URL');
    const href = urlNode ? safeHref(source.slice(urlNode.from, urlNode.to)) : null;
    const label = node.name === 'Autolink' && href !== null
      ? escapeHtml(href)
      : renderLinkLabel(node, source, depth);
    if (href === null) {
      return label;
    }
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a>`;
  }
  if (node.name === 'Image') {
    return renderLinkLabel(node, source, depth);
  }
  if (node.name === 'Escape') {
    return escapeHtml(slice.slice(1));
  }
  const tag = TAG_BY_NAME.get(node.name);
  if (!tag) {
    return escapeHtml(slice);
  }
  const inner = node.firstChild && node.lastChild !== node.firstChild
    ? source.slice(node.firstChild.to, node.lastChild.from)
    : '';
  return `<${tag}>${renderSlice(inner, depth + 1)}</${tag}>`;
}

/**
 * Renders one block child of the parsed slice: paragraphs walk their
 * marked spans, anything else stays literal.
 * @param {object} node Block syntax node.
 * @param {string} source Slice the node came from.
 * @param {number} depth Current recursion depth.
 * @returns {string} HTML for the block.
 */
function renderBlock(node, source, depth) {
  if (node.name !== 'Paragraph') {
    return escapeHtml(source.slice(node.from, node.to));
  }
  let out = '';
  let pos = node.from;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.from > pos) {
      out += escapeHtml(source.slice(pos, child.from));
    }
    out += renderSpan(child, source, depth);
    pos = child.to;
  }
  if (pos < node.to) {
    out += escapeHtml(source.slice(pos, node.to));
  }
  return out;
}

/**
 * Renders an inline slice by re-parsing it standalone; the slice is always
 * strictly smaller than its parent, so recursion terminates.
 * @param {string} slice Source slice to render.
 * @param {number} depth Current recursion depth.
 * @returns {string} HTML for the slice.
 */
function renderSlice(slice, depth) {
  if (depth > MAX_INLINE_DEPTH || typeof slice !== 'string' || slice === '') {
    return typeof slice === 'string' ? escapeHtml(slice) : '';
  }
  const top = markdownLanguage.parser.parse(slice).topNode;
  let out = '';
  for (let block = top.firstChild; block; block = block.nextSibling) {
    out += renderBlock(block, slice, depth);
  }
  return out;
}

/**
 * Renders one mindmap label's inline Markdown as safe HTML.
 * @param {string} raw Item text (marker and task box already stripped).
 * @param {object} [_nodeObj] MindElixir node object, ignored.
 * @returns {string} Sanitized-by-construction HTML string.
 */
export function renderInlineHtml(raw, _nodeObj) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return '';
  }
  return renderSlice(raw, 0);
}
