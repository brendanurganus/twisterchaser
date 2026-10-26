// Small formatting helpers shared by the map page modules.

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const num = (v, d = 0) => v.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
export const dayFmt = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const clockFmt = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export function durText(min) {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

// Day numbers count from January 1 of the data year (0 = Jan 1).
export function dayIndexOf(localDate, year) {
  const [y, m, d] = localDate.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(year, 0, 1)) / 864e5);
}
const utcDay = (idx, year) => new Date(Date.UTC(year, 0, 1 + idx));
export function dayShort(idx, year) {
  return utcDay(idx, year).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
}
export function dayLong(idx, year) {
  return utcDay(idx, year).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}
export function daysInYear(year) {
  return Math.round((Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 864e5);
}
export function monthStartDay(m, year) {
  return Math.round((Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 864e5);
}

// "Union Lake/City, MI" already carries its state; "Kankakee - Roselawn" does not.
export function nameWithState(t) {
  return t.state && !/,\s*[A-Z]{2}$/.test(t.label) ? `${t.label}, ${t.state}` : t.label;
}
