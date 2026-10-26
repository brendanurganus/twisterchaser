// The left dock: FILTERS, TOP LISTS and STATS. All three read the same filter state,
// so the map, the timeline, the lists and the numbers always describe the same set of tornadoes.

import { EF_FILL, EF_LINE } from './config.js';
import { MONTHS, MONTHS_LONG, num, dayLong, nameWithState } from './format.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const LISTS = [
  { id: 'strongest', label: 'Strongest', empty: 'No tornadoes match.',
    pick: (L) => [...L].sort((a, b) => b.efnum - a.efnum || (b.max_wind_mph ?? 0) - (a.max_wind_mph ?? 0) || b.length_mi - a.length_mi),
    val: (t) => (t.max_wind_mph ? `${t.max_wind_mph} mph` : `EF${t.efnum}`) },
  { id: 'deadliest', label: 'Deadliest', empty: 'None of these tornadoes caused deaths.',
    pick: (L) => L.filter((t) => t.deaths > 0).sort((a, b) => b.deaths - a.deaths || b.injuries - a.injuries),
    val: (t) => `${t.deaths} ${t.deaths === 1 ? 'death' : 'deaths'}` },
  { id: 'longest', label: 'Longest', empty: 'No tornadoes match.',
    pick: (L) => [...L].sort((a, b) => b.length_mi - a.length_mi),
    val: (t) => `${num(t.length_mi, 1)} mi` },
  { id: 'widest', label: 'Widest', empty: 'No widths were recorded for these tornadoes.',
    pick: (L) => L.filter((t) => t.width_yd != null).sort((a, b) => b.width_yd - a.width_yd),
    val: (t) => `${num(t.width_yd)} yd` },
];

