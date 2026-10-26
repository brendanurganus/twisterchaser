// Timeline: one bar per day (height = tornadoes that day, color = strongest rating that day).
// Drag the edges to set a date window, drag inside it to slide it, drag outside to start a new one.
// The bars respect every other filter, so you can see where the active days fall.

import { EF_FILL } from './config.js';
import { MONTHS, dayShort, dayLong, monthStartDay, num } from './format.js';

const $ = (id) => document.getElementById(id);

export function createTimeline({ all, filters, showTip, hideTip }) {
  const wrap = $('tlWrap'), canvas = $('tlCanvas'), ctx = canvas.getContext('2d');
  const hL = $('tlHandleL'), hR = $('tlHandleR'), band = $('tlBand');
  const N = filters.nDays, year = filters.year;
  const HEIGHT = 58, AXIS = 16;
  let W = 0, dpr = 1, replayTimer = null; // replayTimer holds a requestAnimationFrame id while replaying

  let days = [];  // [{n, maxEF, deaths}] for the current non-time filters
  function compute() {
    days = Array.from({ length: N }, () => ({ n: 0, maxEF: -1, deaths: 0 }));
    for (const t of all) {
      if (!filters.matches(t, { time: true })) continue;
      const d = days[t._day];
      d.n++; d.deaths += t.deaths;
      if (t.efnum > d.maxEF) d.maxEF = t.efnum;
    }
  }

  const x0 = (i) => (i / N) * W;
  const dayAt = (clientX) => {
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(N - 1, Math.floor(((clientX - r.left) / r.width) * N)));
  };

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = wrap.clientWidth;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round((HEIGHT + AXIS) * dpr);
    canvas.style.height = `${HEIGHT + AXIS}px`;
    draw();
  }

  function draw() {
    const { from, to } = filters.state;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, HEIGHT + AXIS);
    const max = Math.max(1, ...days.map((d) => d.n));
    // Month ticks and labels: quiet, in the haze ink.
    ctx.font = '11.5px system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    for (let m = 0; m < 12; m++) {
      const xs = x0(monthStartDay(m, year)), xe = x0(m === 11 ? N : monthStartDay(m + 1, year));
      ctx.fillStyle = 'rgba(131,152,173,0.28)';
      ctx.fillRect(Math.round(xs), 0, 1, HEIGHT);
      ctx.fillStyle = '#8398ad';
      ctx.textAlign = 'center';
      ctx.fillText(W / 12 > 38 ? MONTHS[m] : MONTHS[m][0], (xs + xe) / 2, HEIGHT + 12);
    }
    // Reference line at the busiest day, labeled once.
    ctx.fillStyle = 'rgba(131,152,173,0.22)';
    ctx.fillRect(0, 0.5, W, 1);
    ctx.textAlign = 'left'; ctx.fillStyle = '#8398ad';
    ctx.fillText(num(max), 4, 12);
    // Bars.
    const bw = Math.max(1, W / N - 0.6);
    for (let i = 0; i < N; i++) {
      const d = days[i];
      if (!d.n) continue;
      const h = Math.max(2, (d.n / max) * (HEIGHT - 4));
      ctx.globalAlpha = i >= from && i <= to ? 1 : 0.26;
      ctx.fillStyle = EF_FILL[d.maxEF];
      ctx.fillRect(x0(i), HEIGHT - h, bw, h);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(131,152,173,0.5)';
    ctx.fillRect(0, HEIGHT, W, 1);
    placeHandles();
  }

  function placeHandles() {
    const { from, to } = filters.state;
    const xl = x0(from), xr = x0(to + 1);
    hL.style.left = `${xl}px`; hR.style.left = `${xr}px`;
    band.style.left = `${xl}px`; band.style.width = `${Math.max(2, xr - xl)}px`;
    const full = from === 0 && to === N - 1;
    band.classList.toggle('full', full);
    hL.setAttribute('aria-valuenow', from); hR.setAttribute('aria-valuenow', to);
    hL.setAttribute('aria-valuetext', dayLong(from, year)); hR.setAttribute('aria-valuetext', dayLong(to, year));
    $('tlRange').textContent = full ? `Full year, ${year}` : from === to ? dayLong(from, year) : `${dayShort(from, year)} to ${dayShort(to, year)}`;
    $('tlFull').hidden = full;
  }

  // ---- dragging -----------------------------------------------------------
  let mode = null, anchor = 0, grab = 0, span = 0;
  wrap.addEventListener('pointerdown', (e) => {
    stopReplay();
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, d = dayAt(e.clientX);
    const { from, to } = filters.state;
    const xl = x0(from), xr = x0(to + 1);
    const full = from === 0 && to === N - 1;
    if (Math.abs(px - xl) <= 11 && !full) mode = 'L';
    else if (Math.abs(px - xr) <= 11 && !full) mode = 'R';
    else if (px > xl && px < xr && !full) { mode = 'move'; grab = d - from; span = to - from; }
    else { mode = 'new'; anchor = d; filters.set({ from: d, to: d }); }
    wrap.setPointerCapture(e.pointerId);
    hideTip();
  });
  wrap.addEventListener('pointermove', (e) => {
    const d = dayAt(e.clientX);
    if (mode) {
      const { from, to } = filters.state;
      if (mode === 'L') filters.set({ from: Math.min(d, to) });
      else if (mode === 'R') filters.set({ to: Math.max(d, from) });
      else if (mode === 'move') {
        const f = Math.max(0, Math.min(N - 1 - span, d - grab));
        filters.set({ from: f, to: f + span });
      } else filters.set({ from: Math.min(anchor, d), to: Math.max(anchor, d) });
      return;
    }
    const day = days[d];
    const rel = e.clientX - canvas.getBoundingClientRect().left;
    wrap.style.cursor = Math.abs(rel - x0(filters.state.from)) <= 11 || Math.abs(rel - x0(filters.state.to + 1)) <= 11 ? 'ew-resize' : 'pointer';
    showTip(day.n
      ? `<b>${dayLong(d, year)}</b>${day.n} ${day.n === 1 ? 'tornado' : 'tornadoes'}, strongest EF${day.maxEF}${day.deaths ? `, ${day.deaths} ${day.deaths === 1 ? 'death' : 'deaths'}` : ''}`
      : `<b>${dayLong(d, year)}</b>no tornadoes`, e.clientX, e.clientY - 34);
  });
  const end = (e) => { mode = null; try { wrap.releasePointerCapture(e.pointerId); } catch { /* not captured */ } };
  wrap.addEventListener('pointerup', end);
  wrap.addEventListener('pointercancel', end);
  wrap.addEventListener('pointerleave', hideTip);
  wrap.addEventListener('dblclick', () => { stopReplay(); filters.set({ from: 0, to: N - 1 }); });

  // Keyboard: arrows move a handle by a day (shift: a week).
  for (const [el, key] of [[hL, 'from'], [hR, 'to']]) {
    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 7 : 1;
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
      if (!dir) return;
      e.preventDefault(); stopReplay();
      const v = Math.max(0, Math.min(N - 1, filters.state[key] + dir * step));
      filters.set({ [key]: v });
    });
  }
  $('tlFull').addEventListener('click', () => { stopReplay(); filters.set({ from: 0, to: N - 1 }); });

  // ---- replay: the year builds up one day at a time ---------------------------
  const replayBtn = $('tlReplay');
  const DAY_MS = 65; // replay speed: about 19 seconds for a year of data
  function stopReplay() {
    if (replayTimer == null) return;
    cancelAnimationFrame(replayTimer); replayTimer = null;
    replayBtn.textContent = 'Replay the year'; replayBtn.setAttribute('aria-pressed', 'false');
  }
  replayBtn.addEventListener('click', () => {
    if (replayTimer != null) { stopReplay(); return; }
    // Driven by the clock, not by a fixed tick, so a slow device skips days instead of stretching the replay.
    const t0 = performance.now();
    let cur = 0;
    filters.set({ from: 0, to: 0 });
    replayBtn.textContent = 'Stop'; replayBtn.setAttribute('aria-pressed', 'true');
    const step = (now) => {
      const d = Math.min(filters.lastDay, Math.floor((now - t0) / DAY_MS));
      if (d !== cur) { cur = d; filters.set({ from: 0, to: d }); }
      if (d >= filters.lastDay) stopReplay(); else replayTimer = requestAnimationFrame(step);
    };
    replayTimer = requestAnimationFrame(step);
  });

  filters.on(() => { compute(); draw(); });
  new ResizeObserver(resize).observe(wrap);
  compute(); resize();
  return { redraw: () => { compute(); draw(); }, stopReplay };
}
