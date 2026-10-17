# Stagecraft

[![Live Studio](https://img.shields.io/badge/Live_Studio-GitHub_Pages-6366F1)](https://carelessdept.github.io/stagecraft/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8_Strict-3178C6)](https://github.com/carelessdept/stagecraft)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Local-first screen recorder, spring-physics auto-zoom compositor, and interactive walkthrough studio for the browser.**

Live Studio: **[https://carelessdept.github.io/stagecraft/](https://carelessdept.github.io/stagecraft/)**

Stagecraft brings macOS-style spring camera zooms, Catmull-Rom cursor path smoothing, directional velocity motion blur, keystroke HUD callouts, live Raw-vs-Studio split comparison, and interactive HTML walkthrough exports directly to any modern browser. Nothing is uploaded to a remote server; recording, compositing, and video encoding run locally on your machine.

## Features

- **Damped Harmonic Spring Camera (`src/engine/spring.ts`)**
  - Symplectic 240Hz sub-stepped spring solver (`stiffness`, `damping`, `mass`) with `Mellow`, `Snappy`, `Bouncy`, `Cinema`, and custom presets.
  - Real-time unit-step response oscilloscope showing damping ratio ($\zeta$), peak overshoot percentage, and settling time in milliseconds.
  - Automatic viewport boundary clamping so high magnification never exposes blank edges outside the application frame.
- **Cursor Kinematics & Smart Click Clustering (`src/engine/cursor.ts`)**
  - Centripetal Catmull-Rom spline interpolation paired with a configurable Gaussian temporal smoothing kernel.
  - Velocity-vector directional motion blur on fast cursor movements and rapid camera pans.
  - One-click **Auto-Zoom from Clicks** that clusters nearby mouse clicks into non-overlapping zoom blocks on the timeline.
- **Multi-Layer Studio Compositor & Live Split Wipe (`src/engine/compositor.ts`)**
  - 8 studio backdrops (`Sequoia Aurora`, `Natural Titanium`, `Sonoma Horizon`, `Emerald Matrix`, `Cupertino Ice`, `Noir Carbon`, `Mojave Editorial`, `Studio Amethyst`).
  - Interactive **Raw Capture vs Stagecraft Studio** split-screen wipe (`B`) so you can compare the unstyled recording against the spring-zoomed studio composite at 60fps.
  - Adjustable canvas padding, corner radius, elevation shadow, 1px specular glass border, macOS window chrome, and 3D perspective tilt (with optional cursor-follow tilt).
  - Keystroke HUD pills (`⌘K`, `⇧⌘P`), radial spotlight dimming masks, WebAudio tactile click synthesis, and an auto-ducking presenter webcam PiP overlay.
- **4-Track Non-Linear Timeline & Undo/Redo Stack (`src/engine/history.ts`)**
  - Drag and resize spring zoom blocks, click cursor markers to jump to exact timestamps, and scrub at 60fps.
  - Full 50-step Undo/Redo command stack (`⌘Z` / `⇧⌘Z`).
- **Local Video, PNG Frame & Interactive HTML Exports (`src/engine/exporter.ts`)**
  - **60fps / 30fps Local Video Export** (`.webm` / `.mp4` at 720p, 1080p, or 1440p) with zero watermarks.
  - **Instant 1080p PNG Hero Frame Export** (`P`).
  - **Interactive HTML Walkthrough Export** (`.html`) that bundles guided hotspot steps into a single self-contained file you can host or share offline.

## Quick Start

```sh
git clone https://github.com/carelessdept/stagecraft.git
cd stagecraft
npm ci --ignore-scripts
npm run check
npm run serve
```

Then open `http://localhost:4173` in your browser, or use the hosted build at **[https://carelessdept.github.io/stagecraft/](https://carelessdept.github.io/stagecraft/)**.

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Space` | Play / Pause timeline |
| `B` | Toggle live split-screen Raw vs Studio comparison wipe |
| `Z` | Insert spring zoom block at playhead |
| `K` | Insert keystroke HUD callout at playhead |
| `S` | Insert spotlight walkthrough step at playhead |
| `P` | Export current composite frame as 1080p PNG |
| `←` / `→` | Step playhead backward / forward 100ms |
| `L` | Toggle loop playback |
| `⌫` / `Delete` | Delete selected zoom block |
| `⌘Z` / `⇧⌘Z` | Undo / Redo |
| `?` | Open shortcuts & project JSON modal |

## Programmatic SDK Usage

```ts
import {
  createPresetProject,
  evaluateCameraAtTime,
  evaluateCursorAtTime,
  generateInteractiveWalkthroughHtml,
} from 'stagecraft-studio';

const project = createPresetProject('code-deploy');
const camera = evaluateCameraAtTime(project, 2.0, (t) =>
  evaluateCursorAtTime(project.cursorTrack, t, project.style.cursorSmoothing),
);
console.log(camera.scale, camera.focusX, camera.focusY);

const html = generateInteractiveWalkthroughHtml(project);
```

## License

MIT
