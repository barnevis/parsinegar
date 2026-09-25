// Verifies the built-in docs companion (pure, injected fetch, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILTIN_DOCS, createBuiltinDocs } from '../../../pages/home/builtin-docs.js';

function stubFetch(texts = {}, ok = true) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return { ok, text: async () => texts[url] ?? `# mock for ${url}` };
  };
  return { fetchImpl, calls };
}

test('should_list_builtin_docs_when_listed', () => {
  const guides = createBuiltinDocs({ t: (key) => key });
  assert.deepEqual(guides.list().map(({ id }) => id), ['help', 'changelog', 'about']);
  assert.deepEqual(BUILTIN_DOCS.map(({ id }) => id), ['help', 'changelog', 'about']);
});

test('should_load_and_cache_when_opened', async () => {
  const { fetchImpl, calls } = stubFetch({ './GUIDE.md': '# راهنما' });
  const guides = createBuiltinDocs({ fetchImpl, t: (key) => `t:${key}` });
  const first = await guides.open('help');
  assert.deepEqual(first, { id: 'help', title: 't:parsinegar.builtin.help', content: '# راهنما' });
  const second = await guides.open('help');
  assert.deepEqual(second, first);
  assert.deepEqual(calls, ['./GUIDE.md']);
});

test('should_return_null_when_id_is_unknown', async () => {
  const { fetchImpl, calls } = stubFetch();
  const guides = createBuiltinDocs({ fetchImpl });
  assert.equal(await guides.open('nope'), null);
  assert.deepEqual(calls, []);
});

test('should_return_null_when_load_fails', async () => {
  const { fetchImpl } = stubFetch({}, false);
  const guides = createBuiltinDocs({ fetchImpl });
  assert.equal(await guides.open('help'), null);
});

test('should_return_null_when_page_is_dead', async () => {
  const { fetchImpl, calls } = stubFetch({ './GUIDE.md': '# راهنما' });
  const guides = createBuiltinDocs({ fetchImpl, isLive: () => false });
  assert.equal(await guides.open('help'), null);
  assert.deepEqual(calls, ['./GUIDE.md']);
});

test('should_return_null_without_fetch_when_omitted', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = undefined;
  try {
    const guides = createBuiltinDocs({ fetchImpl: undefined });
    assert.equal(await guides.open('help'), null);
  } finally {
    globalThis.fetch = realFetch;
  }
});
