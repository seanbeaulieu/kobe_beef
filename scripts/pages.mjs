// Static, crawlable HTML for every restaurant (/r/<id>/) plus an index of all
// of them (/restaurants/), generated from public/data/restaurants.json. The
// map is a JS app that search engines and link previews mostly can't read;
// these pages give each restaurant a real URL with its facts in the HTML.
//
// Generated into r/ and restaurants/ at the project root (gitignored) so Vite
// builds them like any other page and they pick up the hashed stylesheet.
// Driven by the kobePages() plugin in vite.config.ts.
//
// Set SITE_URL (e.g. https://kobe-beef.example) at build time to get
// canonical links, absolute og:url and a sitemap.xml.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { VENUES, VENUE_ORDER, DINE_IN } from '../src/venue.ts';
import { ward } from '../src/format.ts';

const ROOT = new URL('../', import.meta.url);
const DATA = new URL('public/data/restaurants.json', ROOT);
export const GENERATED_DIRS = ['r', 'restaurants'];

const DINE_IN_SET = new Set(DINE_IN);
// "Chuo, Kobe" → "Chuo"; visitors know Arima Onsen, not the Kita ward it sits in
const area = (r) => (/有馬町/.test(r.address) ? 'Arima Onsen' : ward(r.address)?.replace(/, Kobe$/, '') ?? null);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isHttp = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
const yen = (n) => `¥${n.toLocaleString('en-US')}`;
const TIERS = ['', 'Under ¥5,000', '¥5,000–15,000', '¥15,000–30,000', 'Over ¥30,000'];
const title = (r) => r.nameEn ?? r.name;
// the registry name, when it adds something to the English one
const jpName = (r) => (r.nameEn && r.nameEn !== r.name ? r.name : null);
const pagePath = (r) => `/r/${r.id}/`;

const haversineKm = (a, b) => {
  const rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lng - a.lng) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
};

export const siteUrl = () => (process.env.SITE_URL ?? '').replace(/\/+$/, '');

function shell({ path, pageTitle, description, image, jsonLd, body }) {
  const site = siteUrl();
  const abs = site ? `${site}${path}` : null;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(pageTitle)}</title>
    <meta name="description" content="${esc(description)}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <meta name="theme-color" content="#0d0809" />
    <meta name="color-scheme" content="dark" />
    ${abs ? `<link rel="canonical" href="${esc(abs)}" />\n    <meta property="og:url" content="${esc(abs)}" />` : ''}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Kobe Beef Guide" />
    <meta property="og:title" content="${esc(pageTitle)}" />
    <meta property="og:description" content="${esc(description)}" />
    ${image ? `<meta property="og:image" content="${esc(image)}" />` : ''}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/src/pages.css" />
    ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
  </head>
  <body>
    <header class="top">
      <a class="brand" href="/">Kobe Beef <span>Guide</span></a>
      <nav>
        <a href="/">Map</a>
        <a href="/restaurants/">All restaurants</a>
        <a href="/real-kobe-beef/">Is it real?</a>
      </nav>
    </header>
    <main class="page">
${body}
    </main>
    <footer class="foot">
      <p>Restaurant list from the official registry of designated Kobe Beef stores
        (<a href="https://www.kobe-niku.jp/shop/?lang=1" rel="noopener noreferrer">kobe-niku.jp</a>).
        Not affiliated with the Kobe Beef Association. Confirm hours and prices with the restaurant before you go.</p>
    </footer>
  </body>
