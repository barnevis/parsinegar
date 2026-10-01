// Verifies the export service (fake Markdown service, real assembly).
import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../lib/export-service.js';

function createMarkdownService(html = '<p>ok</p>') {
  const calls = [];
  return {
    calls,
    async renderFragment(input) {
      calls.push(input);
      return { html };
    },
  };
}

function setup(html) {
  const markdown = createMarkdownService(html);
  return { service: createService({ markdown, events: null }), markdown };
}

test('should_assemble_standalone_document_when_exported', async () => {
  const { service, markdown } = setup('<p>سلام</p>');
  const result = await service.exportHtml({ markdown: '# سلام', title: 'یادداشت', theme: 'dark' });
  assert.equal(result.mime, 'text/html');
  assert.equal(result.filename, 'یادداشت.html');
  assert.ok(result.html.startsWith('<!DOCTYPE html>'));
  assert.ok(result.html.includes('<html lang="fa" dir="rtl">'));
  assert.ok(result.html.includes('<title>یادداشت</title>'));
  assert.ok(result.html.includes('<p>سلام</p>'));
  assert.equal(markdown.calls.length, 1);
  assert.equal(markdown.calls[0].markdown, '# سلام');
  assert.ok(Array.isArray(markdown.calls[0].syntaxExtensions));
  assert.ok(Array.isArray(markdown.calls[0].htmlExtensions));
  assert.equal(typeof markdown.calls[0].footnoteOptions, 'object');
});

test('should_default_title_theme_and_mime_when_exported', async () => {
  const { service } = setup();
  const result = await service.exportHtml({ markdown: 'x' });
  assert.equal(result.filename, 'بدون عنوان.html');
  assert.ok(result.html.includes('<title>بدون عنوان</title>'));
});

test('should_sanitize_filename_when_exported', async () => {
  const { service } = setup();
  const result = await service.exportHtml({ markdown: 'x', title: 'a/b\\c' });
  assert.equal(result.filename, 'a-b-c.html');
});

test('should_escape_title_when_assembled', async () => {
  const { service } = setup();
  const result = await service.exportHtml({ markdown: 'x', title: '<b>bad</b>' });
  assert.ok(!result.html.includes('<b>bad</b>'));
  assert.ok(result.html.includes('&lt;b&gt;bad&lt;/b&gt;'));
});

test('should_reject_invalid_theme_when_exported', async () => {
  const { service } = setup();
  const error = await service.exportHtml({ markdown: 'x', theme: 'neon' }).catch((caught) => caught);
  assert.equal(error?.code, 'EXPORT_INVALID_THEME');
  assert.equal(error?.source, 'parsinegar.export.service');
  assert.equal(error?.type, 'operational');
  assert.equal(typeof error?.timestamp, 'string');
});

test('should_map_render_failure_when_markdown_fails', async () => {
  const markdown = {
    async renderFragment() {
      throw { code: 'MARKDOWN_RENDER_FAILED', source: 'pey.markdown' };
    },
  };
  const service = createService({ markdown, events: null });
  const error = await service.exportHtml({ markdown: 'x' }).catch((caught) => caught);
  assert.equal(error?.code, 'EXPORT_RENDER_FAILED');
  assert.deepEqual(error?.detail, { cause: 'MARKDOWN_RENDER_FAILED' });
});

test('should_fail_with_structured_error_when_markdown_is_missing', async () => {
  const service = createService({ markdown: null, events: null });
  const error = await service.exportHtml({ markdown: 'x' }).catch((caught) => caught);
  assert.equal(error?.code, 'EXPORT_MARKDOWN_UNAVAILABLE');
  assert.equal(error?.source, 'parsinegar.export.service');
  assert.equal(error?.type, 'operational');
  assert.equal(typeof error?.timestamp, 'string');
});

test('should_render_empty_body_when_markdown_is_empty', async () => {
  const { service } = setup('');
  const result = await service.exportHtml({ markdown: '' });
  assert.ok(result.html.includes('<body>'));
});
