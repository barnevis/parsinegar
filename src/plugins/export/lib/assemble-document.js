// Assembles a standalone RTL HTML document from a sanitized fragment.
//
// Pure string building: the body fragment arrives already sanitized from the
// renderer and is embedded as-is (never re-escaped). Only the title — the
// single untrusted string here — is escaped. Themes are minimal inline CSS so
// the file opens correctly with no network.
const THEMES = ['light', 'dark', 'sepia'];

const THEME_CSS = {
  light: {
    bg: '#ffffff',
    fg: '#1a1a1a',
    muted: '#55555f',
    border: '#b9b9c4',
    wash: '#f1f1f4',
    accent: '#0f766e',
    mark: '#fef08a',
  },
  dark: {
    bg: '#11111b',
    fg: '#cdd6f4',
    muted: '#a6adc8',
    border: '#45475a',
    wash: '#1e1e2e',
    accent: '#5eead4',
    mark: '#713f12',
  },
  sepia: {
    bg: '#f4ecd8',
    fg: '#5b4636',
    muted: '#8a7360',
    border: '#d3c5a5',
    wash: '#ece0c8',
    accent: '#8a5a00',
    mark: '#fde68a',
  },
};

const ADMONITION_LABELS = {
  'parsneshan-warning': 'هشدار',
  'parsneshan-caution': 'احتیاط',
  'parsneshan-important': 'مهم',
  'parsneshan-tip': 'راهنما',
  'parsneshan-note': 'نکته',
};

/**
 * Escapes a string for HTML text and attribute contexts.
 * @param {string} value Raw string.
 * @returns {string} Escaped string.
 */
function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the inline stylesheet for a theme.
 * @param {string} theme One of light, dark, sepia.
 * @returns {string} CSS text.
 */
function themeCss(theme) {
  const c = THEME_CSS[theme];
  const admonitions = Object.entries(ADMONITION_LABELS)
    .map(
      ([kind, label]) =>
        `div.${kind}{border:1px solid ${c.border};border-inline-start:4px solid ${c.accent};border-radius:8px;padding:.75em 1em;margin:1em 0}` +
        `div.${kind}::before{content:'${label}';display:block;font-weight:700;color:${c.accent};margin-bottom:.5em}`,
    )
    .join('');
  return (
    `body{background:${c.bg};color:${c.fg};font-family:'Vazirmatn',Tahoma,sans-serif;` +
    `line-height:1.9;max-width:46rem;margin:2rem auto;padding:0 1rem}` +
    `h1,h2,h3,h4,h5,h6{line-height:1.6}` +
    `blockquote{border-inline-start:3px solid ${c.border};padding-inline-start:.75em;color:${c.muted};margin:1em 0}` +
    `pre{direction:ltr;text-align:left;background:${c.wash};border-radius:8px;padding:1em;overflow-x:auto}` +
    `code{font-family:ui-monospace,monospace;background:${c.wash};border-radius:4px;padding:0 .25em}` +
    `pre code{background:none;padding:0}` +
    `table{border-collapse:collapse;margin:1em 0}` +
    `th,td{border:1px solid ${c.border};padding:.4em .8em}` +
    `ul,ol{padding-inline-start:1.5em}` +
    `li:has(> input[type="checkbox"]){list-style:none}` +
    `.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}` +
    `mark{background:${c.mark};border-radius:2px;padding:0 .15em}` +
    `hr{border:none;border-top:2px solid ${c.border};margin:1.5em 0}` +
    `a{color:${c.accent}}` +
    `img{max-width:100%}` +
    `div.parsneshan-poem{text-align:center}` +
    `div.parsneshan-verse{margin:.5em 0}` +
    `span.parsneshan-hemistich{margin:0 1em}` +
    `section.footnotes{font-size:.9em;color:${c.muted}}` +
    admonitions
  );
}

/**
 * Assembles a full standalone document.
 * @param {object} input Assembly input.
 * @param {string} input.title Document title (escaped).
 * @param {string} input.bodyHtml Sanitized body fragment (embedded as-is).
 * @param {string} input.theme One of light, dark, sepia.
 * @returns {string} Complete HTML document.
 */
export function assembleDocument({ title, bodyHtml, theme }) {
  const palette = THEMES.includes(theme) ? theme : 'light';
  const safeTitle = escapeHtml(title);
  return (
    '<!DOCTYPE html>\n' +
    '<html lang="fa" dir="rtl">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    `<title>${safeTitle}</title>\n` +
    `<style>${themeCss(palette)}</style>\n` +
    '</head>\n' +
    '<body>\n' +
    `${bodyHtml}\n` +
    '</body>\n' +
    '</html>\n'
  );
}

/**
 * Lists the supported output themes.
 * @returns {Array<string>} Theme names.
 */
export function outputThemes() {
  return [...THEMES];
}
