import type { Filters, Restaurant } from './types';
import { distanceKm } from './geo';
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
      const hay = `${r.name} ${r.nameEn ?? ''} ${r.address}`.normalize('NFKC').toLowerCase();
      if (!hay.includes(q)) continue;
    }

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

  if (f.center) out.sort((a, b) => a.distanceKm! - b.distanceKm!);
  return out;
}
