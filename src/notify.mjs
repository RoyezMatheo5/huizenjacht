// Pushmeldingen via ntfy (gratis app voor Android en iOS: https://ntfy.sh).
// Het topic is een geheime naam die je als GitHub-secret NTFY_TOPIC instelt.

const SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';
const TOPIC = process.env.NTFY_TOPIC;
const DRY = process.env.DRY_RUN === '1' || !TOPIC;

const euro = (n) => (n == null ? 'prijs op aanvraag' : `€ ${n.toLocaleString('nl-BE')}`);

function line(g) {
  const parts = [euro(g.price), g.locality];
  if (g.bedrooms) parts.push(`${g.bedrooms} slpk`);
  if (g.livingArea) parts.push(`${g.livingArea} m²`);
  if (g.flags?.length) parts.push(g.flags.join(', '));
  return parts.filter(Boolean).join(' · ');
}

const firstUrl = (g) => Object.values(g.ads).find((a) => !a.gone)?.url;

async function send(msg) {
  if (DRY) {
    console.log('[melding]', JSON.stringify(msg, null, 1));
    return;
  }
  const res = await fetch(SERVER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic: TOPIC, ...msg }),
  });
  if (!res.ok) console.error(`ntfy fout: HTTP ${res.status} ${await res.text()}`);
}

export async function notifyNew(groups, config) {
  const site = config.siteUrl;
  if (groups.length <= 3) {
    for (const g of groups) {
      await send({
        title: `Nieuw huis: ${g.locality ?? ''} ${euro(g.price)}`.trim(),
        message: [line(g), g.street ? `${g.street} ${g.number ?? ''}`.trim() : null, `Via ${Object.values(g.ads).map((a) => a.source).join(', ')}`]
          .filter(Boolean).join('\n'),
        tags: ['house'],
        priority: 4,
        click: firstUrl(g) || site,
        ...(g.photo ? { attach: g.photo, filename: 'foto.jpg' } : {}),
        actions: [{ action: 'view', label: 'Alle huizen', url: site }],
      });
    }
    return;
  }
  await send({
    title: `${groups.length} nieuwe huizen te koop`,
    message: groups.slice(0, 8).map(line).join('\n') + (groups.length > 8 ? `\n... en ${groups.length - 8} meer` : ''),
    tags: ['house'],
    priority: 4,
    click: site,
  });
}

export async function notifyPriceDrops(drops, config) {
  for (const { group: g, before } of drops) {
    await send({
      title: `Prijsdaling: ${g.locality ?? ''} ${euro(before)} → ${euro(g.price)}`,
      message: line(g),
      tags: ['chart_with_downwards_trend'],
      priority: 3,
      click: firstUrl(g) || config.siteUrl,
    });
  }
}

export async function notifySourceDown(name, error, config) {
  await send({
    title: `Huizenjacht: ${name} werkt niet meer`,
    message: `Al 3 keer na elkaar mislukt: ${error}`,
    tags: ['warning'],
    priority: 2,
    click: config.siteUrl,
  });
}
