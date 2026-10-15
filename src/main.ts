import { Map as MLMap, NavigationControl, Popup, ScaleControl, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre resolves its worker relative to its own module, which breaks once bundled.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';

import type { Dataset, Filters, HoursMode, Restaurant } from './types';
import { DEFAULT_FILTERS, applyFilters, type Result } from './filters';
import { circlePolygon } from './geo';
import { loadHours, toJapanLocalInput } from './hours';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const KOBE: [number, number] = [135.195, 34.69];

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---------- state ----------
let data: Restaurant[] = [];
let filters: Filters = { ...DEFAULT_FILTERS };
let pickingCenter = false;
let oh: Awaited<ReturnType<typeof loadHours>> | null = null;

// ---------- map ----------
setWorkerUrl(workerUrl);
const map = new MLMap({
  container: 'map',
  style: STYLE_URL,
  center: KOBE,
  zoom: 12,
  attributionControl: { compact: true },
});
map.addControl(new NavigationControl(), 'top-right');
map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

map.on('load', () => {
  map.addSource('radius', { type: 'geojson', data: empty });
  map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': '#b91c1c', 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': '#b91c1c', 'line-width': 1.5, 'line-dasharray': [2, 2] } });

  map.addSource('restaurants', { type: 'geojson', data: empty, cluster: true, clusterRadius: 40, clusterMaxZoom: 15 });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'restaurants', filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#7f1d1d', 'circle-opacity': 0.85,
      'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 24],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'restaurants', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Noto Sans Bold'] },
    paint: { 'text-color': '#fff' },
  });
  map.addLayer({
    id: 'points', type: 'circle', source: 'restaurants', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['case', ['==', ['get', 'open'], 1], '#15803d', '#b91c1c'],
      'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2,
    },
  });

  map.addSource('center', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'center', type: 'circle', source: 'center',
    paint: { 'circle-color': '#1d4ed8', 'circle-radius': 6, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
  });

  map.on('click', 'clusters', async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const src = map.getSource<GeoJSONSource>('restaurants')!;
    const zoom = await src.getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
  });
  map.on('click', 'points', (e: MapLayerMouseEvent) => {
    if (pickingCenter) return;
    const id = e.features?.[0]?.properties.id;
    const r = data.find((x) => x.id === id);
    if (r) openPopup(r);
  });
  for (const layer of ['clusters', 'points']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = pickingCenter ? 'crosshair' : ''));
  }
  map.on('click', (e) => {
    if (!pickingCenter) return;
    setPicking(false);
    setCenter({ lat: e.lngLat.lat, lng: e.lngLat.lng });
  });

  render(); // data may have arrived before the style finished loading
});

// ---------- data ----------
loadData();
async function loadData() {
  try {
    const res = await fetch('/data/restaurants.json');
    if (!res.ok) throw new Error(String(res.status));
    const ds: Dataset = await res.json();
    data = ds.restaurants;
    $('#data-meta').textContent =
      `${ds.count} restaurants · data updated ${new Date(ds.generatedAt).toLocaleDateString()}`;
    render();
  } catch (e) {
    $('#count').textContent = 'Failed to load restaurant data.';
    console.error(e);
  }
}

// ---------- render ----------
let popup: Popup | null = null;

function render() {
  const results = applyFilters(data, filters, oh);

  map.getSource<GeoJSONSource>('restaurants')?.setData({
    type: 'FeatureCollection',
    features: results.map(({ r, open }) => ({
      type: 'Feature',
      properties: { id: r.id, open: open ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    })),
  });

  const c = filters.center;
  map.getSource<GeoJSONSource>('radius')?.setData(c ? circlePolygon(c, filters.radiusKm) : empty);
  map.getSource<GeoJSONSource>('center')?.setData(
    c ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } } : empty,
  );

  $('#count').textContent = `${results.length} of ${data.length} restaurants`;
  renderList(results);
}

function renderList(results: Result[]) {
  const ol = $('#results');
  ol.replaceChildren(
    ...results.map(({ r, distanceKm }) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.nameEn ? `${r.nameEn} · ${r.name}` : r.name;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = [
        r.priceTier ? '¥'.repeat(r.priceTier) : null,
        r.rating != null ? `★ ${r.rating.toFixed(1)}` : null,
        distanceKm != null ? `${distanceKm.toFixed(1)} km` : null,
        r.openingHours ? 'hours ✓' : null,
      ].filter(Boolean).join(' · ') || '—';
      btn.append(name, meta);
      btn.addEventListener('click', () => {
        map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 16) });
        openPopup(r);
      });
      li.append(btn);
      return li;
    }),
  );
}

