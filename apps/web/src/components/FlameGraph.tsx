import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { fetchFlamegraphSvg } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------
interface Frame {
  name: string;
  samples: number;
  pct: number;
  x: number;
  y: number;
  w: number;
  depth: number;
  parent: Frame | null;
  children: Frame[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROW_H = 20;
const FONT_SIZE = 11;
const MIN_PX = 1;

// ---------------------------------------------------------------------------
// Color helpers — match C++ flamegraph.cpp palette (warm: red/orange/yellow/green)
// ---------------------------------------------------------------------------
const SLEEP_SET = new Set([
  '__lll_lock_wait','__lll_lock_wait_private','__futex_abstimed_wait_cancelable64',
  '__clock_nanosleep','__pthread_clockjoin_ex','sem_wait','pthread_cond_wait',
  'epoll_wait','nanosleep','poll','select',
]);
const SYNC_SET = new Set(['__pthread_mutex_lock','pthread_mutex_lock']);

function frameColor(name: string, dimmed: boolean): string {
  if (dimmed) return 'rgba(60,60,70,0.6)';
  const base = name.split('(')[0].trim();
  if (SLEEP_SET.has(base)) return 'hsl(220,20%,42%)';
  if (SYNC_SET.has(base) || base.startsWith('std::mutex') || base.startsWith('std::unique_lock'))
    return 'hsl(28,72%,48%)';
  let h = 5381;
  for (let i = 0; i < name.length; i++) h = (Math.imul(33, h) ^ name.charCodeAt(i)) >>> 0;
  const bucket = h % 4;
  const v = h % 40;
  if (bucket === 0) return `rgb(${215 + (v >> 2)},${40 + v},10)`;
  if (bucket === 1) return `rgb(${220 + (v >> 2)},${120 + v},10)`;
  if (bucket === 2) return `rgb(${200 + (v >> 2)},${185 + (v >> 1)},10)`;
  return `rgb(${80 + v},${160 + (v >> 1)},${50 + (v >> 1)})`;
}

// ---------------------------------------------------------------------------
// SVG parser — reads <g class="frame"> elements produced by flamegraph.cpp
// Title format: "name — N samples (X%)"
// ---------------------------------------------------------------------------
interface RawRect { name: string; samples: number; pct: number; x: number; y: number; w: number; }

function parseSvgFlamegraph(svgText: string): Frame[] | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) return null;

  const svgEl = doc.querySelector('svg');
  if (!svgEl) return null;

  const svgW = parseFloat(svgEl.getAttribute('width') || '1200');

  const rawFrames: RawRect[] = [];

  doc.querySelectorAll('g.frame, g[class="frame"]').forEach((g) => {
    const title = g.querySelector('title')?.textContent ?? '';
    const rect = g.querySelector('rect');
    if (!rect) return;

    const x = parseFloat(rect.getAttribute('x') || '0');
    const y = parseFloat(rect.getAttribute('y') || '0');
    const w = parseFloat(rect.getAttribute('width') || '0');
    if (w < 0.1) return;

    let name = title;
    let samples = 0;
    let pct = 0;

    const dashMatch = title.match(/^(.+?)\s+[—\-]+\s+(\d+)\s+samples?\s+\(([\d.]+)%\)/);
    if (dashMatch) {
      name = dashMatch[1].trim();
      samples = parseInt(dashMatch[2], 10);
      pct = parseFloat(dashMatch[3]);
    } else {
      const parenMatch = title.match(/^(.+?)\s+\((\d+)\s+samples?,?\s*([\d.]+)%\)/);
      if (parenMatch) {
        name = parenMatch[1].trim();
        samples = parseInt(parenMatch[2], 10);
        pct = parseFloat(parenMatch[3]);
      }
    }

    rawFrames.push({ name, samples, pct, x, y, w });
  });

  if (rawFrames.length === 0) return null;

  const minY = Math.min(...rawFrames.map(r => r.y));
  const rowH = ROW_H;

  const frames: Frame[] = rawFrames.map(r => ({
    name: r.name,
    samples: r.samples,
    pct: r.pct,
    x: r.x,
    y: r.y,
    w: r.w,
    depth: Math.round((r.y - minY) / rowH),
    parent: null,
    children: [],
  }));

