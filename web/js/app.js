// Twister Chaser main map: every surveyed 2026 tornado on 3D terrain (or a flat overview).
// Filters, timeline, search, top lists and stats all work on the same filter state.
//
//   index.html                  3D terrain view
//   index.html?view=flat        flat overview
//   index.html?id=<id>          open with that tornado selected
//   &lite=1                     force the phone-weight scene (testing)

import { Map as GLMap, LngLatBounds } from '../vendor/maplibre/maplibre-gl.mjs';
import * as C from './config.js';
import { num, dayFmt, clockFmt, durText, nameWithState } from './format.js';
import { createFilters } from './filters.js';
import { createTimeline } from './timeline.js';
import { createDock } from './dock.js';
import { createSearch } from './search.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const fetchJSON = async (u) => {
  const r = await fetch(u);
  if (!r.ok) throw new Error(`${u}: ${r.status}`);
  return r.json();
};
const EF_COLOR = ['match', ['get', 'ef'], ...C.EF_FILL.flatMap((c, i) => [i, c]), '#ffffff'];
const phone = () => matchMedia('(max-width: 760px)').matches;

// City label tiers: [minimum population, first zoom it appears at]. Bigger cities appear earlier and win collisions.
const CITY_TIERS = [[15000, 8.4], [30000, 7.4], [60000, 6.4], [120000, 5.3], [300000, 4.2], [700000, 3.0]];