export function createDock({ all, filters, stateNames, onPick, showTip, hideTip }) {
  const year = filters.year;
  const dock = $('dock'), tabs = [...document.querySelectorAll('#dockTabs button')];
  const panels = { filters: $('panelFilters'), lists: $('panelLists'), stats: $('panelStats') };
  let active = null, listKind = 'strongest';
  const openListeners = new Set();

  // ---- tabs ---------------------------------------------------------------
  function open(tab) {
    active = tab;
    dock.dataset.open = tab ? 'true' : 'false';
    $('dockBody').hidden = !tab;
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== tab;
    if (tab) render();
    for (const fn of openListeners) fn(tab);
  }
  for (const b of tabs) b.addEventListener('click', () => open(active === b.dataset.tab ? null : b.dataset.tab));

  // ---- FILTERS --------------------------------------------------------------
  const P = panels.filters;
  const states = [...new Set(all.map((t) => t.state).filter(Boolean))].sort((a, b) => (stateNames[a] ?? a).localeCompare(stateNames[b] ?? b));
  P.innerHTML = `
    <h3>Rating</h3>
    <div class="chips" id="fEF">${[0, 1, 2, 3, 4, 5].map((i) => `
      <button data-ef="${i}" aria-pressed="true"><i style="background:${EF_FILL[i]};border-color:${EF_LINE[i]}"></i><b>EF${i}</b><span></span></button>`).join('')}</div>
    <h3>Month</h3>
    <div class="chips months" id="fMonth">${MONTHS.map((m, i) => `<button data-m="${i}" aria-pressed="false" title="${MONTHS_LONG[i]}"><b>${m}</b><span></span></button>`).join('')}</div>
    <h3>State</h3>
    <select id="fState" aria-label="State"><option value="">All states</option>${states.map((s) => `<option value="${s}"></option>`).join('')}</select>
    <h3>Deaths</h3>
    <div class="seg" id="fDeaths"><button data-d="0">Any</button><button data-d="1">1 or more</button><button data-d="2">2 or more</button></div>
    <p class="result"><span id="fCount"></span> <button id="fReset" class="link">Reset filters</button></p>`;
  $('fEF').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) filters.toggleEF(Number(b.dataset.ef)); });
  $('fMonth').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) filters.toggleMonth(Number(b.dataset.m)); });
  $('fState').addEventListener('change', (e) => { filters.set({ state: e.target.value }); onPick.stateChanged?.(e.target.value); });
  $('fDeaths').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) filters.set({ minDeaths: Number(b.dataset.d) }); });
  $('fReset').addEventListener('click', () => filters.reset());

  function renderFilters() {
    const st = filters.state;
    const cnt = (skip, key) => { const c = {}; for (const t of all) if (filters.matches(t, skip)) { const k = key(t); c[k] = (c[k] ?? 0) + 1; } return c; };
    const ef = cnt({ ef: true }, (t) => t.efnum), mo = cnt({ months: true }, (t) => t._month), sc = cnt({ state: true }, (t) => t.state);
    for (const b of $('fEF').children) { const i = Number(b.dataset.ef); b.setAttribute('aria-pressed', String(st.ef.has(i))); b.lastElementChild.textContent = num(ef[i] ?? 0); b.classList.toggle('zero', !(ef[i])); }
    for (const b of $('fMonth').children) { const i = Number(b.dataset.m); b.setAttribute('aria-pressed', String(st.months.has(i))); b.lastElementChild.textContent = mo[i] ?? 0; b.classList.toggle('zero', !(mo[i])); }
    for (const o of $('fState').options) if (o.value) o.textContent = `${stateNames[o.value] ?? o.value} (${sc[o.value] ?? 0})`;
    $('fState').value = st.state;
    const dn = (k) => all.filter((t) => filters.matches(t, { deaths: true }) && t.deaths >= k).length;
    for (const b of $('fDeaths').children) { const k = Number(b.dataset.d); b.setAttribute('aria-pressed', String(st.minDeaths === k)); b.title = `${num(dn(k))} tornadoes`; }
    const n = filters.filtered().length;
    $('fCount').textContent = filters.isDefault() ? `All ${num(all.length)} tornadoes` : `${num(n)} of ${num(all.length)} tornadoes`;
    $('fReset').hidden = filters.isDefault();
  }

  // ---- TOP LISTS ----------------------------------------------------------------
  const LP = panels.lists;
  LP.innerHTML = `
    <div class="seg lists" id="lKinds" role="tablist">${LISTS.map((l) => `<button data-k="${l.id}" role="tab">${l.label}</button>`).join('')}</div>
    <p class="dim" id="lNote"></p>
    <ol class="toplist" id="lList"></ol>`;
  $('lKinds').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { listKind = b.dataset.k; renderLists(); } });
  $('lList').addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) onPick.select(b.dataset.id); });

  function renderLists() {
    const spec = LISTS.find((l) => l.id === listKind);
    for (const b of $('lKinds').children) b.setAttribute('aria-selected', String(b.dataset.k === listKind));
    const L = filters.filtered();
    const rows = spec.pick(L).slice(0, 10);
    $('lNote').textContent = filters.isDefault() ? `Top 10 of all ${num(all.length)} tornadoes.` : `Top 10 of the ${num(L.length)} tornadoes that match your filters.`;
    $('lList').innerHTML = rows.length ? rows.map((t, i) => `
      <li><button data-id="${t.id}">
        <span class="rk">${i + 1}</span>
        <span class="chip sm" style="background:${EF_FILL[t.efnum]};border-color:${EF_LINE[t.efnum]}">EF${t.efnum}</span>
        <span class="nm">${esc(t.label)}<small>${esc(t.state ?? '')}, ${dayLong(t._day, year).replace(/^\w+, /, '').replace(/, \d{4}$/, '')}</small></span>
        <span class="val">${esc(spec.val(t))}</span>
      </button></li>`).join('') : `<li class="none">${spec.empty}</li>`;
  }

  // ---- STATS ---------------------------------------------------------------------
  const SP = panels.stats;
  function renderStats() {
    const L = filters.filtered();
    const N = L.length;
    const sum = (f) => L.reduce((a, t) => a + f(t), 0);
    const efc = [0, 0, 0, 0, 0, 0];
    const mon = Array.from({ length: 12 }, () => [0, 0, 0, 0, 0, 0]);
    const byState = {}, byDay = {};
    for (const t of L) {
      efc[t.efnum]++; mon[t._month][t.efnum]++;
      if (t.state) byState[t.state] = (byState[t.state] ?? 0) + 1;
      byDay[t.local_date] = (byDay[t.local_date] ?? 0) + 1;
    }
    const strongest = [...L].sort((a, b) => b.efnum - a.efnum || (b.max_wind_mph ?? 0) - (a.max_wind_mph ?? 0))[0];
    const deadliest = [...L].filter((t) => t.deaths > 0).sort((a, b) => b.deaths - a.deaths)[0];
    const busy = Object.entries(byDay).sort((a, b) => b[1] - a[1])[0];
    const warned = L.filter((t) => t.warning && t.warning.lead_min >= 0 && t.warning.lead_reliable).length;
    const unwarned = L.filter((t) => !t.warning).length;
    const topStates = Object.entries(byState).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
    const maxState = topStates[0]?.[1] ?? 1, maxEF = Math.max(1, ...efc);
    const monTot = mon.map((m) => m.reduce((a, b) => a + b, 0)), maxMon = Math.max(1, ...monTot);
    const tl = (t) => `<button class="pick" data-id="${t.id}">${esc(nameWithState(t))}</button>`;

    if (!N) { SP.innerHTML = '<p class="dim">No tornadoes match your filters.</p>'; return; }
    SP.innerHTML = `
      <p class="dim">${filters.isDefault() ? `All ${num(all.length)} tornadoes of ${year}.` : `${num(N)} of ${num(all.length)} tornadoes match your filters.`}</p>
      <div class="big4">
        <div><b>${num(N)}</b><span>Tornadoes</span></div>
        <div><b>${num(sum((t) => t.deaths))}</b><span>Deaths</span></div>
        <div><b>${num(sum((t) => t.injuries))}</b><span>Injuries</span></div>
        <div><b>${num(sum((t) => t.length_mi))}</b><span>Miles of path</span></div>
      </div>
      <dl class="facts2">
        <div><dt>Strongest</dt><dd>EF${strongest.efnum}${strongest.max_wind_mph ? `, ${strongest.max_wind_mph} mph` : ''}: ${tl(strongest)}</dd></div>
        ${deadliest ? `<div><dt>Deadliest</dt><dd>${deadliest.deaths} ${deadliest.deaths === 1 ? 'death' : 'deaths'}: ${tl(deadliest)}</dd></div>` : ''}
        <div><dt>Busiest day</dt><dd>${num(busy[1])} tornadoes on ${esc(dayLong(L.find((t) => t.local_date === busy[0])._day, year).replace(/^\w+, /, ''))}</dd></div>
        <div><dt>Warned first</dt><dd>${Math.round((warned / N) * 100)}% had a tornado warning issued before they began; ${Math.round((unwarned / N) * 100)}% matched no warning</dd></div>
      </dl>
      <h3>By rating</h3>
      <div class="hbars">${efc.map((n, i) => `
        <div class="hb" data-tip="EF${i}: ${num(n)}"><span class="lab">EF${i}</span><span class="track"><i style="width:${(n / maxEF) * 100}%;background:${EF_FILL[i]}"></i></span><span class="n">${num(n)}</span></div>`).join('')}</div>
      <h3>By month</h3>
      <div class="cols" id="monCols">${mon.map((m, mi) => `
        <div class="col" data-m="${mi}"><div class="stack">${m.map((n, i) => n ? `<i style="height:${Math.max(2, (n / maxMon) * 96)}px;background:${EF_FILL[i]}"></i>` : '').reverse().join('')}</div><span>${MONTHS[mi][0]}</span></div>`).join('')}</div>
      <h3>Top states</h3>
      <div class="hbars">${topStates.map(([s, n]) => `
        <div class="hb"><span class="lab">${s}</span><span class="track"><i class="ice" style="width:${(n / maxState) * 100}%"></i></span><span class="n">${num(n)}</span></div>`).join('')}</div>
      <details class="tbl"><summary>Table view</summary>
        <table><thead><tr><th>Month</th>${[0, 1, 2, 3, 4, 5].map((i) => `<th>EF${i}</th>`).join('')}<th>All</th></tr></thead>
        <tbody>${mon.map((m, mi) => monTot[mi] ? `<tr><th>${MONTHS[mi]}</th>${m.map((n) => `<td>${n || ''}</td>`).join('')}<td>${monTot[mi]}</td></tr>` : '').join('')}</tbody></table>
      </details>`;
    // Hover on the month columns.
    for (const c of SP.querySelectorAll('.col')) {
      const mi = Number(c.dataset.m);
      c.addEventListener('pointermove', (e) => showTip(`<b>${MONTHS_LONG[mi]}</b>${monTot[mi]} tornadoes` + mon[mi].map((n, i) => (n ? `<br>EF${i}: ${n}` : '')).join(''), e.clientX, e.clientY - 18));
      c.addEventListener('pointerleave', hideTip);
    }
    SP.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => onPick.select(b.dataset.id)));
  }

  function render() {
    if (active === 'filters') renderFilters();
    else if (active === 'lists') renderLists();
    else if (active === 'stats') renderStats();
  }
  filters.on(render);
  open(null);
  return { open, close: () => open(null), get active() { return active; }, onOpenChange: (fn) => openListeners.add(fn), render };
}
