// Playback prototype: follow one tornado along its path.
//
//   playback.html                      -> the 2026 Kankakee-Roselawn EF3
//   playback.html?id=<tornado id>      -> any tornado in data/tornadoes-2026.json
//   &lite=1                            -> force the phone-weight scene
//   &cam=drone|side|chase  &p=0.5      -> start playing from a camera/progress (testing)

import { Map as GLMap, LngLat } from '../vendor/maplibre/maplibre-gl.mjs';
import { Frame, Track, clamp, smooth } from './geo.js';
import { Swath } from './swath.js';
import { StormLayer } from './storm.js';
import { CameraRig, desiredCamera, overviewCamera } from './cameras.js';
import { createHud } from './hud.js';
import * as C from './config.js';

const params = new URLSearchParams(location.search);
const fetchJSON = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r.json();
};
const EMPTY = { type: 'FeatureCollection', features: [] };
const EF_MATCH = ['match', ['get', 'ef'], ...C.EF_FILL.flatMap((c, i) => [i, c]), '#ffffff'];

async function main() {
  const hudLoading = document.getElementById('loading');
  const famousId = (params.get('id') ?? '').startsWith('famous-');
  const [tData, wData] = await Promise.all(famousId
    ? [fetchJSON('../data/famous.json'), fetchJSON('../data/warnings-famous.json')]
    : [fetchJSON('../data/tornadoes-2026.json'), fetchJSON('../data/warnings-2026.json')]);
  const all = tData.tornadoes;
  const t = params.get('id')
    ? all.find((x) => x.id === params.get('id'))
    : all.find((x) => /Kankakee - Roselawn/.test(x.name ?? ''));
  if (!t) throw new Error('Tornado not found');
  const warning = t.warning ? wData[t.warning.key] : null;
  // Famous tornadoes crossed several warnings. The first is the one the lead time is measured from; all of them draw.
  const warningRings = t.famous
    ? Object.values(wData).filter((w) => w.tornado_ids?.includes(t.id)).map((w) => w.polygon)
    : (warning ? [warning.polygon] : []);
  document.getElementById('backToMap').href = `index.html?id=${encodeURIComponent(t.id)}`;

  const frame = new Frame(t.path[0][0], t.path[0][1]);
  const track = new Track(frame, t.path);

  // Swath: the real outline if the pipeline made one, else a constant band.
  let swath = null;
  if (t.has_outline) {
    try { swath = Swath.fromProfile(frame, await fetchJSON(`../data/swaths/${t.id}.json`)); } catch (e) { console.warn(e); }
  }
  if (!swath) swath = Swath.fromBand(frame, track, (t.width_yd ? t.width_yd * C.YD : C.NOMINAL_WIDTH_M), t.efnum);

  const playable = t.playable;
  const durSec = Math.max(1, t.duration_min * 60);

  // ---- map ------------------------------------------------------------
  const lite = C.LITE;
  const map = new GLMap({
    container: 'map',
    center: t.path[0],
    zoom: 11, pitch: 50, bearing: 0,
    maxPitch: 130, minZoom: 3,
    attributionControl: { compact: true, customAttribution: C.ATTRIBUTION },
    pixelRatio: Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2),
    fadeDuration: 0,
    style: {
      version: 8,
      projection: { type: 'mercator' },
      sources: {
        dem: { type: 'raster-dem', tiles: [C.DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: lite ? 12 : 14 },
        imagery: { type: 'raster', tiles: [C.IMAGERY_TILES], tileSize: 256, maxzoom: 16 },
        swathDone: { type: 'geojson', data: EMPTY },
        swathHead: { type: 'geojson', data: EMPTY },
        path: { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: t.path } } },
        warn: {
          type: 'geojson',
          data: warning
            ? { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: warningRings } }
            : EMPTY,
        },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0a1118' } },
        { id: 'imagery', type: 'raster', source: 'imagery',
          paint: { 'raster-brightness-max': 0.66, 'raster-saturation': -0.3, 'raster-contrast': 0.14, 'raster-fade-duration': 0 } },
        { id: 'swath-done', type: 'fill', source: 'swathDone', paint: { 'fill-color': EF_MATCH, 'fill-opacity': 0.7, 'fill-antialias': false } },
        { id: 'swath-head', type: 'fill', source: 'swathHead', paint: { 'fill-color': EF_MATCH, 'fill-opacity': 0.7, 'fill-antialias': false } },
        { id: 'warn-line', type: 'line', source: 'warn', paint: { 'line-color': C.WARNING_RED, 'line-width': 2, 'line-opacity': 0.9 } },
        { id: 'path-line', type: 'line', source: 'path',
          paint: { 'line-color': '#DCE8F2', 'line-width': 1.4, 'line-opacity': 0.6, 'line-dasharray': [2, 2] } },
      ],
      sky: {
        'sky-color': '#1a222b', 'horizon-color': '#8a8467', 'fog-color': '#454b4a',
        'fog-ground-blend': 0.5, 'horizon-fog-blend': 0.8, 'sky-horizon-blend': 0.7, 'atmosphere-blend': 0,
      },
      terrain: { source: 'dem', exaggeration: 1 },
    },
  });
  map.setCenterClampedToGround(false);

  const rig = new CameraRig(map, frame);
  const storm = new StormLayer({ frame });
  const groundAt = (x, y) => {
    const [lo, la] = frame.toLL(x, y);
    const e = map.queryTerrainElevation(new LngLat(lo, la));
    return e == null || Number.isNaN(e) ? null : e;
  };

  // ---- state ------------------------------------------------------------
  const state = {
    mode: 'overview', playing: false, speed: 1, cam: params.get('cam') || 'chase', funnel: 'damage',
    sim: 0, settle: 3, camBlend: 0, baseR: 20, ground: 200, doneKey: -1, lastSwathP: -1, lastHud: 0,
  };
  const setInteractive = (on) => {
    for (const h of ['dragPan', 'dragRotate', 'scrollZoom', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom']) {
      map[h]?.[on ? 'enable' : 'disable']();
    }
  };

  // ---- HUD wiring -------------------------------------------------------
  const hud = createHud({
    t, warning, swath, track, frame, playable, reason: t.timing_issue,
    handlers: {
      onWatch: () => enterPlay(),
      onTogglePlay: () => setPlaying(!state.playing),
      onRestart: () => { seek(0); setPlaying(true); },
      onSpeed: (s) => { state.speed = s; hud.setSpeed(s); },
      onCamera: (id) => { state.cam = id; state.camBlend = 1.8; hud.setCamera(id); },
      onFunnel: (m) => { state.funnel = m; hud.setFunnel(m); },
      onOverview: () => enterOverview(),
      onSeek: (p) => seek(p * durSec),
      onMoreOpen: () => hud.redrawMini(state.sim / durSec * swath.total, currentPos()),
    },
  });
  hud.setCamera(state.cam);

  function setPlaying(p) { state.playing = p; hud.setPlaying(p); }

  function seek(sim) {
    state.sim = clamp(sim, 0, durSec);
    state.lastSwathP = -1;
    updateScene(0, true);
  }

  function currentPos() {
    const q = swath.sample((state.sim / durSec) * swath.total);
    return { x: q.x + q.nx * ((q.PA[0] + q.PB[0]) / 2), y: q.y + q.ny * ((q.PA[0] + q.PB[0]) / 2) };
  }

  function showFullSwath() {
    map.getSource('swathDone').setData(swath.all());
    map.getSource('swathHead').setData(EMPTY);
    state.doneKey = -1; state.lastSwathP = -1;
  }

  function enterOverview() {
    state.mode = 'overview';
    setPlaying(false);
    storm.update({ visible: false });
    setInteractive(true);
    showFullSwath();
    state.settle = 3;
    rig.syncFromMap();
    hud.setMode('overview');
    hud.showOverviewSummary();
  }

  async function enterPlay() {
    if (!playable) return;
    state.mode = 'play';
    state.sim = 0; state.camBlend = 2.2; state.lastSwathP = -1; state.doneKey = -1;
    setInteractive(false);
    rig.syncFromMap();
    hud.setMode('play');
    hud.setCamera(state.cam);
    map.getSource('swathDone').setData(EMPTY);
    map.getSource('swathHead').setData(EMPTY);
    updateScene(0, true);
    setPlaying(true);
  }

  // One frame of the scene. dt in real seconds.
  function updateScene(dt, force) {
    const p = state.sim / durSec;
    const sd = p * swath.total;
    const ext = swath.extentAt(sd);
    const q = ext.q;
    const px = q.x + q.nx * ext.mid, py = q.y + q.ny * ext.mid;
    const dir = track.at(p * track.total);
    const g = groundAt(px, py);
    if (g != null) state.ground += (g - state.ground) * (dt ? smooth(dt, 0.25) : 1);

    // funnel size
    const widthM = Math.max(ext.width, swath.approx && !t.width_yd ? C.NOMINAL_WIDTH_M : 0);
    const targetR = state.funnel === 'damage'
      ? Math.max(10, widthM / 2)
      : Math.max(6, (widthM / 2) * C.REALISTIC_FUNNEL_RATIO);
    state.baseR += (targetR - state.baseR) * (dt ? smooth(dt, 0.3) : 1);
    const topR = clamp(state.baseR * 2.4 + 30, 45, 900);
    const lean = 0.38 * C.WALL_BASE_M;
    storm.update({
      visible: state.mode === 'play', x: px, y: py, ground: state.ground,
      baseR: state.baseR, topR, leanX: -dir.dx * lean, leanZ: dir.dy * lean, vis: 1,
    });

    // camera
    if (state.mode === 'play') {
      const d = desiredCamera(state.cam, { x: px, y: py, dx: dir.dx, dy: dir.dy, ground: state.ground, baseR: state.baseR }, groundAt);
      const tau = state.camBlend > 0 ? 0.8 : 0.22;
      if (force && !dt) rig.snap(d); else rig.step(Math.max(dt, 1e-3), d, tau);
      if (dt) state.camBlend = Math.max(0, state.camBlend - dt);
    }

    // growing swath (throttled; the done part only changes when a chunk completes)
    if (state.mode === 'play' && (force || Math.abs(p - state.lastSwathP) > 0.0004)) {
      const u = swath.upTo(sd);
      if (u.doneKey !== state.doneKey) { map.getSource('swathDone').setData(u.done); state.doneKey = u.doneKey; }
      map.getSource('swathHead').setData(u.head);
      state.lastSwathP = p;
    }

    const now = performance.now();
    if (force || now - state.lastHud > 100) {
      state.lastHud = now;
      hud.update({ sim: state.sim, widthM: ext.width, efNow: swath.efAt(sd), pos: { x: px, y: py } });
    }
  }

  // ---- loop ---------------------------------------------------------------
  let last = performance.now();
  function tick(now) {
    const real = (now - last) / 1000;      // true elapsed time, so playback speed stays honest on slow devices
    const dt = Math.min(0.1, real);        // camera smoothing never takes a bigger step than this
    last = now;
    if (state.mode === 'play') {
      if (state.playing) {
        state.sim = Math.min(durSec, state.sim + Math.min(1, real) * state.speed);
        if (state.sim >= durSec) setPlaying(false);
      }
      updateScene(dt, false);
    } else if (state.settle > 0) {
      const g = groundAt(...track.at(0) && [track.at(0).x, track.at(0).y]) ?? state.ground;
      rig.step(dt, overviewCamera(track, g), 0.7);
      state.settle -= dt;
    }
    requestAnimationFrame(tick);
  }

  // ---- keyboard -----------------------------------------------------------
  addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, textarea')) return;
    const k = e.key.toLowerCase();
    if (k === ' ' && state.mode === 'play') { e.preventDefault(); setPlaying(!state.playing); }
    else if (k === 'c' && state.mode === 'play') {
      const ids = ['chase', 'drone', 'side'];
      state.cam = ids[(ids.indexOf(state.cam) + 1) % 3]; state.camBlend = 1.8; hud.setCamera(state.cam);
    } else if (k === 's' && state.mode === 'play') {
      const sp = [1, 10, 60]; state.speed = sp[(sp.indexOf(state.speed) + 1) % 3]; hud.setSpeed(state.speed);
    } else if (k === 'r' && state.mode === 'play') { seek(0); setPlaying(true); }
    else if (k === 'o' && state.mode === 'play') enterOverview();
  });

  // ---- go ---------------------------------------------------------------
  await new Promise((res) => map.once('load', res));
  map.addLayer(storm);
  storm.update({ visible: false });
  showFullSwath();
  rig.snap(overviewCamera(track, 0));
  hud.setLoading('Loading terrain and aerial imagery');
  await new Promise((res) => map.once('idle', res));
  hud.setLoading(null);
  state.ground = groundAt(track.at(0).x, track.at(0).y) ?? state.ground;
  state.settle = 3;
  requestAnimationFrame(tick);

  // Test and debugging hooks (harmless in production).
  window.tc = {
    state, map, storm, swath, track, frame, t, hud,
    seek: (p) => seek(p * durSec),
    play: () => { if (state.mode !== 'play') enterPlay(); else setPlaying(true); },
    pause: () => setPlaying(false),
    cam: (id) => { state.cam = id; state.camBlend = 0; hud.setCamera(id); },
    funnel: (m) => { state.funnel = m; hud.setFunnel(m); },
    speed: (s) => { state.speed = s; hud.setSpeed(s); },
    overview: () => enterOverview(),
    idle: () => new Promise((res) => (map.loaded() && !map.isMoving() ? map.once('idle', res) : map.once('idle', res))),
  };
  window.tcReady = true;
  if (params.has('p') && playable) { await enterPlay(); setPlaying(false); seek(Number(params.get('p')) * durSec); }
}

main().catch((e) => {
  console.error(e);
  const el = document.getElementById('loadingText');
  if (el) el.textContent = `Could not start: ${e.message}`;
});
