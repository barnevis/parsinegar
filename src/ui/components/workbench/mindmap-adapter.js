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

const FALLBACK_NODE_GAP = 30;

/**
 * Reads the library's node-gap step for branch insets, mirroring how its
 * own generator reads it off the container.
 * @param {object} self MindElixir instance (`this` at the call site).
 * @returns {number} Gap in pixels, falling back to the default theme value.
 */
export function nodeGapOf(self) {
  try {
    const raw = parseInt(self?.container?.style?.getPropertyValue('--node-gap-x'), 10);
    if (Number.isInteger(raw) && raw > 0) {
      return raw;
    }
  } catch {
    // Unmeasurable containers keep the default theme step.
  }
  return FALLBACK_NODE_GAP;
}

/**
 * Builds a sub-branch link path with geometrically mirrored control
 * points: the bulge always leans toward the child side. This is the
 * library generator's formula with one correction — the side comes from
 * actual box positions, not the passed `direction` flag, which mislabels
 * sub-links in right-growing layouts (their curve then humps behind the
 * parent instead of toward the child).
 * @param {object} args Link geometry `{ pT, pL, pW, pH, cT, cL, cW, cH, isFirst }`
 *   (parent/child top, left, width, height in the same space).
 * @param {number} gap Node-gap step in pixels.
 * @returns {string} SVG path data.
 */
export function subBranchPath({ pT, pL, pW, pH, cT, cL, cW, cH, isFirst }, gap) {
  const h = gap;
  const d = isFirst ? pT + pH / 2 : pT + pH;
  const p = cT + cH;
  const g = (Math.abs(d - p) / 300) * h;
  if (cL + cW / 2 < pL + pW / 2) {
    const y = pL;
    const m = y + h;
    const x = y - h;
    const u = cL + h;
    return `M ${m} ${d} C ${y} ${d} ${y + g} ${p} ${x} ${p} H ${u}`;
  }
  const y = pL + pW;
  const m = y - h;
  const x = y + h;
  const u = cL + cW - h;
  return `M ${m} ${d} C ${y} ${d} ${y - g} ${p} ${x} ${p} H ${u}`;
}

/**
 * Sub-branch generator for the MindElixir constructor option: same shape
 * as `subBranchPath`, reading the gap step off the calling instance.
 * @param {object} args Link geometry (see `subBranchPath`).
 * @returns {string} SVG path data.
 */
export function generateSubBranch(args) {
  return subBranchPath(args, nodeGapOf(this));
}
