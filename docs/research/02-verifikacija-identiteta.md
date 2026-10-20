# 02 – Verifikacija identiteta potpisnika (razine povjerenja)

Datum istraživanja: 20. 10. 2026. Stack: Cloudflare Workers + TypeScript, open source.
Oznake pouzdanosti: **[P]** provjereno u primarnom izvoru (repo/docs) tijekom ovog istraživanja; **[N]** nije potvrđeno, treba ručno provjeriti prije implementacije.

## Cilj i načelo dizajna

- Potpis je javan (ime vidljivo) ili privatan (anoniman, ali provjerljivo stvarna i jedinstvena osoba).
- Nitko ne smije biti prisiljen na jedan nacionalni eID (pristranost uzorka), pa postoji **više neovisnih putova**, a uz svaki potpis prikazuje se **razina i način provjere** (badge), ne samo „provjereno”.
- Sustav ne tvrdi više nego što metoda dokazuje (npr. akademski e-mail dokazuje pristup adresi, ne identitet).

## 1. Akademski e-mail

**Popisi domena**
- Hipo `university-domains-list` (MIT, aktivan, zadnji push 22. 9. 2026) [P]: JSON `world_universities_and_domains.json`. Za HR sadrži samo 12 zapisa: unidu.hr, unios.hr, unipu.hr, uniri.hr, unist.hr, unizd.hr, unizg.hr, zsem.hr, vern.hr, tvz.hr, algebra.hr, unin.hr. Nedostaju fakultetske i institutske domene (fer.hr, irb.hr, pmf.unizg.hr…) i javni instituti.
- JetBrains `swot` (MIT, aktivan, push 20. 10. 2026) [P]: struktura `lib/domains/<tld>/<naziv>.txt`; za `hr` ima ~65 unosa (npr. fer, ffzg, foi, fsb, mathos, algebra…). Bolja pokrivenost fakulteta, ali pokriva „student”, ne nužno zaposlenike. Nema irb.hr/gov.hr (provjeriti listing, [N]).
- Zaključak: ni jedan popis nije dovoljan. Treba **vlastiti, ručno održavan `allowlist-hr.json`** (u repou, PR-ovi dopušteni) uz pravila:
  - sufiks-match: `*.unizg.hr`, `*.uniri.hr`… (poddomene fakulteta), ne samo točno podudaranje;
  - dodati instituti: irb.hr, ipf.hr, pilar.hr, hazu.hr, srce.hr, carnet.hr, ffzg…; javni sektor `*.gov.hr`, `*.mzo.hr` kao zasebna kategorija „javna institucija” (ne „akademik”);
  - uvesti i Hipo/swot kao izvor za inozemstvo (build-time merge, deduplikacija);
  - neprepoznata domena -> razina „e-mail provjeren”, ne „akademska”; moguća ručna moderacija zahtjeva za dodavanje domene.
- Ograničenja: aliasi/forwarderi, alumni adrese (doživotne), dijeljeni sandučići (info@), studenti vs. zaposlenici. Badge: „akademska adresa (domena X)”, bez tvrdnje o statusu „dr.”.

**Magic link / OTP na Workersima**
- Tok: POST e-mail -> Worker generira 6-znamenkasti OTP ili token (32 B random), pohranjuje samo **hash** u KV/D1 s TTL 10–15 min i brojačem pokušaja; verifikacija constant-time; rate limit po IP/e-mailu (Workers rate limiting binding / Turnstile).
- Slanje: Cloudflare Email Service (Workers binding) je u **Beti** [P: developers.cloudflare.com/email-service]; slanje proizvoljnim primateljima traži Workers Paid; cijene stranica upućuje na zasebni pricing [N]. Alternativa Resend (REST iz Workera): free 3.000 mailova/mj, 100/dan, 3 domene; Pro 20 USD/mj za 50.000 [P]. Preporuka: apstrakcija `EmailSender` s dva adaptera (CF Email, Resend), SPF/DKIM/DMARC na vlastitoj domeni.
- Privatnost: za anonimni potpis pohraniti samo **HMAC(e-mail, serverski pepper)** radi jedinstvenosti; sam e-mail ne zapisivati. Javni potpis: e-mail i dalje nije javan. Napomena: i tako operater u trenutku provjere vidi e-mail, što treba iskreno navesti.
- Trud: nizak (1–2 dana). Trošak: ~0. Zrelost: visoka.