</html>
`;
}

function restaurantPage(r, all, generatedAt) {
  const v = VENUES[r.venueType] ?? VENUES.other;
  const where = area(r);
  const prices = [r.priceLunch && `lunch ${yen(r.priceLunch)}`, r.priceDinner && `dinner ${yen(r.priceDinner)}`].filter(Boolean);
  const description = [
    `${title(r)}${jpName(r) ? ` (${jpName(r)})` : ''} is a registered Kobe Beef store (No. ${r.registrationNo})${where ? ` in ${where}, Kobe` : ' in Kobe'}.`,
    `${v.label}.`,
    prices.length ? `Kobe beef course: ${prices.join(', ')}.` : '',
    'Address, hours and map.',
  ].filter(Boolean).join(' ');

  const nearby = all
    .filter((o) => o.id !== r.id && DINE_IN_SET.has(o.venueType))
    .map((o) => ({ o, d: haversineKm(r, o) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6);

  const rows = [];
  rows.push(['Address', `〒${esc(r.postal ?? '')} ${esc(r.address)}`]);
  rows.push(['Hours', r.openingHours
    ? `<span class="lines">${r.openingHours.split(/\s*;\s*/).filter(Boolean).map((l) => `<span>${esc(l)}</span>`).join('')}</span><small>Japan time, OpenStreetMap syntax</small>`
    : 'Not listed. Check with the restaurant.']);
  if (r.priceLunch || r.priceDinner) {
    rows.push(['Typical Kobe beef course', [r.priceLunch && `Lunch <strong>${yen(r.priceLunch)}</strong>`, r.priceDinner && `Dinner <strong>${yen(r.priceDinner)}</strong>`].filter(Boolean).join(' · ')]);
  } else if (r.priceTier) {
    rows.push(['Price', esc(TIERS[r.priceTier])]);
  }
  if (r.tel) rows.push(['Phone', `<a href="tel:${esc(r.tel.replace(/[^\d+]/g, ''))}">${esc(r.tel)}</a>`]);
  if (isHttp(r.website)) rows.push(['Website', `<a href="${esc(r.website)}" rel="noopener noreferrer">${esc(new URL(r.website).hostname.replace(/^www\./, ''))}</a>`]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': r.venueType === 'hotel' || r.venueType === 'ryokan' ? 'Hotel' : r.venueType === 'shop' ? 'Store' : 'Restaurant',
    name: title(r),
    ...(jpName(r) ? { alternateName: jpName(r) } : {}),
    address: { '@type': 'PostalAddress', streetAddress: r.address, postalCode: r.postal ?? undefined, addressLocality: 'Kobe', addressRegion: 'Hyogo', addressCountry: 'JP' },
    geo: { '@type': 'GeoCoordinates', latitude: r.lat, longitude: r.lng },
    ...(r.tel ? { telephone: r.tel } : {}),
    ...(isHttp(r.website) ? { sameAs: r.website } : {}),
    ...(r.image ? { image: r.image } : {}),
    ...(r.priceTier ? { priceRange: '¥'.repeat(r.priceTier) } : {}),
    ...(r.venueType !== 'hotel' && r.venueType !== 'ryokan' && r.venueType !== 'shop' ? { servesCuisine: ['Japanese', 'Kobe beef'] } : {}),
    ...(siteUrl() ? { url: `${siteUrl()}${pagePath(r)}` } : {}),
  };

  const body = `      <nav class="crumbs"><a href="/restaurants/">All restaurants</a> › <a href="/restaurants/#${r.venueType}">${esc(v.label)}</a></nav>
      <article class="spot">
        ${r.image ? `<figure class="hero"><img src="${esc(r.image)}" alt="Photo of ${esc(title(r))}" referrerpolicy="no-referrer" />${isHttp(r.imageSource) ? `<figcaption>Photo: <a href="${esc(r.imageSource)}" rel="noopener noreferrer">${esc(new URL(r.imageSource).hostname.replace(/^www\./, ''))}</a></figcaption>` : ''}</figure>` : ''}
        <p class="eyebrow">Registered Kobe Beef store · No. ${r.registrationNo}</p>
        <h1>${esc(title(r))}</h1>
        ${jpName(r) ? `<p class="jp" lang="ja">${esc(jpName(r))}</p>` : ''}
        <p class="tags"><span class="tag">${esc(v.label)}</span>${where ? `<span>${esc(where)}, Kobe</span>` : ''}${r.priceTier ? `<span class="price" title="${esc(TIERS[r.priceTier])}">${'¥'.repeat(r.priceTier)}</span>` : ''}</p>
        ${DINE_IN_SET.has(r.venueType) ? '' : `<p class="note">${esc(v.hint)}.</p>`}
        <p class="actions">
          <a class="btn primary" href="/#${esc(r.id)}">View on map</a>
          <a class="btn" href="https://www.google.com/maps/dir/?api=1&amp;destination=${r.lat},${r.lng}" rel="noopener noreferrer">Directions</a>
          <a class="btn" href="https://www.google.com/maps/search/?api=1&amp;query=${esc(encodeURIComponent(`${r.name} ${r.address}`))}" rel="noopener noreferrer">Google Maps</a>
          <a class="btn" href="https://tabelog.com/en/rstLst/?sw=${esc(encodeURIComponent(r.name))}" rel="noopener noreferrer">Tabelog</a>
        </p>
        <dl class="facts">
