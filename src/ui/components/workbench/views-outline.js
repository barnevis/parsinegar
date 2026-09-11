// Outline view: renders the document heading outline markup.
//
// Pure render function owned by this view module; the registry only references
// it and holds no view logic. Takes explicit data, never services or DOM.
import { escapeHtml } from './html.js';
import { parseOutline } from './outline.js';

/**
 * Nests flat headings under the nearest preceding shallower heading.
 * Skipped levels nest under the closest available parent.
 * @param {Array<object>} headings Flat `[{ level, text, line }]`.
 * @returns {Array<object>} Roots with nested `children`.
 */
export function buildOutlineTree(headings) {
  const roots = [];
  const stack = [];
  for (const heading of headings) {
    const node = { ...heading, children: [] };
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop();
    }
    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].children.push(node);
    }
    stack.push(node);
  }
  return roots;
}

/**
 * Renders heading nodes as a nested list.
 * @param {Array<object>} nodes Tree nodes.
 * @returns {string} Nested list markup.
 */
function renderNodes(nodes) {
  return nodes.map((node) => `
    <li part="outline-item">
      <button type="button" part="outline-jump" data-line="${node.line}">${escapeHtml(node.text)}</button>${node.children.length > 0 ? `<ul part="outline-list">${renderNodes(node.children)}</ul>` : ''}
    </li>`).join('');
}

/**
 * Renders the heading outline with navigation targets.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string} options.documentText Raw document text.
 * @returns {string} Outline markup.
 */
export function renderOutlineView({ t, documentText }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const headings = parseOutline(documentText);
  if (headings.length === 0) {
    return `<p part="outline-empty">${escapeHtml(translate('parsinegar.views.outline-empty'))}</p>`;
  }
  return `<ul part="outline-list">${renderNodes(buildOutlineTree(headings))}</ul>`;
}
