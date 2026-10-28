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

/** "¥7,480 dinner": the real figure where we have one, else the tier's range. */
export function priceEl(r: { priceTier?: number | null; priceLunch?: number | null; priceDinner?: number | null }): HTMLElement | null {
  const el = document.createElement('span');
  el.className = 'price';
  const [n, meal] = r.priceDinner ? [r.priceDinner, 'dinner'] : r.priceLunch ? [r.priceLunch, 'lunch'] : [null, null];
  if (n) {
    const small = document.createElement('small');
    small.textContent = ` ${meal}`;
    el.append(yen(n), small);
  } else if (r.priceTier) {
    el.textContent = ['', 'under ¥5,000', '¥5,000–15,000', '¥15,000–30,000', 'over ¥30,000'][r.priceTier] ?? '';
  } else return null;
  return el;
}

/** OSM opening_hours "Mo-Fr 11:00-22:00; Sa,Su 11:00-21:00" → one rule per line, days spelled out. */
const DAYS: Record<string, string> = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun', PH: 'holidays' };
export const hoursLines = (spec: string) =>
  spec.split(/\s*;\s*/).filter(Boolean).map((l) =>
    l.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, (d) => DAYS[d])
      .replace(/(?<=[a-z]),(?=[A-Za-z])/g, ', ')
      .replace(/(?<=\d),(?=\d)/g, ', ')
      .replace(/-/g, '–')
      .replace(/\boff\b/, 'closed'));

/** "0789781550" → "078-978-1550". Kobe numbers are 078; mobiles and free-dial are 3-4-4. */
export function tel(raw: string): string {
  const d = raw.replace(/[^\d]/g, '');
  if (/^0[5-9]0\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^0120\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  if (/^078\d{7}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw;
}
