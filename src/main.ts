import { Map as MLMap, NavigationControl, Popup, ScaleControl, setWorkerUrl, type GeoJSONSource, type ExpressionSpecification, type MapLayerMouseEvent, type PaddingOptions } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre resolves its worker relative to its own module, which breaks once bundled.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import './style.css';

import type { Dataset, Filters, HoursMode, LngLat, Restaurant, SortKey, VenueType } from './types';
import { DEFAULT_FILTERS, applyFilters, sortResults, type Result } from './filters';
import { circlePolygon, distanceKm } from './geo';
import { isOpen, japanWallClock, loadHours, toJapanLocalInput } from './hours';
import { hoursLines, priceEl, tel, ward, yen } from './format';
import { DINE_IN, VENUES, VENUE_ORDER } from './venue';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const KOBE: LngLat = { lng: 135.195, lat: 34.69 };
const C = { shu: '#b5321c', ink: '#1c1a17', paper: '#f4efe5', dim: '#a89f90' };

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const mobile = window.matchMedia('(max-width: 899px)');
const canHover = window.matchMedia('(hover: hover)');

// ---------- state ----------
let data: Restaurant[] = [];
const byId = new Map<string, Restaurant>();
let filters: Filters = { ...DEFAULT_FILTERS };
let sortKey: SortKey = 'featured';
let results: Result[] = [];
let selected: Restaurant | null = null;
let hovered: number | null = null; // registrationNo (the map feature id)
let centerFromMe = false;
let pickingCenter = false;
let oh: Awaited<ReturnType<typeof loadHours>> | null = null;

// ---------- small DOM helpers ----------
const ICONS = {
  back: ['M15 18l-6-6 6-6'],
  directions: ['M3 11l18-8-8 18-2-8z'],
  phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2'],
  globe: ['c12,12,9', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18', 'M12 3a14 14 0 0 0 0 18'],
  share: ['M12 3v12', 'M8 7l4-4 4 4', 'M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6'],
  pin: ['M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z', 'c12,9,2.5'],
  clock: ['c12,12,9', 'M12 7v5l3 2'],
  yen: ['M6 4l6 8 6-8', 'M12 12v8', 'M8 13h8', 'M8 17h8'],
} as const;

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICONS[name]) {
    if (d.startsWith('c')) {
      const [cx, cy, r] = d.slice(1).split(',');
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
      svg.append(c);
    } else {
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
  }
  return svg;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
}

/** The registration number, set like the stamp on the store's certificate. */
function seal(no: number): HTMLElement {
  const el = h('span', 'seal');
  el.title = `Registered Kobe Beef store No. ${no}`;
  const jp = h('span', 'seal-jp', '登録');
  jp.lang = 'ja';
  jp.setAttribute('aria-hidden', 'true');
  el.append(jp, h('span', 'seal-no', String(no)));
  return el;
}

// All outbound links are validated http(s) or built from our own templates.
function extLink(href: string, text: string, cls?: string): HTMLAnchorElement {
  const a = h('a', cls, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
const isHttp = (u: string | null): u is string => !!u && /^https?:\/\//.test(u);

let toastTimer = 0;
function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), 3800);
}

// Hotlinked photo; nothing at all when there is none or it fails to load.
function photo(r: Restaurant, cls: string, alt = ''): HTMLImageElement | null {
  if (!r.image || !/^https:\/\//.test(r.image)) return null;
  const img = h('img', cls);
  img.src = r.image;
  img.alt = alt;
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => img.remove());
  return img;
}

// ---------- map ----------
setWorkerUrl(workerUrl);
const map = new MLMap({
  container: 'map',
  style: STYLE_URL,
  center: [KOBE.lng, KOBE.lat],
  zoom: 12.3,
  attributionControl: { compact: true },
});
map.addControl(new NavigationControl({ visualizePitch: false }), 'top-right');
map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');

// Loading veil: fade out once the first tiles are drawn; say so if the tile host fails first.
const veil = $('#map-loading');
map.once('idle', () => {
  if (veil.classList.contains('failed')) return;
  veil.classList.add('done');
  veil.addEventListener('transitionend', () => veil.remove(), { once: true });
});
map.on('error', () => {
  // a stray failed tile is fine; only a style that never loaded leaves the map blank
  if (map.isStyleLoaded() || !veil.isConnected || veil.classList.contains('done')) return;
  veil.classList.add('failed');
  $('#map-loading-text').textContent = 'Map tiles unavailable. The list still works.';
});

