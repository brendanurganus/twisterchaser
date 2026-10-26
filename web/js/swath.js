// The damage swath: a ribbon along the track that can grow behind the tornado.
//
// Two sources feed the same machinery:
//   * Swath.fromProfile  the real NWS damage outline, resampled by the data
//                        pipeline into cross-track slices (one per ~15-120 m).
//                        Each slice has, per EF level, how far the area rated at
//                        or above that level reaches left and right of the track.
//   * Swath.fromBand     no outline exists: a constant band at the surveyed
//                        maximum width. This is an approximation and the UI says so.
//
// Zones are nested (the EF2 core sits inside the EF1 area), so the ribbon is cut
// into non-overlapping strips, one colour each, and drawn as map polygons that
// MapLibre drapes over the terrain.

import { clamp } from './geo.js';

const CHUNK = 48; // stations per static chunk

export class Swath {
  constructor({ frame, s, x, y, levels, A, B, approx }) {
    this.frame = frame;
    this.s = s; this.x = x; this.y = y;
    this.levels = levels;      // EF numbers present, ascending
    this.approx = approx;      // true when drawn as a constant band
    this.n = s.length;
    this.total = s[s.length - 1];
    // unit normal pointing LEFT of travel, from neighbouring station centres
    this.nx = new Array(this.n); this.ny = new Array(this.n);
    for (let i = 0; i < this.n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(this.n - 1, i + 1);
      const tx = x[i1] - x[i0], ty = y[i1] - y[i0];
      const m = Math.hypot(tx, ty) || 1;
      this.nx[i] = -ty / m; this.ny[i] = tx / m;
    }
    // "Pinched" intervals: where a level is absent, collapse it onto the middle of
    // the level below so strips taper to nothing instead of leaving gaps.
    const K = levels.length;
    this.PA = Array.from({ length: K }, () => new Float64Array(this.n));
    this.PB = Array.from({ length: K }, () => new Float64Array(this.n));
    for (let i = 0; i < this.n; i++) {
      for (let k = 0; k < K; k++) {
        const a = A[k][i], b = B[k][i];
        if (b > a) { this.PA[k][i] = a; this.PB[k][i] = b; }
        else if (k === 0) { this.PA[k][i] = 0; this.PB[k][i] = 0; }
        else {
          const mid = (this.PA[k - 1][i] + this.PB[k - 1][i]) / 2;
          this.PA[k][i] = mid; this.PB[k][i] = mid;
        }
      }
    }
    this._chunkCache = new Map();
  }

  static fromProfile(frame, prof) {
    const x = [], y = [];
    for (const [lo, la] of prof.c) { const p = frame.toXY(lo, la); x.push(p[0]); y.push(p[1]); }
    return new Swath({ frame, s: prof.s, x, y, levels: prof.levels, A: prof.a, B: prof.b, approx: false });
  }

  static fromBand(frame, track, widthM, efnum) {
    const n = Math.max(2, Math.ceil(track.total / clamp(track.total / 500, 15, 120)));
    const s = [], x = [], y = [];
    for (let i = 0; i <= n; i++) {
      const si = (track.total * i) / n;
      const p = track.at(si);
      s.push(si); x.push(p.x); y.push(p.y);
    }
    const a = new Array(s.length).fill(-widthM / 2), b = new Array(s.length).fill(widthM / 2);
    return new Swath({ frame, s, x, y, levels: [efnum], A: [a], B: [b], approx: true });
  }

