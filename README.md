# Huizenjacht Jabbeke

Kijkt elk uur (7u tot 22u) op Immoweb, Zimmo en Immovlan naar huizen te koop rond Jabbeke,
plus rechtstreeks op de sites van Residentie Vastgoed, Immo Stijn, Immo Sleutel, Immo Gryson,
Stijn De Smet, Puur Vastgoed en Vastgoed Sinnaeve (`src/sources/zabun.mjs`, `residentie.mjs`).
Bij een nieuw huis of een prijsdaling krijg je een pushmelding op je gsm. Alle huizen staan
op een eigen website met foto's, filters, favorieten en een kaart.

Hetzelfde huis op meerdere portalen of bij meerdere kantoren verschijnt maar één keer
(ontdubbeld op adres, of op postcode + prijs + slaapkamers + oppervlakte als het adres ontbreekt).

## Zoekcriteria aanpassen

Alles staat in `config.json`:

- `maxPrice`, `minBedrooms`
- `areas`: per postcode `"active": true/false`. Uitgeschakelde randgemeenten staan er al in.
- `excludeLocalities`: deelgemeenten die je niet wil (nu Veldegem, Meetkerke, Nieuwmunster).

Na een wijziging: committen en pushen. De volgende run gebruikt de nieuwe criteria.

## Eenmalige installatie

### 1. Pushmeldingen op je gsm

1. Installeer de app **ntfy** (Android: Play Store, iPhone: App Store).
2. Tik op **+** en abonneer je op je eigen geheime topicnaam (dezelfde als het secret
   `NTFY_TOPIC` hieronder). Laat de server op `ntfy.sh` staan.

Iedereen die deze topicnaam kent, kan je meldingen lezen. Deel hem dus niet.

### 2. GitHub-repository

1. Maak op GitHub een nieuwe repository `huizenjacht` aan.
   **Let op:** GitHub Pages werkt op een gratis account alleen met een **publieke** repository.
   De woningdata zijn openbare advertenties, maar je zoekcriteria zijn dan wel zichtbaar.
2. Pas in `config.json` `siteUrl` aan naar `https://<jouw-github-naam>.github.io/huizenjacht/`.
3. Push deze map naar de repository.

### 3. Instellingen in GitHub

- **Settings > Secrets and variables > Actions > New repository secret**
  Naam `NTFY_TOPIC`, waarde je geheime topicnaam.
- **Settings > Pages**: Source = *Deploy from a branch*, branch `main`, map `/docs`.
- **Actions**: open *Huizen zoeken* en klik *Run workflow* om meteen een eerste run te doen.

## Lokaal testen

Vereist Node 20+ en curl.

```
DRY_RUN=1 node src/run.mjs
```

Met `DRY_RUN=1` worden geen meldingen verstuurd, maar wel getoond in de console.

## Hoe het werkt

| Bestand | Rol |
|---|---|
| `src/sources/*.mjs` | Leest de zoekresultaten van elk portaal uit |
| `src/dedupe.mjs` | Voegt dezelfde woning van verschillende bronnen samen |
| `src/run.mjs` | Filtert, bewaart in `docs/data/listings.json`, bepaalt wat nieuw is |
| `src/notify.mjs` | Pushmeldingen via ntfy |
| `docs/index.html` | De website (GitHub Pages) |
| `.github/workflows/scan.yml` | Elk uur automatisch uitvoeren |

Werkt een portaal 3 runs na elkaar niet (bv. omdat het de GitHub-servers blokkeert),
dan krijg je daar één melding van. Op de website zie je per bron een groen of rood bolletje.
