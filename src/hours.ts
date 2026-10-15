// opening_hours is ~1 MB (holiday tables), so it's loaded lazily the first
// time an hours filter is used.
import type { opening_hours as OH } from 'opening_hours';

type OHCtor = typeof OH;
let ctor: Promise<OHCtor> | null = null;
const parsed = new Map<string, OH | null>();

const KOBE_NOMINATIM = {
  lat: 34.69,
  lon: 135.195,
  address: { country_code: 'jp', state: '兵庫県' },
};

export function loadHours(): Promise<OHCtor> {
  ctor ??= import('opening_hours').then((m) => m.default as unknown as OHCtor);
  return ctor;
}

/**
 * opening_hours evaluates a Date using its *local* fields, but visitors may be
 * anywhere. Build a Date whose local fields equal the given Japan wall-clock
 * time so evaluation is always in JST.
 */
export function japanWallClock(at: Date = new Date()): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return new Date(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
}

/** "YYYY-MM-DDTHH:mm" interpreted as Japan wall-clock time. */
export function parseJapanLocal(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

export function toJapanLocalInput(d: Date = japanWallClock()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** true/false if known, null if unknown or unparseable. Requires loadHours() resolved. */
export function isOpen(Ctor: OHCtor, spec: string | null, wallClock: Date): boolean | null {
  if (!spec) return null;
  let oh = parsed.get(spec);
  if (oh === undefined) {
    try {
      oh = new Ctor(spec, KOBE_NOMINATIM);
    } catch {
      oh = null;
    }
    parsed.set(spec, oh);
  }
  if (!oh) return null;
  if (oh.getUnknown(wallClock)) return null;
  return oh.getState(wallClock);
}
