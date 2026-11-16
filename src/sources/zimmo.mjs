// Zimmo: server-side gerenderde Angular-pagina per gemeente. Elk pand zit in een
// <zimmo-listing>-element; we lezen link, adres, prijs en kenmerken uit de HTML.

import { fetchText, stripTags, parsePrice, toInt, sleep, decodeEntities } from '../lib.mjs';

function parseCard(block) {
  const link = block.match(/href="(\/nl\/([a-z0-9-]+)-(\d{4})\/te-koop\/([a-z-]+)\/([A-Z0-9]{4,7}))"/);
  if (!link) return null;
  const [, path, , postcode, type, code] = link;

  // <address> Straat 12 <br> 8490 Jabbeke </address>
  const addr = block.match(/<address[^>]*>([\s\S]*?)<\/address>/);
  let street = null, number = null, locality = null, pc = postcode;
  if (addr) {
    const parts = addr[1].split(/<br[^>]*>/).map((p) => stripTags(p)).filter(Boolean);
    const last = parts.pop() || '';
    const m = last.match(/^(\d{4})\s+(.+)$/);
    if (m) [, pc, locality] = m;
    const streetLine = parts.join(' ').trim();
    // Straat = alles tot het eerste losse getal; de rest is huisnummer
    // ("94 - C", "29 bus U24", "1B").
    const sm = streetLine.match(/^(.*?\D)\s+(\d.*)$/);
    if (sm) [, street, number] = sm;
    else if (streetLine) street = streetLine;
  }

  const priceBlock = block.match(/class="price"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
  const priceText = priceBlock ? stripTags(priceBlock[1]) : '';
  const bedrooms = toInt(block.match(/aantal slaapkamers is (\d+)/i)?.[1]);
  const livingArea = toInt(block.match(/woonoppervlakte is (\d+)/i)?.[1]);
  const plotArea = toInt(block.match(/(?:perceel|grond)oppervlakte is (\d+)/i)?.[1]);
  const photo = block.match(/class="main-image"[^>]*?\ssrc="([^"]+)"/)?.[1]
    ?? block.match(/<img[^>]+src="(https:\/\/files\.zimmo\.be\/[^"]+)"/)?.[1] ?? null;
  const agency = block.match(/alt="([^"]+?) logo"/)?.[1] ?? null;
  const text = stripTags(block);

  let status = null;
  if (/\bverkocht\b/i.test(text)) status = 'sold';
  else if (/\bin optie\b|\bonder optie\b/i.test(text)) status = 'option';

  return {
    source: 'zimmo',
    sourceId: code,
    url: `https://www.zimmo.be${path}`,
    title: `${type.charAt(0).toUpperCase() + type.slice(1)} te koop`,
    type,
    price: parsePrice(priceText),
    bedrooms,
    livingArea,
    plotArea,
    street,
    number,
    postcode: pc,
    locality,
    lat: null,
    lon: null,
    photo: photo ? decodeEntities(photo) : null,
    agency: agency ? decodeEntities(agency) : null,
    epc: block.match(/energielabel is EPC ([A-F]\+?)/i)?.[1]?.toUpperCase() ?? null,
    status,
    publicSale: /openbare verkoop|biddit/i.test(text),
    description: '',
  };
}

export async function scrapeZimmo(config, areas) {
  const found = new Map();
  const slugs = [...new Set(areas.flatMap((a) => a.zimmo || []))];

  for (const slug of slugs) {
    for (let page = 1; page <= 5; page++) {
      const url = `https://www.zimmo.be/nl/${slug}/te-koop/huis${page > 1 ? `?page=${page}` : ''}`;
      const html = await fetchText(url);
      const blocks = html.split('<zimmo-listing').slice(1).map((b) => b.split('</zimmo-listing>')[0]);
      let added = 0;
      for (const b of blocks) {
        const item = parseCard(b);
        if (!item || found.has(item.sourceId)) continue;
        found.set(item.sourceId, item);
        added++;
      }
      await sleep(1200);
      if (added === 0 || !html.includes(`page=${page + 1}`)) break;
    }
  }
  return [...found.values()];
}
