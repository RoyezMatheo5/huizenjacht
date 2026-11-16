// Hoofdscript: haalt alle bronnen op, filtert, ontdubbelt, bewaart en stuurt
// pushmeldingen voor nieuwe woningen en prijsdalingen.
//
//   node src/run.mjs            normale run
//   DRY_RUN=1 node src/run.mjs  geen pushmeldingen, toont wat er gestuurd zou worden

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { scrapeImmoweb } from './sources/immoweb.mjs';
import { scrapeZimmo } from './sources/zimmo.mjs';
import { scrapeImmovlan } from './sources/immovlan.mjs';
import { scrapeZabun } from './sources/zabun.mjs';
import { scrapeResidentie } from './sources/residentie.mjs';
import { mergeIntoGroups, refreshMerged } from './dedupe.mjs';
import { notifyNew, notifyPriceDrops, notifySourceDown } from './notify.mjs';
import { norm } from './lib.mjs';

const DATA_FILE = 'docs/data/listings.json';
const KEEP_REMOVED_DAYS = 30;
const SOURCES = {
  immoweb: scrapeImmoweb,
  zimmo: scrapeZimmo,
  immovlan: scrapeImmovlan,
  kantoren: scrapeZabun,
  residentie: scrapeResidentie,
};

const config = JSON.parse(await readFile('config.json', 'utf8'));
const areas = config.areas.filter((a) => a.active);
const now = new Date().toISOString();

let db;
try {
  db = JSON.parse(await readFile(DATA_FILE, 'utf8'));
} catch {
  db = { meta: { initialized: false, sources: {} }, listings: [] };
}

// ---------- 1. Ophalen ----------
const items = [];
const okSources = new Set();
for (const [name, scrape] of Object.entries(SOURCES)) {
  if (!config.sources?.[name]) continue;
  const prev = db.meta.sources[name] ?? {};
  try {
    const result = await scrape(config, areas);
    items.push(...result);
    okSources.add(name);
    db.meta.sources[name] = { ok: true, count: result.length, lastOk: now, failStreak: 0, error: null };
    console.log(`${name}: ${result.length} advertenties`);
  } catch (err) {
    const failStreak = (prev.failStreak ?? 0) + 1;
    db.meta.sources[name] = { ...prev, ok: false, failStreak, error: String(err.message || err) };
    console.error(`${name} MISLUKT (${failStreak}x): ${err.message}`);
    if (failStreak === 3 && db.meta.initialized) await notifySourceDown(name, err.message, config);
  }
}

// ---------- 2. Filteren ----------
const excluded = (config.excludeLocalities ?? []).map(norm);
function wanted(item) {
  const area = areas.find((a) => a.postcode === item.postcode);
  if (!area) return false;
  const loc = norm(item.locality);
  if (excluded.some((x) => loc.includes(x))) return false;
  if (area.onlyLocalities && !area.onlyLocalities.some((x) => loc.includes(norm(x)))) return false;
  if (item.price == null ? !config.keepUnknownPrice : item.price > config.maxPrice) return false;
  if (item.bedrooms == null ? !config.keepUnknownBedrooms : item.bedrooms < config.minBedrooms) return false;
  return true;
}
const fresh = items.filter(wanted);
console.log(`Na filter: ${fresh.length} van ${items.length} advertenties`);

// ---------- 3. Ontdubbelen en bijwerken ----------
const groups = db.listings;
const oldPrice = new Map(groups.map((g) => [g.id, g.price]));
const created = mergeIntoGroups(groups, fresh, now);

for (const g of groups) {
  // Advertenties van een bron die vandaag gelukt is maar het pand niet meer toont: weg.
  for (const ad of Object.values(g.ads)) {
    if (okSources.has(ad.source) && ad.lastSeen !== now) ad.gone = true;
  }
  refreshMerged(g);
  const allGone = Object.values(g.ads).every((a) => a.gone);
  if (allGone && !g.removedAt) g.removedAt = now;
}

const drops = [];
for (const g of groups) {
  const before = oldPrice.get(g.id);
  if (!g.priceHistory.length && g.price != null) g.priceHistory.push({ date: now, price: g.price });
  else if (g.price != null && g.priceHistory.at(-1)?.price !== g.price) {
    g.priceHistory.push({ date: now, price: g.price });
    if (before != null && g.price < before && !g.removedAt) drops.push({ group: g, before });
  }
}

const cutoff = Date.now() - KEEP_REMOVED_DAYS * 864e5;
db.listings = groups
  .filter((g) => !g.removedAt || Date.parse(g.removedAt) > cutoff)
  .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen));

// ---------- 4. Melden ----------
const newOnes = created.filter((g) => g.status !== 'sold');
console.log(`Nieuw: ${newOnes.length}, prijsdalingen: ${drops.length}, totaal actief: ${db.listings.filter((g) => !g.removedAt).length}`);

if (!db.meta.initialized) {
  console.log('Eerste run: bestaande panden opgeslagen zonder melding.');
  for (const g of created) g.seed = true;
  db.meta.initialized = okSources.size > 0;
} else {
  if (newOnes.length) await notifyNew(newOnes, config);
  if (drops.length) await notifyPriceDrops(drops, config);
}

db.meta.lastRun = now;
db.meta.criteria = {
  maxPrice: config.maxPrice,
  minBedrooms: config.minBedrooms,
  areas: areas.map((a) => a.name),
  excluded: config.excludeLocalities,
};

await mkdir(dirname(DATA_FILE), { recursive: true });
await writeFile(DATA_FILE, JSON.stringify(db, null, 1));
