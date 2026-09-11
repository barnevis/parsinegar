// Pre-warms the kit stylesheet cache with the real home page styles.
//
// PeyElement gates the first render on the stylesheet load; in tests there is
// no HTTP server, so the cache is warmed with the actual file text through
// the kit's own test hook ({ preload: false, fetchFn }). Every test file that
// mounts the home page must import this module first.
import { readFile } from 'node:fs/promises';
import { getStyleText } from 'pey.webui/base/attach-style-sheet';

const HOME_CSS_URL = new URL('../pages/home/home.css', import.meta.url).href;

async function readHomeCss() {
  return readFile(new URL(HOME_CSS_URL), 'utf8');
}

await getStyleText(HOME_CSS_URL, {
  preload: false,
  fetchFn: async () => ({ ok: true, status: 200, text: readHomeCss }),
});

export { HOME_CSS_URL };
