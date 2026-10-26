// Shared constants for Twister Chaser.

// SPC convective-outlook categorical fills, read from SPC's own outlook GeoJSON
// (TSTM, MRGL, SLGT, ENH, MDT, HIGH). EF0..EF5 map onto them in order.
export const EF_FILL = ['#C1E9C1', '#66A366', '#FFE066', '#FFA366', '#E06666', '#EE99EE'];
// SPC's matching line colors, used for thin outlines and chips' borders.
export const EF_LINE = ['#55BB55', '#2E7D32', '#DDAA00', '#FF6600', '#CC0000', '#CC00CC'];
export const WARNING_RED = '#E0453A';

// Free terrain and imagery, no keys. Credit both everywhere they appear.
export const DEM_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const IMAGERY_TILES =
  'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
export const ATTRIBUTION = [
  'Imagery: <a href="https://www.usgs.gov/core-science-systems/ngp/tnm-delivery/" target="_blank" rel="noopener">USGS The National Map</a> (USDA NAIP)',
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS Terrain Tiles</a>',
  'Tracks: <a href="https://apps.dat.noaa.gov/StormDamage/DamageViewer/" target="_blank" rel="noopener">NWS Damage Assessment Toolkit</a>',
  'Warnings: <a href="https://mesonet.agron.iastate.edu/" target="_blank" rel="noopener">Iowa Environmental Mesonet</a>',
];

const q = new URLSearchParams(location.search);

// Phones and low-memory devices get the lighter scene automatically.
// ?lite=1 or ?lite=0 forces either way (handy for testing).
function detectLite() {
  if (q.has('lite')) return q.get('lite') === '1';
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
  return coarse || small || !!lowMem;
}
export const LITE = detectLite();
export const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Storm geometry, metres above the ground at the tornado.
export const CLOUD_BASE_M = 1100; // the cloud deck
export const WALL_BASE_M = 650;   // base of the wall cloud, where the funnel starts
export const REALISTIC_FUNNEL_RATIO = 0.3; // illustrative: visible funnel vs damage width
export const NOMINAL_WIDTH_M = 27;         // drawn when a track has no recorded width (30 yd)
export const YD = 0.9144;
export const MI = 1609.344;