const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const tip = new Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'tip' });

// Recolour the stock light basemap to the paper the panel is printed on. Matched by
// layer id pattern so a renamed layer upstream just keeps its stock colour.
function tintBasemap() {
  const paint = (id: string, prop: Parameters<MLMap['setPaintProperty']>[1], v: string) => map.setPaintProperty(id, prop, v);
  for (const l of map.getStyle().layers) {
    const id = l.id;
    if (/^poi/.test(id)) map.setLayoutProperty(id, 'visibility', 'none'); // they compete with our markers
    else if (l.type === 'background') paint(id, 'background-color', '#e7e0d2');
    else if (l.type === 'fill') {
      if (/water/.test(id)) paint(id, 'fill-color', '#c9d1cc');
      else if (/park|wood|grass|landcover/.test(id)) paint(id, 'fill-color', '#dcd8c4');
      else if (/building/.test(id)) paint(id, 'fill-color', '#dcd3c2');
      else paint(id, 'fill-color', '#e2dbcc');
    } else if (l.type === 'line') {
      if (/water/.test(id)) paint(id, 'line-color', '#c9d1cc');
      else if (/rail/.test(id)) paint(id, 'line-color', '#c4b9a5');
      else if (/casing/.test(id)) paint(id, 'line-color', '#d3c9b6');
      else if (/highway|road|street|path|bridge|tunnel/.test(id)) paint(id, 'line-color', '#f8f5ee');
      else if (/boundary/.test(id)) paint(id, 'line-color', '#b8ad99');
    } else if (l.type === 'symbol' && l.layout?.['text-field']) {
      paint(id, 'text-color', /water/.test(id) ? '#7f8d88' : '#7a7264');
      paint(id, 'text-halo-color', '#e7e0d2');
    }
  }
}

const setState = (id: number, state: Record<string, boolean>) => {
  if (map.getSource('restaurants')) map.setFeatureState({ source: 'restaurants', id }, state);
};

map.on('load', () => {
  tintBasemap();

  map.addSource('radius', { type: 'geojson', data: empty });
  map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': C.shu, 'fill-opacity': 0.05 } });
  map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': C.ink, 'line-width': 1, 'line-dasharray': [3, 3], 'line-opacity': 0.6 } });

  map.addSource('restaurants', { type: 'geojson', data: empty, cluster: true, clusterRadius: 44, clusterMaxZoom: 15, promoteId: 'n' });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'restaurants', filter: ['has', 'point_count'],
    paint: {
      'circle-color': C.ink,
      'circle-radius': ['step', ['get', 'point_count'], 13, 10, 16, 30, 20],
      'circle-stroke-color': C.paper, 'circle-stroke-width': 1.5,
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'restaurants', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11.5, 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
    paint: { 'text-color': C.paper },
  });
  const active: ExpressionSpecification = ['any', ['boolean', ['feature-state', 'selected'], false], ['boolean', ['feature-state', 'hover'], false]];
  map.addLayer({
    // a thin ink ring around the hovered or selected store
    id: 'points-ring', type: 'circle', source: 'restaurants', filter: ['!', ['has', 'point_count']],
    paint: { 'circle-color': 'transparent', 'circle-radius': 13, 'circle-stroke-color': C.ink, 'circle-stroke-width': 1.25, 'circle-stroke-opacity': ['case', active, 1, 0] },
  });
  map.addLayer({
    id: 'points', type: 'circle', source: 'restaurants', filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': ['case', ['==', ['get', 'dim'], 1], C.dim, C.shu],
      'circle-radius': ['case', active, 7.5, 6],
      'circle-stroke-color': C.paper,
      'circle-stroke-width': 1.5,
    },
  });

  map.addSource('center', { type: 'geojson', data: empty });
  map.addLayer({
    id: 'center', type: 'circle', source: 'center',
    paint: { 'circle-color': C.paper, 'circle-radius': 5, 'circle-stroke-color': C.ink, 'circle-stroke-width': 2 },
  });

  map.on('click', 'clusters', async (e) => {
    const f = e.features?.[0];
    if (!f) return;
    const zoom = await map.getSource<GeoJSONSource>('restaurants')!.getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
  });
  map.on('click', 'points', (e: MapLayerMouseEvent) => {
    if (pickingCenter) return;
    const r = byId.get(e.features?.[0]?.properties.id);
    if (r) select(r, { fly: false });
  });
  map.on('mousemove', 'points', (e: MapLayerMouseEvent) => {
    const f = e.features?.[0];
    if (!f || !canHover.matches) return;
    const r = byId.get(f.properties.id);
    if (!r || hovered === r.registrationNo) return;
    setHover(r.registrationNo);
    tip.setLngLat([r.lng, r.lat]).setDOMContent(tipCard(r)).addTo(map);
  });
  map.on('mouseleave', 'points', () => {
    setHover(null);
    tip.remove();
  });
  for (const layer of ['clusters', 'points']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = pickingCenter ? 'crosshair' : ''));
  }
  map.on('click', (e) => {
    if (!pickingCenter) {
      if (aboutOpen()) setAbout(false);
      return;
    }
    setPicking(false);
    setCenter({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    toast(`Point set. Showing restaurants within ${filters.radiusKm} km.`);
  });

  map.setPadding(mapPadding());
  render(); // data may have arrived before the style finished loading
  if (selected) setState(selected.registrationNo, { selected: true });
});

