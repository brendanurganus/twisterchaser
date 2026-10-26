// Camera presets and a rig that glides MapLibre's camera between them.
//
// Positions are in the local metric frame (x east, y north) plus altitude in
// metres above sea level. MapLibre does the look-at maths for us.

import { LngLat } from '../vendor/maplibre/maplibre-gl.mjs';
import { clamp, smooth } from './geo.js';

export const CAMERA_MODES = [
  { id: 'chase', label: 'Chase', hint: 'Low and behind, like a storm chaser' },
  { id: 'drone', label: 'Drone', hint: 'High overhead' },
  { id: 'side', label: 'Side', hint: 'Alongside the path' },
];

// t: { x, y, dx, dy (unit direction of travel), ground, baseR }
// groundAt(x, y) -> metres above sea level, or null if the terrain tile is not loaded yet.
export function desiredCamera(mode, t, groundAt) {
  const nx = -t.dy, ny = t.dx; // left of travel
  const at = (px, py, h) => (groundAt(px, py) ?? t.ground) + h;
  if (mode === 'drone') {
    // Stay outside the funnel's flared top (about 2.4x the base radius) whatever size it is drawn at,
    // and above the wall cloud (which fades out once the camera is above its base) so the view is never inside it.
    const back = Math.max(1300, t.baseR * 3.8 + 500);
    const px = t.x - t.dx * back + nx * 120, py = t.y - t.dy * back + ny * 120;
    return { x: px, y: py, alt: t.ground + Math.max(1150, back * 0.62), tx: t.x, ty: t.y, talt: t.ground + 40, fov: 45 };
  }
  if (mode === 'side') {
    const off = 2300 + t.baseR * 2.2, ahead = 250;
    const px = t.x + nx * off + t.dx * ahead, py = t.y + ny * off + t.dy * ahead;
    return { x: px, y: py, alt: at(px, py, 150), tx: t.x, ty: t.y, talt: t.ground + 300, fov: 50 };
  }
  // chase: low and behind, looking up at the funnel
  const back = clamp(1700 + t.baseR * 2.0, 1700, 3600);
  const px = t.x - t.dx * back + nx * back * 0.12, py = t.y - t.dy * back + ny * back * 0.12;
  return { x: px, y: py, alt: at(px, py, 30), tx: t.x, ty: t.y, talt: t.ground + 380, fov: 50 };
}

// Whole path in view, seen from the side with the direction of travel running left to right.
export function overviewCamera(track, ground) {
  const b = track.bounds();
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
  const a = track.at(0), z = track.at(track.total);
  let dx = z.x - a.x, dy = z.y - a.y;
  const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
  const nx = -dy, ny = dx;
  const span = Math.max(Math.hypot(b.x1 - b.x0, b.y1 - b.y0), 600);
  const D = Math.max(2200, span * 0.85);
  return { x: cx - nx * D, y: cy - ny * D, alt: ground + D * 0.75, tx: cx, ty: cy, talt: ground, fov: 40 };
}

export class CameraRig {
  constructor(map, frame) {
    this.map = map;
    this.frame = frame;
    this.st = null;
  }

  // Start from wherever the map camera is now, so switching never jumps.
  syncFromMap() {
    const m = this.map;
    const c = m._camera.transform.getCameraLngLat();
    const [x, y] = this.frame.toXY(c.lng, c.lat);
    const ctr = m.getCenter();
    const [tx, ty] = this.frame.toXY(ctr.lng, ctr.lat);
    this.st = {
      x, y, alt: m._camera.transform.getCameraAltitude(),
      tx, ty, talt: m.getCenterElevation?.() ?? 0,
      fov: m.getVerticalFieldOfView(),
    };
  }

  snap(d) { this.st = { ...d }; this.apply(); }

  step(dt, d, tau) {
    if (!this.st) this.syncFromMap();
    const k = smooth(dt, tau);
    const s = this.st;
    for (const key of ['x', 'y', 'alt', 'tx', 'ty', 'talt', 'fov']) s[key] += (d[key] - s[key]) * k;
    this.apply();
  }

  apply() {
    const s = this.st, m = this.map;
    const [lo, la] = this.frame.toLL(s.x, s.y);
    const [tlo, tla] = this.frame.toLL(s.tx, s.ty);
    if (Math.abs(m.getVerticalFieldOfView() - s.fov) > 0.01) m.setVerticalFieldOfView(s.fov);
    m.jumpTo(m.calculateCameraOptionsFromTo(new LngLat(lo, la), s.alt, new LngLat(tlo, tla), s.talt));
  }
}
