// Renders remote Markdown images as inline pictures (live preview).
//
// Collects `Image` syntax nodes with http(s) sources and replaces the whole
// `![alt](src)` span with an <img> widget — except where the cursor or a
// selection touches the span, which keeps the editable source visible (the
// same reveal contract links already have). Relative paths, data: URLs and
// reference-style images keep the current alt-text rendering: documents live
// in IndexedDB with no folder to resolve against. Broken images fall back to
// their alt text. An image nested in a link keeps the outer target: the
// picture is wrapped in an anchor that follows the href in a new tab.
import { syntaxTree } from '@codemirror/language';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';

const REMOTE_PATTERN = /^https?:\/\//i;
const IMAGE_OPEN_LENGTH = 2; // `![`

/**
 * Inline picture widget for one collected image.
 */
class ImageWidget extends WidgetType {
  constructor(image) {
    super();
    this.image = image;
  }

  eq(other) {
    return other instanceof ImageWidget
      && other.image.alt === this.image.alt
      && other.image.src === this.image.src
      && other.image.href === this.image.href;
  }

  /**
   * Builds the picture node: an <img>, wrapped in an anchor when the
   * Markdown image sits inside a link. A failed load swaps the picture for
   * its alt text in place.
   * @returns {HTMLElement} Picture or linked picture node.
   */
  toDOM() {
    const { alt, src, href } = this.image;
    const fallback = document.createElement('span');
    fallback.className = 'parsi-image-fallback';
    fallback.textContent = alt;
    const picture = document.createElement('img');
    picture.className = 'parsi-image';
    picture.src = src;
    picture.alt = alt;
    picture.addEventListener('error', () => {
      picture.replaceWith(fallback);
    }, { once: true });
    if (typeof href !== 'string' || href.length === 0) {
      return picture;
    }
    const link = document.createElement('a');
    link.className = 'parsi-image-link';
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener';
    link.append(picture);
    return link;
  }
}

/**
 * Checks whether any selection range touches `from`..`to` (boundaries
 * inclusive). A touched image keeps its editable source instead of the
 * picture, mirroring the link reveal behavior.
 * @param {object} selection Editor selection state.
 * @param {number} from Span start.
 * @param {number} to Span end.
 * @returns {boolean} True when a range touches the span.
 */
function selectionTouches(selection, from, to) {
  return selection.ranges.some((range) => range.from <= to && range.to >= from);
}

/**
 * Reads the alt text, source and optional outer link target of an Image
 * node. `enter` hands a cursor, so children are read through its stable
 * node. Alt is the raw slice between `![` and `]` (plain alt text owns no
 * syntax node of its own); src is the `URL` child.
 * @param {object} doc Document text accessor (`sliceString`).
 * @param {object} entered Entered cursor positioned on the Image node.
 * @param {Array} links Collected `{ from, to, href }` link ranges.
 * @returns {object|null} `{ from, to, alt, src, href }`, or null when the
 *   source is not a remote http(s) URL.
 */
function readImage(doc, entered, links) {
  const node = entered.node;
  let close = -1;
  let src = '';
  let child = node.firstChild;
  while (child) {
    if (child.name === 'LinkMark' && close < 0 && doc.sliceString(child.from, child.to) === ']') {
      close = child.from;
    }
    if (child.name === 'URL' && src === '') {
      src = doc.sliceString(child.from, child.to);
    }
    child = child.nextSibling;
  }
  if (close < 0 || !REMOTE_PATTERN.test(src)) {
    return null;
  }
  const enclosing = links.find((link) => link.from <= node.from && node.to <= link.to);
  return {
    from: node.from,
    to: node.to,
    alt: doc.sliceString(node.from + IMAGE_OPEN_LENGTH, close),
    src,
    href: enclosing ? enclosing.href : '',
  };
}

/**
 * Collects `{ from, to, href }` ranges of Link nodes with their last URL
 * child (the href follows the link text, so the last URL wins).
 * @param {object} tree Lezer syntax tree.
 * @param {number} from Visible range start.
 * @param {number} to Visible range end.
 * @returns {Array} Link ranges with href text.
 */
function collectLinks(tree, doc, from, to) {
  const links = [];
  tree.iterate({
    from,
    to,
    enter(entered) {
      if (entered.name !== 'Link') {
        return;
      }
      let href = '';
      let child = entered.node.firstChild;
      while (child) {
        if (child.name === 'URL') {
          href = doc.sliceString(child.from, child.to);
        }
        child = child.nextSibling;
      }
      links.push({ from: entered.from, to: entered.to, href });
    },
  });
  return links;
}

/**
 * Collects renderable images in one range: remote http(s) sources untouched
 * by the selection.
 * @param {object} state Editor state.
 * @param {number} from Range start.
 * @param {number} to Range end.
 * @returns {Array} `{ from, to, alt, src, href }` images, ascending.
 */
export function collectImagesFrom(state, from, to) {
  const tree = syntaxTree(state);
  const links = collectLinks(tree, state.doc, from, to);
  const images = [];
  tree.iterate({
    from,
    to,
    enter(node) {
      if (node.name !== 'Image') {
        return;
      }
      if (selectionTouches(state.selection, node.from, node.to)) {
        return;
      }
      const image = readImage(state.doc, node, links);
      if (image) {
        images.push(image);
      }
    },
  });
  images.sort((a, b) => a.from - b.from || a.to - b.to);
  return images;
}

/**
 * Collects renderable images in the visible ranges.
 * @param {object} view Active editor view.
 * @returns {Array} `{ from, to, alt, src, href }` images, ascending.
 */
export function collectImages(view) {
  const images = [];
  for (const { from, to } of view.visibleRanges) {
    images.push(...collectImagesFrom(view.state, from, to));
  }
  images.sort((a, b) => a.from - b.from || a.to - b.to);
  return images;
}

/**
 * Builds picture decorations for the visible ranges.
 * @param {object} view Active editor view.
 * @returns {object} Decoration set.
 */
function buildImageDecorations(view) {
  const builder = [];
  for (const image of collectImages(view)) {
    builder.push(Decoration.replace({ widget: new ImageWidget(image) }).range(image.from, image.to));
  }
  return Decoration.set(builder);
}

const imageDecorationPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildImageDecorations(view);
    }

    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildImageDecorations(update.view);
      }
    }
  },
  { decorations: (value) => value.decorations },
);

const imageTheme = EditorView.theme({
  '& .parsi-image': {
    maxWidth: '100%',
    maxHeight: '16rem',
    borderRadius: '6px',
    verticalAlign: 'middle',
  },
  '& .parsi-image-fallback': {
    display: 'inline-block',
    border: '1px dashed var(--pey-color-border, #e2e2e8)',
    borderRadius: '6px',
    padding: '0.1rem 0.4rem',
    color: 'var(--pey-color-text-muted, #6b6b78)',
  },
});

/**
 * Returns the live-image extensions for the editor.
 * @returns {Array} View plugin plus theme.
 */
export function imageViewExtensions() {
  return [imageDecorationPlugin, imageTheme];
}