// Compact preview shown while hovering a marker (desktop only).
function tipCard(r: Restaurant): HTMLElement {
  const card = h('div', 'tipcard');
  const img = photo(r, 'tip-img');
  if (img) card.append(img);

  const body = h('div', 'tip-body');
  body.append(h('strong', 'tip-title', r.nameEn ?? r.name));
  if (r.nameEn) body.append(h('span', 'tip-sub', r.name));

  const meta = h('span', 'card-meta');
  meta.append(h('span', 'venue', VENUES[r.venueType].short));
  const price = priceEl(r);
  if (price) meta.append(price);
  if (r.rating != null) meta.append(h('span', 'stars', `★ ${r.rating.toFixed(1)}`));
  const d = results.find((x) => x.r.id === r.id)?.distanceKm;
  if (d != null) meta.append(h('span', undefined, d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`));
  const area = ward(r.address);
  if (area) meta.append(h('span', 'tip-sub', area));
  if (meta.childElementCount) body.append(meta);

  if (r.openingHours) {
    const status = h('span', 'tip-hours');
    body.append(status);
    loadHours().then((ctor) => {
      oh ??= ctor;
      const open = isOpen(ctor, r.openingHours, japanWallClock());
      if (open == null) return status.remove();
      status.append(h('span', open ? 'status open' : 'status closed', open ? 'Open now' : 'Closed now'));
    });
  }

  card.append(body);
  return card;
}

function setHover(n: number | null) {
  if (hovered === n) return;
  if (hovered != null) setState(hovered, { hover: false });
  document.querySelector('.card.is-hover')?.classList.remove('is-hover');
  hovered = n;
  if (n == null) return;
  setState(n, { hover: true });
  document.querySelector(`.card[data-n="${n}"]`)?.classList.add('is-hover');
}

// ---------- data ----------
loadData();
async function loadData() {
  try {
    const res = await fetch('/data/restaurants.json');
    if (!res.ok) throw new Error(String(res.status));
    const ds: Dataset = await res.json();
    data = ds.restaurants;
    for (const r of data) byId.set(r.id, r);
    $('#data-meta').textContent =
      `${ds.count} restaurants · data updated ${new Date(ds.generatedAt).toLocaleDateString()}`;
    $('#brand-sub').textContent = `${data.length} registered restaurants, Kobe city`;
    renderAbout();
    renderTypeOptions();
    render();
    const fromHash = byId.get(decodeURIComponent(location.hash.slice(1)));
    if (fromHash) select(fromHash);
  } catch (e) {
    $('#count').textContent = 'Failed to load restaurant data.';
    console.error(e);
  }
}

// ---------- render ----------
const cards = new Map<string, HTMLButtonElement>();

function render() {
  if (!filters.center && sortKey === 'distance') sortKey = 'featured';
  results = sortResults(applyFilters(data, filters, oh), sortKey);
  const hoursActive = filters.hoursMode !== 'any';

  map.getSource<GeoJSONSource>('restaurants')?.setData({
    type: 'FeatureCollection',
    features: results.map(({ r, open }) => ({
      type: 'Feature',
      properties: { id: r.id, n: r.registrationNo, dim: hoursActive && open !== true ? 1 : 0 },
      geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
    })),
  });

  const c = filters.center;
  map.getSource<GeoJSONSource>('radius')?.setData(c ? circlePolygon(c, filters.radiusKm) : empty);
  map.getSource<GeoJSONSource>('center')?.setData(
    c ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [c.lng, c.lat] } } : empty,
  );

  const count = $('#count');
  count.replaceChildren(h('strong', undefined, String(results.length)), ` of ${data.length} restaurants`);
  $('#empty').hidden = results.length > 0 || data.length === 0;
  renderList();
  syncControls();
}

function renderList() {
  cards.clear();
  const hoursActive = filters.hoursMode !== 'any';
  $('#results').replaceChildren(
    ...results.map(({ r, distanceKm: d, open }) => {
      const li = h('li');
      const btn = h('button', 'card');
      btn.type = 'button';
      btn.dataset.n = String(r.registrationNo);
      if (r.id === selected?.id) btn.classList.add('is-selected');

      const thumb = photo(r, 'thumb');
      if (thumb) btn.append(thumb);

      const body = h('span', 'card-body');
      body.append(h('span', 'card-title', r.nameEn ?? r.name));
      const sub = [r.nameEn ? r.name : null, ward(r.address)].filter(Boolean).join(' · ');
      if (sub) body.append(h('span', 'card-sub', sub));

      const meta = h('span', 'card-meta');
      meta.append(h('span', 'venue', VENUES[r.venueType].short));
      const price = priceEl(r);
      if (price) meta.append(price);
      if (r.rating != null) meta.append(h('span', 'stars', `★ ${r.rating.toFixed(1)}`));
      if (d != null) meta.append(h('span', undefined, d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`));
      if (hoursActive) {
        meta.append(open === true ? h('span', 'status open', 'Open') : h('span', 'status', 'Hours unknown'));
      }
      body.append(meta);
      btn.append(body);

      btn.addEventListener('mouseenter', () => setHover(r.registrationNo));
      btn.addEventListener('mouseleave', () => setHover(null));
      btn.addEventListener('click', () => select(r));
      cards.set(r.id, btn);
      li.append(btn);
      return li;
    }),
  );
}