  frames.sort((a, b) => a.depth - b.depth || a.x - b.x);

  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    for (let j = i - 1; j >= 0; j--) {
      const p = frames[j];
      if (p.depth === f.depth - 1 && p.x <= f.x + 0.5 && p.x + p.w >= f.x + f.w - 0.5) {
        f.parent = p;
        p.children.push(f);
        break;
      }
    }
  }

  if (frames[0]?.samples === 0) {
    const root = frames[0];
    root.samples = Math.round(root.w);
    root.pct = 100;
    if (svgW > 0) {
      for (const f of frames) {
        if (f.samples === 0) f.samples = Math.round((f.w / svgW) * root.samples);
        if (f.pct === 0) f.pct = (f.w / svgW) * 100;
      }
    }
  }

  return frames;
}

// ---------------------------------------------------------------------------
// Hit test + render helpers
// ---------------------------------------------------------------------------
interface RenderFrame {
  frame: Frame;
  rx: number;
  ry: number;
  rw: number;
  color: string;
}

function buildRenderList(
  frames: Frame[],
  focused: Frame,
  canvasW: number,
  canvasH: number,
  searchLower: string,
): RenderFrame[] {
  const scale = canvasW / focused.w;
  const depthOffset = focused.depth;
  const result: RenderFrame[] = [];

  for (const f of frames) {
    const rw = f.w * scale;
    if (rw < MIN_PX) continue;
    const rx = (f.x - focused.x) * scale;
    const ry = (f.depth - depthOffset) * ROW_H;
    if (ry < 0 || ry > canvasH + ROW_H) continue;
    if (rx + rw < 0 || rx > canvasW) continue;
    if (f.x < focused.x - 0.5 || f.x + f.w > focused.x + focused.w + 0.5) continue;
    const dimmed = searchLower !== '' && !f.name.toLowerCase().includes(searchLower);
    const highlight = searchLower !== '' && f.name.toLowerCase().includes(searchLower);
    const color = highlight ? 'hsl(55,100%,55%)' : frameColor(f.name, dimmed);
    result.push({ frame: f, rx, ry, rw, color });
  }
  return result;
}

function hitTest(list: RenderFrame[], px: number, py: number): RenderFrame | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i];
    if (px >= r.rx && px < r.rx + r.rw && py >= r.ry && py < r.ry + ROW_H - 1) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface Props { runId?: string; svgContent?: string; fullHeight?: boolean; }

