// "The year in tracks": about ten seconds, every surveyed tornado of the year drawn on a flat US map
// in the order it happened. No sound. Skippable (button, Escape, Space, Enter or a tap anywhere).
// It is skipped entirely for people who ask their system for reduced motion, when a link points at one
// tornado, when the page is driven by automation, and after the first play in a browser session.

import { EF_FILL, EF_LINE } from './config.js';
import { num, dayShort } from './format.js';

const SWEEP_MS = 8000, HOLD_MS = 1700, FADE_MS = 700;
const $ = (id) => document.getElementById(id);

export function shouldIntro(params) {
  if (params.get('intro') === '1') return true;
  if (params.get('intro') === '0') return false;
  if (params.has('id') || params.has('view') || params.has('lite')) return false;
  if (navigator.webdriver) return false;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  try { if (sessionStorage.getItem('tc-intro-seen')) return false; } catch { /* storage can be blocked */ }
  return true;
}

// Albers equal-area conic, the usual look for a map of the lower 48.
function albers() {
  const r = Math.PI / 180, p1 = 29.5 * r, p2 = 45.5 * r, p0 = 37.5 * r, l0 = -96 * r;
  const n = (Math.sin(p1) + Math.sin(p2)) / 2;
  const C = Math.cos(p1) ** 2 + 2 * n * Math.sin(p1);
  const rho0 = Math.sqrt(C - 2 * n * Math.sin(p0)) / n;
  return (lon, lat) => {
    const rho = Math.sqrt(C - 2 * n * Math.sin(lat * r)) / n;
    const th = n * (lon * r - l0);
    return [rho * Math.sin(th), rho0 - rho * Math.cos(th)];
  };
}

export function runIntro({ all, states, year }) {
  const root = $('intro');
  const cv = $('introCanvas');
  if (!root || !cv) return Promise.resolve();
  root.hidden = false;
  document.body.classList.add('intro-on');
  const ctx = cv.getContext('2d');
  const project = albers();

  // Lower 48 only: Alaska, Hawaii and territories would shrink the map for no tornado.
  const proj = (lon, lat) => project(lon, lat);
  const items = all
    .filter((t) => t.start[0] > -128 && t.start[0] < -64 && t.start[1] > 23 && t.start[1] < 50)
    .map((t) => ({ t, day: t._day, pts: (t.path.length >= 2 ? t.path : [t.start, t.end]).map(([lo, la]) => proj(lo, la)) }))
    .sort((a, b) => a.t.start_utc.localeCompare(b.t.start_utc));
  const nDays = Math.max(...all.map((t) => t._day)) + 1;
  const stateRings = [];
  for (const f of states.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) for (const ring of poly) {
      if (ring[0][0] > -128 && ring[0][0] < -64 && ring[0][1] > 23 && ring[0][1] < 50) stateRings.push(ring.map(([lo, la]) => proj(lo, la)));
    }
  }

  // Fit the projected bounds into the canvas, leaving room for the date line at the bottom.
  let W = 0, H = 0, dpr = 1, sc = 1, ox = 0, oy = 0, acc = null, actx = null, drawn = 0;
  let b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of stateRings) for (const [x, y] of ring) { b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; }
  const X = (x) => ox + x * sc, Y = (y) => oy - y * sc;
  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const padT = W < 700 ? 90 : 80, padB = W < 700 ? 130 : 150, padX = W < 700 ? 14 : 60;
    sc = Math.min((W - 2 * padX) / (b[2] - b[0]), (H - padT - padB) / (b[3] - b[1]));
    ox = (W - sc * (b[2] - b[0])) / 2 - sc * b[0];
    oy = padT + (H - padT - padB - sc * (b[3] - b[1])) / 2 + sc * b[3];
    acc = document.createElement('canvas'); acc.width = cv.width; acc.height = cv.height;
    actx = acc.getContext('2d');
    actx.scale(dpr, dpr);
    actx.lineCap = 'round'; actx.lineJoin = 'round';
    drawn = 0;
  }
  const stroke = (c, pts, color, w) => {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
    c.strokeStyle = color; c.lineWidth = w; c.stroke();
  };
  const lineW = (ef) => (W < 700 ? 1.8 : 2.4) + ef * (W < 700 ? 0.45 : 0.6);

  const clock = $('introDate'), counter = $('introCount'), sub = $('introSub');
  const totalDeaths = all.reduce((a, t) => a + t.deaths, 0);

  return new Promise((resolve) => {
    let raf = 0, t0 = 0, finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      removeEventListener('keydown', onKey);
      removeEventListener('resize', onResize);
      try { sessionStorage.setItem('tc-intro-seen', '1'); } catch { /* ignore */ }
      root.classList.add('out');
      setTimeout(() => { root.hidden = true; root.classList.remove('out'); document.body.classList.remove('intro-on'); resolve(); }, 450);
    };
    const onKey = (e) => { if (['Escape', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); finish(); } };
    const onResize = () => { layout(); };
    addEventListener('keydown', onKey);
    addEventListener('resize', onResize);
    $('introSkip').onclick = (e) => { e.stopPropagation(); finish(); };
    root.onclick = finish;
    layout();
    $('introSkip').focus({ preventScroll: true });

    function frame(now) {
      if (!t0) t0 = now;
      const el = now - t0;
      const sweep = Math.min(1, el / SWEEP_MS);
      // A touch of ease so the busy spring months do not blur past.
      const dayF = sweep * nDays;
      const dayNow = Math.min(nDays - 1, Math.floor(dayF));

      // draw newly arrived tornadoes onto the accumulation layer
      while (drawn < items.length && items[drawn].day <= dayF) {
        const it = items[drawn++];
        stroke(actx, it.pts, EF_LINE[it.t.efnum], lineW(it.t.efnum) + 1.2);
        stroke(actx, it.pts, EF_FILL[it.t.efnum], lineW(it.t.efnum));
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineJoin = 'round';
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(131,152,173,0.35)';
      for (const ring of stateRings) {
        ctx.beginPath();
        ring.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.stroke();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(acc, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // fresh arrivals glow for a moment
      for (let i = drawn - 1; i >= 0 && i > drawn - 60; i--) {
        const it = items[i];
        const age = (dayF - it.day) / Math.max(1, nDays) * SWEEP_MS;
        if (age > 450) break;
        ctx.globalAlpha = 1 - age / 450;
        stroke(ctx, it.pts, '#ffffff', lineW(it.t.efnum) + 3);
        ctx.globalAlpha = 1;
      }

      clock.textContent = el < SWEEP_MS ? dayShort(dayNow, year).toUpperCase() : `${year}`;
      counter.textContent = `${num(drawn)} ${drawn === 1 ? 'TORNADO' : 'TORNADOES'}`;
      sub.textContent = el < SWEEP_MS
        ? 'Each line is one surveyed tornado. Color is its EF rating.'
        : `${num(totalDeaths)} ${totalDeaths === 1 ? 'death' : 'deaths'} in tornadoes the NWS surveyed.`;

      if (el >= SWEEP_MS + HOLD_MS) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
  });
}
