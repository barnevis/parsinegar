// About view: product card with the themed logotype and links out.
//
// Pure render function owned by this view module; the registry only
// references it. Links leave to GitHub in a new tab and never touch
// services; the logo inherits the theme text color, so it reads on
// every theme without a per-theme asset.
import { escapeHtml } from './html.js';
import { logoMarkup } from './logo.js';

const GITHUB_URL = 'https://github.com/barnevis/parsinegar';
const CHANGELOG_URL = 'https://github.com/barnevis/parsinegar/blob/main/CHANGELOG.md';

/**
 * Renders the about card.
 * @param {object} options Render options.
 * @param {Function} options.t Translation function.
 * @returns {string} About view markup.
 */
export function renderAboutView({ t }) {
  const translate = typeof t === 'function' ? t : (key) => key;
  return `
    <div part="settings-view">
      <div part="about-hero" aria-hidden="true">${logoMarkup()}</div>
      <h2 part="about-title">${escapeHtml(translate('parsinegar.app.title'))}</h2>
      <p part="settings-note">${escapeHtml(translate('parsinegar.about.tagline'))}</p>
      <p part="settings-note">${escapeHtml(translate('parsinegar.about.body'))}</p>
      <p part="settings-note">${escapeHtml(translate('parsinegar.about.version'))}</p>
      <div part="settings-actions">
        <a part="settings-button" data-primary href="${GITHUB_URL}" target="_blank" rel="noopener">${escapeHtml(translate('parsinegar.menu.github'))}</a>
        <a part="settings-button" href="${CHANGELOG_URL}" target="_blank" rel="noopener">${escapeHtml(translate('parsinegar.about.changelog'))}</a>
      </div>
    </div>`;
}
