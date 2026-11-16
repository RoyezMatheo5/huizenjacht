// Ontdubbelen: hetzelfde huis kan op Immoweb, Zimmo en Immovlan staan, en bij
// twee kantoren tegelijk. We groeperen advertenties ("ads") tot één woning.
//
// Regels:
//  1. Zelfde bron + zelfde id                 -> zelfde woning (vorige run).
//  2. Zelfde straat + huisnummer + postcode    -> zelfde woning (ook binnen één portaal).
//  3. Geen adres om te vergelijken: zelfde postcode, prijs binnen 1%,
//     zelfde slaapkamers en woonoppervlakte binnen 5%  -> zelfde woning,
//     maar alleen tussen verschillende portalen of verschillende kantoren.
//     Zo smelten twee identieke nieuwbouwwoningen van één bouwer niet samen.

import { norm } from './lib.mjs';

const SOURCE_PRIORITY = ['immoweb', 'zimmo', 'immovlan', 'residentie', 'kantoren'];
const FIELDS = ['title', 'type', 'bedrooms', 'livingArea', 'plotArea', 'street', 'number',
  'postcode', 'locality', 'lat', 'lon', 'photo', 'epc'];

export const adKey = (x) => `${x.source}:${x.sourceId}`;

// "Gistelse Steenweg" = "Gistelsteenweg", "94 - C" = "94C", "29 bus U24" = "29".
const streetKey = (s) => norm(s).replace(/ /g, '');
const numberKey = (n) => norm(String(n).split(/\bbus\b|\/|,/i)[0]).replace(/ /g, '');
const addressKey = (x) =>
  x.street && x.number && x.postcode ? `${streetKey(x.street)}|${numberKey(x.number)}|${x.postcode}` : null;

// Huisnummer zonder letter, voor "41" tegenover "41B".
const baseNumber = (n) => String(n).match(/\d+/)?.[0];

const close = (a, b, pct) => a == null || b == null || Math.abs(a - b) <= Math.max(a, b) * pct;

function sameHouse(group, item) {
  const ka = addressKey(item);
  for (const ad of Object.values(group.ads)) {
    if (ad.source === item.source && ad.sourceId === item.sourceId) return true;
    const kb = addressKey(ad);
    if (ka && kb) {
      if (ka === kb) return true;
      // Zelfde straat en hoofdnummer (41 vs 41B): verder met de prijs/kamer-check.
      const near = streetKey(ad.street) === streetKey(item.street) && baseNumber(ad.number) === baseNumber(item.number);
      if (!near) continue;
    }
    const differentSeller =
      ad.source !== item.source || (ad.agency && item.agency && norm(ad.agency) !== norm(item.agency));
    if (!differentSeller) continue;
    if (ad.postcode !== item.postcode) continue;
    if (ad.price == null || item.price == null || !close(ad.price, item.price, 0.01)) continue;
    if (ad.bedrooms != null && item.bedrooms != null && ad.bedrooms !== item.bedrooms) continue;
    if (!close(ad.livingArea, item.livingArea, 0.05)) continue;
    if (ad.street && item.street && streetKey(ad.street) !== streetKey(item.street)) continue;
    return true;
  }
  return false;
}

const byPriority = (a, b) =>
  SOURCE_PRIORITY.indexOf(a.source) - SOURCE_PRIORITY.indexOf(b.source);

// Vult de samengevoegde velden van een woning op basis van de beste bron.
export function refreshMerged(group) {
  const all = Object.values(group.ads).sort(byPriority);
  const live = all.filter((a) => !a.gone);
  const ads = live.length ? live : all;

  for (const f of FIELDS) group[f] = ads.find((a) => a[f] != null && a[f] !== '')?.[f] ?? null;
  group.locality = bestLocality(group.postcode, ads.map((a) => a.locality));

  const prices = ads.map((a) => a.price).filter((p) => p != null);
  group.price = prices.length ? Math.min(...prices) : null;
  // "Residentie Vastgoed Brugge" = "Residentie Vastgoed - Brugge"
  const agencies = new Map();
  for (const a of ads) if (a.agency && !agencies.has(norm(a.agency))) agencies.set(norm(a.agency), a.agency);
  group.agencies = [...agencies.values()];
  group.status = ads.find((a) => a.status === 'sold')
    ? 'sold'
    : ads.find((a) => a.status === 'option') ? 'option' : null;
  group.flags = detectFlags(ads);
}

// Portalen noemen een deelgemeente soms bij de hoofdgemeente ("Brugge",
// "Bruges", "Jabbeke Zerkegem"). We kiezen de meest specifieke naam.
const DEELGEMEENTEN = ['Varsenare', 'Snellegem', 'Stalhille', 'Zerkegem', 'Roksem', 'Ettelgem',
  'Westkerke', 'Loppem', 'Aartrijke', 'Sint-Andries', 'Sint-Michiels', 'Houtave', 'Vlissegem',
  'Klemskerke', 'Eernegem'];
const POSTCODE_NAME = { '8211': 'Aartrijke', '8200': 'Sint-Andries/Sint-Michiels' };

function bestLocality(postcode, names) {
  for (const n of names) {
    const hit = DEELGEMEENTEN.find((d) => norm(n || '').includes(norm(d)));
    if (hit) return hit;
  }
  return POSTCODE_NAME[postcode] ?? names.find(Boolean) ?? null;
}

function detectFlags(ads) {
  const text = ads.map((a) => `${a.title || ''} ${a.description || ''}`).join(' ').toLowerCase();
  const flags = [];
  if (/domicili[eë] (is |kan )?(hier )?niet|geen domicili|zonder domicili|vakantiewoning|weekendverblijf|recreatie ?(domein|park)/.test(text))
    flags.push('Geen domicilie?');
  if (/te renoveren|op te knappen|renovatie|opknapper/.test(text)) flags.push('Renovatie');
  if (/lijfrente/.test(text)) flags.push('Lijfrente');
  if (/nieuwbouw|btw-regime|21% btw/.test(text)) flags.push('Nieuwbouw');
  if (ads.some((a) => a.publicSale)) flags.push('Openbare verkoop');
  return flags;
}

// Koppelt de verse advertenties aan bestaande woningen of maakt nieuwe aan.
// Geeft de nieuw aangemaakte woningen terug.
export function mergeIntoGroups(groups, items, now) {
  const created = [];
  for (const item of [...items].sort(byPriority)) {
    const key = adKey(item);
    let group =
      groups.find((g) => g.ads[key]) ??
      groups.find((g) => !g.removedAt && sameHouse(g, item)) ??
      groups.find((g) => g.removedAt && sameHouse(g, item));

    if (!group) {
      group = { id: key.replace(':', '-'), firstSeen: now, lastSeen: now, removedAt: null, priceHistory: [], ads: {} };
      groups.push(group);
      created.push(group);
    }
    group.ads[key] = { ...item, firstSeen: group.ads[key]?.firstSeen ?? now, lastSeen: now, gone: false };
    group.lastSeen = now;
    group.removedAt = null;
  }
  return created;
}
