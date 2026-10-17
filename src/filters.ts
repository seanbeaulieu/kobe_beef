import type { Filters, Restaurant, SortKey } from './types';
import { distanceKm } from './geo';
import { ward } from './format';
import { isOpen, japanWallClock, parseJapanLocal, type loadHours } from './hours';

type OHCtor = Awaited<ReturnType<typeof loadHours>>;

export const DEFAULT_FILTERS: Filters = {
  query: '',
  maxPriceTier: 4,
  includeUnknownPrice: true,
  hoursMode: 'any',
  hoursAt: '',
  includeUnknownHours: true,
  minRating: 0,
  includeUnknownRating: true,
  center: null,
  radiusKm: 2,
  withPhoto: false,
};

export interface Result {
  r: Restaurant;
  distanceKm: number | null;
  open: boolean | null;
}

/** Pure: same inputs → same output. `oh` must be loaded if hoursMode !== 'any'. */
export function applyFilters(all: Restaurant[], f: Filters, oh: OHCtor | null): Result[] {
  const q = f.query.trim().normalize('NFKC').toLowerCase();
  const when =
    f.hoursMode === 'now' ? japanWallClock() : f.hoursMode === 'at' ? parseJapanLocal(f.hoursAt) : null;

  const out: Result[] = [];
  for (const r of all) {
    if (q) {
      const hay = `${r.name} ${r.nameEn ?? ''} ${r.address} ${ward(r.address) ?? ''}`.normalize('NFKC').toLowerCase();
      if (!hay.includes(q)) continue;
    }

    if (f.withPhoto && !r.image) continue;

    if (r.priceTier == null ? !f.includeUnknownPrice : r.priceTier > f.maxPriceTier) continue;

    if (f.minRating > 0 && (r.rating == null ? !f.includeUnknownRating : r.rating < f.minRating)) continue;

    let open: boolean | null = null;
    if (when && oh) {
      open = isOpen(oh, r.openingHours, when);
      if (open === false) continue;
      if (open === null && !f.includeUnknownHours) continue;
    }

    let d: number | null = null;
    if (f.center) {
      d = distanceKm(f.center, r);
      if (d > f.radiusKm) continue;
    }

    out.push({ r, distanceKm: d, open });
  }

  return out;
}

// Featured: entries we know the most about first, then registry order.
const richness = (r: Restaurant) =>
  (r.image ? 2 : 0) + (r.rating != null ? 1 : 0) + (r.priceTier != null ? 1 : 0) + (r.openingHours ? 1 : 0) + (r.nameEn ? 0.5 : 0);
const label = (r: Restaurant) => (r.nameEn ?? r.name).normalize('NFKC').toLowerCase();
// unknowns sort last in either direction
const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
  a == null ? (b == null ? 0 : 1) : b == null ? -1 : (a - b) * dir;

/** Returns a new, sorted array; ties fall back to registration number. */
export function sortResults(results: Result[], key: SortKey): Result[] {
  const cmp: Record<SortKey, (a: Result, b: Result) => number> = {
    featured: (a, b) => richness(b.r) - richness(a.r),
    distance: (a, b) => nullsLast(a.distanceKm, b.distanceKm, 1),
    price: (a, b) => nullsLast(a.r.priceTier, b.r.priceTier, 1),
    rating: (a, b) => nullsLast(a.r.rating, b.r.rating, -1),
    name: (a, b) => label(a.r).localeCompare(label(b.r)),
  };
  return [...results].sort((a, b) => cmp[key](a, b) || a.r.registrationNo - b.r.registrationNo);
}
