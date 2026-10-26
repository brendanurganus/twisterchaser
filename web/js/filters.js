// Filter model for the map: rating, month, state, deaths and a date window.
// Every other module reads and writes filters here, so the map, timeline, lists and stats stay in step.

import { dayIndexOf, daysInYear } from './format.js';

export function createFilters(all, year) {
  const nDays = daysInYear(year);
  for (const t of all) {
    t._day = dayIndexOf(t.local_date, year);
    t._month = Number(t.local_date.slice(5, 7)) - 1;
  }
  const lastDay = Math.max(...all.map((t) => t._day));
  const fresh = () => ({
    ef: new Set([0, 1, 2, 3, 4, 5]), // ratings shown
    months: new Set(),               // empty means every month
    state: '',                       // '' means every state
    minDeaths: 0,
    from: 0, to: nDays - 1,          // inclusive day window
  });
  let st = fresh();
  let version = 0, cache = null;
  const listeners = new Set();

  // skip: keys to ignore, so a control can show counts "if I changed only this one".
  function matches(t, skip = {}) {
    if (!skip.ef && !st.ef.has(t.efnum)) return false;
    if (!skip.months && st.months.size && !st.months.has(t._month)) return false;
    if (!skip.state && st.state && t.state !== st.state) return false;
    if (!skip.deaths && t.deaths < st.minDeaths) return false;
    if (!skip.time && (t._day < st.from || t._day > st.to)) return false;
    return true;
  }
  const api = {
    nDays, lastDay, year,
    get state() { return st; },
    matches,
    filtered() {
      if (!cache || cache.v !== version) cache = { v: version, list: all.filter((t) => matches(t)) };
      return cache.list;
    },
    isDefault() {
      const d = fresh();
      return st.ef.size === 6 && !st.months.size && !st.state && !st.minDeaths && st.from === d.from && st.to === d.to;
    },
    // patch may hold: ef (Set), months (Set), state, minDeaths, from, to
    set(patch) {
      st = { ...st, ...patch };
      if (st.from > st.to) [st.from, st.to] = [st.to, st.from];
      version++;
      for (const fn of listeners) fn(st);
    },
    reset() { st = fresh(); version++; for (const fn of listeners) fn(st); },
    toggleEF(n) {
      const s = new Set(st.ef);
      if (s.has(n)) s.delete(n); else s.add(n);
      api.set({ ef: s });
    },
    toggleMonth(m) {
      const s = new Set(st.months);
      if (s.has(m)) s.delete(m); else s.add(m);
      api.set({ months: s });
    },
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return api;
}
