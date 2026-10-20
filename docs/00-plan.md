# 00 — Plan

Platforma otvorenog koda za potpisivanje otvorenih pisama: javno ili anonimno,
s više razina provjere identiteta, tako da nijedan način provjere (pa ni državni
eID) nije preduvjet za potpis. Svatko može podići svoju instancu ili, ako je
instanca otvorena, na njoj objaviti svoje pismo.

Istraživanje: [01 — postojeće platforme](research/01-postojece-platforme.md),
[02 — verifikacija identiteta](research/02-verifikacija-identiteta.md).

## Odluke

| Pitanje | Odluka | Zašto |
|---|---|---|
| Fork ili od nule | Od nule; ideje sheme i moderacije iz Countersigna (MIT), openletter.earth, Pytitiona, e-petitions | Nijedan projekt nema OIDC, razine ni anonimni tok; svi traže prepis runtimea |
| Runtime | Cloudflare Worker (TypeScript), D1, HTML renderiran na serveru | Jedan deploy, bez zasebnog backenda; brze stranice, rade bez JS-a |
| Pohrana identiteta | Samo HMAC(e-mail), HMAC(OIB), HMAC(ORCID); e-mail se ne sprema | Deduplikacija bez baze osobnih podataka |
| Certilia | Worker je povjerljivi OIDC klijent (secret u `wrangler secret`) | Nema zasebnog proxyja kao u ranijem projektu |
| Nepromjenjivost | Lanac hasheva po pismu, javni `log.json`, neovisni verifikator, OTS sidrenje | Organizator ne može tiho brisati ili dodavati potpise |
| Anonimnost u MVP-u | „Anonimno” = ime se ne objavljuje, operater zna samo HMAC | ZK (Semaphore) dolazi u fazi 2, kad i operater ne smije znati tko je potpisao |

## Razine provjere

Javno se prikazuje najviša razina i popis metoda.

| Razina | Naziv | Kako |
|---|---|---|
| 1 | E-mail potvrđen | Link s jednokratnim tokenom; potvrda tek klikom na gumb (skeneri mailova ne potvrđuju) |
| 2 | Institucijski e-mail | Domena s allowliste (HR sveučilišta, instituti, javni sektor; proširivo) |
| 3 | Identitet potvrđen | ORCID (istraživači) ili Certilia (hrvatska eOsobna) — ime iz izvora zamjenjuje upisano |
| 4 | Ručno potvrđeno | Organizator potvrdi izravnim kontaktom, uz javnu bilješku |

## Faze

**Faza 1 — MVP (ovaj repo, sada)**
1. Organizatori: prijava e-mailom, izrada pisma (Markdown), objava, zatvaranje.
   Instanca može biti zatvorena (popis organizatora) ili otvorena.
2. Potpis: ime, titula, ustanova, država, komentar; javno ili anonimno;
   potvrda e-mailom; jedan potpis po e-mailu po pismu.
3. Pojačanje provjere s osobne stranice potpisa: ORCID, Certilia (ako su
   konfigurirani). Jedan ORCID / jedan OIB po pismu.
4. Moderacija: opcionalni red čekanja, ručna potvrda, odbijanje.
5. Povlačenje potpisa linkom iz e-maila.
6. Lanac hasheva, `log.json`, `signatures.json`, CSV, `scripts/verify-log.mjs`,
   `scripts/checkpoint.sh` (OpenTimestamps).
7. Turnstile i rate limit po IP-u protiv spama (opcionalno, preko env-a).

**Faza 2 — anonimno s dokazom (Semaphore v4)**
Svaka razina ima svoju Semaphore grupu. Nakon provjere korisnik u pregledniku
stvara identitet, server prima samo commitment (jedan po HMAC-u), a potpis ide
kao dokaz s nullifierom vezanim uz pismo. Klijentski dio prilagoditi iz
`web/src/zk.ts` projekta stadion-maksimir-natjecaj-2026; provjera dokaza na
Workeru je otvoreno pitanje (CPU limit) — spike prije implementacije.

**Faza 3 — dokument bez državnog posrednika**
Spike zkPassport i Self na stvarnoj hrvatskoj putovnici i eOsobnoj; ako SDK
ne radi na Workeru, `verifierMode: api` ili mali verifier servis.

**Faza 4 — EUDI novčanik (OpenID4VP)** kad Hrvatska otvori verifier sandbox.

## Otvorena pitanja

- Domena instance i tko je operater (odgovornost za obradu podataka, GDPR).
- Popis domena javnog sektora (postoji izvan ovog repoa; uvesti u `src/domains.ts`).
- Prikazivati li titulu kao tvrdnju potpisnika ili samo ako je iz ORCID-a.
