// Residentie Vastgoed (Oudenburg, Brugge, ...): Skarabee-site met server-side
// gerenderde kaarten. Geen postcode in de kaart, dus die leiden we af uit de
// deelgemeente. Straat en nummer komen uit de URL-slug.

import { fetchText, stripTags, parsePrice, toInt, sleep, decodeEntities, titleCase } from '../lib.mjs';

const TOWNS = {
  Jabbeke: '8490', Snellegem: '8490', Varsenare: '8490', Stalhille: '8490', Zerkegem: '8490',
  Oudenburg: '8460', Ettelgem: '8460', Roksem: '8460', Westkerke: '8460',
  Zedelgem: '8210', Loppem: '8210', Veldegem: '8210', Aartrijke: '8211',
  'Sint-Andries': '8200', 'Sint-Michiels': '8200',
  Zuienkerke: '8377', Houtave: '8377', Meetkerke: '8377', Nieuwmunster: '8377',
  Vlissegem: '8421', Klemskerke: '8420', Eernegem: '8480', Gistel: '8470', Bredene: '8450',
};
const BASE = 'https://www.residentievastgoed.be';

function parseCard(chunk) {
  const head = chunk.match(/^<a href="(\/nl-be\/detail\/([^/]+)\/([^/]+)\/(\d+))" title="([^"]*)" class="(pub-\d+ card[^"]*)"[^>]*data-id="(\d+)"([^>]*)>/);
  if (!head) return null;
  const [, path, , streetSlug, , , cls, id, rest] = head;
  const body = chunk.split('</a>')[0];
  const city = stripTags(body.match(/<span class='city'>([^<]*)/)?.[1] ?? '');
  const sm = streetSlug.match(/^(.*?)-(\d+[a-z]?)(?:-|$)/i);
  const street = sm ? titleCase(sm[1].replace(/-/g, ' ')) : null;
  const badge = (b) => new RegExp(`badge--pub is-${b}`).test(body);

  return {
    source: 'residentie',
    sourceId: id,
    url: BASE + path,
    title: stripTags(body.match(/<span class='type'>([^<]*)/)?.[1] ?? 'Woning'),
    type: 'woning',
    price: parsePrice(body.match(/pub-price__value'>([^<]*)/)?.[1]),
    bedrooms: toInt(body.match(/pub__icon--bed">\s*<dd>\s*(\d+)/)?.[1]),
    livingArea: toInt(body.match(/pub__icon--habitable">[\s\S]*?<dd>\s*(\d+)/)?.[1]),
    plotArea: toInt(body.match(/pub__icon--area">[\s\S]*?<dd>\s*(\d+)/)?.[1]),
    street,
    number: sm ? sm[2] : null,
    postcode: TOWNS[city] ?? null,
    locality: city || null,
    lat: parseFloat(rest.match(/data-lat="([\d.]+)"/)?.[1]) || null,
    lon: parseFloat(rest.match(/data-lon="([\d.]+)"/)?.[1]) || null,
    photo: decodeEntities(body.match(/data-src="([^"]+)"/)?.[1] ?? '') || null,
    agency: 'Residentie Vastgoed',
    epc: null,
    status: badge('sold-or-rented') ? 'sold' : badge('option') ? 'option' : null,
    publicSale: false,
    description: /has-project/.test(cls) ? 'nieuwbouw project' : '',
  };
}

export async function scrapeResidentie(config, areas) {
  const pcs = new Set(areas.map((a) => a.postcode));
  const cities = Object.entries(TOWNS).filter(([, pc]) => pcs.has(pc)).map(([c]) => `&cities=${encodeURIComponent(c)}`).join('');
  const found = new Map();
  for (let page = 1; page <= 6; page++) {
    const html = await fetchText(`${BASE}/te-koop?sorts=Dwelling${cities}${page > 1 ? `&pageindex=${page}` : ''}`);
    const chunks = html.split(/(?=<a href="\/nl-be\/detail\/)/).slice(1);
    let added = 0;
    for (const c of chunks) {
      const item = parseCard(c);
      if (!item || found.has(item.sourceId)) continue;
      found.set(item.sourceId, item);
      added++;
    }
    if (added === 0 || !html.includes(`pageindex=${page + 1}`)) break;
    await sleep(1200);
  }
  return [...found.values()];
}
