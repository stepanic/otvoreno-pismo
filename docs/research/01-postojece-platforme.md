# 01 — Postojeće platforme za otvorena pisma i peticije

Datum istraživanja: 2026-10-20. Izvori: klonirani repozitoriji (`--depth 1`) u `/private/tmp/claude-501/research-openletter/`, `gh` API, javne stranice. Što nije mogao potvrditi izvor, označeno je kao „nepoznato”.

## 1. Sažetak preporuke

**Graditi od nule na Cloudflare Workers + TypeScript, uz selektivno preuzimanje ideja (i po želji koda) iz jaebooker/openletter (Countersign, MIT).** Ne forkati ni jedan postojeći projekt kao cjelinu: nijedan ne pokriva višerazinsku identifikaciju (OIDC, eID, domena), a oba glavna kandidata su vezana uz stack koji ne radi na Workersima bez prepisivanja (Next.js + Postgres/PGlite; AdonisJS 4 + Heroku Postgres).

## 2. Usporedna tablica

| | jaebooker/openletter („Countersign”) | citizenspring/openletter (openletter.earth) | openletter.net | FLI / ai-security-letter.org | Pytition | alphagov/e-petitions |
|---|---|---|---|---|---|---|
| Stack | Next.js 16 (App Router, server actions), React 19, Drizzle ORM, Postgres (`postgres`) ili PGlite, nodemailer; TS ~1.9k LOC | `api/`: AdonisJS 4 (stari JS), Lucid, Postgres, Heroku; `frontend/`: Next/Vercel SSG; JS | zatvoren (nepoznato) | nepoznato; statične stranice s listom | Django, Python | Ruby on Rails |
| Licenca | MIT | MIT | proprietarno | n/a (sadržaj, ne softver) | BSD-3 | MIT |
| Zadnja aktivnost | 2026-10-15; **1 commit** („first blood”) | 2026-10-12 (merge PR #64); aktivno održavan, ali stara baza | živ servis | živo | 2026-10-04 | 2026-10-19 |
| Zvjezdice | 1 | 23 | n/a | n/a | 117 | 313 |
| Zrelost | vrlo nova; ima unit testove za scoring i Playwright e2e; jedna zajednička admin lozinka | nekoliko godina, 20+ migracija, ali zastarjeli framework (AdonisJS 4) | produkcijska | produkcijska | zrela, stabilna | produkcijska (UK parlament), ali teška (Rails, moderacija vlade) |
| Model podataka | `letters` (slug, title, body Markdown, status draft/published/closed), `signers` (name, email, **title**, country, url, showDomain, status pending/verified/removed, seed, hash tokena, scoring polja trust/authenticity/notability, confirmed, flagged), `auth_reviews` (recenzent→subjekt, real/fake/unsure), `comparisons` (Bradley-Terry parovi) | `letters` (locale, slug, token, user_id, parent_letter_id za prijevode), `signatures` (name, city, occupation, organization, email opcionalno, token, is_verified, `verification_method` email/passkey, `passkey_credential_id`), `users`, `tokens` | nepoznato | popis: titula + ime + institucija + država | petition, signature, organization, user, permission | petition, signature, moderacija |
| Verifikacija | potvrda e-poštom (token u linku + gumb) + **peer review** i **trust graf** (personalizirani PageRank iz početnih potpisnika) + ručna moderacija (hold/restore/remove) | potvrda e-poštom; opcionalno **passkey (WebAuthn)** | e-pošta + lokacija, opcionalno povezani X račun, peer review (autentičnost + „poznatost” po parovima) | FLI: slojevito; „verified” oznaka kad ih FLI izravno potvrdi ili postoji javna izjava; svi prolaze e-mail provjere, spam/duplikat filtre i ručni vetting tim (iz njihove općenite prakse, ne potvrđeno za Statement on Superintelligence) | potvrda e-poštom | potvrda e-poštom + moderacija |
| Anonimnost | ne eksplicitno; `showDomain` i skrivanje e-pošte; ime je javno | e-pošta se ne sprema ako se ne uključi newsletter; nema trackera | nije dokumentirano | superintelligence-statement.org nudi „Sign anonymously”; mehanizam nije opisan | e-pošta se ne objavljuje; potpisi mogu biti skriveni | ne |
| Multi-tenant | više pisama na jednoj instanci, ali jedan admin (zajednička lozinka); nema organizacija/korisnika | da, korisnici ↔ pisma, token po pismu; prijevodi kao povezana pisma | ne (kurirana, mali broj globalnih pisama; tim traži partnerstva) | ne | da, organizacije s per-user dozvolama | ne (jedna državna instanca) |
| Naslovi/tituli | polje `title` (slobodan tekst) | `occupation` + `organization` | nepoznato | da, „Prof.”/„Dr.” + institucija + država (ai-security-letter.org) | ne | ne |
| OIDC / eID | ne | ne (samo passkey) | ne | ne | ne | ne |
| Domena e-pošte | samo `showDomain` (prikaz), nema pravila po domeni | ne | ne | ne | ne | ne |

## 3. Detalji po projektu

### 3.1 jaebooker/openletter (Countersign) — najvažniji

- **Kod:** `src/db/schema.ts` (4 tablice), `src/app/actions.ts` (signLetter, confirmSignature, submitAuthReview, submitComparison, admin akcije: saveLetter, addSeedSigner, moderateSigner, recomputeNow), `src/lib/scoring.ts` (~150 redaka čistih funkcija: `trustScores`, `authenticityScores`, `bradleyTerry`, pragovi u `THRESHOLDS`), `src/lib/recompute.ts` (potpuni preračun nakon svake recenzije), `src/lib/auth.ts` (sha256 hash tokena, cookie sesija po pismu).
- **Tok:** potpis → e-pošta s linkom → klik + gumb potvrđuje → potpisnik dobiva sesiju i može recenzirati druge. Početni potpisnici (`seed`) sidre trust graf; račun kojeg nijedan pouzdani potpisnik nije potvrdio ima trust 0.
- **Prednosti:** MIT; čista, mala kodna baza (~1.9k LOC TS) koju je lako pročitati; scoring je odvojen i testiran; ideja peer reviewa + trusta iz seed potpisnika je dobra za akademsku zajednicu (osnivači/seed = poznati akademici); CSV izvoz; Markdown pisma; token se sprema samo kao hash.
- **Slabosti:** 1 commit, 1 zvjezdica, projekt star tjedan dana — nema dokazane održivosti; jedna zajednička admin lozinka, nema računa organizatora ni tenant izolacije; rate limiter u memoriji; nema OIDC, nema pravila domene, nema anonimnog potpisa (e-pošta i ime su obavezni); preračun cijelog grafa po recenziji (O(n) po događaju); README sam kaže da „confirmed” nije dokaz identiteta. Peer review je loš fit za privatne/anonimne potpisnike (anonimac ne može biti javno ocijenjen).
- **Portabilnost na Workers:** Next.js 16 ide na Workers preko OpenNext adaptera, ali `postgres`/PGlite/nodemailer/`node:crypto` zahtijevaju prilagodbu (Hyperdrive + Postgres, ili prepis Drizzle sheme na D1/SQLite; slanje e-pošte preko Cloudflare Email Service ili Resend/Postmark). Realno: shema i `scoring.ts` se prenose gotovo 1:1, UI i server actions se prepisuju.
- **Težina dodavanja OIDC-a (Certilia):** srednje. Treba novu tablicu `identities` (provider, subject, razina, claimovi), dva route handlera (`/auth/oidc/start`, `/callback`) s PKCE + state/nonce + provjera JWT (JWKS, RS256) i vezanje identiteta na `signers`. Arhitektura „signer = jedan red” to podnosi, ali stanje „verified” je binarno i vezano uz e-poštu (`status`, `confirmed`) — treba ga zamijeniti razinama (level 0..N) i načinom provjere po potpisu. Ne postoji sloj za providere koji bi se proširio.
- **Težina dodavanja domene e-pošte:** niska. Dodati tablicu `domain_rules` (po pismu: dopuštene/akademske domene → razina) i provjeriti `email` nakon potvrde; `showDomain` već postoji za prikaz. Slabo mjesto: popis akademskih domena treba održavati (npr. kuriran popis HR visokih učilišta + svjetski popis sveučilišta, poput `Hipo/university-domains-list`).

### 3.2 citizenspring/openletter (openletter.earth)

- Funkcionalno: više korisnika i pisma, višejezični prijevodi (`parent_letter_id`), SSG frontend, minimalna pohrana osobnih podataka, tokeni po potpisu. Jedina „jača” provjera: **passkey** (`PasskeyController.js`, `@simplewebauthn/server`) — zanimljivo kao nisko-trenje, anti-Sybil sredstvo bez trećih strana.
- Slabosti: AdonisJS 4 / stari Node ekosustav, Heroku, `node-fetch` 2, mješavina JS bez tipova; TODO.md navodi da nisu još napravili ni „prikaz verificiranih vs neverificiranih potpisa”, a razlomak po gradu/zanimanju je tek plan. Za OIDC/domenu: moguće, ali u zastarjelom frameworku — svejedno prepis.
- Korisno preuzeti: model prijevoda (povezana pisma po locale), princip „ne spremaj e-poštu osim uz privolu”, passkey kao opcionalni drugi faktor.

### 3.3 openletter.net (nije FOSS)

Prema javnoj stranici: potpisnik daje ime, **verificira se e-pošta i lokacija**, opcionalno povezivanje X računa; nakon potpisa recenzira druge (je li stvarna osoba, tko je poznatiji); trust graf za autentičnost, uparena usporedba za notability. Potpisi se prikazuju odmah, a recenzije naknadno prilagođavaju poredak/oznaku. Fokus na mali broj globalnih pisama, bez self-service hostinga (kontakt za partnerstva). Cijene, anonimnost i tenant-model: nisu na stranici. Countersign je izričito njegov FOSS „clean-room” analog.

### 3.4 Praksa velikih pisama o AI riziku

- **superintelligence-statement.org (FLI):** nudi „Sign anonymously”, broji 77.777 potpisa uključujući 5.000 iz petice Ekō; stranica **ne opisuje** proces verifikacije. Opća FLI praksa (s njihovih starijih stranica): svi potpisi prolaze e-mail provjeru, spam/duplikat filtre i ručni pregled tima; oznaka „verified” za one koje je FLI izravno kontaktirao ili imaju javnu izjavu. Ovo je izvedeno iz njihove opće prakse i nije potvrđeno za baš tu izjavu.
- **ai-security-letter.org:** popis s titulom (Prof./Dr.), imenom, institucijom i državom; zasebna lista medijskih kontakata; **nema opisa verifikacije ni anonimnosti**. Pouka: akademski format prikaza (titula + institucija + država) je standard koji treba podržati.
- Zaključak za nas: veliki akteri koriste *ručnu kuraciju + javnu potvrdu*, a ne kriptografski dokaz. Ono što gradimo (razine pouzdanosti na potpisu) je iznad tog standarda.

### 3.5 Ostali FOSS projekti vrijedni pogleda

| Projekt | Stack | Licenca | Zadnje | Zvj. | Relevantnost |
|---|---|---|---|---|---|
| pytition/Pytition | Django | BSD-3 | 2026-10-04 | 117 | Najbolji uzorak za **multi-tenant**: organizacije, per-user dozvole, privatnost bez CDN-a, CSV, mail queue s retry-em. Ne radi na Workersima; koristiti kao uzor modela dozvola. |
| alphagov/e-petitions | Rails | MIT | 2026-10-19 | 313 | Uzor za **moderaciju** potpisa i petitions workflow, anti-spam, validaciju potpisa i izvoz; preteško za fork, dobro za ideje (stanja potpisa, audit). |
| 5t34k/nowhere | Svelte | AGPL-3 | 2026-07-10 | 129 | Pronađen pretragom; nije pregledan. Ne preporučujem zbog AGPL i nejasnog opsega. |
| rms-open-letter/rms-open-letter.github.io | statični (GitHub) | nepoznata | 2021 (arhiva) | 594 | Potpis kroz GitHub PR — kao uzor „javno + provjerljivo” (javni git log), ali nije primjenjivo za anonimne ni neGitHub korisnike. |

ORCID: nijedan od pronađenih FOSS projekata ne podržava ORCID. Provjera preko ORCID OAuth (OIDC-kompatibilan) je dostupna kao izvor akademskog identiteta, ali ne postoji gotovo rješenje za preuzeti.

## 4. Usporedba po našim zahtjevima

| Zahtjev | Countersign | openletter.earth | Pytition | Procjena |
|---|---|---|---|---|
| Javni/privatni (anonimni) potpis | ne | djelomično (bez e-pošte) | djelomično | gradimo sami |
| Višerazinska verifikacija | jedna (e-pošta) + peer | e-pošta/passkey | e-pošta | gradimo sami; moguće preuzeti polje razine |
| Domena e-pošte | ne | ne | ne | trivijalno dodati |
| Biometrijski eID/putovnica (self.xyz) | ne | ne | ne | gradimo; ZK/OIDC-like callback |
| Certilia OIDC | ne | ne | ne | gradimo (isto kao naš postojeći Worker, ponovno iskoristiv) |
| Put bez Certilije | e-pošta | e-pošta | e-pošta | modelirati kao zasebne „verifikatore” |
| Akademske titule | da (`title`) | `occupation` | ne | preuzeti polje, dodati strukturirano (titula, institucija, država) |
| Multi-tenant | slabo | srednje | dobro | gradimo (org → letter → signature) |
| Workers + TS | tek uz prepis | ne | ne | — |

## 5. Preporuka

1. **Build fresh** na Workers + TS (Hono ili jednostavan router), D1/SQLite (ili Durable Object po pismu za brojač i rate-limit), R2 po potrebi, Cloudflare Email Service za potvrde. Razlog: nijedan projekt nema ni OIDC ni razine pouzdanosti ni anonimni tok, a oba glavna kandidata traže prepis runtimea. Fork bi nas vezao uz tuđu shemu s binarnim „verified”.
2. **Preuzeti iz Countersigna (MIT, uz atribuciju):** oblik sheme (`letters`/`signers`), hash tokena, `seed` signatories, `src/lib/scoring.ts` (čiste funkcije, prenosive bez izmjena u Workers) kao *opcionalni* modul peer-reviewa za javne potpisnike, CSV izvoz, moderacijska stanja. Pazi: jedan red repo-a, vrlo mlad, bez jamstva održavanja — kopirati snapshot, ne ovisiti o upstreamu.
3. **Preuzeti ideje:** passkey kao nisko-trenje drugi faktor (openletter.earth); modele organizacija/dozvola (Pytition); stanja moderacije i audit (e-petitions); prikaz titula (Prof./Dr. + institucija + država) kao na ai-security-letter.org; „javna izjava / izravna potvrda” kao ručna razina (FLI).
4. **Predložena shema razina** (za sljedeći dokument): `signature` ima `visibility` (public/private-anon) i skup `verifications[]` (provider, razina, vrijeme, dokaz-hash), a javno se prikazuje najviša razina: 0 neprovjereno, 1 e-pošta, 2 akademska domena, 3 OIDC/eID (Certilia ili self.xyz), 4 ručno potvrđeno. Certilia je jedan verifikator među više, ne pretpostavka sustava.

## 6. Otvoreno / za provjeriti

- Stvarni proces verifikacije FLI-ja za Statement on Superintelligence i način „Sign anonymously” (kontakt `letters@futureoflife.org` ili intervju).
- Hosting Workers za Next.js (OpenNext) nije testiran — ne treba ako gradimo od nule.
- Licence ovisnosti i trade-off AGPL (nowhere) nisu analizirani.
