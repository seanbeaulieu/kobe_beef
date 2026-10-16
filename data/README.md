# data/

| File | What | Edit by hand? |
|---|---|---|
| `overrides.json` | Curated fixes and additions, keyed by `"kb-<registrationNo>"` | **yes** |
| `geocode-cache.json` | GSI geocoder results per address | no |
| `osm-cache.json` | OpenStreetMap Overpass dump | no |
| `image-cache.json` | og:image scraped per restaurant website (`null` = none found) | no |

**After editing `overrides.json`, run `npm run data`.** The app only reads the generated
`public/data/restaurants.json`, so edits do nothing until that file is rebuilt. Commit both files.

## overrides.json fields

Every field is optional. Whatever you set replaces the scraped value.

| Field | Type | Notes |
|---|---|---|
| `nameEn` | string | English name |
| `priceTier` | 1–4 | ¥ under 5k · ¥¥ 5–15k · ¥¥¥ 15–30k · ¥¥¥¥ 30k+ (typical Kobe beef meal, JPY) |
| `priceLunch`, `priceDinner` | number | JPY, typical Kobe beef course |
| `openingHours` | string | [OSM opening_hours syntax](https://wiki.openstreetmap.org/wiki/Key:opening_hours), evaluated in JST |
| `rating` | 0–5 | curated |
| `lat`, `lng` | number | set both, or neither |
| `image` | https URL, or `null` | photo shown in the list and popup; `null` hides a bad scraped photo |
| `imageSource` | URL | page the photo is credited to (shown as "Photo: host"); defaults to `website` |
| `_sources`, `_notes`, `_checked` | any | for humans only, ignored by the build |

## Photos

By default the build uses the `og:image` of the restaurant's own website. Only about 56 of the 204
restaurants list a website, so most need a curated `image`.

Rules for `image`:

- **Use the restaurant's own site or official social account first.** Hotel restaurants can use the hotel's
  page for that restaurant. Prefer a photo of the dining room, the counter or a Kobe beef dish. A logo or
  a generic hotel exterior is a last resort.
- **Do not take photos from Tabelog, Gurunavi, Hot Pepper, Retty, Google Maps or Instagram CDN URLs.**
  They are user or platform content, the URLs expire, or the site forbids scraping.
- Wikimedia Commons is fine (use the `upload.wikimedia.org` file URL). Set `imageSource` to the Commons file page.
- Must be a direct **https** image URL (`.jpg`/`.png`/`.webp`…), not a page URL. The build checks it loads as
  an image and drops it with a warning otherwise.
- Photos are hotlinked, never copied into the repo.
- Also replace scraped photos that are wrong: logos, "no image" placeholders, a hotel's guest room. Use a
  better URL, or `"image": null`.
- Note where you found it in `_sources` and set `_checked`, as for other fields.

Example:

```json
"kb-207": {
  "image": "https://example.com/images/dining-room.jpg",
  "imageSource": "https://example.com/",
  "_checked": "2026-10-16"
}
```
