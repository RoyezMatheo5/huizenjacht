// Kantoren op het Zabun CMS (sites van Max-Immo). Eén publieke JSON-API voor
// allemaal; het siteId is een publieke identifier die elke bezoeker meestuurt.

import { execFile } from 'node:child_process';
import { sleep, titleCase } from '../lib.mjs';

export const ZABUN_SITES = [
  { name: 'Immo Stijn', host: 'www.immostijn.be', siteId: '89dac44b-2839-4ffb-8bbb-ab455659b537' },
  { name: 'Immo Sleutel', host: 'www.immosleutel.be', siteId: '923ef2f8-2eee-41bc-ae35-f28a31ffd5b6' },
  { name: 'Immo Gryson', host: 'www.immogryson.be', siteId: '3b7117c5-74d5-4be8-8adf-8c5f98a01528' },
  { name: 'Stijn De Smet Vastgoed', host: 'www.stijndesmetvastgoed.be', siteId: '6d5bae6d-788f-47aa-a5dc-a657e8bcbf69' },
  { name: 'Puur Vastgoed', host: 'www.puur-vastgoed.be', siteId: '2580006c-91a9-44b5-829a-cac6cee0e4b5' },
  { name: 'Vastgoed Sinnaeve', host: 'www.vastgoedsinnaeve.be', siteId: 'f51b673b-afe5-4a6f-afbf-fcea7c40da40' },
];

function postJson(url, headers, body) {
  const args = ['-s', '--compressed', '--max-time', '30', '-X', 'POST', '-w', '\n__STATUS__%{http_code}'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  args.push('--data-binary', JSON.stringify(body), url);
  return new Promise((resolve, reject) =>
    execFile('curl', args, { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, out) => {
      if (err) return reject(err);
      const i = out.lastIndexOf('\n__STATUS__');
      const status = Number(out.slice(i + 11));
      if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status} voor ${url}`));
      resolve(JSON.parse(out.slice(0, i)));
    }));
}

const nl = (x) => x?.nl ?? x?.name?.nl ?? null;

export async function scrapeZabun(config, areas) {
  const zips = [...new Set(areas.map((a) => a.postcode))];
  const out = [];
  const errors = [];

  for (const site of ZABUN_SITES) {
    try {
      // Geen prijsfilter in de query: die sluit "prijs op aanvraag" uit. We filteren zelf.
      const res = await postJson(
        `https://api.cms.zabun.be/sites/${site.siteId}/estates`,
        { 'X-SITE': site.siteId, 'Content-Type': 'application/json', 'zabun-client': 'true' },
        { query: { terms: { 'children.general.address.city.zip': zips } }, sort: [], pagination: { from: 0, size: 200 } },
      );
      for (const r of res.results ?? []) {
        for (const c of r.children ?? []) {
          const g = c.general ?? {};
          const head = nl(g.headType?.name) ?? '';
          const trans = nl(g.transaction?.name) ?? '';
          if (!/^(huis|woning)$/i.test(head) || !/koop/i.test(trans)) continue;
          const a = g.address ?? {};
          out.push({
            source: 'kantoren',
            sourceId: `${site.siteId.slice(0, 8)}-${g.id}`,
            url: `https://${site.host}/nl/aanbod/${g.id}/x`,
            title: nl(g.subType?.name) || head,
            type: nl(g.subType?.name) || head,
            price: g.price?.visible === false ? null : g.price?.value ?? null,
            bedrooms: g.bedroomCount ?? null,
            livingArea: null,
            plotArea: null,
            street: nl(a.street) ?? null,
            number: a.number ?? null,
            postcode: a.city?.zip ?? null,
            locality: a.city?.name ? titleCase(nl(a.city.name) ?? a.city.name) : null,
            lat: null,
            lon: null,
            photo: c.pictures?.[0]?.file ?? c.pictures?.[0]?.thumbnail ?? null,
            agency: site.name,
            epc: null,
            status: /verkocht/i.test(trans) ? 'sold' : /optie/i.test(trans) ? 'option' : null,
            publicSale: false,
            description: '',
          });
        }
      }
    } catch (err) {
      errors.push(`${site.name}: ${err.message}`);
    }
    await sleep(800);
  }
  if (errors.length === ZABUN_SITES.length) throw new Error(errors.join('; '));
  if (errors.length) console.warn('Zabun deels mislukt:', errors.join('; '));
  return out;
}
