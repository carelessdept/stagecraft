import type { DemoScenePreset } from '../state/types.js';
import { clamp } from '../engine/spring.js';

/**
 * Renders a Retina-crisp interactive application viewport at `timeSec`
 * when operating on one of the three built-in procedural product scenes.
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
  // Base IDE background
  ctx.fillStyle = '#0D1017';
  ctx.fillRect(0, 0, w, h);

  // Top sub-bar (toolbar with breadcrumb + Promote button at x=0.83, y=0.12..0.2)
  const barH = h * 0.11;
  ctx.fillStyle = '#111520';
  ctx.fillRect(0, 0, w, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, barH);
  ctx.lineTo(w, barH);
  ctx.stroke();

  // Breadcrumb pill
  ctx.font = `600 ${Math.round(h * 0.022)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.fillStyle = '#94A3B8';
  ctx.fillText('packages / edge-gateway / src /', w * 0.035, barH * 0.58);
  ctx.fillStyle = '#F8FAFC';
  ctx.fillText('edge-router.ts', w * 0.255, barH * 0.58);

  // Status badge + Promote button (around x=0.83, y=0.17 in full window coords)
  const promoted = t >= 7.6;
  const btnX = w * 0.74;
  const btnY = barH * 0.22;
  const btnW = w * 0.22;
  const btnH = barH * 0.58;
  roundRect(ctx, btnX, btnY, btnW, btnH, 8);
  const btnGrad = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY + btnH);
  if (promoted) {
    btnGrad.addColorStop(0, '#10B981');
    btnGrad.addColorStop(1, '#059669');
  } else {
    btnGrad.addColorStop(0, '#6366F1');
    btnGrad.addColorStop(1, '#4F46E5');
  }
  ctx.fillStyle = btnGrad;
  ctx.fill();

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${Math.round(h * 0.021)}px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif`;
  ctx.fillText(
    promoted ? '✓ Live on 310 Edge PoPs (180ms)' : 'Promote Release  ⇧⌘P',
    btnX + w * 0.018,
    btnY + btnH * 0.66,
  );

  // Left sidebar file tree
  const sideW = w * 0.19;
  ctx.fillStyle = '#0A0D14';
  ctx.fillRect(0, barH, sideW, h - barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(sideW, barH);
  ctx.lineTo(sideW, h);
  ctx.stroke();

  const files = [
    ['▸', 'middleware/', '#64748B', false],
    ['▾', 'src/', '#94A3B8', false],
    ['  TS', 'edge-router.ts', '#E2E8F0', true],
    ['  TS', 'rate-limiter.ts', '#94A3B8', false],
    ['  TS', 'jwt-verifier.ts', '#94A3B8', false],
    ['  TS', 'telemetry.ts', '#94A3B8', false],
    ['▾', 'test/', '#94A3B8', false],
    ['  TS', 'canary.spec.ts', '#38BDF8', false],
  ] as const;

  ctx.font = `500 ${Math.round(h * 0.02)}px "SF Mono", "JetBrains Mono", monospace`;
  files.forEach(([icon, name, color, active], i) => {
    const rowY = barH + h * 0.05 + i * (h * 0.052);
    if (active) {
      roundRect(ctx, w * 0.01, rowY - h * 0.032, sideW - w * 0.02, h * 0.044, 6);
      ctx.fillStyle = 'rgba(99, 102, 241, 0.16)';
      ctx.fill();
    }
    ctx.fillStyle = active ? '#818CF8' : '#64748B';
    ctx.fillText(icon, w * 0.018, rowY);
    ctx.fillStyle = color;
    ctx.fillText(name, w * 0.055, rowY);
  });

  // Center Code Editor pane (x: sideW .. w * 0.58)
  const editorW = w * 0.39;
  const codeRight = sideW + editorW;
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.beginPath();
  ctx.moveTo(codeRight, barH);
  ctx.lineTo(codeRight, h);
  ctx.stroke();

  // Highlight active edited line around (0.31, 0.36)
  const editedQuota = t >= 1.0 ? '2_500' : '1_000';
  const savedBadge = t >= 2.2;

  const activeLineY = barH + h * 0.215;
  ctx.fillStyle = t >= 0.9 && t <= 3.4 ? 'rgba(99, 102, 241, 0.16)' : 'rgba(255, 255, 255, 0.03)';
  ctx.fillRect(sideW, activeLineY, editorW, h * 0.05);
  ctx.fillStyle = '#818CF8';
  ctx.fillRect(sideW, activeLineY, 3, h * 0.05);

  const codeLines: Array<[string, string, string]> = [
    ['01', 'import { createSlidingLimiter } from ', '"./rate-limiter";'],
    ['02', 'import { verifyEdgeSignature } from ', '"./jwt-verifier";'],
    ['03', '', ''],
    ['04', 'export const edgePolicy = createSlidingLimiter({', ''],
    ['05', `  windowMs: 60_000, maxRequests: ${editedQuota},`, ' // ⚡ Edge burst cap'],
    ['06', '  burstTolerance: 0.15,', ''],
    ['07', '  regionFailover: "deterministic-ring",', ''],
    ['08', '  onQuotaExceeded: (ctx) => ctx.reject(429),', ''],
    ['09', '});', ''],
    ['10', '', ''],
    ['11', 'export async function handleEdgeRequest(req: Request) {', ''],
    ['12', '  const session = await verifyEdgeSignature(req);', ''],
    ['13', '  return edgePolicy.guard(session, () => route(req));', ''],
    ['14', '}', ''],
  ];

  const fontSize = Math.round(h * 0.0195);
  ctx.font = `500 ${fontSize}px "SF Mono", "JetBrains Mono", monospace`;
  codeLines.forEach(([num, main, tail], idx) => {
    const y = barH + h * 0.065 + idx * (h * 0.046);
    ctx.fillStyle = '#475569';
    ctx.fillText(num, sideW + w * 0.015, y);
    ctx.fillStyle = idx === 4 ? '#38BDF8' : '#E2E8F0';
    ctx.fillText(main, sideW + w * 0.048, y);
    if (tail) {
      ctx.fillStyle = idx === 4 ? '#34D399' : '#A78BFA';
      ctx.fillText(tail, sideW + w * 0.048 + ctx.measureText(main).width, y);
    }
  });

  if (savedBadge) {
    roundRect(ctx, sideW + editorW - w * 0.12, barH + h * 0.02, w * 0.105, h * 0.042, 6);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
    ctx.fill();
    ctx.fillStyle = '#34D399';
    ctx.font = `600 ${Math.round(h * 0.017)}px -apple-system, sans-serif`;
    ctx.fillText('✓ AST Verified', sideW + editorW - w * 0.11, barH + h * 0.047);
  }

  // Right Pane: Top Telemetry Graph + Bottom Canary Test Runner (around x=0.72, y=0.58)
  const rightX = codeRight + w * 0.02;
  const rightW = w - rightX - w * 0.02;

  // Top card: P99 Latency & Edge Throughput
  const card1Y = barH + h * 0.03;
  const card1H = h * 0.34;
  roundRect(ctx, rightX, card1Y, rightW, card1H, 12);
  ctx.fillStyle = '#131824';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.stroke();

  ctx.fillStyle = '#94A3B8';
  ctx.font = `600 ${Math.round(h * 0.018)}px -apple-system, sans-serif`;
  ctx.fillText('GLOBAL EDGE P99 LATENCY', rightX + w * 0.018, card1Y + h * 0.05);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `700 ${Math.round(h * 0.042)}px -apple-system, sans-serif`;
  ctx.fillText(promoted ? '1.42 ms' : '1.84 ms', rightX + w * 0.018, card1Y + h * 0.11);

  ctx.fillStyle = '#34D399';
  ctx.font = `600 ${Math.round(h * 0.018)}px "SF Mono", monospace`;
  ctx.fillText('99.998% SLA · 48.2k req/s', rightX + w * 0.15, card1Y + h * 0.105);

  // Sparkline wave
  ctx.beginPath();
  const sparkStartX = rightX + w * 0.02;
  const sparkW = rightW - w * 0.04;
  const sparkBaseY = card1Y + card1H * 0.76;
  for (let i = 0; i <= 36; i++) {
    const u = i / 36;
    const px = sparkStartX + u * sparkW;
    const wave =
      Math.sin(u * 9 + t * 2.2) * (h * 0.028) +
      Math.cos(u * 17 - t * 1.4) * (h * 0.014);
    const py = sparkBaseY + wave;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = '#38BDF8';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Bottom card: Canary Runner (around x=0.74, y=0.62)
  const card2Y = card1Y + card1H + h * 0.03;
  const card2H = h - card2Y - h * 0.035;
  roundRect(ctx, rightX, card2Y, rightW, card2H, 12);
  ctx.fillStyle = '#090C12';
  ctx.fill();
  ctx.strokeStyle = t >= 4.2 && t <= 6.8 ? 'rgba(56, 189, 248, 0.45)' : 'rgba(255,255,255,0.08)';
  ctx.stroke();

  ctx.fillStyle = '#94A3B8';
  ctx.font = `600 ${Math.round(h * 0.018)}px "SF Mono", monospace`;
  ctx.fillText('zsh — canary-verification-suite', rightX + w * 0.018, card2Y + h * 0.05);

  const testProgress = clamp((t - 4.1) / 1.6, 0, 1);
  const passedCount = Math.round(14 + testProgress * 28);

  const termLines: Array<[string, string]> = [
    ['$ pnpm test:canary --edge-workers', '#E2E8F0'],
    ['✔ sliding-window quota enforcement (1.2ms)', '#34D399'],
    ['✔ burst tolerance replay protection (0.8ms)', '#34D399'],
    [
      testProgress > 0.3
        ? '✔ deterministic regional ring failover (2.1ms)'
        : '⠋ running regional failover simulation...',
      testProgress > 0.3 ? '#34D399' : '#38BDF8',
    ],
    [
      testProgress > 0.75
        ? '✔ zero-downtime hot reload across 310 PoPs (3.4ms)'
        : '⠋ verifying TLS session ticket rotation...',
      testProgress > 0.75 ? '#34D399' : '#38BDF8',
    ],
    [`ℹ Assertions: ${passedCount}/42 passed · 0 failed`, '#A78BFA'],
  ];

  ctx.font = `500 ${Math.round(h * 0.0185)}px "SF Mono", "JetBrains Mono", monospace`;
  termLines.forEach(([line, col], i) => {
    ctx.fillStyle = col;
    ctx.fillText(line, rightX + w * 0.018, card2Y + h * 0.115 + i * (h * 0.055));
  });
}

function renderAiWorkflowScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  ctx.fillStyle = '#0B0914';
  ctx.fillRect(0, 0, w, h);

  // Subtle dot grid
  ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
  const step = Math.max(24, Math.round(w * 0.025));
  for (let gx = step; gx < w; gx += step) {
    for (let gy = step; gy < h; gy += step) {
      ctx.fillRect(gx, gy, 1.5, 1.5);
    }
  }

  // Top Header
  const barH = h * 0.11;
  ctx.fillStyle = 'rgba(18, 15, 32, 0.92)';
  ctx.fillRect(0, 0, w, barH);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `600 ${Math.round(h * 0.023)}px -apple-system, sans-serif`;
  ctx.fillText('Nexus Orchestrator · Production Agent DAG', w * 0.03, barH * 0.6);

  // Execute Button at (0.83, 0.2)
  const executed = t >= 7.6;
  roundRect(ctx, w * 0.74, h * 0.15, w * 0.21, h * 0.08, 10);
  ctx.fillStyle = executed ? '#10B981' : '#9333EA';
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `600 ${Math.round(h * 0.021)}px -apple-system, sans-serif`;
  ctx.fillText(
    executed ? '● Streaming Spans (0.8ms)' : '▶ Execute Pipeline  ⌘↵',
    w * 0.76,
    h * 0.198,
  );

  // 3 Interactive Graph Nodes
  const nodes = [
    {
      x: w * 0.12,
      y: h * 0.34,
      nw: w * 0.24,
      nh: h * 0.24,
      title: '01 · Webhook Ingress',
      subtitle: 'Strict Schema & HMAC Guard',
      metric: '100% Validated',
      accent: '#38BDF8',
    },
    {
      x: w * 0.43,
      y: h * 0.36,
      nw: w * 0.25,
      nh: h * 0.25,
      title: '02 · Policy & Budget Router',
      subtitle: 'P99 < 120ms · Token Cap 4k',
      metric: t >= 4.5 ? 'Guardrails Active' : 'Configuring...',
      accent: '#C084FC',
    },
    {
      x: w * 0.74,
      y: h * 0.38,
      nw: w * 0.21,
      nh: h * 0.23,
      title: '03 · Verified Action Sink',
      subtitle: 'Idempotent Commit Log',
      metric: executed ? '418 Events Committed' : 'Ready',
      accent: '#34D399',
    },
  ];

  // Draw cubic bezier cables + animated pulses between nodes
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
    ctx.strokeStyle = 'rgba(192, 132, 252, 0.45)';
    ctx.lineWidth = 3;
    ctx.stroke();

    const pulseU = (t * 0.9 + i * 0.35) % 1;
    const px = x1 + (x2 - x1) * pulseU;
    const py = y1 + (y2 - y1) * pulseU;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#F472B6';
    ctx.fill();
  }

  nodes.forEach(n => {
    roundRect(ctx, n.x, n.y, n.nw, n.nh, 14);
    ctx.fillStyle = '#151226';
    ctx.fill();
    ctx.strokeStyle = n.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = n.accent;
    ctx.font = `700 ${Math.round(h * 0.021)}px -apple-system, sans-serif`;
    ctx.fillText(n.title, n.x + w * 0.016, n.y + h * 0.06);

    ctx.fillStyle = '#CBD5E1';
    ctx.font = `500 ${Math.round(h * 0.018)}px -apple-system, sans-serif`;
    ctx.fillText(n.subtitle, n.x + w * 0.016, n.y + h * 0.115);

    roundRect(ctx, n.x + w * 0.016, n.y + h * 0.15, n.nw - w * 0.032, h * 0.055, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fill();
    ctx.fillStyle = '#F8FAFC';
    ctx.font = `600 ${Math.round(h * 0.017)}px "SF Mono", monospace`;
    ctx.fillText(n.metric, n.x + w * 0.026, n.y + h * 0.185);
  });
}

function renderFintechScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
): void {
  ctx.fillStyle = '#071212';
  ctx.fillRect(0, 0, w, h);

  // Header
  const barH = h * 0.11;
  ctx.fillStyle = '#0B1C1C';
  ctx.fillRect(0, 0, w, barH);
  ctx.fillStyle = '#F8FAFC';
  ctx.font = `600 ${Math.round(h * 0.024)}px -apple-system, sans-serif`;
  ctx.fillText('Meridian Treasury · Global Liquidity Desk', w * 0.035, barH * 0.6);

  // Volume Metric Card at (0.34, 0.32)
  roundRect(ctx, w * 0.04, h * 0.16, w * 0.52, h * 0.36, 14);
  ctx.fillStyle = '#0E2424';
  ctx.fill();
  ctx.strokeStyle = 'rgba(52, 211, 153, 0.3)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#94A3B8';
  ctx.font = `600 ${Math.round(h * 0.019)}px -apple-system, sans-serif`;
  ctx.fillText('24H NET SETTLEMENT VOLUME (USD CORRIDORS)', w * 0.065, h * 0.22);

  ctx.fillStyle = '#ECFDF5';
  ctx.font = `700 ${Math.round(h * 0.052)}px -apple-system, sans-serif`;
  ctx.fillText('$42,890,410.00', w * 0.065, h * 0.305);

  // Animated Bars
  const barCount = 18;
  for (let i = 0; i < barCount; i++) {
    const bx = w * 0.065 + i * (w * 0.026);
    const bh = (0.35 + 0.55 * Math.abs(Math.sin(i * 0.55 + t * 0.8))) * (h * 0.14);
    const by = h * 0.48 - bh;
    roundRect(ctx, bx, by, w * 0.018, bh, 4);
    ctx.fillStyle = i === 11 && t >= 1.1 ? '#34D399' : 'rgba(52, 211, 153, 0.35)';
    ctx.fill();
  }

  // Right Batch Settlement Card at (0.72, 0.64)
  const settled = t >= 6.4;
  roundRect(ctx, w * 0.59, h * 0.16, w * 0.37, h * 0.76, 14);
  ctx.fillStyle = '#0D2020';
  ctx.fill();
  ctx.strokeStyle = settled ? '#10B981' : 'rgba(255,255,255,0.1)';
  ctx.stroke();

  ctx.fillStyle = '#F8FAFC';
  ctx.font = `600 ${Math.round(h * 0.024)}px -apple-system, sans-serif`;
  ctx.fillText('Batch #4092 · Multi-Sig Queue', w * 0.62, h * 0.23);

  const rows = [
    ['Stripe Treasury US-East', '$14,200,000', 'Verified'],
    ['SEPA Instant Eurozone', '$9,450,000', 'Verified'],
    ['Singapore FAST Liquidity', '$11,840,410', 'Verified'],
    ['Tokyo RTGS Reserve', '$7,400,000', 'Verified'],
  ];

  ctx.font = `500 ${Math.round(h * 0.019)}px "SF Mono", monospace`;
  rows.forEach(([corridor, amt], idx) => {
    const ry = h * 0.33 + idx * (h * 0.09);
    ctx.fillStyle = '#CBD5E1';
    ctx.fillText(corridor!, w * 0.62, ry);
    ctx.fillStyle = '#34D399';
    ctx.fillText(amt!, w * 0.83, ry);
  });

  // Authorize Button at (0.78, 0.74)
  roundRect(ctx, w * 0.62, h * 0.68, w * 0.31, h * 0.095, 10);
  ctx.fillStyle = settled ? '#059669' : '#10B981';
  ctx.fill();
  ctx.fillStyle = '#041311';
  ctx.font = `700 ${Math.round(h * 0.022)}px -apple-system, sans-serif`;
  ctx.fillText(
    settled ? '✓ Batch Settled On-Chain' : 'Sign & Broadcast Batch  ⇧⌘S',
    w * 0.645,
    h * 0.738,
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
