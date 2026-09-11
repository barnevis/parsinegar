// Pure outline extraction for the document outline view.
//
// Parses ATX headings (`#` to `######`) from raw text: no DOM, no editor
// dependency. Line numbers are 1-based for editor navigation.

const HEADING_PATTERN = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;

/**
 * Extracts the heading outline of a Markdown document.
 * @param {string} text Raw document text.
 * @returns {Array<object>} `[{ level, text, line }]` in document order.
 */
export function parseOutline(text) {
  if (typeof text !== 'string' || text === '') {
    return [];
  }
  const items = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = HEADING_PATTERN.exec(lines[index]);
    if (match) {
      items.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  }
  return items;
}
