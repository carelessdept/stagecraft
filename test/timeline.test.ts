import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlaybackRateAtTime,
  insertZoomSegmentAtTime,
} from '../src/engine/history.js';
import { canvasPixelToNormalizedWindowPoint } from '../src/engine/compositor.js';

test('insertZoomSegmentAtTime trims overlapping segments so zoom blocks never collide', () => {
  const initial = [
    {
      id: 'z-1',
      startTime: 1.0,
      endTime: 4.0,
      scale: 2.0,
      targetX: 0.3,
      targetY: 0.3,
      mode: 'auto-cursor' as const,
      springPreset: 'snappy' as const,
    },
  ];

  const { segments, created } = insertZoomSegmentAtTime(initial, 10.0, 2.5, {
    scale: 2.5,
  });

  assert.equal(segments.length, 2);
  assert.equal(segments[0]!.endTime, 2.5);
  assert.equal(segments[1]!.id, created.id);
  assert.equal(segments[1]!.startTime, 2.5);
});

test('getPlaybackRateAtTime returns configured speed ramp multiplier', () => {
  const ramps = [{ id: 's-1', startTime: 2.0, endTime: 5.0, rate: 2.0 }];
  assert.equal(getPlaybackRateAtTime(ramps, 1.0), 1.0);
  assert.equal(getPlaybackRateAtTime(ramps, 3.5), 2.0);
});

test('canvasPixelToNormalizedWindowPoint inverts zoomed camera transform accurately', () => {
  const camera = {
    scale: 2.0,
    focusX: 0.25,
    focusY: 0.25,
    velocityX: 0,
    velocityY: 0,
    velocityScale: 0,
    activeSegment: null,
  };
  const windowRect = { x: 100, y: 100, w: 800, h: 500, headerH: 0 };
  // At canvas center (500, 350), unscaled point should map to camera focus (0.25, 0.25)
  const norm = canvasPixelToNormalizedWindowPoint(500, 350, 1000, 700, camera, windowRect);
  assert.equal(norm.x, 0.25);
  assert.equal(norm.y, 0.25);
});
