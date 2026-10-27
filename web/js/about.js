// Live numbers for the about page, computed from the same data file the map uses so they never go stale.
import { num, dayFmt } from './format.js';

const box = document.getElementById('live');
try {
  const r = await fetch('../data/tornadoes-2026.json');
  if (!r.ok) throw new Error(r.status);
  const d = await r.json();
  const all = d.tornadoes;
  const outline = all.filter((t) => t.has_outline).length;
  const noPlay = all.filter((t) => !t.playable).length;
  const warned = all.filter((t) => t.warning).length;
  const first = all.filter((t) => t.warning && t.warning.lead_min >= 0 && t.warning.lead_reliable).map((t) => t.warning.lead_min).sort((a, b) => a - b);
  const median = first.length ? first[Math.floor(first.length / 2)] : null;
  const pct = (n) => `${Math.round((n / all.length) * 100)}%`;
  const when = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' }).format(Date.parse(d.meta.source_fetched_utc));
  box.innerHTML = `
    <h2>Right now</h2>
    <p class="dim">Source data last pulled ${when}.</p>
    <dl class="nums">
      <div><dt>Rated tornadoes in ${d.meta.year}</dt><dd>${num(all.length)}</dd></div>
      <div><dt>With a real damage outline</dt><dd>${num(outline)} <small>${pct(outline)}</small></dd></div>
      <div><dt>Playback turned off for timing</dt><dd>${num(noPlay)} <small>${pct(noPlay)}</small></dd></div>
      <div><dt>Matched to a tornado warning</dt><dd>${num(warned)} <small>${pct(warned)}</small></dd></div>
      ${median != null ? `<div><dt>Median lead time when warned first</dt><dd>${num(median)} min</dd></div>` : ''}
    </dl>`;
} catch (e) {
  box.innerHTML = '<p class="dim">Current numbers could not be loaded.</p>';
}
