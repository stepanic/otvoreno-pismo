# Otvoreno pismo

Platforma otvorenog koda za potpisivanje otvorenih pisama: **javno ili anonimno**,
s **više razina provjere** potpisnika, tako da nijedan način provjere (pa ni
državni eID) nije preduvjet za potpis. Svaki potpis ulazi u javni **lanac
hasheva** koji svatko može neovisno provjeriti.

Cloudflare Worker + D1, HTML renderiran na serveru (radi bez JavaScripta).

## Razine provjere

| Razina | Naziv | Kako |
|---|---|---|
| 1 | E-mail potvrđen | link s jednokratnim tokenom + gumb za potvrdu |
| 2 | Institucijski e-mail | domena s allowliste (sveučilišta, instituti, javni sektor) — `src/domains.ts` |
| 3 | Identitet potvrđen | ORCID ili Certilia (hrvatska eOsobna); jedan identitet = jedan potpis po pismu |
| 4 | Ručno potvrđeno | organizator potvrdi izravnim kontaktom, uz javnu bilješku |

Javno se prikazuju brojke po razinama i metode uz svaki potpis. E-mail, OIB i
ORCID se ne spremaju — samo HMAC (za deduplikaciju) i domena e-maila.

## Što ima

- Organizatori: prijava e-mailom, pismo u Markdownu, nacrt → objava → zatvaranje;
  nakon objave tekst je zaključan (njegov hash je prva karika lanca).
- Instanca zatvorena (popis organizatora) ili otvorena (`ORGANIZERS="*"`).
- Potpis: ime, titula, ustanova, država, komentar; anonimno uz opcionalni prikaz
  ustanove po domeni; povlačenje i ponovni potpis linkom iz e-maila.
- Moderacija: opcionalni red čekanja, odobri / odbij / ručno potvrdi.
- Javni izvoz: `/<pismo>/log.json`, `signatures.json`, `letter.json`, `signatures.csv`.
- Zaštita: CSRF (Origin), rate limit po IP-u i e-mailu, opcionalni Turnstile,
  blokada jednokratnih e-mail domena, CSP.

## Provjera lanca

```sh
node scripts/verify-log.mjs https://instanca/<pismo>
```

Provjerava svaku kariku (`sha256(prev_hash|seq|događaj)`), da tekst pisma
odgovara hashu iz lanca i da se objavljeni popis potpisa točno slaže s lancem
(svaki potpis je u lancu hash javnog zapisa sa solju, pa povučeni potpis nestaje
s popisa, a lanac ostaje cijel). `scripts/verify-lib.mjs` nema ovisnosti.

Sidrenje u Bitcoin preko OpenTimestampsa: `scripts/checkpoint.sh https://instanca/<pismo>`
(treba `pip install opentimestamps-client`).

## Lokalni razvoj

```sh
npm ci
printf 'HMAC_KEY=dev\nORGANIZERS=ti@example.org\n' > .dev.vars
npm run db:migrate:local
npm run dev            # http://localhost:8787, mailovi se ispisuju u konzolu
npm run check          # tsc + vitest (Workers runtime, D1 u memoriji)
```

## Deploy

```sh
npx wrangler d1 create otvoreno-pismo      # upiši database_id u wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put HMAC_KEY           # dugačak nasumičan niz; ne mijenjati nakon starta
npx wrangler secret put RESEND_API_KEY     # uz MAIL_MODE=resend i MAIL_FROM na vlastitoj domeni
npm run deploy
```

U `wrangler.jsonc` postavi `BASE_URL`, `SITE_NAME`, `ORGANIZERS`, `MAIL_MODE`, `MAIL_FROM`.

Neobavezno:

- **ORCID** — aplikacija na orcid.org/developer-tools, redirect URI
  `<BASE_URL>/oidc/callback/orcid`; secreti `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`
  (`ORCID_BASE=https://sandbox.orcid.org` za testiranje).
- **Certilia** — OAuth2 aplikacija na developer.certilia.com, redirect URI
  `<BASE_URL>/oidc/callback/certilia`; secreti `CERTILIA_CLIENT_ID`,
  `CERTILIA_CLIENT_SECRET` (`CERTILIA_BASE=https://idp.test.certilia.com` za testiranje).
  Worker je sam povjerljivi OIDC klijent (PKCE + client secret), bez proxyja.
- **Turnstile** — `TURNSTILE_SITE_KEY` (var) i `TURNSTILE_SECRET` (secret).
- **Dodatne domene** — `EXTRA_DOMAINS="domena.hr=Naziv ustanove;druga.hr=Naziv"`.

## Dokumentacija

- [docs/00-plan.md](docs/00-plan.md) — odluke i faze (sljedeće: anonimnost sa
  Semaphore ZK dokazom, zkPassport/Self, EUDI novčanik)
- [docs/research/01-postojece-platforme.md](docs/research/01-postojece-platforme.md)
- [docs/research/02-verifikacija-identiteta.md](docs/research/02-verifikacija-identiteta.md)

Ideje sheme i moderacije djelomično po uzoru na
[Countersign](https://github.com/jaebooker/openletter) (MIT) i
[openletter.earth](https://github.com/citizenspring/openletter) (MIT).
Certilia tok i lanac hasheva preneseni iz
[stadion-maksimir-natjecaj-2026](https://github.com/stepanic/stadion-maksimir-natjecaj-2026).

## Licenca

MIT
