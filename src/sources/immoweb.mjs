// Immoweb: de zoekpagina bevat per pand een JSON-blok in het attribuut
// :classified="..." van <iw-search-card-rendered>. Daarin staan prijs, adres,
// coördinaten, slaapkamers en foto's.

import { fetchText, decodeEntities, sleep, titleCase } from '../lib.mjs';

const STATUS = { under_option: 'option', sold: 'sold', under_offer: 'option' };

export async function scrapeImmoweb(config, areas) {
  const postcodes = [...new Set(areas.map((a) => a.postcode))].join(',');
  const found = new Map();

  for (let page = 1; page <= 8; page++) {
    const url =
      'https://www.immoweb.be/nl/zoeken/huis/te-koop?countries=BE' +
      `&postalCodes=${postcodes}&maxPrice=${config.maxPrice}` +
      `&minBedroomCount=${config.minBedrooms}&orderBy=newest&page=${page}`;
    const html = await fetchText(url);

    // Een echte blokkade is een kleine captcha-pagina. Een lege pagina na de
    // laatste resultaten noemt DataDome ook, maar is gewoon het einde.
    if (!html.includes('iw-search-card-rendered') && (html.length < 100000 || /captcha-delivery/i.test(html))) {
      if (page === 1) throw new Error('Immoweb blokkeert dit verzoek (DataDome/captcha)');
      break;
    }

    // Onder de resultaten toont Immoweb "vergelijkbare panden" uit andere
    // gemeenten. Die knippen we weg.
    const cut = html.indexOf('<iw-search-similar');
    const main = cut > 0 ? html.slice(0, cut) : html;

    const blobs = [...main.matchAll(/:classified="([^"]*)"/g)];
    if (blobs.length === 0) break;

    let added = 0;
    for (const [, raw] of blobs) {
      let c;
      try {
        c = JSON.parse(decodeEntities(raw));
      } catch {
        continue;
      }
      if (found.has(c.id)) continue;
      const loc = c.property?.location ?? {};
      const pics = c.media?.pictures ?? [];
      found.set(c.id, {
        source: 'immoweb',
        sourceId: String(c.id),
        url: `https://www.immoweb.be/nl/zoekertje/${c.id}`,
        title: c.property?.title || null,
        type: c.property?.subtype || c.property?.type || null,
        price: c.price?.mainValue ?? c.transaction?.sale?.price ?? null,
        bedrooms: c.property?.bedroomCount ?? null,
        livingArea: c.property?.netHabitableSurface ?? null,
        plotArea: c.property?.landSurface ?? null,
        street: loc.street || null,
        number: loc.number || null,
        postcode: loc.postalCode || null,
        locality: loc.locality ? titleCase(loc.locality) : null,
        lat: loc.latitude ?? null,
        lon: loc.longitude ?? null,
        photo: pics[0]?.largeUrl || pics[0]?.mediumUrl || null,
        agency: c.customerName === 'PRIVATE' ? 'Particulier' : c.customerName || null,
        epc: c.transaction?.certificate || null,
        status: STATUS[c.flags?.main] ?? null,
        publicSale: Boolean(c.transaction?.sale?.publicSale),
        description: c.property?.title || '',
      });
      added++;
    }
    if (added === 0) break;
    await sleep(1500);
  }
  return [...found.values()];
}
