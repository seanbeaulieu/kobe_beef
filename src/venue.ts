// No imports: scripts/pages.mjs loads this file from vite.config.ts too.

/** see scripts/venue-type.mjs */
export type VenueType = 'steak' | 'yakiniku' | 'sukiyaki' | 'casual' | 'other' | 'hotel' | 'ryokan' | 'shop';

export const VENUES: Record<VenueType, { label: string; short: string; hint: string }> = {
  steak: { label: 'Steak & teppanyaki', short: 'Steak', hint: 'Cooked for you on the grill or iron plate' },
  yakiniku: { label: 'Yakiniku', short: 'Yakiniku', hint: 'You grill it yourself at the table' },
  sukiyaki: { label: 'Sukiyaki & shabu-shabu', short: 'Sukiyaki', hint: 'Thin slices in a hot pot' },
  casual: { label: 'Casual', short: 'Casual', hint: 'Ramen, burgers, izakaya and other dishes with Kobe beef in them' },
  other: { label: 'Other restaurants', short: 'Restaurant', hint: 'Western, kaiseki and everything else' },
  hotel: { label: 'Hotel restaurants', short: 'Hotel', hint: 'Teppanyaki and dining rooms inside hotels' },
  ryokan: { label: 'Ryokan & stay-only', short: 'Ryokan', hint: 'Kobe beef comes with an overnight or day-use plan, not walk-in' },
  shop: { label: 'Shops & unconfirmed', short: 'Shop', hint: 'Butchers, mail order, and entries with no restaurant we could find' },
};

export const VENUE_ORDER = Object.keys(VENUES) as VenueType[];

/** Shown by default: places you can walk into (or book) and sit down to eat. */
export const DINE_IN: VenueType[] = VENUE_ORDER.filter((t) => t !== 'ryokan' && t !== 'shop');
