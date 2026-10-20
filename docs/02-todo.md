# 02 — TODO do pravog lansiranja

Stanje 20. 10. 2026.: instanca radi na https://openletter.domovina.ai, testno
pismo `/pismo-test-ms` ima potpis koji je stvarno prošao i Certiliju i ORCID
(razina 3, ime preuzeto iz ORCID-a), `verify-log.mjs` prolazi. Za isprobavanje je
spremno; za pravo pismo nije.

Vezani dokumenti: [00-plan](00-plan.md) (faze), [01-stanje](01-stanje.md) (što je
napravljeno i deployano).

## P0 — prije pravog pisma

1. **Kvota mailova.** Resend free: 100 mailova/dan, 3.000/mj. Pismo koje se
   proširi puca prvi dan. Plaćeni Resend (20 USD/mj za 50.000) ili Cloudflare
   Email Service (beta, traži Workers Paid).
2. **Turnstile uključiti** (`TURNSTILE_SITE_KEY` var + `TURNSTILE_SECRET`). Kod
   postoji; bez njega skripta troši kvotu mailova unatoč rate limitu
   (20 potpisa/sat po IP-u, 5 po e-mailu).
3. **Stranica o privatnosti / GDPR**: operater, pravna osnova, što se sprema
   (ime, titula, ustanova, HMAC e-maila/OIB-a/ORCID-a, domena), rok čuvanja,
   kontakt. Poveznica iz obrasca uz kvačicu suglasnosti.
4. **Cron čišćenje** (`scheduled` handler): nepotvrđeni potpisi starije od 7 dana
   (sadrže ime), istekli `login_tokens`, `sessions`, `oidc_states`, `rate`.
5. **Više organizatora po pismu**: tablica `letter_organizers`, pozivnica e-mailom;
   sada `letters.owner_hash` + globalni secret `ORGANIZERS`.

## P1 — ubrzo nakon lansiranja

6. **self.xyz / zkPassport** (faza 3) — jedini izričiti zahtjev grupe koji nije
   pokriven (provjera osobnom bez Certilije). Prvo spike na Workeru i stvarnoj
   hrvatskoj putovnici/eOsobnoj ([research/02](research/02-verifikacija-identiteta.md) §3–4).
7. **OTS sidrenje kao GitHub Action** po satu (`scripts/checkpoint.sh`, uzor
   `.github/workflows/maksimir-checkpoint.yml` u stadion-maksimir-natjecaj-2026).
8. **Domene javnog sektora** — popis postoji izvan repoa; `EXTRA_DOMAINS` ili
   `src/domains.ts`.
9. **Engleska verzija** sučelja; prijevod pisma kao povezano pismo.
10. **Straničenje potpisa** i istaknuti potpisnici (sada se sve renderira).
11. **Pregled prije objave** (tekst se nakon objave više ne može mijenjati).

## P2 — kasnije

12. **Semaphore ZK anonimnost** (faza 2); spike `verifyProof` na Workeru (CPU).
13. **Neovisni sigurnosni review** u `docs/review/`, tagiran.
14. **Moderacija**: filtri, grupne akcije.
15. **EUDI novčanik / OpenID4VP** kad HR otvori verifier sandbox.

## Otvorena odluka

E-mail se namjerno ne sprema, pa organizator ne može obavijestiti potpisnike.
Ako grupa to želi: opt-in kvačica i odvojena tablica s e-mailom (i brisanje uz
povlačenje potpisa).

## Zamke iz prve iteracije

- `@cloudflare/vitest-pool-workers` je preimenovan u `@cloudflare/vitest-plugin`
  (API: `cloudflareTest()` plugin + `readD1Migrations`); radi s vitest 4.1, ne s
  vitest 5 iako ga npm nudi kao latest.
- Testni runtime učitava `.dev.vars` i njime pregazi `vars` iz wranglera — testovi
  su prolazili lokalno s `MAIL_MODE=resend` u wrangleru samo zbog `.dev.vars`.
  Zato `vitest.config.ts` eksplicitno postavlja `BASE_URL` i `MAIL_MODE=log`.
- Ruta `/:slug` mora biti registrirana zadnja, inače guta `/a`, `/login`, `/kako-radi`.
- ORCID token endpoint prima samo `client_secret_post` (secret u tijelu) — tako i šaljemo.
- Certilia: stvarni tok s PKCE + client secretom izravno iz Workera radi
  (bez proxyja iz flutter_certilia); provjera `nonce`/`aud` prošla.
- `ORGANIZERS` je secret, ne var (javni repo); `env.ORGANIZERS` zato može biti undefined.
- Kod postavljanja secreta iz clipboarda provjeriti oblik (ORCID secret = UUID,
  ORCID ID = `APP-…`, Resend = `re_…`): jednom je u secret otišao krivi sadržaj
  clipboarda i morao se obrisati.
