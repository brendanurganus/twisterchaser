// The heads-up display: readout, transport, scrub bar with the warning window,
// and the expandable detail panel (mini-map, warning, survey notes, honesty notes).

import { EF_FILL, EF_LINE, WARNING_RED, YD, MI, NOMINAL_WIDTH_M } from './config.js';
import { CAMERA_MODES } from './cameras.js';
import { clamp } from './geo.js';
import { ratingLabel, trackNotes } from './format.js';

const $ = (id) => document.getElementById(id);

const clockFmt = (tz) => new Intl.DateTimeFormat('en-US', {
  timeZone: tz, hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
const clockShort = (tz) => new Intl.DateTimeFormat('en-US', {
  timeZone: tz, hour: 'numeric', minute: '2-digit' });
const zoneName = (ms, tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
  .formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? '';
const dayFmt = (tz) => new Intl.DateTimeFormat('en-US', {
  timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

export function mmss(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
export function durText(min) {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function chip(el, efnum, label) {
  el.textContent = label ?? `EF${efnum}`;
  el.style.background = EF_FILL[efnum];
  el.style.borderColor = EF_LINE[efnum];
}

function li(parent, html) {
  const e = document.createElement('li');
  e.innerHTML = html;
  parent.appendChild(e);
  return e;
}

export function createHud({ t, warning, swath, track, frame, playable, reason, handlers }) {
  const tz = t.tz;
  const startMs = Date.parse(t.start_utc);
  const durSec = Math.max(1, t.duration_min * 60);
  const cf = clockFmt(tz);

  // ---- header ---------------------------------------------------------
  chip($('efChip'), t.efnum, ratingLabel(t));
  $('tName').textContent = t.label;
  $('tSub').textContent = `${t.state ?? ''}${t.state ? ', ' : ''}${dayFmt(tz).format(startMs)}`;
  $('notes').textContent = t.famous
    ? [t.story, t.notes ? `NWS survey comments:\n${t.notes}` : ''].filter(Boolean).join('\n\n')
    : (t.notes ?? 'No survey notes were entered for this tornado.');
  if (t.famous) for (const el of document.querySelectorAll('[data-notes-title]')) el.textContent = 'About this tornado';
  // Famous tornadoes carry the drawn length separately: the hand-traced or outline-derived path can differ from the SPC length.
  const shownMi = t.drawn_mi ?? t.length_mi;

  // ---- camera + funnel controls ---------------------------------------
  const camGroup = $('camGroup');
  for (const c of CAMERA_MODES) {
    const b = document.createElement('button');
    b.dataset.cam = c.id; b.textContent = c.label; b.title = c.hint;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => handlers.onCamera(c.id));
    camGroup.appendChild(b);
  }
  for (const b of document.querySelectorAll('#funnelGroup button')) {
    b.addEventListener('click', () => handlers.onFunnel(b.dataset.funnel));
  }
  for (const b of document.querySelectorAll('#speeds button')) {
    b.addEventListener('click', () => handlers.onSpeed(Number(b.dataset.speed)));
  }
  $('btnPlay').addEventListener('click', () => handlers.onTogglePlay());
  $('btnRestart').addEventListener('click', () => handlers.onRestart());
  $('btnOverview').addEventListener('click', () => handlers.onOverview());
  $('btnWatch').addEventListener('click', () => handlers.onWatch());
  $('scrubInput').addEventListener('input', (e) => handlers.onSeek(Number(e.target.value) / 1000));
  $('moreBtn').addEventListener('click', () => {
    const open = $('more').hidden;
    $('more').hidden = !open;
    $('moreBtn').setAttribute('aria-expanded', String(open));
    $('moreBtn').textContent = open ? 'Less detail' : 'More detail';
    if (open) handlers.onMoreOpen?.();
  });

  // ---- overview card ---------------------------------------------------
  const facts = $('facts');
  const maxW = swath.maxWidth();
  const widthKnown = t.width_yd != null;
  li(facts, `<b>${num(t.length_mi, 1)} mi</b><span>path length${t.famous && t.drawn_mi && Math.abs(t.drawn_mi - t.length_mi) > 1 ? ` (${num(t.drawn_mi, 1)} drawn)` : ''}</span>`);
  li(facts, `<b>${widthKnown ? num(t.width_yd) + ' yd' : 'not recorded'}</b><span>maximum width</span>`);
  li(facts, `<b>${playable ? durText(t.duration_min) : 'unreliable'}</b><span>on the ground</span>`);
  li(facts, `<b>${t.max_wind_text ?? (t.max_wind_mph ? t.max_wind_mph + ' mph' : 'not recorded')}</b><span>peak wind</span>`);
  li(facts, `<b>${t.deaths} ${t.deaths === 1 ? 'death' : 'deaths'}, ${t.injuries} injured</b><span>human toll</span>`);
  li(facts, `<b>${clockShort(tz).format(startMs)} to ${clockShort(tz).format(Date.parse(t.end_utc))} ${zoneName(startMs, tz)}</b><span>local time</span>`);
  if (warning && t.warning) {
    const l = t.warning.lead_min;
    li(facts, l >= 0
      ? `<b>${num(l, 0)} min of warning</b><span>before the tornado began</span>`
      : `<b>warned ${num(-l, 0)} min late</b><span>after the tornado began</span>`);
  } else {
    li(facts, `<b>no warning matched</b><span>in the NWS archive</span>`);
  }
  $('ovNote').textContent = playable
    ? (t.track_kind === 'traced'
      ? 'Press play to follow the tornado. The path and damage band are approximate: hand-traced through landmarks, drawn at one constant width.'
      : 'Press play to follow the tornado along its path.')
    : `Playback is off for this tornado: ${reason}. The path, damage and survey notes are still here.`;
  $('btnWatch').disabled = !playable;
  $('btnWatch').textContent = 'Play';

  // ---- warning box -----------------------------------------------------
  const wb = $('warnBox');
  if (warning && t.warning) {
    const issued = Date.parse(warning.issued_utc);
    const p1 = document.createElement('p');
    p1.textContent = `NWS ${warning.wfo} issued tornado warning ${warning.etn} at ${cf.format(issued)}.`;
    const p2 = document.createElement('p');
    const l = t.warning.lead_min;
    p2.className = l >= 0 ? 'lead good' : 'lead late';
    p2.textContent = l >= 0
      ? `${num(l, 0)} minutes of lead time before the tornado began.`
      : `Issued ${num(-l, 0)} minutes after the survey says the tornado began.`;
    wb.append(p1, p2);
    const bits = [];
    if (warning.torn_tag) bits.push(`Tornado tag: ${warning.torn_tag.toLowerCase()}`);
    if (warning.damage_tag) bits.push(`Damage threat: ${warning.damage_tag.toLowerCase()}`);
    if (warning.emergency) bits.push('Tornado emergency');
    if (t.warning.tornadoes_in_warning > 1) bits.push(`One warning covered ${t.warning.tornadoes_in_warning} surveyed tornadoes`);
    if (!t.warning.lead_reliable) bits.push('Lead time is uncertain because this survey timing is unreliable');
    if (bits.length) { const p3 = document.createElement('p'); p3.className = 'dim'; p3.textContent = bits.join('. ') + '.'; wb.append(p3); }
  } else {
    wb.textContent = 'No tornado warning polygon covered this track in the NWS archive.';
  }

  // ---- honesty notes ---------------------------------------------------
  const h = $('honesty');
  li(h, 'Position along the path is interpolated from the survey&rsquo;s start and end times at constant speed. Real tornadoes speed up and slow down, and the survey only records two times.');
  for (const n of (t.caveats ?? [])) li(h, esc(n));
  for (const n of trackNotes(t)) li(h, esc(n));
  if (t.famous && t.warning?.warnings_on_path > 1) li(h, `${t.warning.warnings_on_path} tornado warnings touched this path. The lead time is measured from the earliest one that was active when the tornado began. All of them are outlined on the map.`);
  if (swath.approx) {
    li(h, widthKnown
      ? `Damage swath is an approximation: no survey outline exists for this tornado, so it is drawn as a constant band at the maximum surveyed width (${num(t.width_yd)} yd).`
      : `Damage swath is an approximation: no outline or width was recorded, so it is drawn as a constant ${num(NOMINAL_WIDTH_M / YD)} yd band.`);
  } else if (!swath.zoned) {
    li(h, `Damage swath is the NWS damage outline, drawn in one color (the tornado's overall rating) because the survey did not publish separate rating zones. Widest point on screen: ${num(maxW / YD)} yd.`);
  } else {
    li(h, `Damage swath is the NWS survey outline, resampled into slices across the path. Colors are the EF rating of each zone. Widest point on screen: ${num(maxW / YD)} yd.`);
  }
  li(h, 'The funnel is a depiction. Real funnels are usually much narrower than the damage path, so you can switch between a funnel sized to the damage width and a smaller one.');
  li(h, 'Aerial imagery is the current USGS mosaic, not a pre-storm photo.');

  // ---- tags under the transport ------------------------------------------
  const tags = $('tags');
  li(tags, 'Timing estimated');
  li(tags, swath.approx ? 'Swath approximate' : (swath.zoned ? 'Swath from survey outline' : 'Swath one color'));
  if (t.track_kind === 'traced') li(tags, 'Path approximate');
  const fTag = li(tags, 'Funnel depiction'); fTag.id = 'tagFunnel';

  // ---- scrub bar with the warning window --------------------------------
  function drawWarningBand() {
    const band = $('warnBand'), tick = $('warnTick'), cap = $('scrubCaption');
    band.hidden = tick.hidden = true;
    if (!warning || !t.warning) { cap.textContent = 'No tornado warning matched this tornado.'; return; }
    const issuedFrac = (Date.parse(warning.issued_utc) - startMs) / (durSec * 1000);
    const expFrac = (Date.parse(warning.last_expire_utc) - startMs) / (durSec * 1000);
    const l = t.warning.lead_min;
    const a = clamp(issuedFrac, 0, 1), b = clamp(expFrac, 0, 1);
    if (b > a) { band.hidden = false; band.style.left = `${a * 100}%`; band.style.width = `${(b - a) * 100}%`; }
    tick.hidden = false;
    tick.style.left = `${a * 100}%`;
    tick.classList.toggle('before', issuedFrac < 0);
    cap.textContent = l >= 0
      ? `Warning issued ${num(l, 0)} min before the tornado began`
      : `Warning issued ${num(-l, 0)} min after the tornado began`;
    cap.style.color = l >= 0 ? '' : WARNING_RED;
  }
  drawWarningBand();

  // ---- mini-map ---------------------------------------------------------
  const mini = $('mini'), mctx = mini.getContext('2d');
  const warnLocal = warning ? warning.polygon.map(([lo, la]) => frame.toXY(lo, la)) : null;
  const tb = track.bounds();
  let bx0 = tb.x0, by0 = tb.y0, bx1 = tb.x1, by1 = tb.y1;
  if (warnLocal) for (const [x, y] of warnLocal) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
  const bw = Math.max(bx1 - bx0, 400), bh = Math.max(by1 - by0, 400);
  const padPx = 26;
  let fullRings = null;

  function drawMini(sd, pos) {
    if ($('more').hidden) return;
    const W = mini.width, H = mini.height;
    const sc = Math.min((W - 2 * padPx) / bw, (H - 2 * padPx) / bh);
    const cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    const X = (x) => W / 2 + (x - cx) * sc, Y = (y) => H / 2 - (y - cy) * sc;
    mctx.clearRect(0, 0, W, H);
    mctx.fillStyle = '#0a1118'; mctx.fillRect(0, 0, W, H);
    // faint grid
    mctx.strokeStyle = 'rgba(131,152,173,0.12)'; mctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) { mctx.beginPath(); mctx.moveTo(0, (H * i) / 6); mctx.lineTo(W, (H * i) / 6); mctx.stroke(); }
    for (let i = 1; i < 10; i++) { mctx.beginPath(); mctx.moveTo((W * i) / 10, 0); mctx.lineTo((W * i) / 10, H); mctx.stroke(); }
    if (warnLocal) {
      mctx.beginPath();
      warnLocal.forEach(([x, y], i) => (i ? mctx.lineTo(X(x), Y(y)) : mctx.moveTo(X(x), Y(y))));
      mctx.closePath();
      mctx.fillStyle = 'rgba(224,69,58,0.10)'; mctx.fill();
      mctx.strokeStyle = WARNING_RED; mctx.lineWidth = 1.5; mctx.stroke();
    }
    const paintRings = (rings, alpha) => {
      mctx.globalAlpha = alpha;
      for (const r of rings) {
        mctx.beginPath();
        r.ring.forEach(([x, y], i) => (i ? mctx.lineTo(X(x), Y(y)) : mctx.moveTo(X(x), Y(y))));
        mctx.closePath();
        mctx.fillStyle = EF_FILL[r.ef]; mctx.strokeStyle = EF_FILL[r.ef]; mctx.lineWidth = 1;
        mctx.fill(); mctx.stroke();
      }
      mctx.globalAlpha = 1;
    };
    fullRings ??= swath.ringsUpTo(swath.total);
    paintRings(fullRings, 0.22);
    paintRings(swath.ringsUpTo(sd), 1);
    // path
    mctx.beginPath();
    track.xy.forEach(([x, y], i) => (i ? mctx.lineTo(X(x), Y(y)) : mctx.moveTo(X(x), Y(y))));
    mctx.strokeStyle = 'rgba(220,232,242,0.55)'; mctx.lineWidth = 1.2; mctx.setLineDash([4, 4]); mctx.stroke(); mctx.setLineDash([]);
    if (pos) {
      mctx.beginPath(); mctx.arc(X(pos.x), Y(pos.y), 6, 0, Math.PI * 2);
      mctx.fillStyle = '#DCE8F2'; mctx.fill();
      mctx.strokeStyle = '#0a1118'; mctx.lineWidth = 2; mctx.stroke();
    }
    // scale bar
    const km = bw > 20000 ? 10 : bw > 6000 ? 5 : bw > 2500 ? 1 : 0.5;
    const L = km * 1000 * sc;
    mctx.strokeStyle = '#8398AD'; mctx.lineWidth = 2;
    mctx.beginPath(); mctx.moveTo(14, H - 16); mctx.lineTo(14 + L, H - 16); mctx.stroke();
    mctx.fillStyle = '#8398AD'; mctx.font = '20px system-ui, sans-serif';
    mctx.fillText(`${km} km`, 14, H - 24);
  }

  // ---- state setters ------------------------------------------------------
  const api = {
    setMode(mode) {
      const play = mode === 'play';
      const dts = document.querySelectorAll('#stats dt');
      dts[0].textContent = play ? 'Local time' : 'Began (local)';
      dts[2].textContent = play ? 'Width now' : 'Max width';
      dts[3].textContent = play ? 'Rating now' : 'Peak rating';
      $('transport').hidden = !play;
      $('rail').hidden = !play;
      $('overviewCard').hidden = play;
      document.body.dataset.mode = mode;
    },
    setPlaying(p) {
      $('icPause').hidden = !p; $('icPlay').hidden = p;
      $('btnPlay').setAttribute('aria-label', p ? 'Pause' : 'Play');
    },
    setSpeed(s) {
      for (const b of document.querySelectorAll('#speeds button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
    },
    setCamera(id) {
      for (const b of document.querySelectorAll('#camGroup button')) b.setAttribute('aria-pressed', String(b.dataset.cam === id));
    },
    setFunnel(mode) {
      for (const b of document.querySelectorAll('#funnelGroup button')) b.setAttribute('aria-pressed', String(b.dataset.funnel === mode));
      $('funnelNote').textContent = mode === 'damage'
        ? 'Depiction: drawn as wide as the damage path.'
        : 'Illustrative: about 30% of the damage width.';
    },
    setLoading(msg) {
      const el = $('loading');
      el.hidden = !msg;
      if (msg) $('loadingText').textContent = msg;
    },
    // info: { sim, widthM, efNow, pos }
    update(info) {
      const p = clamp(info.sim / durSec, 0, 1);
      $('sTime').textContent = cf.format(startMs + info.sim * 1000);
      $('sDist').textContent = `${num(shownMi * p, 1)} of ${num(shownMi, 1)} mi`;
      $('sWidth').textContent = swath.approx && !widthKnown ? 'not recorded' : `${num(info.widthM / YD)} yd`;
      const ef = $('sEF');
      // Without separate rating zones the bar can only know the tornado's overall rating.
      ef.textContent = swath.zoned ? `EF${info.efNow}` : `${ratingLabel(t)} overall`;
      ef.style.color = EF_FILL[swath.zoned ? info.efNow : t.efnum];
      $('elapsed').textContent = `${mmss(info.sim)} / ${mmss(durSec)}`;
      $('scrubFill').style.width = `${p * 100}%`;
      $('scrubInput').value = String(Math.round(p * 1000));
      drawMini(info.sim / durSec * swath.total, info.pos);
    },
    showOverviewSummary() {
      $('sTime').textContent = `${cf.format(startMs)}`;
      $('sDist').textContent = `${num(shownMi, 1)} mi`;
      $('sWidth').textContent = widthKnown ? `${num(t.width_yd)} yd` : 'not recorded';
      const ef = $('sEF'); ef.textContent = ratingLabel(t); ef.style.color = EF_FILL[t.efnum];
      drawMini(swath.total, null);
    },
    redrawMini(sd, pos) { drawMini(sd, pos); },
  };
  api.setMode('overview');
  api.setFunnel('damage');
  api.setSpeed(1);
  api.setCamera('chase');
  api.showOverviewSummary();
  return api;
}
