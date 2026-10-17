import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPRING_PRESETS,
  clampViewportFocus,
  evaluateCameraAtTime,
  resolveSpringConfig,
  sampleSpringResponseCurve,
  stepSpring1D,
} from '../src/engine/spring.js';
import { createPresetProject } from '../src/demo/presets.js';

test('stepSpring1D converges accurately to target without numerical divergence', () => {
  let state = { position: 0, velocity: 0 };
  for (let i = 0; i < 120; i++) {
    state = stepSpring1D(state, 2.25, SPRING_PRESETS.snappy, 1 / 60);
  }
  assert.ok(Math.abs(state.position - 2.25) < 0.001);
  assert.ok(Math.abs(state.velocity) < 0.001);
});

test('sampleSpringResponseCurve distinguishes underdamped bouncy vs mellow springs', () => {
  const bouncy = sampleSpringResponseCurve(SPRING_PRESETS.bouncy, 1.0, 80);
  const mellow = sampleSpringResponseCurve(SPRING_PRESETS.mellow, 1.0, 80);
  assert.equal(bouncy.regime, 'underdamped');
  assert.ok(bouncy.peakOvershootPct > mellow.peakOvershootPct);
  assert.equal(bouncy.points.length, 80);
  assert.ok(Math.abs(bouncy.points[79]! - 1) < 0.05);
});

test('clampViewportFocus prevents zoomed camera from exposing out-of-bounds edges', () => {
  assert.equal(clampViewportFocus(0.9, 1.0), 0.5);
  assert.equal(clampViewportFocus(0.02, 2.0), 0.25);
  assert.equal(clampViewportFocus(0.98, 2.0), 0.75);
});

test('evaluateCameraAtTime smoothly zooms in during active segment and returns to 1.0x', () => {
  const project = createPresetProject('code-deploy');
  const before = evaluateCameraAtTime(project, 0.2, () => ({ x: 0.5, y: 0.5 }));
  const inside = evaluateCameraAtTime(project, 2.1, () => ({ x: 0.31, y: 0.36 }));
  const after = evaluateCameraAtTime(project, 3.95, () => ({ x: 0.5, y: 0.5 }));

  assert.ok(before.scale < 1.05);
  assert.ok(inside.scale > 1.75);
  assert.ok(inside.focusX < 0.42);
  assert.ok(after.scale < 1.15);
});

test('resolveSpringConfig clamps custom out-of-range values safely', () => {
  const custom = resolveSpringConfig('custom', { stiffness: 9999, damping: 1, mass: 0.01 });
  assert.equal(custom.stiffness, 800);
  assert.equal(custom.damping, 4);
  assert.equal(custom.mass, 0.2);
});