// One checkbox per venue type, with how many registry entries have it.
function renderTypeOptions() {
  const counts = new Map<VenueType, number>();
  for (const r of data) counts.set(r.venueType, (counts.get(r.venueType) ?? 0) + 1);
  $('#type-options').replaceChildren(
    ...VENUE_ORDER.filter((t) => counts.has(t)).map((t) => {
      const label = h('label');
      label.title = VENUES[t].hint;
      const box = h('input');
      box.type = 'checkbox';
      box.name = 'types';
      box.value = t;
      box.checked = box.defaultChecked = DEFAULT_FILTERS.types.includes(t);
      const span = h('span', undefined, VENUES[t].label);
      span.append(h('small', undefined, String(counts.get(t))));
      label.append(box, span);
      return label;
    }),
  );
}

function activeFilterCount() {
  const f = filters;
  const typesChanged = f.types.length !== DEFAULT_FILTERS.types.length || f.types.some((t) => !DEFAULT_FILTERS.types.includes(t));
  return [typesChanged, f.maxPriceTier < 4, f.hoursMode !== 'any', f.minRating > 0, !!f.center, f.withPhoto].filter(Boolean).length;
}

function syncControls() {
  $('#chip-open').setAttribute('aria-pressed', String(filters.hoursMode === 'now'));
  $('#chip-near').setAttribute('aria-pressed', String(centerFromMe && !!filters.center));
  $('#chip-photo').setAttribute('aria-pressed', String(filters.withPhoto));
  const n = activeFilterCount();
  const badge = $('#filter-badge');
  badge.hidden = n === 0;
  badge.textContent = String(n);

  const sort = $<HTMLSelectElement>('#sort');
  (sort.querySelector('option[value="distance"]') as HTMLOptionElement).disabled = !filters.center;
  sort.value = sortKey;

  $('#apply-filters').textContent =
    results.length === 0 ? 'No matches' : `Show ${results.length} restaurant${results.length === 1 ? '' : 's'}`;
  const c = filters.center;
  $('#center-status').textContent = c
    ? `${centerFromMe ? 'Your location' : 'Point'} · ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}`
    : "No point set. Results aren't limited by distance.";
}

