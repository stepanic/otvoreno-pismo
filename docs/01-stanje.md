# 01 — Stanje implementacije (20. 10. 2026.)

## Gotovo (nije još testirano)
- `migrations/0001_init.sql` — shema (pisma, potpisi, identity_claims, tokeni, sesije, oidc_states, log s append-only triggerima, rate).
- `src/store.ts` — sva logika: pisma (nacrt → objava → zatvaranje), potpis (zahtjev, potvrda, povlačenje, ponovni potpis), razine iz metoda, moderacija (odobri / odbij / ručno potvrdi), ORCID/Certilia vezanje (jedan identitet po pismu), organizatori (login token, sesije), rate limit.
- `src/chain.ts` — lanac hasheva, atomarno s promjenom stanja (D1 batch), retry na sudar seq.
- `src/oidc.ts` — generički OIDC (discovery, PKCE za Certiliju, RS256 provjera id_tokena WebCryptom, nonce opcionalan za Certiliju).
- `src/domains.ts` — HR allowlista + opća pravila (.edu, ac.xx) + jednokratne domene.
- `src/views.ts`, `src/index.ts` — server-side HTML, rute, CSRF provjera Origina, Turnstile opcionalno.
- `scripts/verify-lib.mjs`, `verify-log.mjs`, `checkpoint.sh` — neovisna provjera i OTS.
- `npx tsc --noEmit` prolazi.

## Sljedeće
1. `vitest.config.ts` s `@cloudflare/vitest-plugin` (`cloudflareTest`, `readD1Migrations`; paket je nasljednik `vitest-pool-workers`, vitest 4.1), `test/setup.ts` primjenjuje migracije.
2. Testovi: chain, domains, canonical, markdown escape, verifyIdToken (RSA ključ generiran u testu, JWKS kroz `_caches`), integracija preko `worker.fetch` (login organizatora → pismo → objava → potpis → `outbox` → potvrda → moderacija → povlačenje → `verify()` iz `scripts/verify-lib.mjs` mora proći), OIDC callback sa stubanim `fetch`.
3. `wrangler dev` ručni prolaz (MAIL_MODE=log), README s uputama za deploy (D1 create, secrets, Certilia redirect URI `/oidc/callback/certilia`, ORCID redirect).
4. GitHub `stepanic/otvoreno-pismo` (javni), push.
5. Faza 2 (Semaphore) prema `00-plan.md`.
