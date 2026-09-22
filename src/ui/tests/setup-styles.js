// Pre-warms the kit stylesheet cache with the real page and component styles.
//
// PeyElement gates the first render on the stylesheet load; in tests there is
// no HTTP server, so the cache is warmed with the actual file text through
// the kit's own test hook ({ preload: false, fetchFn }). Every test file that
// mounts the home page or a workbench child element must import this module
// first.
import { readFile } from 'node:fs/promises';
import { getStyleText } from 'pey.webui/base/attach-style-sheet';

const STYLE_URLS = [
  new URL('../pages/home/home.css', import.meta.url).href,
  new URL('../components/menu-bar/menu-bar.css', import.meta.url).href,
  new URL('../components/activity-rail/activity-rail.css', import.meta.url).href,
  new URL('../components/side-panel/side-panel.css', import.meta.url).href,
  new URL('../components/status-bar/status-bar.css', import.meta.url).href,
  new URL('../components/modal-dialog/modal-dialog.css', import.meta.url).href,
];

for (const styleUrl of STYLE_URLS) {
  const content = await readFile(new URL(styleUrl), 'utf8');
  await getStyleText(styleUrl, {
    preload: false,
    fetchFn: async () => ({ ok: true, status: 200, text: async () => content }),
  });
}

export { STYLE_URLS };
