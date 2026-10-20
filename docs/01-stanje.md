# 01 — Stanje implementacije (20. 10. 2026.)

## Gotovo
- `migrations/0001_init.sql` — shema (pisma, potpisi, identity_claims, tokeni, sesije, oidc_states, log s append-only triggerima, rate).
- `src/store.ts` — sva logika: pisma (nacrt → objava → zatvaranje), potpis (zahtjev, potvrda, povlačenje, ponovni potpis), razine iz metoda, moderacija (odobri / odbij / ručno potvrdi), ORCID/Certilia vezanje (jedan identitet po pismu), organizatori (login token, sesije), rate limit.
- `src/chain.ts` — lanac hasheva, atomarno s promjenom stanja (D1 batch), retry na sudar seq.
- `src/oidc.ts` — generički OIDC (discovery, PKCE za Certiliju, RS256 provjera id_tokena WebCryptom, nonce opcionalan za Certiliju).
- `src/domains.ts` — HR allowlista + opća pravila (.edu, ac.xx) + jednokratne domene.
- `src/views.ts`, `src/index.ts` — server-side HTML, rute, CSRF provjera Origina, Turnstile opcionalno.
- `scripts/verify-lib.mjs`, `verify-log.mjs`, `checkpoint.sh` — neovisna provjera i OTS.
- `npx tsc --noEmit` prolazi.

- Testovi (`npm run check`): 22 testa u Workers runtimeu — unit (lanac, kanonski JSON jednak verifikatoru, domene, markdown escape) i cijeli tok (organizator, objava i zaključavanje teksta, javni/anonimni potpis, deduplikacija, povlačenje i ponovni potpis, moderacija, CSRF, zatvoreno pismo, append-only trigger, Certilia i ORCID OIDC s lažnim IdP-om, tuđi ključ i istekao token).
- Ručni prolaz kroz `wrangler dev`: 4 potpisa, `verify-log.mjs` prolazi na živom serveru; stranica pregledana na 1280 px i 390 px (tamna tema), bez horizontalnog scrolla.

## Sljedeće
1. Deploy instance: domena, D1, `HMAC_KEY`, Resend ili Cloudflare Email Service, Turnstile.
2. Registrirati ORCID i Certilia aplikacije (redirect URI-ji u README-u) i jednom proći stvarni tok; provjeriti nosi li Certilia `nonce` u id_tokenu.
3. Uvesti popis domena javnog sektora (`EXTRA_DOMAINS` ili `src/domains.ts`).
4. GitHub Action za `scripts/checkpoint.sh` (OTS sidrenje po satu, kao u stadion-maksimir-natjecaj-2026).
5. Faza 2 (Semaphore) prema `00-plan.md`; prije toga spike `verifyProof` na Workeru.
