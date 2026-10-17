export type SpringPresetName = 'mellow' | 'snappy' | 'bouncy' | 'cinema' | 'custom';

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

export type AspectRatioPreset = '16:9' | '16:10' | '4:3' | '1:1' | '9:16';

export type WindowChromeStyle = 'macos-dark' | 'macos-glass' | 'minimal' | 'none';

export type CursorStylePreset = 'macos' | 'studio-ring' | 'touch-orb' | 'crosshair';

export type DemoScenePreset = 'code-deploy' | 'ai-workflow' | 'fintech-command' | 'custom-video';

export interface ZoomSegment {
  id: string;
  startTime: number;
  endTime: number;
  scale: number;
  targetX: number; // Normalized 0..1 within screen rect
  targetY: number; // Normalized 0..1 within screen rect
  mode: 'auto-cursor' | 'manual';
  springPreset: SpringPresetName;
  label?: string;
}

export interface CursorPoint {
  time: number;
  x: number; // Normalized 0..1
  y: number; // Normalized 0..1
  clicked?: boolean;
  button?: 'left' | 'right';
  label?: string;
}

export interface KeystrokeEvent {
  id: string;
  time: number;
  duration: number;
  keys: string;
  label?: string;
}

export interface SpotlightStep {
  id: string;
  time: number;
  duration: number;
  x: number; // Normalized 0..1
  y: number; // Normalized 0..1
  radius: number; // Normalized 0..0.5
  title: string;
  description: string;
}

export interface SpeedSegment {
  id: string;
  startTime: number;
  endTime: number;
  rate: number; // 0.5 .. 3.0
}

export interface BackdropDefinition {
  id: string;
  name: string;
  subtitle: string;
  primaryStops: [string, string, string];
  radialGlows: Array<{ x: number; y: number; radius: number; color: string }>;
  accentColor: string;
}

export interface WebcamBubbleConfig {
  enabled: boolean;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  size: number; // 80..220 px in 1080p coordinates
  shape: 'squircle' | 'circle';
  duckOnZoom: boolean;
}

export interface StudioStyleConfig {
  aspectRatio: AspectRatioPreset;
  backdropId: string;
  padding: number; // 0..140 px (in 1080p space)
  cornerRadius: number; // 0..36 px
  shadowIntensity: number; // 0..100
  insetBorder: number; // 0..100
  windowChrome: WindowChromeStyle;
  windowTitle: string;
  tiltX: number; // -20..20 deg
  tiltY: number; // -20..20 deg
  dynamicTilt: boolean;
  cursorStyle: CursorStylePreset;
  cursorScale: number; // 1.0..3.0
  cursorSmoothing: number; // 0..100
  motionBlur: number; // 0..100
  clickRipple: boolean;
  clickSound: boolean;
  spotlightEnabled: boolean;
  spotlightOpacity: number; // 0..0.85
  springPreset: SpringPresetName;
  springConfig: SpringConfig;
  webcamBubble: WebcamBubbleConfig;
}

export interface StagecraftProject {
  version: '1.0';
  name: string;
  duration: number; // seconds
  trimStart: number;
  trimEnd: number;
  scenePreset: DemoScenePreset;
  style: StudioStyleConfig;
  zoomSegments: ZoomSegment[];
  cursorTrack: CursorPoint[];
  keystrokes: KeystrokeEvent[];
  spotlights: SpotlightStep[];
  speedSegments: SpeedSegment[];
}

export interface CameraFrameState {
  scale: number;
  focusX: number;
  focusY: number;
  velocityX: number;
  velocityY: number;
  velocityScale: number;
  activeSegment: ZoomSegment | null;
}

export interface EvaluatedCursorState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  angle: number;
  isPressed: boolean;
  activeRipples: Array<{
    x: number;
    y: number;
    progress: number; // 0..1
    label?: string;
  }>;
}
