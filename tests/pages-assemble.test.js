// Verifies the Pages assembly ships every runtime-fetched project document.
//
// The built-in docs (help, changelog, about) are fetched from the deployed
// site at runtime (see `builtin-docs.js`), so the workflow must copy them
// into `dist/`. Missing files fail silently in the app (fetch 404 → null),
// which is exactly the class of regression this pins: source URLs and the
// assemble step are checked against each other, plus file existence.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { BUILTIN_DOCS } from '../src/ui/pages/home/builtin-docs.js';

const ROOT_URL = new URL('../', import.meta.url);
const WORKFLOW_URL = new URL('../.github/workflows/pages.yml', import.meta.url);

function resolveRoot(relativeUrl) {
  assert.ok(relativeUrl.startsWith('./'), `expected a root-relative url: ${relativeUrl}`);
  return new URL(relativeUrl, ROOT_URL);
}

function assembleBlock(workflow) {
  const start = workflow.indexOf('Assemble site');
  assert.ok(start >= 0, 'expected the Assemble site step');
  const rest = workflow.slice(start);
  const end = rest.search(/\n\s+-\s+(name|uses):/);
  return end < 0 ? rest : rest.slice(0, end);
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
  const block = assembleBlock(workflow);
  assert.ok(block.includes('touch dist/.nojekyll'), 'expected Jekyll to stay disabled');
  for (const { id, url } of BUILTIN_DOCS) {
    // Root file (`./CHANGELOG.md`) or anything under a copied tree (`docs`).
    const relative = url.slice('./'.length);
    const covered = block.includes(relative)
      || (relative.includes('/') && block.includes(relative.split('/')[0]));
    assert.ok(covered, `expected the assemble step to ship ${id} (${relative})`);
  }
});
