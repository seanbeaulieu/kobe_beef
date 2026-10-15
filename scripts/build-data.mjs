// Builds public/data/restaurants.json from the official Kobe Beef Marketing &
// Distribution Promotion Association registry (kobe-niku.jp), geocodes entries
// without coordinates via GSI (Japan's national geocoder), optionally enriches
// with OpenStreetMap opening_hours, then applies hand-curated data/overrides.json.
//
// Usage: npm run data            (uses caches)
//        npm run data -- --refresh-osm   (re-query OpenStreetMap)
//        npm run data -- --fresh         (ignore all caches)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = new URL('../', import.meta.url);
const OUT = new URL('public/data/restaurants.json', ROOT);
const GEOCACHE = new URL('data/geocode-cache.json', ROOT);
const OVERRIDES = new URL('data/overrides.json', ROOT);
const OSMCACHE = new URL('data/osm-cache.json', ROOT);

// prefecture=28 → Hyogo, tag=3 → "食事ができる Restaurant"
const SOURCE_URL = 'https://www.kobe-niku.jp/shop/?lang=1&prefecture=28&tag=3';
const UA = 'kobe-beef-guide-databuild (github.com/seanbeaulieu)';
const fresh = process.argv.includes('--fresh');
const refreshOsm = fresh || process.argv.includes('--refresh-osm');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = async (url, fallback) =>
  existsSync(url) ? JSON.parse(await readFile(url, 'utf8')) : fallback;

const decode = (s) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Only http(s) URLs survive; anything else (javascript:, data:) is dropped.
const safeUrl = (u) => {
  try {
    const url = new URL(u);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

function parseRegistry(html) {
  const tables = html.split('<table class="export-tbl"').slice(1);
  const out = [];
  for (const t of tables) {
    const name = t.match(/<strong>([\s\S]*?)<\/strong>/)?.[1];
    const regNo = t.match(/Registration No\.?\s*(\d+)/)?.[1];
    if (!name || !regNo) continue;

    const tds = [...t.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)];
    const addrTd = tds.find(([, attrs]) => /valign="top"/.test(attrs))?.[2] ?? '';
    const postal = addrTd.match(/〒\s*([\d-]+)/)?.[1] ?? null;
    const tel = addrTd.match(/TEL\s*'?([\d\-()]+)/)?.[1] ?? null;
    const address = decode(
      addrTd.replace(/〒\s*[\d-]+/, '').replace(/TEL[\s\S]*$/, ''),
    );

    const website = safeUrl(t.match(/<a href="([^"]+)"><img src="img\/index-07/)?.[1] ?? '');
    const mapUrl = t.match(/href="(https:\/\/www\.google\.[^"]*\/maps[^"]*)"/)?.[1] ?? null;
    const at = mapUrl?.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);

    out.push({
      id: `kb-${regNo}`,
      registrationNo: Number(regNo),
      name: decode(name),
      address,
      postal,
      tel,
      website,
      coords: at ? { lat: Number(at[1]), lng: Number(at[2]), source: 'registry' } : null,
    });
  }
  return out;
}

// Addresses in the registry omit "兵庫県" and use mixed digit styles; GSI does
// best with prefecture + city + block, so strip building names after the
// block number and fall back to coarser queries.
function geocodeQueries(address) {
  const a = address.normalize('NFKC').replace(/[‐−–—ー－]/g, '-');
  const base = a.startsWith('兵庫県') ? a : `兵庫県${a}`;
  const block = base.match(/^.*?\d+(?:-\d+){0,2}/)?.[0];
  const chome = base.match(/^.*?[区町]\D*?\d+/)?.[0];
  return [...new Set([block, chome, base].filter(Boolean))];
}

async function gsiGeocode(q) {
  const res = await fetch(
    'https://msearch.gsi.go.jp/address-search/AddressSearch?q=' + encodeURIComponent(q),
    { headers: { 'User-Agent': UA } },
  );
  if (!res.ok) throw new Error(`GSI ${res.status}`);
  const [hit] = await res.json();
  if (!hit) return null;
  const [lng, lat] = hit.geometry.coordinates;
  return { lat, lng, source: 'gsi', matched: hit.properties.title };
}

// One Overpass query for every restaurant-ish node/way in Kobe that has
// opening_hours; matched to registry entries by name + distance.
async function fetchOsm() {
  const q = `[out:json][timeout:60];
area["name"="神戸市"]["admin_level"="7"]->.k;
(nwr(area.k)["amenity"~"restaurant|fast_food|cafe|bar|pub"]["name"];);
out center tags;`;
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json();
  return json.elements.map((e) => ({
    osmId: `${e.type}/${e.id}`,
    lat: e.lat ?? e.center?.lat,
    lng: e.lon ?? e.center?.lon,
    tags: e.tags,
  }));
}

