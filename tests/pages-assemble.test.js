// Verifies the Pages assembly ships every runtime-fetched project document.
//
// The built-in docs (help, changelog, about) are fetched from the deployed
// site at runtime (see `builtin-docs.js`), so the pipeline must copy them
// into `dist/`. The workflow only runs the build script; the assembly lives
// in `scripts/build-dist.mjs`, so the test wires both links together:
// workflow → `npm run build` → doc copies + `.nojekyll`. Missing files fail
// silently in the app (fetch 404 → null), which is the regression class
// pinned here.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BUILTIN_DOCS } from '../src/ui/pages/home/builtin-docs.js';

const ROOT_URL = new URL('../', import.meta.url);
const WORKFLOW_URL = new URL('../.github/workflows/pages.yml', import.meta.url);
const BUILD_SCRIPT_URL = new URL('../scripts/build-dist.mjs', import.meta.url);

function resolveRoot(relativeUrl) {
  assert.ok(relativeUrl.startsWith('./'), `expected a root-relative url: ${relativeUrl}`);
  return new URL(relativeUrl, ROOT_URL);
}

test('should_reference_existing_files_when_builtin_docs_are_listed', async () => {
  assert.ok(BUILTIN_DOCS.length > 0, 'expected built-in docs');
  for (const { id, url } of BUILTIN_DOCS) {
    const content = await readFile(resolveRoot(url), 'utf8');
    assert.ok(content.trim().length > 0, `expected non-empty built-in doc: ${id}`);
  }
});

test('should_copy_builtin_docs_when_site_is_assembled', async () => {
  const workflow = await readFile(WORKFLOW_URL, 'utf8');
  assert.ok(workflow.includes('npm run build'), 'expected the assemble step to run the build script');
  const buildScript = await readFile(BUILD_SCRIPT_URL, 'utf8');
  for (const token of ['dist', 'docs', 'README.md', 'CHANGELOG.md', 'bootstrap.json', '.nojekyll']) {
    assert.ok(buildScript.includes(`'${token}'`) || buildScript.includes(`"${token}"`),
      `expected the build script to ship ${token}`);
  }
  for (const { id, url } of BUILTIN_DOCS) {
    const relative = url.slice('./'.length);
    const covered = buildScript.includes(relative)
      || (relative.includes('/') && buildScript.includes(relative.split('/')[0]));
    assert.ok(covered, `expected the build script to ship ${id} (${relative})`);
  }
});
