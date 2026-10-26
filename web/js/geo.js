// Local metric frame used everywhere in the scene.
//
// x = east, y = north, in metres, measured in Web Mercator "ground metres" at the
// frame's origin latitude. Using Mercator (not a flat-earth approximation) keeps
// everything we draw lined up with the map tiles and the draped damage swath.

const CIRC = 40075016.686;

export function lngLatToMerc(lon, lat) {
  const s = Math.sin((lat * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function mercToLngLat(x, y) {
  const n = Math.PI - 2 * Math.PI * y;
  return [x * 360 - 180, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
}

export class Frame {
  constructor(lon0, lat0) {
    [this.ox, this.oy] = lngLatToMerc(lon0, lat0);
    this.lon0 = lon0;
    this.lat0 = lat0;
    this.s = 1 / (CIRC * Math.cos((lat0 * Math.PI) / 180)); // Mercator units per metre
  }
  toXY(lon, lat) {
    const [mx, my] = lngLatToMerc(lon, lat);
    return [(mx - this.ox) / this.s, -(my - this.oy) / this.s];
  }
  toLL(x, y) {
    return mercToLngLat(this.ox + x * this.s, this.oy - y * this.s);
  }
}

// A polyline in the local frame with arc-length lookup.
export class Track {
  constructor(frame, lonlats) {
    this.frame = frame;
    const pts = [];
    for (const [lo, la] of lonlats) {
      const p = frame.toXY(lo, la);
      const q = pts[pts.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) pts.push(p);
    }
    if (pts.length < 2) pts.push([pts[0][0] + 1, pts[0][1]]);
    this.xy = pts;
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    this.total = this.cum[this.cum.length - 1];
  }

  // Position and unit direction of travel at distance s (metres) along the track.
  at(s) {
    s = Math.max(0, Math.min(this.total, s));
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / seg;
    const a = this.xy[lo], b = this.xy[hi];
    // Direction smoothed over ~300 m so the chase camera does not twitch at vertices.
    const s0 = Math.max(0, s - 150), s1 = Math.min(this.total, s + 150);
    const p0 = this._pt(s0), p1 = this._pt(s1);
    let dx = p1[0] - p0[0], dy = p1[1] - p0[1];
    const n = Math.hypot(dx, dy) || 1;
    dx /= n; dy /= n;
    return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, dx, dy };
  }

  _pt(s) {
    let lo = 0, hi = this.cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const seg = this.cum[hi] - this.cum[lo] || 1;
    const t = (s - this.cum[lo]) / seg;
    return [this.xy[lo][0] + (this.xy[hi][0] - this.xy[lo][0]) * t,
            this.xy[lo][1] + (this.xy[hi][1] - this.xy[lo][1]) * t];
  }

  bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of this.xy) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return { x0, y0, x1, y1 };
  }
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (dt, tau) => 1 - Math.exp(-dt / tau);