## 2. ORCID OAuth

- Javni API, OIDC: scope `openid` (ekvivalentan `/authenticate`), authorization code flow vraća `orcid`, `name`, potpisani `id_token` [P: info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id]. Sandbox: `sandbox.orcid.org` (authorize `/oauth/authorize`, token `/oauth/token`); sandbox mailovi idu samo na Mailinator [P]. Public API je besplatan, registracija klijenta u Developer Tools (traži verificiran e-mail).
- Što dokazuje: da potpisnik **kontrolira ORCID račun**; ORCID iD je samoprijavljeni identitet. Ime i afilijacije (employment/education) su **samoprijavljeni** osim ako ih je upisala organizacija-član (tada izvor je naveden, čita se iz `/employments` s `read-public` tokenom; izvor „source” razlikuje samoprijavu od institucije) [dijelom N: provjeriti polje `source` u odgovoru]. Dakle ORCID **ne dokazuje** stvarno ime ni titulu „dr.”; jaki signal je afilijacija koju je upisala institucija.
- Privatnost: ORCID iD je javan identifikator; za anonimni potpis pohraniti HMAC(orcid). Ne koristiti za potpuno anonimne tokove ako je iD povezan s objavama.
- Trud: nizak (1–2 dana, jedan `fetch` za token + jedan za employments). Cijena: 0. Zrelost: visoka. Dobro za badge „ORCID: ime, institucija (potvrdila institucija / samoprijavljeno)”.

## 3. Self (self.xyz)

- `@selfxyz/core` (backend verifier, TypeScript; npm verzija u repou 1.2.0-beta.2) [P]; `SelfBackendVerifier(scope, endpoint, mockPassport, allowedIds, configStore, userIdType)`, `verify(attestationId, proof, publicSignals, userContextData)`. Rezultat sadrži `nullifier`, `discloseOutput` (nacionalnost, dob…), OFAC i minimalnu dob [P]. Repo `selfxyz/self`, aktivan (push 16. 10. 2026), licenca „Other” (provjeriti uvjete) [P].
- Dokazi: putovnica (attestation 1) i EU ID kartica (V2) [djelomično P; ID vrijednost 2 vs 3 nejasna]. Hrvatska (HRV) postoji u popisu država u kodu [P], ali **ne znači potvrdu podrške za eOsobnu** [N].
- Nullifier je deterministički po dokumentu (i scopeu); dvostruki potpis iste osobe isti nullifier [P].
- Workers: u verifieru se očekuje on-chain/registry provjera (Celo, root dokumenta) i dohvat podataka preko RPC-a; WASM/ethers/Node API kompatibilnost s Workerima **nije potvrđena** [N] – isprobati spike 0,5 dana; fallback: mali Node servis ili Self Enterprise (kreditni model, 10–25 kredita po radnom prostoru, cijena u USD nije javna) [P].
- Korisnik mora imati Self mobilnu aplikaciju + NFC čitanje; UX trenje srednje. Revizija: zksecurity audit objavljen [P]. Zrelost: srednja (beta SDK).

## 4. zkPassport

- `@zkpassport/sdk` (monorepo `zkpassport/zkpassport-packages`, Apache-2.0, repo circuits aktivan 20. 10. 2026) [P]. Backend: `new ZKPassport(domain)`, `verify({proofs, originalQuery, queryResult, scope})`; lokalna provjera uz fallback na njihov verifier API (`verifierMode: local|api`) [P].
- **`uniqueIdentifier`**: isti za isti dokument + domenu + scope -> idealno za „jedan potpis po osobi” bez otkrivanja identiteta; ne vezuje se među domenama [P].
- Upiti: dob, nacionalnost in/out, `EU_COUNTRIES`, otkrivanje samo traženih atributa [P]. Podržani su pasoši i ID kartice; hrvatski CSCA certifikati (hr_root/link) su u njihovom masterlist-u [P], što je dobar znak da HR dokumenti prolaze pasivnu autentikaciju, ali **popis podržanih dokumenata nije javno pročitan** [N] – testirati stvarnom eOsobnom/putovnicom.
- Ograničenja iz README-a: nema vanjske revizije (samo interne); rezultati u pregledniku se ne smiju vjerovati, samo backend [P]. Workers/WASM: lokalna provjera koristi Noir/bb WASM, vjerojatno teška za Worker limite (CPU/veličina), **[N] spike**; `verifierMode: "api"` radi bez toga, ali ovisi o njihovom servisu. Besplatno za sada; cijena API-ja [N].
- Zrelost: srednja, brzo se razvija.

