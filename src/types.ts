export interface Restaurant {
  id: string;
  registrationNo: number;
  name: string;
  nameEn: string | null;
  address: string;
  postal: string | null;
  tel: string | null;
  website: string | null;
  lat: number;
  lng: number;
  coordSource: 'registry' | 'gsi' | 'manual';
  /** OpenStreetMap opening_hours syntax, e.g. "Mo-Su 11:00-21:00" */
  openingHours: string | null;
  /** 1–4 (¥ … ¥¥¥¥) */
  priceTier: 1 | 2 | 3 | 4 | null;
  priceLunch: number | null;
  priceDinner: number | null;
  /** 0–5 */
  rating: number | null;
  cuisine: string | null;
  osmId: string | null;
}

export interface Dataset {
  generatedAt: string;
  source: string;
  count: number;
  restaurants: Restaurant[];
}

export interface LngLat {
  lat: number;
  lng: number;
}

export type HoursMode = 'any' | 'now' | 'at';

export interface Filters {
  query: string;
  maxPriceTier: 1 | 2 | 3 | 4;
  includeUnknownPrice: boolean;
  hoursMode: HoursMode;
  /** Japan-local "YYYY-MM-DDTHH:mm" when hoursMode === 'at' */
  hoursAt: string;
  includeUnknownHours: boolean;
  minRating: number;
  includeUnknownRating: boolean;
  center: LngLat | null;
  radiusKm: number;
}