export default function FlameGraph({ runId, svgContent, fullHeight = false }: Props) {
  const { getToken } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [focused, setFocused] = useState<Frame | null>(null);
  const [totalSamples, setTotalSamples] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; rf: RenderFrame } | null>(null);
  const renderListRef = useRef<RenderFrame[]>([]);
  const hoveredRef = useRef<RenderFrame | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFrames(null);
    setFocused(null);

    const handleParsed = (text: string) => {
      if (cancelled) return;
      const parsed = parseSvgFlamegraph(text);
      if (!parsed || parsed.length === 0) {
        setError('Could not parse flamegraph — no frames found.');
        setLoading(false);
        return;
      }
      const root = parsed.find(f => f.depth === 0) ?? parsed[0];
      setFrames(parsed);
      setFocused(root);
      setTotalSamples(root.samples || 1);
      setLoading(false);
    };

    if (svgContent) {
      handleParsed(svgContent);
      return () => { cancelled = true; };
    }

    if (!runId) {
      setError('No run ID provided.');
      setLoading(false);
      return () => { cancelled = true; };
    }

    getToken()
      .then(token => fetchFlamegraphSvg(runId, token))
      .then(handleParsed)
      .catch(e => {
        if (!cancelled) {
          setError(`Failed to load: ${(e as Error).message}`);
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [runId, svgContent, getToken]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !focused || !frames) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, W, H);

    const searchLower = search.toLowerCase();
    const list = buildRenderList(frames, focused, W, H, searchLower);
    renderListRef.current = list;

    ctx.font = `${FONT_SIZE}px ui-monospace,monospace`;

    for (const r of list) {
      const isHovered = hoveredRef.current === r;
      ctx.fillStyle = r.color;
      ctx.fillRect(r.rx, r.ry, r.rw, ROW_H - 1);
      if (isHovered) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(r.rx + 0.75, r.ry + 0.75, r.rw - 1.5, ROW_H - 2.5);
      }
      if (r.rw > 10) {
        ctx.fillStyle = '#fff';
        const maxChars = Math.max(0, Math.floor((r.rw - 6) / (FONT_SIZE * 0.58)));
        if (maxChars >= 2) {
          const label = r.frame.name.length > maxChars
            ? r.frame.name.slice(0, maxChars - 1) + '…'
            : r.frame.name;
          ctx.fillText(label, r.rx + 3, r.ry + ROW_H - 6);
        }
      }
    }
  }, [frames, focused, search]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      canvas.width = Math.floor(width);
      canvas.height = Math.floor(height);
      draw();
    });
    obs.observe(container);
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    return () => obs.disconnect();
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = hitTest(renderListRef.current, px, py);
    if (!hit) return;
    if (hit.frame === focused) {
      setFocused(hit.frame.parent ?? hit.frame);
    } else {
      setFocused(hit.frame);
    }
  }, [focused]);

  const handleDblClick = useCallback(() => {
    if (!frames) return;
    const root = frames.find(f => f.depth === 0) ?? frames[0];
    setFocused(root);
  }, [frames]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const hit = hitTest(renderListRef.current, px, py);
    if (hit !== hoveredRef.current) {
      hoveredRef.current = hit ?? null;
      draw();
    }
    canvas.style.cursor = hit ? 'pointer' : 'default';
    setTooltip(hit ? { x: px, y: py, rf: hit } : null);
  }, [draw]);

  const handleMouseLeave = useCallback(() => {
    hoveredRef.current = null;
    setTooltip(null);
    draw();
  }, [draw]);

  const rootFrame = frames?.find(f => f.depth === 0) ?? null;
  const isZoomed = focused !== null && focused !== rootFrame;

  return (
    <div className={`flex flex-col gap-2${fullHeight ? ' h-full' : ''}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="text"
          placeholder="Search functions…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="px-3 py-1 text-sm bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 w-56"
        />
        {isZoomed && (
          <button
            onClick={handleDblClick}
            className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
          >
            ↩ Reset zoom
          </button>
        )}
        {isZoomed && focused && (
          <span className="text-xs text-blue-400 font-mono truncate max-w-xs">
            {focused.name}
          </span>
        )}
        {frames && (
          <span className="text-xs text-gray-500 ml-auto">
            {totalSamples.toLocaleString()} samples · click to zoom · double-click to reset
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className="relative rounded-lg overflow-hidden border border-gray-700 bg-gray-900"
        style={{ height: fullHeight ? '100%' : '440px' }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm z-10">
            Loading flamegraph…
          </div>
        )}
        {!loading && error && (
          <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm z-10 px-8 text-center">
            {error}
          </div>
        )}
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onDoubleClick={handleDblClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ display: loading || error ? 'none' : 'block', width: '100%', height: '100%' }}
        />
        {tooltip && (
          <div
            className="absolute z-20 pointer-events-none bg-gray-950 border border-gray-600 rounded px-3 py-2 text-xs text-white shadow-xl max-w-xs"
            style={{
              left: Math.min(tooltip.x + 14, (containerRef.current?.clientWidth ?? 600) - 240),
              top: tooltip.y > 220 ? tooltip.y - 72 : tooltip.y + 22,
            }}
          >
            <p className="font-mono break-all leading-snug mb-1">{tooltip.rf.frame.name}</p>
            <p className="text-gray-400">
              {tooltip.rf.frame.pct > 0
                ? `${tooltip.rf.frame.pct.toFixed(2)}% of total`
                : `${((tooltip.rf.frame.samples / totalSamples) * 100).toFixed(2)}% of total`}
            </p>
            {tooltip.rf.frame.samples > 0 && (
              <p className="text-gray-500">{tooltip.rf.frame.samples.toLocaleString()} samples</p>
            )}
            <p className="text-gray-600 mt-0.5">Click to zoom into frame</p>
          </div>
        )}
      </div>
    </div>
  );
}
