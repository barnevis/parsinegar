// Deploy assembly: bundles the native-ESM site for GitHub Pages.
// Development stays unbundled (importmap + raw modules). Production serves
// minified single-file bundles per bootstrap unit and per importmap target so
// the ESM waterfall of hundreds of raw files collapses to a few chunks;
// runtime-computed dynamic imports (module-loader entries, code-highlight
// languages) still resolve through the unchanged importmap/unit paths laid
// under dist/.

import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL('.', import.meta.url).pathname);
const dist = path.join(root, 'dist');

const appEntry = 'src/app/main.js';

// Bundling moves module code into chunks whose directory differs from the
// original files; the components resolve stylesheets relative to
// import.meta.url, so each generated .js carries its sources' css files next
// to it (sourcemap sources → original css dirs). No css uses url() refs, so
// the copies stay valid wherever they land.
async function reparentStylesheets() {
  const { readdir, readFile } = await import('node:fs/promises');
  let copied = 0;
  const pending = [dist];
  while (pending.length > 0) {
    const dir = pending.pop();
    const dirents = await readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      if (dirent.isDirectory()) {
        pending.push(path.join(dir, dirent.name));
        continue;
      }
      if (!dirent.name.endsWith('.js.map')) {
        continue;
      }
      const mapFile = path.join(dir, dirent.name);
      const sourcemap = JSON.parse(await readFile(mapFile, 'utf8'));
      const sourceDirs = new Set();
      for (const source of sourcemap.sources ?? []) {
        const resolved = path.resolve(dir, source);
        if (resolved.startsWith(path.join(root, 'src'))) {
          sourceDirs.add(path.dirname(resolved));
        }
      }
      for (const sourceDir of sourceDirs) {
        for (const sibling of await readdir(sourceDir)) {
          if (sibling.endsWith('.css')) {
            await cp(path.join(sourceDir, sibling), path.join(dir, sibling));
            copied += 1;
          }
        }
      }
    }
  }
  console.info('[build] stylesheet copies:', copied);
}

/** Collects raw ./<dir> module unit refs PeyCore loads at runtime. */
function unitRefs(node) {
  const refs = new Set();
  for (const value of Object.values(node ?? {})) {
    if (value === null || typeof value !== 'object') {
      continue;
    }
    if (typeof value.path === 'string' && value.path.startsWith('./')) {
      refs.add(value.path);
    }
    for (const nested of unitRefs(value)) {
      refs.add(nested);
    }
  }
  return [...refs];
}

/** Importmap targets, so every bare-specifier resolution hits a bundle. */
async function importMapEntries() {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const match = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('importmap not found in index.html');
  }
  return Object.values(JSON.parse(match[1]).imports)
    .filter((target) => target.startsWith('./'))
    .map((target) => target.slice(2));
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const config = JSON.parse(await readFile(path.join(root, 'bootstrap.json'), 'utf8'));
// The page entry is not a bootstrap ref; index.html loads it directly.
const unitEntries = [appEntry, ...unitRefs(config).map((ref) => `${ref.slice(2)}/index.js`)]
  .filter((entry) => existsSync(path.join(root, entry)));
const entries = [...new Set([...await importMapEntries(), ...unitEntries])];
if (entries.length === 0) {
  throw new Error('no build entries resolved');
}

await build({
  absWorkingDir: root,
  // Named "out" keeps every bundled file at the exact path the raw tree
  // served before (importmap targets, module-loader unit index.js).
  entryPoints: entries.map((file) => ({
    in: path.join(root, file),
    out: file.replace(/\.js$/, ''),
  })),
  outdir: dist,
  bundle: true,
  splitting: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
});

// Beyond the bundles, dist only carries static assets: fonts/theme, sprite,
// runtime-fetched manifests/config/docs and page assets. Raw .js is never
// shipped (every executable path is a bundled entry or esbuild chunk).
await cp(path.join(root, 'src'), path.join(dist, 'src'), {
  recursive: true,
  filter: (source) => !source.endsWith('.js'),
});
// PeyCore fetches every unit's manifest at runtime; local plugin bundles keep
// theirs through the src copy, vendored units carry it from node_modules.
for (const entry of unitEntries) {
  if (!entry.startsWith('node_modules/')) {
    continue;
  }
  const manifest = path.join(root, entry, '..', 'manifest.json');
  if (existsSync(manifest)) {
    const unitDir = path.dirname(path.join(dist, entry));
    await mkdir(unitDir, { recursive: true });
    await cp(manifest, path.join(unitDir, 'manifest.json'));
  }
}
// mindmap-host fetches the MindElixir stylesheet relative to the document.
await mkdir(path.join(dist, 'node_modules/mind-elixir/dist'), { recursive: true });
await cp(
  path.join(root, 'node_modules/mind-elixir/dist/MindElixir.css'),
  path.join(dist, 'node_modules/mind-elixir/dist/MindElixir.css'),
);
await cp(path.join(root, 'public'), path.join(dist, 'public'), { recursive: true });
await cp(path.join(root, 'docs'), path.join(dist, 'docs'), { recursive: true });
await cp(path.join(root, 'README.md'), path.join(dist, 'README.md'));
await cp(path.join(root, 'CHANGELOG.md'), path.join(dist, 'CHANGELOG.md'));
await reparentStylesheets();
await cp(path.join(root, 'bootstrap.json'), path.join(dist, 'bootstrap.json'));
await cp(path.join(root, 'index.html'), path.join(dist, 'index.html'));

const html = await readFile(path.join(root, 'index.html'), 'utf8');
const fontPreloads = [
  'public/fonts/Vazirmatn-Regular.woff2',
  'public/fonts/Vazirmatn-Bold.woff2',
]
  .map((href) => `<link rel="preload" as="font" type="font/woff2" href="./${href}" crossorigin>`)
  .join('\n  ');
const withPreloads = html.replace('</head>', `  ${fontPreloads}\n</head>`);
await writeFile(path.join(dist, 'index.html'), withPreloads);
await writeFile(path.join(dist, '404.html'), withPreloads);
await writeFile(path.join(dist, '.nojekyll'), '');
