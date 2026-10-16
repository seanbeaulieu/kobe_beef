# Kobe Beef Guide

Map of the restaurants in Kobe city on the official **Kobe Beef designated-store registry**
(神戸肉流通推進協議会 指定登録店), with filters for price, hours, rating and distance.

A fully static site with no backend, database, API keys or cookies.

## Stack

| Piece | Choice | Why |
|---|---|---|
| Build | Vite + TypeScript (no framework) | tiny surface, fast, easy to restyle later |
| Map | MapLibre GL JS 6 | open-source WebGL map, clustering built in |
| Tiles | [OpenFreeMap](https://openfreemap.org) | free OSM vector tiles, no key, no limits |
| Hours | `opening_hours` (lazy-loaded) | parses OSM `opening_hours` syntax, always evaluated in JST |
| Data | `scripts/build-data.mjs` → `public/data/restaurants.json` | built offline and committed, served as a static file |
| Hosting | Cloudflare Pages (recommended) | free, unlimited bandwidth, supports `public/_headers` |

## Data pipeline

```
kobe-niku.jp registry (Hyogo, restaurants) ──► filter 神戸市
   │ coords from registry map links (~40 entries)
   ├─► GSI address geocoder for the rest     (cached: data/geocode-cache.json)
   ├─► OpenStreetMap Overpass name+distance match → hours, English name (cached: data/osm-cache.json)
   └─► data/overrides.json (hand-curated price / hours / rating / coords, keyed by "kb-<regNo>")
```

```bash
npm run data                     # rebuild using caches
npm run data -- --refresh-osm    # re-query OSM
npm run data -- --fresh          # ignore all caches
```

`.github/workflows/refresh-data.yml` re-runs this weekly and commits only if the output changed.
The push then triggers a redeploy.

### Known data gaps (v1)
- **Price**: none in any open source. Fill `priceTier` (1–4) in `overrides.json`.
- **Hours**: only about 6 of 204 have OSM hours. Fill `openingHours` in overrides, or add them to OSM, which helps everyone.
- **Reviews**: no free source that allows redistribution. Google Places is paid and forbids caching; Tabelog forbids scraping.
  The `rating` field is for curated values. Popups link out to Google Maps and Tabelog.
- Geocoded points are block-level (~50 m), not the exact door.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build && npm run preview   # prod build, served with the real CSP from public/_headers
```

Needs Node ≥ 22.12 (24 LTS recommended, see `.nvmrc`).

## Deploy (Cloudflare Pages)

1. Push to GitHub.
2. Cloudflare dashboard → Workers & Pages → Create → Pages → connect the repo.
3. Build command `npm run build`, output dir `dist`, env var `NODE_VERSION=24`.

Netlify works identically (it reads the same `_headers` file). GitHub Pages also works, but it ignores `_headers`, so you lose the CSP.

## Security

- Static only: no server, auth, DB or secrets to leak.
- Strict CSP (`public/_headers`): scripts are same-origin only, there is no inline JS, and the only external connection is the tile host.
- Scraped strings render only via `textContent`, never `innerHTML`. Outbound URLs are validated as http(s) at build time and again at render.
- `npm audit` runs in CI. maplibre-gl ≤ 6.4 has a known XSS bug, hence v6.14.

## Attribution

Registry data © 神戸肉流通推進協議会. Map data © OpenStreetMap contributors (ODbL). Tiles: OpenFreeMap / OpenMapTiles.
Not affiliated with the Kobe Beef association.