async function main() {
  const [tData, wData, states, outlines, citiesFC] = await Promise.all([
    fetchJSON('../data/tornadoes-2026.json'),
    fetchJSON('../data/warnings-2026.json'),
    fetchJSON('../data/states.geojson'),
    fetchJSON('../data/outlines-2026.geojson'),
    fetchJSON('../data/cities.geojson'),
  ]);
  const all = tData.tornadoes;
  const year = tData.meta.year;
  const stateNames = Object.fromEntries(states.features.map((f) => [f.properties.st, f.properties.name]));
  // Outline pieces carry "EF1" style text; the map colors by number, and stronger zones draw on top.
  for (const f of outlines.features) f.properties.ef = Number(String(f.properties.ef).replace('EF', ''));
  outlines.features.sort((a, b) => a.properties.ef - b.properties.ef);
  const byId = new Map(all.map((t) => [t.id, t]));
  const lite = C.LITE;
  const filters = createFilters(all, year);

  // ---- header + legend -----------------------------------------------------
  const updated = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })
    .format(Date.parse(tData.meta.source_fetched_utc));
  $('legend').innerHTML = C.EF_FILL.map((c, i) => `<li><i style="background:${c};border-color:${C.EF_LINE[i]}"></i>EF${i}</li>`).join('');
  function updateBrandSub() {
    const n = filters.filtered().length;
    $('brandSub').textContent = filters.isDefault()
      ? `${num(all.length)} surveyed tornadoes in ${year}. Updated ${updated}.`
      : `Showing ${num(n)} of ${num(all.length)} tornadoes. Updated ${updated}.`;
  }

  // ---- track data -------------------------------------------------------------
  const tracks = {
    type: 'FeatureCollection',
    features: all.map((t) => ({
      type: 'Feature',
      properties: { id: t.id, ef: t.efnum, name: t.label, state: t.state },
      geometry: { type: 'LineString', coordinates: t.path.length >= 2 ? t.path : [t.start, t.end] },
    })),
  };

  // ---- map ------------------------------------------------------------------------
  const is3d0 = params.get('view') !== 'flat';
  const widthExpr = (k) => ['interpolate', ['linear'], ['zoom'],
    3, ['+', 1.9 * k, ['*', 0.4 * k, ['get', 'ef']]],
    8, ['+', 2.6 * k, ['*', 0.8 * k, ['get', 'ef']]],
    11, ['+', 4 * k, ['*', 1.2 * k, ['get', 'ef']]],
    // Zoomed in, thin the lines so the real damage swath underneath shows.
    14, ['*', 1.2 * k, 1]];

  const cityLayers = CITY_TIERS.map(([min, minzoom], k) => {
    const next = CITY_TIERS[k + 1]?.[0] ?? 1e12;
    const s = 13 + k * 1.8; // base size grows with tier
    return {
      id: `cities-${k}`, type: 'symbol', source: 'cities', minzoom,
      filter: ['all', ['>=', ['get', 'pop'], min], ['<', ['get', 'pop'], next]],
      layout: {
        'text-field': ['get', 'name'], 'text-font': ['VT323'], 'text-transform': 'uppercase',
        'text-size': ['interpolate', ['linear'], ['zoom'], 3, s, 8, s + 3, 12, s + 6],
        'text-letter-spacing': 0.12, 'text-padding': 4, 'text-max-width': 8,
        'symbol-sort-key': ['*', -1, ['get', 'pop']],
      },
      paint: { 'text-color': '#e6eef6', 'text-halo-color': 'rgba(6,11,16,0.95)', 'text-halo-width': 1.8, 'text-halo-blur': 0.4, 'text-opacity': 0.94 },
    };
  });

  const map = new GLMap({
    container: 'map',
    center: [-96, 38], zoom: 3.4, pitch: is3d0 ? 48 : 0,
    minZoom: 2, maxZoom: 18, maxPitch: 85, renderWorldCopies: false,
    attributionControl: { compact: true, customAttribution: C.ATTRIBUTION },
    pixelRatio: Math.min(window.devicePixelRatio || 1, lite ? 1.5 : 2),
    fadeDuration: 0,
    style: {
      version: 8,
      projection: { type: 'mercator' },
      glyphs: `${new URL('glyphs/', document.baseURI).href}{fontstack}/{range}.pbf`,
      sources: {
        dem: { type: 'raster-dem', tiles: [C.DEM_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: lite ? 10 : 12 },
        imagery: { type: 'raster', tiles: [C.IMAGERY_TILES], tileSize: 256, maxzoom: 16 },
        states: { type: 'geojson', data: states },
        outlines: { type: 'geojson', data: outlines },
        tracks: { type: 'geojson', data: tracks },
        cities: { type: 'geojson', data: citiesFC },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#0a1118' } },
        { id: 'imagery', type: 'raster', source: 'imagery',
          paint: { 'raster-brightness-max': 0.5, 'raster-saturation': -0.55, 'raster-contrast': 0.18, 'raster-fade-duration': 0 } },
        { id: 'flat-land', type: 'fill', source: 'states', layout: { visibility: 'none' },
          paint: { 'fill-color': '#111c27', 'fill-antialias': false } },
        { id: 'state-lines', type: 'line', source: 'states',
          paint: { 'line-color': '#8398ad', 'line-opacity': 0.4, 'line-width': 0.9 } },
        { id: 'outlines', type: 'fill', source: 'outlines', minzoom: 8.5, layout: { 'fill-sort-key': ['get', 'ef'] },
          paint: { 'fill-color': EF_COLOR, 'fill-opacity': 0.7, 'fill-antialias': false } },
        { id: 'outlines-sel', type: 'fill', source: 'outlines', filter: ['==', ['get', 'tid'], ''], layout: { 'fill-sort-key': ['get', 'ef'] },
          paint: { 'fill-color': EF_COLOR, 'fill-opacity': 0.8, 'fill-antialias': false } },
        { id: 'tracks-glow', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-sort-key': ['get', 'ef'] },
          paint: { 'line-color': EF_COLOR, 'line-width': widthExpr(3.2), 'line-blur': 5, 'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.3, 13, 0.08] } },
        { id: 'tracks-case', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-sort-key': ['get', 'ef'] },
          paint: { 'line-color': '#060b10', 'line-width': widthExpr(1.5), 'line-opacity': 0.75 } },
        { id: 'tracks-line', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'ef'] },
          paint: { 'line-color': EF_COLOR, 'line-width': widthExpr(1) } },
        ...cityLayers,
        { id: 'tracks-hover', type: 'line', source: 'tracks', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': widthExpr(1.9), 'line-opacity': 0.55, 'line-blur': 1 } },
        { id: 'tracks-sel', type: 'line', source: 'tracks', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': widthExpr(2.3), 'line-opacity': 0.95 } },
        { id: 'tracks-sel-fill', type: 'line', source: 'tracks', filter: ['==', ['get', 'id'], ''], layout: { 'line-cap': 'round' },
          paint: { 'line-color': EF_COLOR, 'line-width': widthExpr(1.1) } },
        // Wide and invisible: makes thin and short tracks easy to hit with a finger or cursor.
        { id: 'tracks-hit', type: 'line', source: 'tracks', layout: { 'line-cap': 'round' },
          paint: { 'line-color': '#000000', 'line-opacity': 0, 'line-width': 18 } },
      ],
      sky: {
        'sky-color': '#0e1620', 'horizon-color': '#33414f', 'fog-color': '#0a1118',
        'fog-ground-blend': 0.6, 'horizon-fog-blend': 0.7, 'sky-horizon-blend': 0.6, 'atmosphere-blend': 0,
      },
      terrain: is3d0 ? { source: 'dem', exaggeration: 1.4 } : undefined,
    },
  });

  const state = { view: is3d0 ? '3d' : 'flat', selected: null, hover: null };
  const tip = $('tip');
  const showTip = (html, x, y) => { tip.innerHTML = html; tip.style.left = `${x}px`; tip.style.top = `${y}px`; tip.hidden = false; };
  const hideTip = () => { tip.hidden = true; };
  const tlH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tl-h')) || 150;

  // Room taken by the panels, so a flight never ends underneath one.
  const fitPad = () => (phone()
    ? { top: 110, bottom: tlH() + 34, left: 16, right: 16 }
    : { top: 80, bottom: tlH() + 90, left: 390, right: 60 });
  const selPad = () => (phone()
    ? { top: 110, bottom: Math.round(innerHeight * 0.46) + tlH() + 40, left: 16, right: 16 }
    : { top: 90, bottom: tlH() + 90, left: 390, right: 430 });

  // ---- filters drive the map ---------------------------------------------------------
  let applyQueued = false;
  function applyFilters() {
    applyQueued = false;
    const list = filters.filtered().map((t) => t.id);
    if (state.selected && !list.includes(state.selected)) list.push(state.selected);
    const f = list.length ? ['in', ['get', 'id'], ['literal', list]] : ['==', ['get', 'id'], '__none__'];
    for (const l of ['tracks-glow', 'tracks-case', 'tracks-line', 'tracks-hit']) map.setFilter(l, f);
    map.setFilter('outlines', list.length ? ['in', ['get', 'tid'], ['literal', list]] : ['==', ['get', 'tid'], '__none__']);
    updateBrandSub();
  }
  filters.on(() => { if (!applyQueued) { applyQueued = true; requestAnimationFrame(applyFilters); } });

  function fitFiltered(animate = true) {
    let list = filters.filtered();
    if (!list.length) list = all;
    const b = new LngLatBounds();
    for (const t of list) { b.extend(t.start); b.extend(t.end); }
    const three = state.view === '3d';
    map.fitBounds(b, { padding: fitPad(), pitch: three ? 48 : 0, bearing: 0, maxZoom: 10, duration: animate ? 1500 : 0, essential: true });
  }

  // ---- view switching ----------------------------------------------------------------
  function applyView(view, animate = true) {
    state.view = view;
    document.body.dataset.view = view;
    for (const b of document.querySelectorAll('#viewToggle button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
    const three = view === '3d';
    map.setLayoutProperty('imagery', 'visibility', three ? 'visible' : 'none');
    map.setLayoutProperty('flat-land', 'visibility', three ? 'none' : 'visible');
    map.setTerrain(three ? { source: 'dem', exaggeration: 1.4 } : null);
    const t = state.selected && byId.get(state.selected);
    if (t) flyTo(t, animate);
    else map.easeTo({ pitch: three ? 48 : 0, duration: animate ? 1100 : 0 });
    const u = new URL(location.href);
    if (three) u.searchParams.delete('view'); else u.searchParams.set('view', 'flat');
    history.replaceState(null, '', u);
  }
  for (const b of document.querySelectorAll('#viewToggle button')) b.addEventListener('click', () => applyView(b.dataset.view));

  // ---- map controls -----------------------------------------------------------------------
  $('zoomIn').addEventListener('click', () => map.zoomIn({ duration: 350 }));
  $('zoomOut').addEventListener('click', () => map.zoomOut({ duration: 350 }));
  $('resetView').addEventListener('click', () => map.easeTo({ bearing: 0, pitch: state.view === '3d' ? (state.selected ? 55 : 48) : 0, duration: 700 }));
  $('fitAll').addEventListener('click', () => { deselect(); fitFiltered(); });
  map.on('rotate', () => { $('compass').style.transform = `rotate(${-map.getBearing()}deg)`; });
  const help = $('help'), helpBtn = $('helpBtn');
  helpBtn.addEventListener('click', () => { help.hidden = !help.hidden; helpBtn.setAttribute('aria-expanded', String(!help.hidden)); });
  document.addEventListener('pointerdown', (e) => {
    if (!help.hidden && !e.target.closest('#help, #helpBtn')) { help.hidden = true; helpBtn.setAttribute('aria-expanded', 'false'); }
  });

  // ---- fly to a tornado ----------------------------------------------------------------
  function heading(t) {
    const [lo0, la0] = t.start, [lo1, la1] = t.end;
    const dx = (lo1 - lo0) * Math.cos(((la0 + la1) / 2) * Math.PI / 180), dy = la1 - la0;
    return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
  }
  function flyTo(t, animate = true) {
    const b = new LngLatBounds();
    for (const p of t.path) b.extend(p);
    if (!t.path.length) b.extend(t.start).extend(t.end);
    const three = state.view === '3d';
    // Look across the path so the tornado travels left to right on screen.
    const bearing = three ? ((heading(t) - 90 + 360) % 360) : 0;
    map.fitBounds(b, { padding: selPad(), pitch: three ? 55 : 0, bearing, maxZoom: 12.5, duration: animate ? 1700 : 0, essential: true });
  }
  function flyToPlace(lon, lat) {
    map.flyTo({ center: [lon, lat], zoom: 9.6, pitch: state.view === '3d' ? 55 : 0, bearing: 0, duration: 1800, essential: true });
  }

  // ---- detail card ------------------------------------------------------------------------
  function statItem(label, value) {
    const d = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value;
    d.append(dt, dd);
    return d;
  }
  function fillCard(t) {
    const tz = t.tz, start = Date.parse(t.start_utc);
    const chip = $('cChip');
    chip.textContent = `EF${t.efnum}`;
    chip.style.background = C.EF_FILL[t.efnum];
    chip.style.borderColor = C.EF_LINE[t.efnum];
    $('cName').textContent = t.label;
    $('cSub').textContent = `${t.state ?? ''}${t.state ? ', ' : ''}${dayFmt(tz).format(start)}`;
    const n = t.near;
    $('cNear').textContent = n ? `About ${num(n.dist_mi, 1)} mi ${n.dir} of ${n.place}, ${n.state}` : '';

    $('cStats').replaceChildren(
      statItem('Path length', `${num(t.length_mi, 1)} mi`),
      statItem('Max width', t.width_yd != null ? `${num(t.width_yd)} yd` : 'not recorded'),
      statItem('Time on the ground', t.playable ? durText(t.duration_min) : 'unreliable'),
      statItem('Peak wind', t.max_wind_mph ? `${t.max_wind_mph} mph` : 'not recorded'),
      statItem('Began', clockFmt(tz).format(start)),
      statItem('Ended', t.playable ? clockFmt(tz).format(Date.parse(t.end_utc)) : 'unreliable'),
    );

    $('cImpact').textContent = '';
    const deaths = `${t.deaths} ${t.deaths === 1 ? 'death' : 'deaths'}`;
    const inj = `${t.injuries} ${t.injuries === 1 ? 'injury' : 'injuries'}`;
    const p1 = document.createElement('p'); p1.textContent = `${deaths}, ${inj}.`;
    if (t.deaths) p1.style.fontWeight = '600';
    const p2 = document.createElement('p'); p2.className = 'dim'; p2.textContent = 'Property damage is not part of the NWS survey data.';
    $('cImpact').append(p1, p2);

    const w = $('cWarn');
    w.replaceChildren();
    const warning = t.warning ? wData[t.warning.key] : null;
    if (warning) {
      const l = t.warning.lead_min;
      const a = document.createElement('p');
      a.className = l >= 0 ? 'lead good' : 'lead late';
      a.textContent = l >= 0
        ? `${num(l)} ${l === 1 ? 'minute' : 'minutes'} of lead time.`
        : `Warning came ${num(-l)} ${l === -1 ? 'minute' : 'minutes'} after the tornado began.`;
      const b = document.createElement('p');
      b.textContent = `NWS ${warning.wfo} issued tornado warning ${warning.etn} at ${clockFmt(tz).format(Date.parse(warning.issued_utc))}.`;
      w.append(a, b);
      const bits = [];
      if (warning.torn_tag) bits.push(`Tornado tag: ${warning.torn_tag.toLowerCase()}`);
      if (warning.damage_tag) bits.push(`Damage threat: ${warning.damage_tag.toLowerCase()}`);
      if (warning.emergency) bits.push('Tornado emergency');
      if (t.warning.tornadoes_in_warning > 1) bits.push(`One warning covered ${t.warning.tornadoes_in_warning} surveyed tornadoes`);
      if (!t.warning.lead_reliable) bits.push('Lead time is uncertain because the survey timing is unreliable');
      if (bits.length) { const c = document.createElement('p'); c.className = 'dim'; c.textContent = bits.join('. ') + '.'; w.append(c); }
    } else {
      w.textContent = 'No tornado warning matched this tornado in the NWS archive.';
    }

    $('cNotes').textContent = t.notes ?? 'No survey notes were entered for this tornado.';
    $('cNotesWrap').open = false;

    const watch = $('cWatch');
    if (t.playable) {
      watch.href = `playback.html?id=${encodeURIComponent(t.id)}`;
      watch.removeAttribute('aria-disabled');
      $('cWatchNote').textContent = 'Opens an overview of the path first. Press play to follow the tornado.';
    } else {
      watch.removeAttribute('href');
      watch.setAttribute('aria-disabled', 'true');
      $('cWatchNote').textContent = `Playback is off for this tornado: ${t.timing_issue}.`;
    }
    $('cSrc').textContent = `Source: NWS Damage Assessment Toolkit, survey by ${t.wfos?.length ? t.wfos.join(', ') : t.wfo}. Warnings from the Iowa Environmental Mesonet.`;
    $('card').scrollTop = 0;
  }

  function select(id, { fly = true } = {}) {
    const t = id && byId.get(id);
    if (!t) return deselect();
    state.selected = id;
    map.setFilter('tracks-sel', ['==', ['get', 'id'], id]);
    map.setFilter('tracks-sel-fill', ['==', ['get', 'id'], id]);
    map.setFilter('outlines-sel', ['==', ['get', 'tid'], id]);
    fillCard(t);
    $('card').hidden = false;
    if (phone()) dock.close();
    applyFilters(); // keep the selected one drawn even if the filters would hide it
    if (fly) flyTo(t);
    const u = new URL(location.href); u.searchParams.set('id', id); history.replaceState(null, '', u);
  }
  function deselect() {
    if (!state.selected) return;
    state.selected = null;
    for (const l of ['tracks-sel', 'tracks-sel-fill']) map.setFilter(l, ['==', ['get', 'id'], '']);
    map.setFilter('outlines-sel', ['==', ['get', 'tid'], '']);
    $('card').hidden = true;
    applyFilters();
    const u = new URL(location.href); u.searchParams.delete('id'); history.replaceState(null, '', u);
  }
  $('cardClose').addEventListener('click', deselect);
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.target.matches?.('input, select')) return;
    if (!help.hidden) { help.hidden = true; helpBtn.setAttribute('aria-expanded', 'false'); }
    else if (state.selected) deselect();
  });

  // ---- panels, timeline, search ---------------------------------------------------------------
  const dock = createDock({ all, filters, stateNames, showTip, hideTip, onPick: {
    select: (id) => select(id),
    stateChanged: (st) => { if (st) fitFiltered(); },
  } });
  dock.onOpenChange((tab) => { if (tab && phone()) deselect(); });
  createTimeline({ all, filters, showTip, hideTip });
  createSearch({ all, cities: citiesFC.features, stateNames, filters, actions: {
    select: (id) => select(id), flyToPlace, fitFiltered: () => { deselect(); fitFiltered(); },
  } });

  // ---- pointer interaction ----------------------------------------------------------------------
  function pick(point) {
    const hits = map.queryRenderedFeatures(point, { layers: ['tracks-hit'] });
    if (!hits.length) return null;
    // Overlapping tracks: prefer the strongest.
    hits.sort((a, b) => b.properties.ef - a.properties.ef);
    return hits[0].properties;
  }
  map.on('mousemove', (e) => {
    if (e.originalEvent?.pointerType === 'touch') return;
    const p = pick(e.point);
    map.getCanvas().style.cursor = p ? 'pointer' : '';
    if (p) {
      if (state.hover !== p.id) { state.hover = p.id; map.setFilter('tracks-hover', ['==', ['get', 'id'], p.id]); }
      showTip(`<b>EF${p.ef}</b>${nameWithState({ label: p.name, state: p.state })}`, e.originalEvent.clientX, e.originalEvent.clientY);
    } else if (state.hover) {
      state.hover = null; map.setFilter('tracks-hover', ['==', ['get', 'id'], '']); hideTip();
    }
  });
  map.on('mouseout', hideTip);
  map.on('click', (e) => {
    const p = pick(e.point);
    if (p) select(p.id); else if (state.selected) deselect();
  });

  // ---- start ------------------------------------------------------------------------------------------
  await new Promise((res) => map.once('load', res));
  updateBrandSub();
  fitFiltered(false);
  applyView(state.view, false);
  await Promise.race([new Promise((res) => map.once('idle', res)), new Promise((res) => setTimeout(res, 25000))]);
  $('loading').hidden = true;
  if (!phone()) dock.open('filters');
  if (params.has('id') && byId.has(params.get('id'))) select(params.get('id'));

  window.tc = { map, state, select, deselect, applyView, byId, all, filters, dock, fitFiltered };
  window.tcReady = true;
}

main().catch((e) => {
  console.error(e);
  const el = $('loadingText');
  if (el) el.textContent = `Could not start: ${e.message}`;
});