## 5. EU Digital Identity Wallet / OpenID4VP

- Rok EU: svaka država članica mora ponuditi barem jedan certificirani novčanik do kraja 2026. Hrvatska: nacionalni novčanik razvija AKD na osnovi Certilije; eIDEasy (rujan 2026) je Hrvatsku podigao u kategoriju 4 jer je „Certilia Wallet” „EU Wallet ready”, dok iGrant tracker još navodi „notified eID, no wallet yet” [P iz pretrage; izvori se razilaze]. Javni sandbox za verifiere u travnju 2026. nije postojao [P].
- Za verifiera: standard OpenID4VP + SD-JWT VC/mdoc. Referentne implementacije: EU `eudi-wallet` GitHub organizacija (`eudi-srv-verifier-endpoint`, Kotlin; web verifier UI), OpenWallet `credo-ts`, `walt.id` verifier (Kotlin); JS/TS: `@sphereon/*`, `@animo-id/*`/Credo, `oid4vc` biblioteke [sve N osim postojanja organizacije; provjeriti održavanost]. Veliki dio zahtijeva registraciju relying party-ja (access certificate), što za građansku inicijativu nije izvjesno.
- Procjena: **faza 3+**, ne MVP. Certilia se već koristi u ovom ekosustavu (prethodni projekt), ali to je upravo „jedan nacionalni eID” kojega izbjegavamo kao jedini put; može biti jedna od razina.

## 6. Anonimno, a verificirano, jedan po osobi

**Kako radi (nullifier):** (a) provjera identiteta na ulazu (e-mail/ORCID/pasoš/eID) izdaje „dopuštenje” za pristup grupi; (b) potpisnik generira vlastiti Semaphore identitet i dodaje commitment u grupu bez vezanja za identitet; (c) pri potpisu šalje ZK dokaz članstva + `nullifier = H(scope, secret)` gdje je scope = ID pisma; isti identitet daje isti nullifier -> drugi potpis se odbija. Slabost: **jedna osoba može napraviti više Semaphore identiteta** ako ulazna provjera ne veže jedinstveni „ključ osobe”. Zato ulazni korak mora pohraniti **HMAC(identifikator, pepper)** po razini (npr. `uniqueIdentifier` iz zkPassport/Self, HMAC(ORCID), HMAC(e-mail)) i izdati točno jedno članstvo po ključu. Napomena: kad isti čovjek koristi više metoda, imat će više ključeva; dedup među razinama nije moguć bez zajedničkog identifikatora (prihvatljivo, prikaz razina po potpisu, ne zbroj kao „jedinstvene osobe” nego po razini).
- Semaphore v4 [P]: `semaphore-protocol/semaphore` v4.14.5 (17. 10. 2026), MIT. Već u uporabi; verifikacija dokaza u TS (`@semaphore-protocol/proof`, `verifyProof`) koristi snarkjs/WASM – u Workerima provjeriti veličinu i CPU, alternativa: Durable Object ili provjera izvan Workera [N].
- **Bandada** (PSE): upravljanje Semaphore grupama preko „credential” pravila (GitHub, e-mail, Twitter…); uključuje API za grupe; održavanost u 2026. [N] – može poslužiti kao uzor, ne nužno ovisnost.
- **Rarimo Freedom Tool** [P: repoi `rarimo/passport-zk-circuits`, `passport-contracts`, `passport-voting-contracts`, `freedomtool-web-ui`; zadnji push rujan 2026.]: glasanje putem putovnice na vlastitom L2 (zk-rollup), nacionalnost/dob/jedinstvenost, nullifier po glasanju. Fokus je glasanje i anketa, ne peticije; vezanje na blockchain i mobilnu aplikaciju Rarime; nije izravna biblioteka za Workere. Vrijedan kao referentni dizajn i kao potencijalni „zajednički zid” dedupliciranja putovnica.
- **zk-email** (`zkemail`): dokaz o primitku e-maila s DKIM potpisom (npr. dokaz domene `@unizg.hr` bez otkrivanja adrese) – zanimljiv za anonimnu „akademik” razinu, ali teže (veliki krugovi, ne radi dobro s fakultetskim M365/Google DKIM varijacijama) [N]; faza 4 istraživanje.
- Postojeći „ZK petition” projekti: pretraga GitHuba daje samo mikrorezultate (npr. `vantuann205/ZK-Petition`, hobi-razina, [P]); jedini ozbiljniji primjer je Vocdoni Passport (peticije uz putovnicu i nullifier) [N, vidjeti stranicu projekta]. Nema zrelog drop-in rješenja – gradimo na Semaphoreu.
- Anti-korelacija: razmak vremena između verifikacije i dodavanja u grupu, batch dodavanje commitmenta (npr. dnevno), ne bilježiti IP, ne povezivati token izdan pri verifikaciji i commitment (blind token/jednokratan kôd koji se troši pri `join`).

