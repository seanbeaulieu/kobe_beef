// Guesses what kind of place a registry entry is from its name, English name
// and OSM cuisine. The registry only says "you can eat here", which lumps
// teppanyaki counters together with ryokan, butcher shops and ramen stalls.
// First matching rule wins; data/overrides.json `venueType` beats all of them.
// "other" is still a sit-down restaurant (western, kaiseki, Korean…), just not
// one we can place from the name.

// ryokan (stay-only meal plans) and shop (butchers, mail order, entries with no
// restaurant we could find) can't be guessed from a name; they come from overrides.
export const VENUE_TYPES = ['steak', 'yakiniku', 'sukiyaki', 'casual', 'other', 'hotel', 'ryokan', 'shop'];

const RULES = [
  // hotels and ryokan (most of Arima onsen is this)
  ['hotel', /ホテル|ほてる|hotel|旅館|旅篭|リゾート|resort|エクシブ|御苑|月光園|瑞苑|瑞宝園|欽山|別墅|奥の細道|龍泉閣|嵐翠|御幸荘|メルヴェール|有馬きらり|温泉|onsen|花小宿|御所坊/i],
  // butchers and meat wholesalers
  ['shop', /精肉|肉店|ミートショップ|meat shop|食品/i],
  // before casual, so 焼肉酒場 / 焼肉 冷麺 stay yakiniku
  ['yakiniku', /焼肉|焼き肉|やきにく|yakiniku|ホルモン|barbecue|bbq|てっちゃん|大長今|冷麺/i],
  ['sukiyaki', /すき焼|すきやき|sukiyaki|しゃぶ|shabu|にくなべ/i],
  // Kobe beef as an ingredient in something else
  ['casual', /ら[ー-]めん|ラーメン|ramen|麺|麵|noodle|burger|バーガー|ぎょうざ|餃子|gyoza|お好み焼|天ぷら|フードホール|food ?hall|kitchen ?car|牛肉重|over rice|居酒屋|izakaya|酒場|カフェ|cafe|coffee|chinese|バル|ポートテラス|ひょうご五国|洋食|amona|salvatore/i],
  ['steak', /ステーキ|すてーき|steak|鉄板|teppan|ビフテキ|bif(?:teck|uteki)|grill|^神戸牛|kobe ?beef/i],
];

/** @returns {string} one of VENUE_TYPES */
export function guessVenueType({ name, nameEn, cuisine }) {
  const hay = [name, nameEn, cuisine].filter(Boolean).join(' ').normalize('NFKC');
  for (const [type, re] of RULES) if (re.test(hay)) return type;
  return 'other';
}
