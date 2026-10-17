import type { DemoScenePreset } from '../state/types.js';
import { clamp } from '../engine/spring.js';

/**
 * Renders a Retina-sharp macOS application viewport at `timeSec`.
 * All UI elements sit at exact normalized coordinates matching the cursor track,
 * with calm, realistic state transitions triggered by user clicks (no wiggling sine charts).
 */
export function renderProceduralAppScene(
  ctx: CanvasRenderingContext2D,
  scene: DemoScenePreset,
  width: number,
  height: number,
  timeSec: number,
): void {
  ctx.save();
  if (scene === 'ai-workflow') {
    renderAiWorkflowScene(ctx, width, height, timeSec);
  } else if (scene === 'fintech-command') {
    renderFintechScene(ctx, width, height, timeSec);
  } else {
    renderCodeDeployScene(ctx, width, height, timeSec);
  }
  ctx.restore();
}

function renderCodeDeployScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  // Base IDE surface (clean macOS dark slate)
  ctx.fillStyle = '#0E1017';
  ctx.fillRect(0, 0, w, h);

  // Top sub-toolbar (0.00 .. 0.085 h)
  const barH = h * 0.085;
  ctx.fillStyle = '#131620';
  ctx.fillRect(0, 0, w, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barH);
  ctx.lineTo(w, barH);
  ctx.stroke();

  // File tab pill
  roundRect(ctx, w * 0.19, barH * 0.18, w * 0.165, barH * 0.64, 6);
  ctx.fillStyle = 'rgba(255,255,255,0.055)';
  ctx.fill();
  ctx.fillStyle = '#38BDF8';
  ctx.font = `600 ${Math.round(h * 0.0155)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.fillText('TS', w * 0.202, barH * 0.58);
  ctx.fillStyle = '#F1F5F9';
  ctx.fillText('edge-router.ts', w * 0.224, barH * 0.58);

  // Saved status pill (appears smoothly after Click 1 at t = 0.98s)
  const saveAlpha = clamp((t - 0.98) / 0.25, 0, 1);
  if (saveAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = saveAlpha;
    roundRect(ctx, w * 0.455, barH * 0.2, w * 0.13, barH * 0.6, 6);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.14)';
    ctx.fill();
    ctx.fillStyle = '#34D399';
    ctx.font = `600 ${Math.round(h * 0.014)}px -apple-system, sans-serif`;
    ctx.fillText('✓ Saved · 0 errors', w * 0.467, barH * 0.57);
    ctx.restore();
  }

  // Left sidebar file explorer
  const sideW = w * 0.18;
  ctx.fillStyle = '#0B0D13';
  ctx.fillRect(0, barH, sideW, h - barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.moveTo(sideW, barH);
  ctx.lineTo(sideW, h);
  ctx.stroke();

  ctx.fillStyle = '#64748B';
  ctx.font = `700 ${Math.round(h * 0.0125)}px -apple-system, sans-serif`;
  ctx.fillText('EXPLORER', w * 0.018, barH + h * 0.045);

  const files = [
    ['src/edge-router.ts', true],
    ['src/rate-limiter.ts', false],
    ['src/jwt-session.ts', false],
    ['src/telemetry.ts', false],
    ['test/canary.spec.ts', false],
    ['wrangler.toml', false],
  ] as const;

  ctx.font = `500 ${Math.round(h * 0.015)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  files.forEach(([name, active], i) => {
    const rowY = barH + h * 0.09 + i * (h * 0.046);
    if (active) {
      roundRect(ctx, w * 0.01, rowY - h * 0.025, sideW - w * 0.02, h * 0.037, 6);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.16)';
      ctx.fill();
    }
    ctx.fillStyle = active ? '#F8FAFC' : '#94A3B8';
    ctx.fillText(name, w * 0.02, rowY);
  });

  // Center Code Editor pane (x: 0.18 .. 0.60)
  const editorW = w * 0.42;
  const codeRight = sideW + editorW;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  ctx.moveTo(codeRight, barH);
  ctx.lineTo(codeRight, h);
  ctx.stroke();

  // Active Line 06 sits at y = 0.36 * h (exact target of Click 1 at x=0.34, y=0.36)
  const editedQuota = t >= 0.98 ? '2_500' : '1_000';
  const activeLineY = h * 0.336;
  ctx.fillStyle = t >= 0.98 ? 'rgba(99, 102, 241, 0.16)' : 'rgba(99, 102, 241, 0.09)';
  ctx.fillRect(sideW, activeLineY, editorW, h * 0.044);
  ctx.fillStyle = '#818CF8';
  ctx.fillRect(sideW, activeLineY, 3, h * 0.044);

  const codeLines: Array<[string, string, string]> = [
    ['01', 'import { createSlidingLimiter } from ', '"./rate-limiter";'],
    ['02', 'import { verifyEdgeSession } from ', '"./jwt-session";'],
    ['03', '', ''],
    ['04', 'export const edgePolicy = createSlidingLimiter({', ''],
    ['05', '  windowMs: 60_000,', ''],
    ['06', `  maxRequests: ${editedQuota},`, ' // Updated edge quota'],
    ['07', '  burstTolerance: 0.15,', ''],
    ['08', '  failoverRing: "global-anycast",', ''],
    ['09', '  onQuotaExceeded: (ctx) => ctx.reject(429),', ''],
    ['10', '});', ''],
    ['11', '', ''],
    ['12', 'export async function handleEdge(req: Request) {', ''],
    ['13', '  const principal = await verifyEdgeSession(req);', ''],
    ['14', '  return edgePolicy.guard(principal, () => fetch(req));', ''],
    ['15', '}', ''],
  ];

  const fontSize = Math.round(h * 0.0155);
  ctx.font = `500 ${fontSize}px "SF Mono", "JetBrains Mono", ui-monospace, monospace`;
  codeLines.forEach(([num, main, tail], idx) => {
    const y = barH + h * 0.056 + idx * (h * 0.044);
    ctx.fillStyle = '#475569';
    ctx.fillText(num, sideW + w * 0.015, y);
    ctx.fillStyle = idx === 5 ? '#7DD3FC' : '#E2E8F0';
    ctx.fillText(main, sideW + w * 0.044, y);
    if (tail) {
      ctx.fillStyle = idx === 5 ? '#34D399' : '#A78BFA';
      ctx.fillText(tail, sideW + w * 0.044 + ctx.measureText(main).width, y);
    }
  });

  // Right Pane (x: 0.62 .. 0.98)
  const rightX = codeRight + w * 0.02;
  const rightW = w - rightX - w * 0.02;

  // Top-Right Card: Production Release & Latency (Click 3 targets button at x=0.82, y=0.16)
  const card1Y = barH + h * 0.028;
  const card1H = h * 0.39;
  roundRect(ctx, rightX, card1Y, rightW, card1H, 11);
  ctx.fillStyle = '#131722';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.stroke();

  const promoted = t >= 7.42;

  // Promote Button positioned directly around (x = 0.82, y = 0.16)
  const btnX = w * 0.745;
  const btnY = h * 0.132;
  const btnW = w * 0.205;
  const btnH = h * 0.058;
  roundRect(ctx, btnX, btnY, btnW, btnH, 7);
  ctx.fillStyle = promoted ? '#10B981' : '#6366F1';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${Math.round(h * 0.0145)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.fillText(
    promoted ? '✓ Live · 100% Traffic' : 'Promote 100%  ⇧⌘P',
    btnX + w * 0.015,
    btnY + btnH * 0.62,
  );

  ctx.fillStyle = '#94A3B8';
  ctx.font = `600 ${Math.round(h * 0.013)}px -apple-system, sans-serif`;
  ctx.fillText('EDGE P99 LATENCY', rightX + w * 0.018, card1Y + h * 0.045);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `700 ${Math.round(h * 0.032)}px -apple-system, sans-serif`;
  ctx.fillText(promoted ? '1.42 ms' : '1.84 ms', rightX + w * 0.018, card1Y + h * 0.098);

  // Static, calm historical telemetry curve (no wiggling sine animation)
  const sparkStartX = rightX + w * 0.02;
  const sparkW = rightW - w * 0.04;
  const sparkBaseY = card1Y + card1H * 0.72;
  const samples = [
    0.15, 0.18, 0.12, 0.22, 0.14, 0.08, 0.05, -0.04, -0.08, -0.05,
    -0.12, -0.18, -0.15, -0.22, -0.26, -0.24, -0.29, -0.32, -0.30, -0.34,
  ];
  ctx.beginPath();
  samples.forEach((val, i) => {
    const u = i / (samples.length - 1);
    const px = sparkStartX + u * sparkW;
    const py = sparkBaseY + val * (h * 0.075);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = promoted ? '#34D399' : '#38BDF8';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(sparkStartX + sparkW, card1Y + card1H - 12);
  ctx.lineTo(sparkStartX, card1Y + card1H - 12);
  ctx.closePath();
  const areaGrad = ctx.createLinearGradient(0, sparkBaseY - 24, 0, card1Y + card1H);
  areaGrad.addColorStop(0, promoted ? 'rgba(52, 211, 153, 0.20)' : 'rgba(56, 189, 248, 0.18)');
  areaGrad.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
  ctx.fillStyle = areaGrad;
  ctx.fill();

  // Bottom-Right Card: Canary Verification Suite (Click 2 targets Run Canary button at x=0.72, y=0.62)
  const card2Y = card1Y + card1H + h * 0.025;
  const card2H = h - card2Y - h * 0.03;
  roundRect(ctx, rightX, card2Y, rightW, card2H, 11);
  ctx.fillStyle = '#0B0E16';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.stroke();

  ctx.fillStyle = '#94A3B8';
  ctx.font = `600 ${Math.round(h * 0.013)}px -apple-system, sans-serif`;
  ctx.fillText('CANARY VERIFICATION', rightX + w * 0.018, card2Y + h * 0.048);

  // Run Canary button positioned at (x = 0.72, y = 0.62)
  const canaryStarted = t >= 4.2;
  const testProgress = clamp((t - 4.2) / 1.35, 0, 1);
  const runBtnX = rightX + w * 0.018;
  const runBtnY = h * 0.592;
  const runBtnW = w * 0.165;
  const runBtnH = h * 0.054;
  roundRect(ctx, runBtnX, runBtnY, runBtnW, runBtnH, 6);
  ctx.fillStyle = canaryStarted ? 'rgba(16, 185, 129, 0.18)' : 'rgba(99, 102, 241, 0.22)';
  ctx.fill();
  ctx.strokeStyle = canaryStarted ? 'rgba(52, 211, 153, 0.5)' : 'rgba(129, 140, 248, 0.5)';
  ctx.stroke();

  ctx.fillStyle = canaryStarted ? '#34D399' : '#C7D2FE';
  ctx.font = `600 ${Math.round(h * 0.014)}px -apple-system, sans-serif`;
  ctx.fillText(
    testProgress >= 1 ? '✓ 42 / 42 Passed' : canaryStarted ? `Running (${Math.round(testProgress * 100)}%)` : '▶ Run Canary  ⌘T',
    runBtnX + w * 0.014,
    runBtnY + runBtnH * 0.62,
  );

  // Smooth progress bar next to Run Canary button
  const progX = runBtnX + runBtnW + w * 0.015;
  const progW = rightW - (runBtnW + w * 0.052);
  const progY = runBtnY + runBtnH * 0.38;
  roundRect(ctx, progX, progY, progW, h * 0.012, 4);
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fill();
  if (testProgress > 0) {
    roundRect(ctx, progX, progY, progW * testProgress, h * 0.012, 4);
    ctx.fillStyle = '#34D399';
    ctx.fill();
  }

  const rows: Array<[string, string, string]> = [
    ['PASS', 'sliding-window quota enforcement', '1.2ms'],
    ['PASS', 'burst tolerance replay guard', '0.8ms'],
    [testProgress > 0.35 ? 'PASS' : 'WAIT', 'regional ring failover (iad · fra)', '2.1ms'],
    [testProgress > 0.8 ? 'PASS' : 'WAIT', 'zero-downtime bundle hot-swap', '3.4ms'],
  ];

  rows.forEach(([badge, name, dur], i) => {
    const ry = card2Y + h * 0.19 + i * (h * 0.055);
    const isPass = badge === 'PASS';
    roundRect(ctx, rightX + w * 0.018, ry - h * 0.021, w * 0.042, h * 0.03, 5);
    ctx.fillStyle = isPass ? 'rgba(16, 185, 129, 0.16)' : 'rgba(148, 163, 184, 0.12)';
    ctx.fill();

    ctx.fillStyle = isPass ? '#34D399' : '#94A3B8';
    ctx.font = `700 ${Math.round(h * 0.0115)}px "SF Mono", monospace`;
    ctx.fillText(badge, rightX + w * 0.024, ry - h * 0.001);

    ctx.fillStyle = '#E2E8F0';
    ctx.font = `500 ${Math.round(h * 0.0145)}px -apple-system, sans-serif`;
    ctx.fillText(name, rightX + w * 0.068, ry);

    ctx.fillStyle = '#64748B';
    ctx.font = `500 ${Math.round(h * 0.0135)}px "SF Mono", monospace`;
    ctx.fillText(dur, rightX + rightW - w * 0.052, ry);
  });
}

function renderAiWorkflowScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  ctx.fillStyle = '#0D0B14';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
  const step = Math.max(24, Math.round(w * 0.025));
  for (let gx = step; gx < w; gx += step) {
    for (let gy = step; gy < h; gy += step) {
      ctx.fillRect(gx, gy, 1.5, 1.5);
    }
  }

  const barH = h * 0.095;
  ctx.fillStyle = '#141122';
  ctx.fillRect(0, 0, w, barH);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `600 ${Math.round(h * 0.019)}px -apple-system, sans-serif`;
  ctx.fillText('Nexus Studio · Agentic DAG', w * 0.03, barH * 0.6);

  const executed = t >= 7.5;
  roundRect(ctx, w * 0.75, h * 0.14, w * 0.21, h * 0.072, 9);
  ctx.fillStyle = executed ? '#10B981' : '#8B5CF6';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${Math.round(h * 0.017)}px -apple-system, sans-serif`;
  ctx.fillText(
    executed ? '✓ Graph Verified (0.8ms)' : '▶ Run Workflow  ⌘↵',
    w * 0.77,
    h * 0.184,
  );

  const nodes = [
    {
      x: w * 0.12,
      y: h * 0.34,
      nw: w * 0.23,
      nh: h * 0.23,
      title: '01 · Webhook Trigger',
      subtitle: 'Strict Schema & HMAC Guard',
      metric: t >= 1.05 ? '✓ Schema Verified' : 'Ready',
      accent: '#38BDF8',
    },
    {
      x: w * 0.43,
      y: h * 0.36,
      nw: w * 0.24,
      nh: h * 0.23,
      title: '02 · Policy Router',
      subtitle: 'P99 < 120ms · Token Cap 4k',
      metric: t >= 4.2 ? '✓ Guardrails Active' : 'Standby',
      accent: '#C084FC',
    },
    {
      x: w * 0.74,
      y: h * 0.38,
      nw: w * 0.21,
      nh: h * 0.22,
      title: '03 · Action Sink',
      subtitle: 'Idempotent Commit Log',
      metric: executed ? '✓ 418 Events Committed' : 'Standby',
      accent: '#34D399',
    },
  ];

  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i]!;
    const b = nodes[i + 1]!;
    const x1 = a.x + a.nw;
    const y1 = a.y + a.nh * 0.5;
    const x2 = b.x;
    const y2 = b.y + b.nh * 0.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo((x1 + x2) * 0.5, y1, (x1 + x2) * 0.5, y2, x2, y2);
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.38)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  nodes.forEach(n => {
    roundRect(ctx, n.x, n.y, n.nw, n.nh, 12);
    ctx.fillStyle = '#161326';
    ctx.fill();
    ctx.strokeStyle = n.accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = n.accent;
    ctx.font = `700 ${Math.round(h * 0.0175)}px -apple-system, sans-serif`;
    ctx.fillText(n.title, n.x + w * 0.016, n.y + h * 0.055);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = `500 ${Math.round(h * 0.015)}px -apple-system, sans-serif`;
    ctx.fillText(n.subtitle, n.x + w * 0.016, n.y + h * 0.105);

    roundRect(ctx, n.x + w * 0.016, n.y + h * 0.14, n.nw - w * 0.032, h * 0.05, 7);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `600 ${Math.round(h * 0.0145)}px "SF Mono", monospace`;
    ctx.fillText(n.metric, n.x + w * 0.026, n.y + h * 0.172);
  });
}

function renderFintechScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  ctx.fillStyle = '#091315';
  ctx.fillRect(0, 0, w, h);

  const barH = h * 0.095;
  ctx.fillStyle = '#0D1C1F';
  ctx.fillRect(0, 0, w, barH);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `600 ${Math.round(h * 0.019)}px -apple-system, sans-serif`;
  ctx.fillText('Meridian Treasury · Global Liquidity', w * 0.035, barH * 0.6);

  roundRect(ctx, w * 0.04, h * 0.15, w * 0.52, h * 0.36, 12);
  ctx.fillStyle = '#102327';
  ctx.fill();
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.25)';
  ctx.lineWidth = 1.25;
  ctx.stroke();

  ctx.fillStyle = '#94A3B8';
  ctx.font = `600 ${Math.round(h * 0.0145)}px -apple-system, sans-serif`;
  ctx.fillText('24H NET SETTLEMENT VOLUME', w * 0.065, h * 0.21);

  ctx.fillStyle = '#ECFDF5';
  ctx.font = `700 ${Math.round(h * 0.042)}px -apple-system, sans-serif`;
  ctx.fillText('$42,890,410.00', w * 0.065, h * 0.29);

  // Calm static historical volume bars (highlighted bar on Click 1 at t = 1.1s)
  const heights = [0.42, 0.48, 0.55, 0.51, 0.62, 0.58, 0.67, 0.72, 0.64, 0.76, 0.82, 0.94, 0.78, 0.85, 0.88, 0.91, 0.86, 0.92];
  heights.forEach((ratio, i) => {
    const bx = w * 0.065 + i * (w * 0.026);
    const bh = ratio * (h * 0.14);
    const by = h * 0.47 - bh;
    roundRect(ctx, bx, by, w * 0.017, bh, 4);
    ctx.fillStyle = i === 11 && t >= 1.1 ? '#34D399' : 'rgba(52, 211, 153, 0.30)';
    ctx.fill();
  });

  const settled = t >= 4.8;
  roundRect(ctx, w * 0.59, h * 0.15, w * 0.37, h * 0.76, 12);
  ctx.fillStyle = '#0E2024';
  ctx.fill();
  ctx.strokeStyle = settled ? '#10B981' : 'rgba(255,255,255,0.08)';
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.font = `600 ${Math.round(h * 0.019)}px -apple-system, sans-serif`;
  ctx.fillText('Batch #4092 · Multi-Sig Queue', w * 0.62, h * 0.22);

  const rows = [
    ['Stripe Treasury US-East', '$14,200,000'],
    ['SEPA Instant Eurozone', '$9,450,000'],
    ['Singapore FAST Liquidity', '$11,840,410'],
    ['Tokyo RTGS Reserve', '$7,400,000'],
  ];

  ctx.font = `500 ${Math.round(h * 0.016)}px -apple-system, sans-serif`;
  rows.forEach(([corridor, amt], idx) => {
    const ry = h * 0.32 + idx * (h * 0.085);
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText(corridor!, w * 0.62, ry);
    ctx.fillStyle = '#34D399';
    ctx.font = `600 ${Math.round(h * 0.0155)}px "SF Mono", monospace`;
    ctx.fillText(amt!, w * 0.82, ry);
  });

  roundRect(ctx, w * 0.62, h * 0.64, w * 0.31, h * 0.082, 9);
  ctx.fillStyle = settled ? '#059669' : '#10B981';
  ctx.fill();
  ctx.fillStyle = '#041311';
  ctx.font = `700 ${Math.round(h * 0.0175)}px -apple-system, sans-serif`;
  ctx.fillText(
    settled ? '✓ Batch Settled On-Chain' : 'Authorize Batch  ⇧⌘S',
    w * 0.655,
    h * 0.69,
  );
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