## 7. Ručna verifikacija i moderacija kod poznatih otvorenih pisama

- FLI (pismo o pauzi AI, 2023.): tvrdili su neovisnu provjeru izravnim kontaktom, a ipak su se pojavili lažni/preuzeti potpisi (npr. lažno pripisan visokoprofilni potpis); danas na stranici opisuju slojeve: verifikacija e-mailom, filteri za spam i duplikate, pregled tima za vetting, te zaseban status „verified” (izravan kontakt/javna izjava) [P, FLI stranica potpisnika; Gigazine].
- Deklaracija o klimatskoj hitnoj situaciji (Kanada, 2019.): ušao „Mickey Mouse”, organizatori naknadno provjeravali imena (CBC) [P].
- OpenLetter.net: heuristike, povezani računi, potpisnici se međusobno procjenjuju [P].
- Naučena lekcija: **dvije razine javnosti** – „potpisi” (e-mail provjera, automatski filteri) i „verificirani” (osoba potvrđena izravnim kontaktom/institucijski izvor), uz javan opis procesa, mogućnost prijave lažnog potpisa i povlačenje potpisa bez računa (token u e-mailu).
- Moderacijski alat (MVP): admin red čekanja (D1 + Access-zaštićena stranica), flagovi: ista domena u velikom broju, jednokratne e-mail domene (blocklist `disposable-email-domains`), brz rast s jednog ASN-a, neobična imena; ručna potvrda za „istaknute” potpisnike (javna imena s titulom).

## Usporedna tablica

