// Gedeelde hulpfuncties voor alle bronnen.

import { execFile } from 'node:child_process';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Haalt een pagina op via curl. Bewust geen fetch() van Node: sommige sites
// (Zimmo) blokkeren Node op basis van de TLS-vingerafdruk, curl laten ze door.
// Gooit een fout bij een status buiten 2xx, zodat de bron als "mislukt" telt.
function curl(url) {
  return new Promise((resolve, reject) => {
    execFile(
      'curl',
      ['-sL', '--compressed', '--max-time', '30', '-A', UA, '-H', 'accept-language: nl-BE,nl;q=0.9',
        '-w', '\n__STATUS__%{http_code}', url],
      { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        if (err) return reject(err);
        const i = stdout.lastIndexOf('\n__STATUS__');
        const status = Number(stdout.slice(i + 11));
        if (status < 200 || status >= 300) return reject(new Error(`HTTP ${status} voor ${url}`));
        resolve(stdout.slice(0, i));
      },
    );
  });
}

export async function fetchText(url, { retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await curl(url);
    } catch (err) {
      lastErr = err;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}

export function decodeEntities(s = '') {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

export const stripTags = (s = '') =>
  decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// "€ 295.000", "295 000 €" -> 295000. Geen cijfers -> null (prijs op aanvraag).
export function parsePrice(text) {
  if (text == null) return null;
  if (typeof text === 'number') return text;
  const digits = String(text).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

export const toInt = (v) => {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

// Voor vergelijkingen: kleine letters, zonder accenten en leestekens.
export const norm = (s = '') =>
  s
    .toString()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const titleCase = (s = '') =>
  s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
