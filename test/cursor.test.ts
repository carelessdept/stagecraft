import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  catmullRom,
  evaluateCursorAtTime,
  generateSmartZoomSegmentsFromClicks,
  sampleRawCursorPosition,
} from '../src/engine/cursor.js';

test('catmullRom hits exact control points at u=0 and u=1', () => {
  assert.equal(catmullRom(0.1, 0.25, 0.75, 0.9, 0), 0.25);
  assert.equal(catmullRom(0.1, 0.25, 0.75, 0.9, 1), 0.75);
});

test('evaluateCursorAtTime interpolates trajectory and emits click ripples', () => {
  const track = [
    { time: 0, x: 0.2, y: 0.2 },
    { time: 1.0, x: 0.8, y: 0.6, clicked: true, label: 'Primary Action' },
    { time: 2.0, x: 0.5, y: 0.5 },
  ];

  const mid = evaluateCursorAtTime(track, 0.5, 40);
  assert.ok(mid.x > 0.25 && mid.x < 0.75);
  assert.ok(mid.speed > 0.1);

  const atClick = evaluateCursorAtTime(track, 1.05, 40);
  assert.equal(atClick.isPressed, true);
  assert.equal(atClick.activeRipples.length, 1);
  assert.equal(atClick.activeRipples[0]!.label, 'Primary Action');
});

test('generateSmartZoomSegmentsFromClicks merges nearby clicks and separates distant ones', () => {
  const track = [
    { time: 1.0, x: 0.25, y: 0.3, clicked: true, label: 'First Click' },
    { time: 1.4, x: 0.28, y: 0.32, clicked: true, label: 'Follow-up Click' },
    { time: 5.2, x: 0.78, y: 0.72, clicked: true, label: 'Second Cluster' },
  ];

  const segments = generateSmartZoomSegmentsFromClicks(track, 8.0, 2.2, 'snappy');
  assert.equal(segments.length, 2);
  assert.ok(segments[0]!.startTime < 1.0);
  assert.ok(segments[0]!.endTime > 1.4);
  assert.ok(segments[1]!.startTime > segments[0]!.endTime);
  assert.ok(Math.abs(segments[0]!.targetX - 0.265) < 0.01);
});