  // Interpolated slice at distance sd along the track.
  sample(sd) {
    sd = clamp(sd, 0, this.total);
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= sd) lo = m; else hi = m; }
    const span = this.s[hi] - this.s[lo] || 1;
    const t = clamp((sd - this.s[lo]) / span, 0, 1);
    const L = (a, b) => a + (b - a) * t;
    let nx = L(this.nx[lo], this.nx[hi]), ny = L(this.ny[lo], this.ny[hi]);
    const m = Math.hypot(nx, ny) || 1; nx /= m; ny /= m;
    const K = this.levels.length;
    const PA = new Array(K), PB = new Array(K);
    for (let k = 0; k < K; k++) { PA[k] = L(this.PA[k][lo], this.PA[k][hi]); PB[k] = L(this.PB[k][lo], this.PB[k][hi]); }
    return { x: L(this.x[lo], this.x[hi]), y: L(this.y[lo], this.y[hi]), nx, ny, PA, PB, lo, hi, t };
  }

  // Width of the whole damage area at sd, and how far its middle sits left of the track.
  extentAt(sd) {
    const q = this.sample(sd);
    return { width: q.PB[0] - q.PA[0], mid: (q.PB[0] + q.PA[0]) / 2, q };
  }

  // Highest EF level with real extent at sd (or the lowest level if none).
  efAt(sd) {
    const q = this.sample(sd);
    for (let k = this.levels.length - 1; k >= 0; k--) if (q.PB[k] - q.PA[k] > 0.5) return this.levels[k];
    return this.levels[0];
  }

  maxWidth() {
    let w = 0;
    for (let i = 0; i < this.n; i++) w = Math.max(w, this.PB[0][i] - this.PA[0][i]);
    return w;
  }

  // Strips (as polygon rings in local metres) for stations i0..i1, plus an
  // optional partial slice at distance sEnd beyond station i1.
  _rings(i0, i1, sEnd) {
    const slices = [];
    for (let i = i0; i <= i1; i++) {
      const PA = this.PA.map((r) => r[i]), PB = this.PB.map((r) => r[i]);
      slices.push({ x: this.x[i], y: this.y[i], nx: this.nx[i], ny: this.ny[i], PA, PB });
    }
    if (sEnd !== undefined && sEnd > this.s[i1] + 0.01) slices.push(this.sample(sEnd));
    if (slices.length < 2) return [];
    const K = this.levels.length, out = [];
    const pt = (sl, u) => [sl.x + sl.nx * u, sl.y + sl.ny * u];
    const push = (ef, outerFn, innerFn) => {
      let maxW = 0;
      const outer = slices.map(outerFn), inner = slices.map(innerFn);
      for (let i = 0; i < slices.length; i++) maxW = Math.max(maxW, Math.abs(outer[i] - inner[i]));
      if (maxW < 0.3) return;
      const ring = [];
      slices.forEach((sl, i) => ring.push(pt(sl, outer[i])));
      for (let i = slices.length - 1; i >= 0; i--) ring.push(pt(slices[i], inner[i]));
      ring.push(ring[0]);
      out.push({ ef, ring });
    };
    for (let k = 0; k < K; k++) {
      const ef = this.levels[k];
      if (k < K - 1) {
        push(ef, (sl) => sl.PB[k], (sl) => sl.PB[k + 1]); // left-hand strip
        push(ef, (sl) => sl.PA[k], (sl) => sl.PA[k + 1]); // right-hand strip
      } else {
        push(ef, (sl) => sl.PB[k], (sl) => sl.PA[k]);     // innermost level, whole width
      }
    }
    return out;
  }

  _toFeatures(rings) {
    return rings.map((r) => ({
      type: 'Feature',
      properties: { ef: r.ef },
      geometry: { type: 'Polygon', coordinates: [r.ring.map(([x, y]) => this.frame.toLL(x, y))] },
    }));
  }

  _chunk(c) {
    if (!this._chunkCache.has(c)) {
      const i0 = c * CHUNK, i1 = Math.min(this.n - 1, (c + 1) * CHUNK);
      this._chunkCache.set(c, i1 > i0 ? this._toFeatures(this._rings(i0, i1)) : []);
    }
    return this._chunkCache.get(c);
  }

  // The whole swath, for the overview.
  all() {
    const f = [];
    for (let c = 0; c * CHUNK < this.n - 1; c++) f.push(...this._chunk(c));
    return { type: 'FeatureCollection', features: f };
  }

  // The swath grown up to distance sd. `done` only changes when a chunk completes,
  // so the caller can leave that map source alone almost every frame.
  upTo(sd) {
    sd = clamp(sd, 0, this.total);
    const idx = Math.min(this.n - 1, Math.max(0, this.sample(sd).lo));
    const cc = Math.floor(idx / CHUNK);
    const done = [];
    for (let c = 0; c < cc; c++) done.push(...this._chunk(c));
    const head = this._toFeatures(this._rings(cc * CHUNK, idx, sd));
    return {
      doneKey: cc,
      done: { type: 'FeatureCollection', features: done },
      head: { type: 'FeatureCollection', features: head },
    };
  }

  // Local-metre rings up to sd, for the mini-map.
  ringsUpTo(sd) {
    sd = clamp(sd, 0, this.total);
    const idx = Math.min(this.n - 1, Math.max(0, this.sample(sd).lo));
    return this._rings(0, idx, sd);
  }
}
