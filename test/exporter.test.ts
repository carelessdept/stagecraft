import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateInteractiveWalkthroughHtml,
  parseProjectJson,
  serializeProjectJson,
} from '../src/engine/exporter.js';
import { createPresetProject } from '../src/demo/presets.js';

test('serializeProjectJson and parseProjectJson round-trip without data loss', () => {
  const project = createPresetProject('ai-workflow');
  const raw = serializeProjectJson(project);
  const parsed = parseProjectJson(raw);
  assert.equal(parsed.name, project.name);
  assert.equal(parsed.zoomSegments.length, project.zoomSegments.length);
  assert.equal(parsed.spotlights.length, project.spotlights.length);
});

test('parseProjectJson rejects malformed payloads', () => {
  assert.throws(() => parseProjectJson('{"version":"0.0"}'), /Invalid Stagecraft project/);
});

test('generateInteractiveWalkthroughHtml produces self-contained HTML with escaped step data', () => {
  const project = createPresetProject('code-deploy');
  const html = generateInteractiveWalkthroughHtml(project);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes(project.name));
  assert.ok(html.includes('Configure Edge Rate Limiter'));
});