// ---------- detail ----------
function select(r: Restaurant | null, { fly = true } = {}) {
  const prev = selected;
  if (selected) {
    setState(selected.registrationNo, { selected: false });
    cards.get(selected.id)?.classList.remove('is-selected');
  }
  selected = r;
  panel.classList.toggle('is-detail', !!r);
  if (!r) {
    closeDetail(prev);
    history.replaceState(null, '', location.pathname + location.search);
    return;
  }
  setState(r.registrationNo, { selected: true });
  cards.get(r.id)?.classList.add('is-selected');
  history.replaceState(null, '', `#${r.id}`);
  renderDetail(r);
  if (mobile.matches && snap === 'peek') setSnap('half');
  if (fly) map.flyTo({ center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 15.5), essential: true });
}

function closeDetail(prev: Restaurant | null) {
  const list = $('#list-view');
  $('#detail-view').hidden = true;
  list.hidden = false;
  if (prev) cards.get(prev.id)?.scrollIntoView({ block: 'nearest' });
  list.classList.remove('is-back');
  void list.offsetWidth; // restart the fade
  list.classList.add('is-back');
}

function renderDetail(r: Restaurant) {
  const view = $('#detail-view');
  view.replaceChildren();

  const top = h('div', 'detail-top');
  const back = h('button', 'back');
  back.type = 'button';
  back.append(icon('back'), 'All restaurants');
  back.addEventListener('click', () => select(null));
  top.append(back);
  view.append(top);

  const hero = photo(r, '', `Photo of ${r.nameEn ?? r.name}`);
  let credit: HTMLElement | null = null;
  if (hero) {
    const fig = h('figure', 'hero');
    fig.append(hero);
    hero.loading = 'eager';
    hero.addEventListener('error', () => (fig.remove(), credit?.remove()));
    view.append(fig);
  }

  const body = h('div', 'detail-body');

  const head = h('div', 'detail-head');
  head.append(seal(r.registrationNo), h('h2', 'detail-title', r.nameEn ?? r.name));
  if (r.nameEn) {
    const jp = h('p', 'detail-jp', r.name);
    jp.lang = 'ja';
    head.append(jp);
  }
  body.append(head);

  const tags = h('div', 'detail-tags');
  const venue = h('span', 'venue', VENUES[r.venueType].label);
  venue.title = VENUES[r.venueType].hint;
  tags.append(venue);
  if (r.rating != null) tags.append(h('span', 'stars', `★ ${r.rating.toFixed(1)}`));
  const area = ward(r.address);
  if (area) tags.append(h('span', 'card-sub', area));
  body.append(tags);
  if (r.venueType === 'ryokan' || r.venueType === 'shop') body.append(h('p', 'hint', `${VENUES[r.venueType].hint}.`));

  const actions = h('div', 'actions');
  const action = (href: string, label: string, ic: keyof typeof ICONS, primary = false) => {
    const a = extLink(href, '', primary ? 'action primary' : 'action');
    a.append(icon(ic), label);
    actions.append(a);
    return a;
  };
  action(`https://www.google.com/maps/dir/?api=1&destination=${r.lat},${r.lng}`, 'Directions', 'directions', true);
  if (r.tel) {
    const a = action(`tel:${r.tel.replace(/[^\d+]/g, '')}`, tel(r.tel), 'phone');
    a.removeAttribute('target');
  }
  if (isHttp(r.website)) action(r.website, 'Website', 'globe');
  const share = h('button', 'action');
  share.type = 'button';
  share.append(icon('share'), 'Copy link');
  share.addEventListener('click', () => shareLink(r));
  actions.append(share);
  body.append(actions);

  const info = h('dl', 'info');
  const row = (ic: keyof typeof ICONS, label: string, ...content: (Node | string)[]) => {
    const div = h('div');
    const dd = h('dd');
    dd.append(...content);
    div.append(icon(ic), h('dt', undefined, label), dd);
    info.append(div);
    return dd;
  };
  row('pin', 'Address', `〒${r.postal ?? ''} ${r.address}`);
  if (r.openingHours) {
    const lines = h('div', 'hours-lines');
    for (const l of hoursLines(r.openingHours)) lines.append(h('span', undefined, l));
    const dd = row('clock', 'Hours', lines);
    loadHours().then((ctor) => {
      oh ??= ctor;
      const open = isOpen(ctor, r.openingHours, japanWallClock());
      if (open == null || selected?.id !== r.id) return;
      const status = h('span', open ? 'status open' : 'status closed', open ? 'Open now' : 'Closed now');
      dd.prepend(status);
      tags.append(status.cloneNode(true));
    });
  } else {
    row('clock', 'Hours', h('span', undefined, 'Not listed. Check with the restaurant.'));
  }
  if (r.priceLunch || r.priceDinner) {
    const parts: (Node | string)[] = [];
    if (r.priceLunch) parts.push('Lunch ', h('strong', undefined, yen(r.priceLunch)));
    if (r.priceLunch && r.priceDinner) parts.push('  ·  ');
    if (r.priceDinner) parts.push('Dinner ', h('strong', undefined, yen(r.priceDinner)));
    row('yen', 'Kobe beef course', ...parts);
  }
  body.append(info);

  const more = h('div', 'more-links');
  more.append(
    extLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address}`)}`, 'Google Maps'),
    extLink(`https://tabelog.com/en/rstLst/?sw=${encodeURIComponent(r.name)}`, 'Tabelog'),
  );
  if (r.osmId) more.append(extLink(`https://www.openstreetmap.org/${r.osmId}`, 'OpenStreetMap'));
  body.append(more);

  if (hero && isHttp(r.imageSource)) {
    credit = h('p', 'credit', 'Photo: ');
    credit.append(extLink(r.imageSource, new URL(r.imageSource).hostname.replace(/^www\./, '')));
    body.append(credit);
  }

  view.append(body);
  $('#list-view').hidden = true;
  view.hidden = false;
  view.scrollTop = 0;
}