const haversineM = (a, b) => {
  const R = 6371e3, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const norm = (s) =>
  (s ?? '').normalize('NFKC').toLowerCase().replace(/[\s・.,'’()（）「」\-]/g, '').replace(/(本店|店)$/, '');

function matchOsm(r, osm) {
  if (!r.coords) return null;
  const n = norm(r.name);
  let best = null;
  for (const o of osm) {
    if (o.lat == null) continue;
    const d = haversineM(r.coords, o);
    if (d > 250) continue;
    const names = [o.tags.name, o.tags['name:ja'], o.tags['name:en']].map(norm).filter(Boolean);
    const hit = names.some((m) => m.length > 1 && (n.includes(m) || m.includes(n)));
    if (hit && (!best || d < best.d)) best = { o, d };
  }
  return best?.o ?? null;
}

async function main() {
  console.log('fetching registry…');
  const res = await fetch(SOURCE_URL, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`registry ${res.status}`);
  const all = parseRegistry(await res.text());
  const kobe = all.filter((r) => /^(兵庫県)?神戸市/.test(r.address));
  console.log(`registry: ${all.length} Hyogo restaurants, ${kobe.length} in Kobe city`);

  // --- geocode ---
  const cache = fresh ? {} : await readJson(GEOCACHE, {});
  let misses = 0;
  for (const r of kobe) {
    if (r.coords) continue;
    if (cache[r.address] !== undefined) {
      r.coords = cache[r.address];
      continue;
    }
    let hit = null;
    for (const q of geocodeQueries(r.address)) {
      hit = await gsiGeocode(q).catch((e) => (console.warn(e.message), null));
      await sleep(300);
      if (hit) break;
    }
    cache[r.address] = hit;
    r.coords = hit;
    if (!hit) misses++, console.warn(`  no geocode: ${r.name} / ${r.address}`);
  }
  await mkdir(new URL('data/', ROOT), { recursive: true });
  await writeFile(GEOCACHE, JSON.stringify(cache, null, 1));
  console.log(`geocoded; ${misses} unresolved`);

  // --- OSM enrichment (hours, cuisine, etc.) ---
  let osm = await readJson(OSMCACHE, null);
  if (!osm || refreshOsm) {
    try {
      console.log('fetching OSM…');
      osm = await fetchOsm();
      await writeFile(OSMCACHE, JSON.stringify(osm));
    } catch (e) {
      console.warn('OSM fetch failed, continuing without:', e.message);
      osm = [];
    }
  }
  let osmHits = 0;
  for (const r of kobe) {
    const o = matchOsm(r, osm);
    if (!o) continue;
    osmHits++;
    r.osmId = o.osmId;
    r.nameEn = o.tags['name:en'] ?? null;
    r.openingHours = o.tags.opening_hours ?? null;
    r.cuisine = o.tags.cuisine ?? null;
    r.website ??= safeUrl(o.tags.website ?? o.tags['contact:website'] ?? '');
  }
  console.log(`OSM matched ${osmHits}/${kobe.length}`);

  // --- manual overrides (price tier, hours, rating, english name…) ---
  const overrides = await readJson(OVERRIDES, {});
  for (const r of kobe) {
    const { lat, lng, ...rest } = overrides[r.id] ?? {};
    Object.assign(r, rest);
    if (lat != null && lng != null) r.coords = { lat, lng, source: 'manual' };
  }

  const restaurants = kobe
    .filter((r) => r.coords)
    .map((r) => ({
      id: r.id,
      registrationNo: r.registrationNo,
      name: r.name,
      nameEn: r.nameEn ?? null,
      address: r.address,
      postal: r.postal,
      tel: r.tel,
      website: r.website,
      lat: Number(r.coords.lat.toFixed(6)),
      lng: Number(r.coords.lng.toFixed(6)),
      coordSource: r.coords.source,
      openingHours: r.openingHours ?? null, // OSM opening_hours syntax
      priceTier: r.priceTier ?? null, // 1–4  (¥ … ¥¥¥¥), see about page
      priceLunch: r.priceLunch ?? null, // JPY, typical Kobe beef course
      priceDinner: r.priceDinner ?? null,
      rating: r.rating ?? null, // 0–5, curated
      cuisine: r.cuisine ?? null,
      osmId: r.osmId ?? null,
    }))
    .sort((a, b) => a.registrationNo - b.registrationNo);

  // keep the timestamp stable when nothing changed, so scheduled runs don't churn commits
  const prev = await readJson(OUT, null);
  const unchanged = prev && JSON.stringify(prev.restaurants) === JSON.stringify(restaurants);
  const payload = {
    generatedAt: unchanged ? prev.generatedAt : new Date().toISOString(),
    source: SOURCE_URL,
    count: restaurants.length,
    restaurants,
  };
  await writeFile(OUT, JSON.stringify(payload));
  console.log(`wrote ${restaurants.length} restaurants → public/data/restaurants.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
