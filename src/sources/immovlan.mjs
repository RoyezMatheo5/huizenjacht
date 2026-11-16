// Immovlan: server-side HTML met <article class="v3-search-card"> per pand.
// Geen straatnaam op de zoekpagina, dus ontdubbelen gebeurt hier op
// postcode + prijs + slaapkamers (zie dedupe.mjs).

import { fetchText, stripTags, parsePrice, toInt, sleep, decodeEntities, titleCase } from '../lib.mjs';

function parseCard(block) {
  const url = block.match(/data-url="(https:\/\/immovlan\.be\/nl\/detail\/([a-z-]+)\/te-koop\/(\d{4})\/([a-z-]+)\/([a-z0-9]+))"/i);
  if (!url) return null;
  const [, link, type, postcode, locSlug, code] = url;

  const price = parsePrice(stripTags(block.match(/class="v3-search-card-price"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? ''));
  const locality = stripTags(block.match(/itemprop="addressLocality"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '') || titleCase(locSlug.replace(/-/g, ' '));
  const pills = [...block.matchAll(/class="v3-search-card-pill"[^>]*>([\s\S]*?)<\/span>/g)].map((m) => stripTags(m[1]));
  const pill = (re) => toInt(pills.find((p) => re.test(p)));
  const bedrooms = pill(/slaapkamer/i);
  const livingArea = pill(/bewoonbare|woonopp|m²\s*$/i);
  const plotArea = pill(/grond|perceel|terrein/i);
  const photo = block.match(/data-src="(https:\/\/api-image\.immovlan\.be[^"]+)"/)?.[1] ?? null;
  const ribbon = stripTags(block.match(/class="v3-search-card-ribbon[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '');
  const description = stripTags(block.match(/itemprop="description"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? '');
  const epc = block.match(/v3-epc-watermark\s+\w*?([A-G][+]?)"/)?.[1] ?? null;

  let status = null;
  if (/verkocht/i.test(ribbon)) status = 'sold';
  else if (/optie|bod/i.test(ribbon)) status = 'option';

  return {
    source: 'immovlan',
    sourceId: code.toUpperCase(),
    url: link,
    title: stripTags(block.match(/class="v3-search-card-title"[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? '') || 'Huis te koop',
    type,
    price,
    bedrooms,
    livingArea,
    plotArea,
    street: null,
    number: null,
    postcode,
    locality,
    lat: null,
    lon: null,
    photo: photo ? decodeEntities(photo) : null,
    agency: null,
    epc,
    status,
    publicSale: /openbare verkoop|biddit/i.test(ribbon + ' ' + description),
    description: description.slice(0, 600),
  };
}

export async function scrapeImmovlan(config, areas) {
  const towns = [...new Set(areas.flatMap((a) => (a.immovlan || '').split(',').filter(Boolean)))].join(',');
  const found = new Map();

  for (let page = 1; page <= 6; page++) {
    const url =
      'https://immovlan.be/nl/vastgoed?transactiontypes=te-koop,in-openbare-verkoop&propertytypes=huis' +
      `&towns=${towns}&maxprice=${config.maxPrice}&minbedrooms=${config.minBedrooms}` +
      `&sortby=zoekresultaten-nieuwste${page > 1 ? `&page=${page}` : ''}`;
    const html = await fetchText(url);
    const blocks = html.split(/<article\b/).slice(1).map((b) => b.split('</article>')[0]);
    let added = 0;
    for (const b of blocks) {
      const item = parseCard(b);
      if (!item || found.has(item.sourceId)) continue;
      found.set(item.sourceId, item);
      added++;
    }
    if (added === 0 || blocks.length < 20) break;
    await sleep(1200);
  }
  return [...found.values()];
}