${rows.map(([k, val]) => `          <div><dt>${esc(k)}</dt><dd>${val}</dd></div>`).join('\n')}
        </dl>
        <p class="small">Listed on the official registry, so it buys certified Kobe beef. Ask to see the certificate or the
          10-digit ID for your cut: <a href="/real-kobe-beef/">how to check it's real</a>.
          Data updated ${esc(generatedAt.slice(0, 10))}.</p>
      </article>
      <section class="nearby">
        <h2>Nearby registered restaurants</h2>
        <ul class="list">
${nearby.map(({ o, d }) => `          <li>${listItem(o)}<span class="dist">${d < 0.05 ? 'same block' : d < 1 ? `${Math.round(d * 100) * 10} m` : `${d.toFixed(1)} km`}</span></li>`).join('\n')}
        </ul>
      </section>`;

  return shell({
    path: pagePath(r),
    pageTitle: `${title(r)} · ${v.label}${where ? ` in ${where}` : ''} | Kobe Beef Guide`,
    description,
    image: r.image,
    jsonLd,
    body,
  });
}

function listItem(r) {
  const where = area(r);
  return `<a href="${pagePath(r)}">${esc(title(r))}</a>${jpName(r) ? ` <span class="jp" lang="ja">${esc(jpName(r))}</span>` : ''}${where ? ` <span class="meta">${esc(where)}</span>` : ''}${r.priceTier ? ` <span class="price">${'¥'.repeat(r.priceTier)}</span>` : ''}`;
}

function indexPage(all) {
  const groups = VENUE_ORDER
    .map((t) => [t, all.filter((r) => r.venueType === t).sort((a, b) => title(a).localeCompare(title(b), 'en'))])
    .filter(([, rs]) => rs.length);
  const dineIn = all.filter((r) => DINE_IN_SET.has(r.venueType)).length;
  const body = `      <h1>Every registered Kobe beef restaurant in Kobe</h1>
      <p class="lede">All ${all.length} places in Kobe city on the official registry of designated Kobe Beef stores,
        the ones that buy certified Kobe beef. ${dineIn} are restaurants you can book or walk into; the rest are ryokan that serve it
        with a stay, and shops. Prefer a map? <a href="/">Open the map</a>.</p>
      <nav class="toc">${groups.map(([t, rs]) => `<a href="#${t}">${esc(VENUES[t].label)} <small>${rs.length}</small></a>`).join('')}</nav>
${groups.map(([t, rs]) => `      <section id="${t}">
        <h2>${esc(VENUES[t].label)} <small>${rs.length}</small></h2>
        <p class="note">${esc(VENUES[t].hint)}.</p>
        <ul class="list">
${rs.map((r) => `          <li>${listItem(r)}</li>`).join('\n')}
        </ul>
      </section>`).join('\n')}`;
  return shell({
    path: '/restaurants/',
    pageTitle: `All ${all.length} registered Kobe beef restaurants in Kobe | Kobe Beef Guide`,
    description: `The full list of restaurants in Kobe on the official Kobe Beef designated-store registry, by type: steak and teppanyaki, yakiniku, sukiyaki, hotels and more.`,
    jsonLd: null,
    body,
  });
}

const write = (rel, html) => {
  const url = new URL(rel, ROOT);
  mkdirSync(new URL('./', url), { recursive: true });
  writeFileSync(url, html.replace(/\n[ \t]*(?=\n)/g, '')); // drop lines left empty by optional parts
  return url.pathname;
};

/** Writes every page; returns their absolute file paths (Vite build inputs). */
export function generatePages() {
  const { restaurants, generatedAt } = JSON.parse(readFileSync(DATA, 'utf8'));
  for (const d of GENERATED_DIRS) rmSync(new URL(`${d}/`, ROOT), { recursive: true, force: true });
  const files = [write('restaurants/index.html', indexPage(restaurants))];
  for (const r of restaurants) files.push(write(`r/${r.id}/index.html`, restaurantPage(r, restaurants, generatedAt)));
  return files;
}

/** Site-relative paths of every page worth indexing. */
export function sitemapPaths() {
  const { restaurants } = JSON.parse(readFileSync(DATA, 'utf8'));
  return ['/', '/restaurants/', '/real-kobe-beef/', ...restaurants.map(pagePath)];
}
