import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectHistoryStack } from '../src/engine/history.js';
import { createPresetProject } from '../src/demo/presets.js';

test('ProjectHistoryStack supports multi-step undo, redo, and checkpointing', () => {
  const initial = createPresetProject('code-deploy');
  const history = new ProjectHistoryStack(initial, 10);

  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);

  const modified = structuredClone(history.state);
  modified.style.padding = 96;
  history.commit(modified);

  assert.equal(history.canUndo, true);
  assert.equal(history.state.style.padding, 96);

  const undone = history.undo();
  assert.ok(undone);
  assert.equal(undone!.style.padding, 64);
  assert.equal(history.canRedo, true);

  const redone = history.redo();
  assert.ok(redone);
  assert.equal(redone!.style.padding, 96);
});