async function shareLink(r: Restaurant) {
  // the static page has a real title, description and photo for link previews
  const url = `${location.origin}/r/${r.id}/`;
  const title = r.nameEn ?? r.name;
  try {
    if (navigator.share && mobile.matches) await navigator.share({ title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    }
  } catch {
    /* user cancelled */
  }
}

// ---------- bottom sheet (mobile) ----------
type Snap = 'peek' | 'half' | 'full';
const panel = $('#panel');
let snap: Snap = 'half';

function snapY(s: Snap) {
  const total = panel.offsetHeight;
  if (s === 'full') return 0;
  if (s === 'peek') return Math.max(0, total - $('#views').offsetTop);
  return Math.max(0, total - Math.round(window.innerHeight * 0.52));
}

function applySheet(y?: number) {
  if (!mobile.matches) {
    panel.style.removeProperty('--sheet-y');
    panel.style.removeProperty('--sheet-hidden');
    return;
  }
  const v = y ?? snapY(snap);
  panel.style.setProperty('--sheet-y', `${v}px`);
  panel.style.setProperty('--sheet-hidden', `${v}px`);
}

function mapPadding(): PaddingOptions {
  if (mobile.matches) {
    const visible = panel.offsetHeight - snapY(snap);
    return { top: 50, left: 20, right: 20, bottom: Math.min(visible, window.innerHeight * 0.6) };
  }
  return { top: 30, right: 50, bottom: 30, left: panel.offsetWidth + 32 };
}

function setSnap(s: Snap) {
  snap = s;
  applySheet();
  if (map.loaded()) map.easeTo({ padding: mapPadding(), duration: 350 });
}

{
  let drag: { y0: number; s0: number; y: number; t: number; v: number } | null = null;
  const current = () => Number.parseFloat(panel.style.getPropertyValue('--sheet-y')) || 0;

  const down = (e: PointerEvent) => {
    if (!mobile.matches || (e.target as Element).closest('button, input, select, a')) return;
    drag = { y0: e.clientY, s0: current(), y: e.clientY, t: e.timeStamp, v: 0 };
    panel.classList.add('dragging');
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.v = (e.clientY - drag.y) / dt;
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    const y = Math.min(Math.max(drag.s0 + (e.clientY - drag.y0), 0), snapY('peek'));
    applySheet(y);
  };
  const up = (e: PointerEvent) => {
    if (!drag) return;
    const moved = Math.abs(e.clientY - drag.y0);
    const { v } = drag;
    drag = null;
    panel.classList.remove('dragging');
    const order: Snap[] = ['full', 'half', 'peek'];
    const i = order.indexOf(snap);
    if (moved < 6) return setSnap(snap === 'full' ? 'half' : order[Math.max(0, i - 1)]); // tap: grow
    if (v > 0.45) return setSnap(order[Math.min(2, i + 1)]);
    if (v < -0.45) return setSnap(order[Math.max(0, i - 1)]);
    const y = current();
    setSnap(order.reduce((best, s) => (Math.abs(snapY(s) - y) < Math.abs(snapY(best) - y) ? s : best)));
  };
  for (const el of [$('#grab'), panel.querySelector<HTMLElement>('.panel-head')!]) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}

const relayout = () => {
  applySheet();
  if (map.loaded()) map.setPadding(mapPadding());
};
mobile.addEventListener('change', relayout);
window.addEventListener('resize', relayout);
requestAnimationFrame(relayout);

// ---------- center / radius ----------
function setCenter(c: LngLat | null, fromMe = false) {
  filters.center = c;
  centerFromMe = !!c && fromMe;
  if (c && sortKey === 'featured') sortKey = 'distance';
  render();
}

function setPicking(on: boolean) {
  pickingCenter = on;
  map.getCanvas().style.cursor = on ? 'crosshair' : '';
  $('#pick-banner').hidden = !on;
  if (on && mobile.matches) setSnap('peek');
}

function locate() {
  if (!navigator.geolocation) return toast('Location is not available in this browser.');
  toast('Finding you…');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      const c = { lat: p.coords.latitude, lng: p.coords.longitude };
      if (distanceKm(c, KOBE) > 40) {
        toast("You're not near Kobe right now. Use “Pick on map” in Filters instead.");
        return;
      }
      $('#toast').hidden = true;
      setCenter(c, true);
      map.flyTo({ center: [c.lng, c.lat], zoom: 14 });
    },
    (err) => toast(`Couldn't get your location: ${err.message}`),
    { enableHighAccuracy: true, timeout: 10000 },
  );
}

