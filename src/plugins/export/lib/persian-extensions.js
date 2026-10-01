// Persian Markdown extensions for export (Parsneshan, third-party).
//
// Only staging: these factories build fresh micromark extensions per render
// call, passed through to `pey.markdown.service`. Nothing here renders or
// sanitizes by itself. Footnote UI strings come from the same package so the
// generic core never learns Persian.
import {
  caution,
  cautionHtml,
  important,
  importantHtml,
  note,
  noteHtml,
  persianFootnoteOptions,
  persianListExtension,
  persianListHtml,
  persianPoem,
  persianPoemHtml,
  tip,
  tipHtml,
  warning,
  warningHtml,
} from 'parsneshan';

/**
 * Builds fresh Persian syntax extensions (admonitions, Persian lists, poem).
 * @returns {Array} Micromark syntax extensions.
 */
export function persianSyntaxExtensions() {
  return [
    warning(),
    caution(),
    important(),
    tip(),
    note(),
    persianListExtension(),
    persianPoem(),
  ];
}

/**
 * Builds fresh Persian HTML extensions matching the syntax ones.
 * @returns {Array} Micromark HTML extensions.
 */
export function persianHtmlExtensions() {
  return [
    warningHtml(),
    cautionHtml(),
    importantHtml(),
    tipHtml(),
    noteHtml(),
    persianListHtml(),
    persianPoemHtml(),
  ];
}

/**
 * Persian footnote UI strings for GFM footnotes (`label`, `backLabel`).
 * Shared constant from Parsneshan (stateless); passed straight through.
 * @returns {object} Footnote rendering options.
 */
export function persianFootnoteOptionsForRender() {
  return persianFootnoteOptions;
}
