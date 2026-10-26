// Search box: tornadoes by name or nearest town, places, states, and dates ("mar 10", "3/10", "2026-03-10", "april").

import { EF_FILL, EF_LINE } from './config.js';
import { MONTHS, MONTHS_LONG, dayIndexOf, dayLong, monthStartDay, daysInYear, num, dayFmt, ratingLabel } from './format.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function miles(lon1, lat1, lon2, lat2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

export function createSearch({ all, famous = [], cities, stateNames, filters, actions }) {
  const year = filters.year;
  const input = $('searchInput'), list = $('searchList');
  const tIndex = all.map((t) => ({ t, key: `${t.label} ${t.near?.place ?? ''} ${t.state ?? ''} ${stateNames[t.state] ?? ''}`.toLowerCase() }));
  const fIndex = famous.map((t) => ({ t, key: `${t.label} ${t.near?.place ?? ''} ${t.state ?? ''} ${stateNames[t.state] ?? ''} ${t.year} ${t.rating} famous`.toLowerCase() }));
  const cIndex = cities.map((f) => ({ f, key: `${f.properties.name} ${f.properties.st} ${stateNames[f.properties.st] ?? ''}`.toLowerCase() }));
  const stateList = Object.entries(stateNames);
  const nDays = daysInYear(year);

  function parseDate(q) {
    let m;
    const clampDay = (mo, d) => {
      const dt = new Date(Date.UTC(year, mo, d));
      return dt.getUTCMonth() === mo && dt.getUTCDate() === d ? dayIndexOf(dt.toISOString().slice(0, 10), year) : null;
    };
    if ((m = q.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return Number(m[1]) === year ? clampDay(m[2] - 1, +m[3]) : null;
    if ((m = q.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/))) {
      const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : year;
      return y === year ? clampDay(m[1] - 1, +m[2]) : null;
    }
    const mn = (s) => MONTHS_LONG.findIndex((x) => x.toLowerCase().startsWith(s) && s.length >= 3);
    if ((m = q.match(/^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?$/))) {
      const mo = mn(m[1]);
      return mo >= 0 && (!m[3] || Number(m[3]) === year) ? clampDay(mo, +m[2]) : null;
    }
    if ((m = q.match(/^(\d{1,2})\s+([a-z]{3,9})\.?$/))) {
      const mo = mn(m[2]);
      return mo >= 0 ? clampDay(mo, +m[1]) : null;
    }
    return null;
  }
  const parseMonth = (q) => {
    const s = q.replace(/\.$/, '').replace(/\s+\d{4}$/, '');
    if (s.length < 3) return -1;
    return MONTHS_LONG.findIndex((x) => x.toLowerCase().startsWith(s));
  };

  function results(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    // dates and months
    const di = parseDate(q);
    if (di != null) {
      const n = all.filter((t) => t._day === di).length;
      out.push({ group: 'Date', html: `<b>${esc(dayLong(di, year))}</b><small>${n ? `${n} ${n === 1 ? 'tornado' : 'tornadoes'}` : 'no tornadoes recorded'}</small>`,
        run: () => { filters.set({ from: di, to: di, months: new Set() }); actions.fitFiltered(); } });
    } else {
      const mo = parseMonth(q);
      if (mo >= 0) {
        const n = all.filter((t) => t._month === mo).length;
        out.push({ group: 'Date', html: `<b>${MONTHS_LONG[mo]} ${year}</b><small>${n} tornadoes</small>`,
          run: () => { filters.set({ from: monthStartDay(mo, year), to: (mo === 11 ? nDays : monthStartDay(mo + 1, year)) - 1, months: new Set() }); actions.fitFiltered(); } });
      }
    }
    const tokens = q.split(/[\s,]+/).filter(Boolean);
    const allTok = (key) => tokens.every((tok) => key.includes(tok));
    // states
    const sHits = stateList.filter(([code, name]) => q.length === 2 ? code.toLowerCase() === q : name.toLowerCase().startsWith(q));
    for (const [code, name] of sHits.slice(0, 2)) {
      const n = all.filter((t) => t.state === code).length;
      if (!n) continue;
      out.push({ group: 'State', html: `<b>${esc(name)}</b><small>${n} tornadoes. Show only this state</small>`,
        run: () => { filters.set({ state: code }); actions.fitFiltered(); } });
    }
    // famous tornadoes
    for (const { t } of fIndex.filter((x) => allTok(x.key)).slice(0, 4)) {
      out.push({ group: 'Famous', html: `<span class="chip sm" style="background:${EF_FILL[t.efnum]};border-color:${EF_LINE[t.efnum]}">${esc(ratingLabel(t))}</span><span class="nm"><b>${esc(t.label)}</b><small>${esc(t.state ?? '')}, ${esc(dayFmt(t.tz).format(Date.parse(t.start_utc)).replace(/^\w+, /, ''))}</small></span>`,
        run: () => actions.select(t.id) });
    }
    // tornadoes
    const th = tIndex.filter((x) => allTok(x.key)).map((x) => {
      const L = x.t.label.toLowerCase();
      const s = L.startsWith(q) ? 0 : L.split(/[\s-]+/).some((w) => w.startsWith(tokens[0])) ? 1 : 2;
      return { ...x, s };
    }).sort((a, b) => a.s - b.s || b.t.efnum - a.t.efnum || b.t.length_mi - a.t.length_mi).slice(0, 6);
    for (const { t } of th) {
      out.push({ group: 'Tornadoes', html: `<span class="chip sm" style="background:${EF_FILL[t.efnum]};border-color:${EF_LINE[t.efnum]}">EF${t.efnum}</span><span class="nm"><b>${esc(t.label)}</b><small>${esc(t.state ?? '')}, ${esc(dayLong(t._day, year).replace(/^\w+, /, ''))}</small></span>`,
        run: () => actions.select(t.id) });
    }
    // places
    const ch = cIndex.filter((x) => allTok(x.key)).map((x) => ({ ...x, s: x.f.properties.name.toLowerCase().startsWith(tokens[0]) ? 0 : 1 }))
      .sort((a, b) => a.s - b.s || b.f.properties.pop - a.f.properties.pop).slice(0, 5);
    for (const { f } of ch) {
      const [lo, la] = f.geometry.coordinates;
      const near = all.filter((t) => miles(lo, la, t.start[0], t.start[1]) <= 50).length;
      out.push({ group: 'Places', html: `<b>${esc(f.properties.name)}, ${esc(f.properties.st)}</b><small>${near} ${near === 1 ? 'tornado' : 'tornadoes'} within 50 mi in ${year}</small>`,
        run: () => actions.flyToPlace(lo, la) });
    }
    return out;
  }

  let items = [], idx = -1;
  function render() {
    items = results(input.value);
    idx = items.length ? 0 : -1;
    if (!input.value.trim()) { close(); return; }
    let g = '', html = '';
    items.forEach((it, i) => {
      if (it.group !== g) { g = it.group; html += `<li class="grp" role="presentation">${g}</li>`; }
      html += `<li role="option" id="sr${i}" data-i="${i}" aria-selected="${i === idx}">${it.html}</li>`;
    });
    if (!items.length) html = '<li class="none" role="presentation">Nothing found. Try a town, a state, or a date like "mar 10".</li>';
    list.innerHTML = html;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); }
  function setActive(i) {
    idx = i;
    for (const el of list.querySelectorAll('[role=option]')) el.setAttribute('aria-selected', String(Number(el.dataset.i) === idx));
    list.querySelector(`#sr${idx}`)?.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    const it = items[i];
    if (!it) return;
    it.run();
    close();
    input.blur();
  }

  input.addEventListener('input', render);
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setActive((idx + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((idx - 1 + items.length) % items.length); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(idx); }
    else if (e.key === 'Escape') { if (input.value) { input.value = ''; close(); } else input.blur(); }
  });
  list.addEventListener('pointerdown', (e) => { const li = e.target.closest('[role=option]'); if (li) { e.preventDefault(); choose(Number(li.dataset.i)); } });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#search')) close(); });
  addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.target.matches?.('input, textarea, select')) { e.preventDefault(); input.focus(); input.select(); }
  });
  $('searchClear').addEventListener('click', () => { input.value = ''; close(); input.focus(); });
  return { focus: () => input.focus() };
}