// All third-party strings go through textContent / validated hrefs — never innerHTML.
function openPopup(r: Restaurant) {
  const el = document.createElement('div');
  el.className = 'popup';
  const add = (tag: string, text: string, cls?: string) => {
    const n = document.createElement(tag);
    n.textContent = text;
    if (cls) n.className = cls;
    el.append(n);
    return n;
  };
  add('strong', r.name);
  if (r.nameEn) add('div', r.nameEn, 'muted');
  add('div', `〒${r.postal ?? ''} ${r.address}`);
  if (r.tel) {
    const a = document.createElement('a');
    a.href = `tel:${r.tel.replace(/[^\d+]/g, '')}`;
    a.textContent = `☎ ${r.tel}`;
    el.append(a);
  }
  if (r.openingHours) add('div', `Hours: ${r.openingHours}`);
  if (r.priceTier) add('div', `Price: ${'¥'.repeat(r.priceTier)}`);
  if (r.rating != null) add('div', `Rating: ★ ${r.rating.toFixed(1)}`);
  add('div', `Registration No. ${r.registrationNo}`, 'muted');

  const links = document.createElement('div');
  links.className = 'links';
  const link = (href: string, text: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = text;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    links.append(a);
  };
  if (r.website && /^https?:\/\//.test(r.website)) link(r.website, 'Website');
  link(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address}`)}`, 'Google Maps');
  link(`https://tabelog.com/en/rstLst/?sw=${encodeURIComponent(r.name)}`, 'Tabelog');
  if (r.osmId) link(`https://www.openstreetmap.org/${r.osmId}`, 'OSM');
  el.append(links);

  popup?.remove();
  popup = new Popup({ maxWidth: '320px' }).setLngLat([r.lng, r.lat]).setDOMContent(el).addTo(map);
}

// ---------- center / radius ----------
function setCenter(c: Filters['center']) {
  filters.center = c;
  $('#center-status').textContent = c ? `Point: ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}` : 'No point set.';
  render();
}

function setPicking(on: boolean) {
  pickingCenter = on;
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  $('#pick-center').textContent = on ? 'Click the map… (cancel)' : 'Pick point on map';
}

$('#pick-center').addEventListener('click', () => setPicking(!pickingCenter));
$('#clear-center').addEventListener('click', () => setCenter(null));
$('#locate-me').addEventListener('click', () => {
  if (!navigator.geolocation) return alert('Geolocation not supported.');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const c = { lat: p.coords.latitude, lng: p.coords.longitude };
      setCenter(c);
      map.flyTo({ center: [c.lng, c.lat], zoom: 14 });
    },
    (err) => alert(`Couldn't get location: ${err.message}`),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ---------- form ----------
const form = $<HTMLFormElement>('#filters');
const hoursAt = form.elements.namedItem('hoursAt') as HTMLInputElement;
hoursAt.value = toJapanLocalInput();

async function readForm() {
  const fd = new FormData(form);
  const hoursMode = (fd.get('hoursMode') as HoursMode) ?? 'any';
  filters = {
    ...filters,
    query: String(fd.get('query') ?? ''),
    maxPriceTier: Number(fd.get('maxPriceTier')) as Filters['maxPriceTier'],
    includeUnknownPrice: fd.has('includeUnknownPrice'),
    hoursMode,
    hoursAt: String(fd.get('hoursAt') ?? ''),
    includeUnknownHours: fd.has('includeUnknownHours'),
    minRating: Number(fd.get('minRating')),
    includeUnknownRating: fd.has('includeUnknownRating'),
    radiusKm: Number(fd.get('radiusKm')),
  };
  $('#radius-out').textContent = String(filters.radiusKm);
  if (hoursMode !== 'any' && !oh) oh = await loadHours();
  render();
}

form.addEventListener('input', readForm);
form.addEventListener('change', readForm);
form.addEventListener('submit', (e) => e.preventDefault());
form.addEventListener('reset', () => {
  setTimeout(() => {
    hoursAt.value = toJapanLocalInput();
    filters = { ...DEFAULT_FILTERS };
    setPicking(false);
    setCenter(null);
    readForm();
  });
});

// "open now" re-evaluates every minute
setInterval(() => filters.hoursMode === 'now' && render(), 60_000);

// ---------- tabs ----------
const tabs = [$('#tab-filters'), $('#tab-about')];
for (const t of tabs) {
  t.addEventListener('click', () => {
    for (const o of tabs) {
      const on = o === t;
      o.setAttribute('aria-selected', String(on));
      $(`#${o.getAttribute('aria-controls')}`).hidden = !on;
    }
  });
}
