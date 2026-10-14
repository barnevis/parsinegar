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

/**
 * Converts a library node (sub)tree into plain records, keeping ids as
 * opaque data for the caller to pair with placed lines.
 * @param {Array<object>} objs Library node objects.
 * @returns {Array<object>} `[{ id, topic, children }]`.
 */
export function plainSubtrees(objs) {
  if (!Array.isArray(objs)) {
    return [];
  }
  return objs
    .filter((node) => node && typeof node === 'object')
    .map((node) => ({
      id: typeof node.id === 'string' ? node.id : null,
      topic: typeof node.topic === 'string' ? node.topic : '',
      children: plainSubtrees(node.children),
    }));
}

/**
 * Resolves a fresh sibling's reference: the id to anchor to and how.
 * @param {object} parentNode Parent library node (with `children`).
 * @param {string} newId Id of the inserted node.
 * @param {string} type `'before'` or `'after'`.
 * @returns {object|null} `{ refId, position }` with position `'before'`,
 *   `'after'` or `'first'` (insert as first child), or null.
 */
export function siblingReference(parentNode, newId, type) {
  const kids = parentNode && Array.isArray(parentNode.children) ? parentNode.children : null;
  if (!kids || typeof newId !== 'string') {
    return null;
  }
  const index = kids.findIndex((kid) => kid && kid.id === newId);
  if (index < 0) {
    return null;
  }
  if (type === 'before') {
    const next = kids[index + 1];
    return next && typeof next.id === 'string' ? { refId: next.id, position: 'before' } : null;
  }
  const prev = kids[index - 1];
  if (prev && typeof prev.id === 'string') {
    return { refId: prev.id, position: 'after' };
  }
  return typeof parentNode.id === 'string' ? { refId: parentNode.id, position: 'first' } : null;
}

/**
 * Describes a library `operation` bus event for text translation. Shapes
 * stay raw (ids unresolved): the caller maps ids to lines against current
 * text plus its pending fresh-id table.
 * @param {object} event Bus event `{ name, obj?, objs?, toObj?, type? }`.
 * @returns {object|null} Described op, `{ kind: 'ignore' }` for transient
 *   ones, or null for unknown names.
 */
export function describeOperation(event) {
  if (!event || typeof event !== 'object' || typeof event.name !== 'string') {
    return null;
  }
  switch (event.name) {
    case 'beginEdit':
      return { kind: 'ignore' };
    case 'finishEdit': {
      if (!event.obj || typeof event.obj !== 'object') {
        return null;
      }
      return { kind: 'rename', id: event.obj.id ?? null, topic: event.obj.topic ?? '' };
    }
    case 'addChild': {
      if (!event.obj || typeof event.obj !== 'object') {
        return null;
      }
      return {
        kind: 'add',
        parentId: event.obj.parent?.id ?? null,
        newId: typeof event.obj.id === 'string' ? event.obj.id : null,
        topic: event.obj.topic ?? '',
      };
    }
    case 'insertSibling': {
      if (!event.obj || typeof event.obj !== 'object') {
        return null;
      }
      const ref = siblingReference(event.obj.parent, event.obj.id, event.type);
      if (!ref) {
        return null;
      }
      return {
        kind: 'sibling',
        refId: ref.refId,
        position: ref.position,
        newId: typeof event.obj.id === 'string' ? event.obj.id : null,
        topic: event.obj.topic ?? '',
      };
    }
    case 'insertParent': {
      if (!event.obj || typeof event.obj !== 'object') {
        return null;
      }
      const wrapped = Array.isArray(event.obj.children) ? event.obj.children[0] : null;
      return {
        kind: 'parent',
        wrappedId: wrapped && typeof wrapped === 'object' ? wrapped.id ?? null : null,
        newId: typeof event.obj.id === 'string' ? event.obj.id : null,
        topic: event.obj.topic ?? '',
      };
    }
    case 'removeNodes': {
      if (!Array.isArray(event.objs)) {
        return null;
      }
      return { kind: 'remove', ids: event.objs.map((node) => (node && typeof node === 'object' ? node.id ?? null : null)) };
    }
    case 'moveNodeIn':
    case 'moveNodeBefore':
    case 'moveNodeAfter': {
      if (!Array.isArray(event.objs) || event.objs.length !== 1) {
        return null;
      }
      return {
        kind: 'move',
        fromId: event.objs[0] && typeof event.objs[0] === 'object' ? event.objs[0].id ?? null : null,
        toId: event.toObj && typeof event.toObj === 'object' ? event.toObj.id ?? null : null,
        position: event.name === 'moveNodeIn' ? 'inside' : event.name === 'moveNodeBefore' ? 'before' : 'after',
      };
    }
    case 'copyNodes': {
      return { kind: 'paste', nodes: plainSubtrees(event.objs) };
    }
    default:
      return null;
  }
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