// ---------- form & chips ----------
const form = $<HTMLFormElement>('#filters');
const q = $<HTMLInputElement>('#q');
const filtersDialog = $<HTMLDialogElement>('#filters-dialog');
const field = <T,>(name: string) => form.elements.namedItem(name) as unknown as T;
const hoursAt = field<HTMLInputElement>('hoursAt');
hoursAt.value = toJapanLocalInput();

async function readForm() {
  const fd = new FormData(form);
  const hoursMode = (fd.get('hoursMode') as HoursMode) ?? 'any';
  filters = {
    ...filters,
    query: q.value,
    types: fd.getAll('types') as VenueType[],
    maxPriceTier: Number(fd.get('maxPriceTier')) as Filters['maxPriceTier'],
    includeUnknownPrice: fd.has('includeUnknownPrice'),
    hoursMode,
    hoursAt: String(fd.get('hoursAt') ?? ''),
    includeUnknownHours: fd.has('includeUnknownHours'),
    minRating: Number(fd.get('minRating')),
    includeUnknownRating: fd.has('includeUnknownRating'),
    radiusKm: Number(fd.get('radiusKm')),
    withPhoto: fd.has('withPhoto'),
  };
  $('#radius-out').textContent = String(filters.radiusKm);
  if (hoursMode !== 'any' && !oh) oh = await loadHours();
  render();
}

form.addEventListener('input', readForm);
form.addEventListener('change', readForm);
form.addEventListener('submit', (e) => {
  e.preventDefault();
  filtersDialog.close();
});
form.addEventListener('reset', () => {
  setTimeout(() => {
    hoursAt.value = toJapanLocalInput();
    setPicking(false);
    centerFromMe = false;
    filters = { ...DEFAULT_FILTERS };
    sortKey = 'featured';
    readForm();
  });
});

q.addEventListener('input', readForm);
q.addEventListener('focus', () => mobile.matches && setSnap('full'));
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && results[0]) {
    q.blur();
    if (results.length === 1) select(results[0].r);
  }
});

$<HTMLSelectElement>('#sort').addEventListener('change', (e) => {
  sortKey = (e.target as HTMLSelectElement).value as SortKey;
  render();
  $('#list-view').scrollTop = 0;
});

