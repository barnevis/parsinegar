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
 * Renders heading nodes as a nested list. Nodes with children carry a
 * toggle button; leaves carry an equally-sized spacer so titles align in
 * one column. Collapsed nodes omit their children.
 * @param {Array<object>} nodes Tree nodes.
 * @param {number|null} activeLine Highlighted heading line, if any.
 * @param {Function} translate Translation function.
 * @param {Set<number>} collapsed Collapsed heading lines.
 * @returns {string} Nested list markup.
 */
function renderNodes(nodes, activeLine, translate, collapsed) {
  return nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = hasChildren && collapsed.has(node.line);
    const gutter = hasChildren
      ? `<button type="button" part="outline-toggle" data-outline-toggle="${node.line}" aria-expanded="${!isCollapsed}" aria-label="${escapeHtml(translate(isCollapsed ? 'parsinegar.views.outline-expand' : 'parsinegar.views.outline-collapse'))}"><span part="outline-chevron" aria-hidden="true"></span></button>`
      : `<span part="outline-spacer" aria-hidden="true"></span>`;
    return `
    <li part="outline-item">
      ${gutter}<button type="button" part="outline-jump" data-line="${node.line}"${node.line === activeLine ? ' aria-current="true"' : ''}>${escapeHtml(node.text)}</button>${hasChildren && !isCollapsed ? `<ul part="outline-list">${renderNodes(node.children, activeLine, translate, collapsed)}</ul>` : ''}
    </li>`;
  }).join('');
}

/**
 * Renders the heading outline with navigation targets.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @param {string} options.documentText Raw document text.
 * @param {number|null} [options.activeLine] Heading line to highlight.
 * @param {Array<number>} [options.collapsed] Collapsed heading lines.
 * @returns {string} Outline markup.
 */
export function renderOutlineView({ t, documentText, activeLine, collapsed }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  const headings = parseOutline(documentText);
  if (headings.length === 0) {
    return `<p part="outline-empty">${escapeHtml(translate('parsinegar.views.outline-empty'))}</p>`;
  }
  const current = Number.isInteger(activeLine) ? activeLine : null;
  const folded = new Set(Array.isArray(collapsed) ? collapsed.filter((line) => Number.isInteger(line)) : []);
  return `<ul part="outline-list">${renderNodes(buildOutlineTree(headings), current, translate, folded)}</ul>`;
}
