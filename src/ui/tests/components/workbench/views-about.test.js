// Verifies the about view renderer (pure function, no DOM).
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAboutView } from '../../../components/workbench/views-about.js';

test('should_render_logo_links_and_version_when_rendered', () => {
  const markup = renderAboutView({ t: (key) => key });
  assert.ok(markup.includes('part="about-hero"'), 'expected the logo hero');
  assert.ok(markup.includes('<svg'), 'expected inline logo markup');
  assert.ok(markup.includes('parsinegar.app.title'));
  assert.ok(markup.includes('parsinegar.about.tagline'));
  assert.ok(markup.includes('parsinegar.about.body'));
  assert.ok(markup.includes('parsinegar.about.version'));
  assert.ok(markup.includes('https://github.com/barnevis/parsinegar'), 'expected the repo link');
  assert.ok(markup.includes('CHANGELOG.md'), 'expected the changelog link');
  assert.ok(markup.includes('target="_blank"'), 'expected new-tab links');
  assert.ok(markup.includes('rel="noopener"'), 'expected opener protection');
});