$('#chip-filters').addEventListener('click', () => filtersDialog.showModal());
$('#chip-open').addEventListener('click', () => {
  field<RadioNodeList>('hoursMode').value = filters.hoursMode === 'now' ? 'any' : 'now';
  readForm();
});
$('#chip-photo').addEventListener('click', () => {
  const box = field<HTMLInputElement>('withPhoto');
  box.checked = !box.checked;
  readForm();
});
$('#chip-near').addEventListener('click', () => (centerFromMe && filters.center ? setCenter(null) : locate()));

$('#pick-center').addEventListener('click', () => {
  filtersDialog.close();
  setPicking(true);
});
$('#pick-cancel').addEventListener('click', () => setPicking(false));
$('#locate-me').addEventListener('click', () => {
  filtersDialog.close();
  locate();
});
$('#clear-center').addEventListener('click', () => setCenter(null));
$('#empty-reset').addEventListener('click', () => {
  q.value = '';
  form.reset();
});

// ---------- dialogs ----------
for (const d of [filtersDialog]) {
  d.addEventListener('click', (e) => e.target === d && d.close()); // backdrop
  d.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => d.close()));
}

// ---------- about drawer ----------
const about = $('#about');
const aboutToggles = [$('#open-about'), $('#about-tab')];

function setAbout(open: boolean, { focus = true } = {}) {
  about.classList.toggle('open', open);
  about.inert = !open;
  $('#app').classList.toggle('about-open', open);
  for (const b of aboutToggles) b.setAttribute('aria-expanded', String(open));
  if (open && focus) about.querySelector<HTMLElement>('.drawer-close')?.focus({ preventScroll: true });
}
const aboutOpen = () => about.classList.contains('open');
for (const b of aboutToggles) b.addEventListener('click', () => setAbout(!aboutOpen()));
about.querySelector('[data-close-about]')!.addEventListener('click', () => {
  setAbout(false);
  $('#open-about').focus();
});
// Greet desktop visits with the About drawer, unless the link points at a specific restaurant.
// On a phone it would cover the whole map, so there it waits for the About button.
if (!location.hash && !mobile.matches) setAbout(true, { focus: false });

function bar(label: string, value: number, total: number) {
  const row = h('div', 'bar');
  const track = h('div', 'bar-track');
  const fill = h('div', 'bar-fill');
  fill.style.setProperty('--w', `${total ? (value / total) * 100 : 0}%`);
  track.append(fill);
  row.append(h('span', 'bar-label', label), track, h('span', 'bar-value', String(value)));
  return row;
}

function renderAbout() {
  const n = data.length;
  const count = (pred: (r: Restaurant) => unknown) => data.filter(pred).length;
  const wards = new Map<string, number>();
  for (const r of data) {
    const w = ward(r.address)?.replace(', Kobe', '') ?? 'Other';
    wards.set(w, (wards.get(w) ?? 0) + 1);
  }

  const dineIn = count((r) => DINE_IN.includes(r.venueType));
  $('#hero-stats').replaceChildren(
    h('b', undefined, String(n)), ' registered stores in ', h('b', undefined, String(wards.size)), ' wards. ',
    h('b', undefined, String(dineIn)), ' of them are restaurants you can walk into or book; the rest are ryokan and shops.',
  );

  $('#coverage').replaceChildren(
    bar('Photos', count((r) => r.image), n),
    bar('Opening hours', count((r) => r.openingHours), n),
    bar('Price', count((r) => r.priceTier || r.priceLunch || r.priceDinner), n),
    bar('English name', count((r) => r.nameEn), n),
  );
  const max = Math.max(...wards.values());
  $('#wards').replaceChildren(
    ...[...wards].sort((a, b) => b[1] - a[1]).map(([w, c]) => bar(w, c, max)),
  );
}

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const typing = (e.target as Element).closest('input, select, textarea');
  if (e.key === '/' && !typing && !document.querySelector('dialog[open]')) {
    e.preventDefault();
    q.focus();
  } else if (e.key === '?' && !typing && !document.querySelector('dialog[open]')) {
    setAbout(!aboutOpen());
  } else if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
    if (aboutOpen()) setAbout(false);
    else if (pickingCenter) setPicking(false);
    else if (typing === q && q.value) return;
    else if (selected) select(null);
  }
});

// "open now" re-evaluates every minute
setInterval(() => filters.hoursMode === 'now' && render(), 60_000);
