const WARDS: Record<string, string> = {
  中央区: 'Chuo',
  東灘区: 'Higashinada',
  灘区: 'Nada',
  兵庫区: 'Hyogo',
  北区: 'Kita',
  長田区: 'Nagata',
  須磨区: 'Suma',
  垂水区: 'Tarumi',
  西区: 'Nishi',
};

/** "神戸市中央区…" → "Chuo, Kobe" (null if the ward isn't recognised). */
export function ward(address: string): string | null {
  // some registry entries repeat the city: "神戸市神戸市中央区…"
  const m = address.match(/(?:神戸市)+\s*(.+?区)/);
  const en = m && WARDS[m[1]];
  return en ? `${en}, Kobe` : null;
}

const jpy = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 });
export const yen = (n: number) => jpy.format(n);

/** ¥¥ followed by the dimmed remainder up to ¥¥¥¥. */
export function priceEl(tier: number): HTMLElement {
  const el = document.createElement('span');
  el.className = 'price';
  el.title = ['', 'Under ¥5,000', '¥5,000–15,000', '¥15,000–30,000', 'Over ¥30,000'][tier] ?? '';
  const off = document.createElement('span');
  off.className = 'off';
  off.textContent = '¥'.repeat(4 - tier);
  el.append('¥'.repeat(tier), off);
  return el;
}

/** OSM opening_hours "Mo-Fr 11:00-22:00; Sa,Su 11:00-21:00" → one rule per line. */
export const hoursLines = (spec: string) => spec.split(/\s*;\s*/).filter(Boolean);