| Metoda | Što dokazuje | Privatnost | Trud (Worker) | Cijena | Zrelost | Poveznica |
|---|---|---|---|---|---|---|
| E-mail OTP/magic link | Kontrola adrese | Operater vidi e-mail; pohrana samo HMAC | 1–2 dana | ~0 (Resend free / CF Email beta) | Visoka | https://developers.cloudflare.com/email-service/ , https://resend.com/pricing |
| Akademska domena (allowlist) | Pristup adresi institucije, ne status | Isto kao e-mail | +1 dan (allowlist) | 0 | Visoka, popis HR nepotpun | https://github.com/Hipo/university-domains-list , https://github.com/JetBrains/swot |
| ORCID OIDC | Kontrola ORCID računa; afilijacije samoprijavljene ili od institucije | iD javan; HMAC za anonimno | 1–2 dana | 0 | Visoka | https://info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id/ |
| Self | Stvarni NFC dokument, jedinstvenost, nacionalnost, dob (ZK) | Vrlo dobra; mobilna app | 2–4 dana + spike za Workers [N] | Besplatni SDK; Enterprise krediti | Srednja (beta) | https://github.com/selfxyz/self |
| zkPassport | Isto; `uniqueIdentifier` po domeni/scopeu | Vrlo dobra | 2–4 dana + spike (API mod bez WASM) | Besplatno [N API cijene] | Srednja, bez vanjske revizije | https://github.com/zkpassport/zkpassport-packages |
| EUDI wallet / OpenID4VP | Državno izdano pouzdano vjerodajnice | Selektivno otkrivanje | Visok (RP registracija) | [N] | Niska u HR 2026. | https://eudi.dev |
| Certilia (postojeće) | Državni eID | Operater (proxy) vidi OIB-podatke | Već izgrađeno u srodnom projektu | Ovisno o ugovoru | Visoka | – |
| Semaphore v4 | Anonimno članstvo + nullifier | Odlična ako je ulaz odvojen | Već u uporabi | 0 | Visoka | https://github.com/semaphore-protocol/semaphore |
| Rarimo Freedom Tool | Putovnica + anoniman glas | Dobra; vlastiti L2 | Visok, ne drop-in | 0 + gas | Srednja | https://github.com/rarimo/passport-voting-contracts |
| zk-email | Dokaz domene bez adrese | Vrlo dobra | Visok, istraživanje | 0 | Niska–srednja | https://github.com/zkemail |
| Ručni pregled | Izravan kontakt | Zavisi o operaterima | Nizak (admin UI) | Vrijeme ljudi | Provjerena praksa | – |

## Predloženi model razina (MVP)

Svaki potpis nosi `tier` i `methods[]`; vidljivo uz potpis i u javnom JSON-u.

- **T0 – E-mail potvrđen**: OTP/magic link. Anti-spam, jedan potpis po HMAC(e-mail). Javno ili „anonimno-ali-potvrđeno” (bez ZK, samo bez imena na listi).
- **T1 – Akademska/institucijska**: e-mail s domene s allowlista (HR + Hipo/swot) i/ili **ORCID** s institucijski potvrđenom afilijacijom. Prikaz: ustanova, ne tvrdnja o tituli.
- **T2 – Dokument (ZK)**: zkPassport i/ili Self (koji god prođe spike na Workersima i sa stvarnom hrvatskom eOsobnom/putovnicom). Dokazuje stvarnu, jedinstvenu osobu i državljanstvo bez imena.
- **T3 – Državni eID / EUDI** (Certilia danas, EUDI wallet kasnije): najjača veza na stvarnu osobu; opcionalna, ne jedina.
- **Povrh svega – „Potvrđeno izravno”**: ručno (kontakt/javna izjava) za istaknute potpisnike.

**Anonimni potpis**: bilo koja razina T0–T3 daje jednokratni kôd za `join` u Semaphore grupu te razine; potpis ide s dokazom i nullifierom; javno se vidi „anonimni potpis, razina Tn, N-ti u grupi”. Odvojene grupe po razini omogućuju brojanje po razini.

**Što prvo (MVP, ~1–2 tjedna):**
1. T0 + T1 e-mail (vlastiti HR allowlist, blocklist jednokratnih domena, Turnstile, rate limit).
2. ORCID OIDC.
3. Semaphore grupe po razini s nullifierom po pismu; odvojen ulazni korak (kôd se troši).
4. Admin red čekanja i javni opis procesa, opoziv potpisa linkom iz e-maila.

**Poslije:** (faza 2) spike zkPassport i Self na Workersima/stvarnoj eOsobnoj; ako ne radi izravno, `verifierMode: api` ili mali verifier servis; (faza 3) Certilia adapter i EUDI/OpenID4VP kad HR otvori verifier sandbox; (faza 4) zk-email za anonimnu akademsku domenu, Rarimo kao referenca.

## Otvorena pitanja (prije implementacije)
- Podržava li Self/zkPassport stvarno hrvatsku eOsobnu (ID karticu) ili samo putovnicu – testirati uređajem.
- Rade li verifier SDK-ovi i Semaphore `verifyProof` unutar Workers CPU/size limita (spike).
- Cijena i uvjeti Cloudflare Email Service nakon bete; uvjeti Self licence („Other”).
- Pravno: GDPR osnova za HMAC(identifikator) i rok čuvanja; tekst privole o tome što operater vidi tijekom provjere.
