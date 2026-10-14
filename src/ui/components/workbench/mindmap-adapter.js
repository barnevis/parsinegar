// Translates the neutral mindmap tree into MindElixir init data.
//
// This is the only module that knows the library's data shape: if the
// library ever changes (or is swapped), only this file changes. Node ids
// encode source lines (`m-<line>`) so map selection maps back to editor
// navigation without a lookup table.
function convertNode(node) {
  return {
    id: `m-${node.line}`,
    topic: node.text,
    children: node.children.map(convertNode),
  };
}

/**
 * Converts a neutral mindmap root into MindElixir init data.
 * @param {object|null} root Neutral root from `buildMindmapTree`.
 * @returns {object|null} `{ nodeData }` for `mind.init()`, or null.
 */
export function toMindElixirData(root) {
  if (!root) {
    return null;
  }
  return { nodeData: { ...convertNode(root), root: true } };
}

/**
 * Reads the source line back from a MindElixir node id.
 * @param {string} id Node id (`m-<line>`).
 * @returns {number|null} 1-based line number, or null for foreign ids.
 */
export function lineOfNodeId(id) {
  const match = typeof id === 'string' ? /^m-(\d+)$/.exec(id) : null;
  if (!match) {
    return null;
  }
  const line = Number(match[1]);
  return Number.isInteger(line) && line >= 1 ? line : null;
}
