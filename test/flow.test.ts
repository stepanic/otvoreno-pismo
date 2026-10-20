import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { b64url } from "../src/crypto";
import type { Env } from "../src/env";
import worker from "../src/index";
import { outbox } from "../src/mail";
import { _caches } from "../src/oidc";
import { verify } from "../scripts/verify-lib.mjs";

const BASE = "http://localhost:8787";
const E = env as unknown as Env;

interface Opts {
  method?: string;
  form?: Record<string, string>;
  cookie?: string;
  origin?: string | null;
}

async function call(path: string, o: Opts = {}): Promise<Response> {
  const method = o.method ?? (o.form ? "POST" : "GET");
  const headers = new Headers();
  if (method === "POST" && o.origin !== null) headers.set("origin", o.origin ?? BASE);
  if (o.cookie) headers.set("cookie", o.cookie);
  const body = o.form ? new URLSearchParams(o.form) : undefined;
  return worker.fetch(new Request(BASE + path, { method, headers, body, redirect: "manual" }), E);
}

function lastMail(to: string) {
  const m = [...outbox].reverse().find((x) => x.to === to);
  if (!m) throw new Error(`nema maila za ${to}`);
  return m;
}

function linkFrom(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m?.[1]) throw new Error(`nema linka u: ${text}`);
  return m[1];
}

async function login(): Promise<string> {
  await call("/login", { form: { email: "Org@Example.org" } });
  const token = linkFrom(lastMail("org@example.org").text, /\/login\/([\w-]+)/);
  expect((await call(`/login/${token}`)).status).toBe(200);
  const r = await call(`/login/${token}`, { form: {} });
  expect(r.status).toBe(303);
  const cookie = r.headers.get("set-cookie")!.split(";")[0]!;
  // token je jednokratan
  expect((await call(`/login/${token}`, { form: {} })).status).toBe(400);
  return cookie;
}

const BODY = "Mi, potpisnici, upozoravamo na rizike superinteligencije i tražimo javnu raspravu.";

async function newLetter(cookie: string, slug: string, extra: Record<string, string> = {}) {
  const r = await call("/a/novo", { cookie, form: { slug, title: `Pismo ${slug}`, summary: "s", body_md: BODY, allow_anonymous: "1", ...extra } });
  expect(r.status).toBe(303);
  expect((await call(`/a/${slug}/objavi`, { cookie, form: {} })).status).toBe(303);
}

async function sign(slug: string, f: Record<string, string>): Promise<string> {
  const r = await call(`/${slug}/potpisi`, { form: { consent: "1", ...f } });
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("Provjeri e-mail");
  return linkFrom(lastMail(f.email!.toLowerCase()).text, /\/m\/([\w-]+)/);
}

async function confirm(token: string) {
  const r = await call(`/m/${token}/potvrdi`, { form: {} });
  expect(r.status).toBe(303);
  return r.headers.get("location")!;
}

async function json<T>(path: string): Promise<T> {
  return (await call(path)).json() as Promise<T>;
}

async function verifyLetter(slug: string) {
  const [log, sigs, letter] = await Promise.all([
    json<Parameters<typeof verify>[0]>(`/${slug}/log.json`),
    json<Parameters<typeof verify>[1] & { counts: { total: number; byTier: Record<string, number> } }>(`/${slug}/signatures.json`),
    json<Parameters<typeof verify>[2]>(`/${slug}/letter.json`),
  ]);
  return { result: await verify(log, sigs, letter), sigs };
}

let cookie: string;
beforeAll(async () => {
  cookie = await login();
});

afterEach(() => {
  vi.unstubAllGlobals();
  _caches.discoCache.clear();
  _caches.jwksCache.clear();
});

describe("organizator", () => {
  it("bez sesije nema pristupa, nepoznati e-mail ne dobiva link", async () => {
    expect((await call("/a")).headers.get("location")).toBe("/login");
    const n = outbox.length;
    const r = await call("/login", { form: { email: "netko@example.org" } });
    expect(await r.text()).toContain("Ako je adresa na popisu");
    expect(outbox.length).toBe(n);
  });

  it("nacrt nije javan; nakon objave tekst je zaključan", async () => {
    await call("/a/novo", { cookie, form: { slug: "nacrt", title: "Nacrt", summary: "", body_md: BODY } });
    expect((await call("/nacrt")).status).toBe(404);
    expect((await call("/nacrt", { cookie })).status).toBe(200);
    expect((await call("/nacrt/potpisi", { form: { consent: "1", name: "A B", email: "a@b.hr" } })).status).toBe(404);
    await call("/a/nacrt/objavi", { cookie, form: {} });
    await call("/a/nacrt", { cookie, form: { title: "Promijenjeno", body_md: "drugi tekst koji je dovoljno dugačak", summary: "novo" } });
    const l = await json<{ title: string; body_md: string }>("/nacrt/letter.json");
    expect(l.title).toBe("Nacrt");
    expect(l.body_md).toBe(BODY);
  });

  it("rezervirane i zauzete adrese", async () => {
    const r1 = await call("/a/novo", { cookie, form: { slug: "login", title: "X x x", summary: "", body_md: BODY } });
    expect(await r1.text()).toContain("rezervirana");
    const r2 = await call("/a/novo", { cookie, form: { slug: "nacrt", title: "X x x", summary: "", body_md: BODY } });
    expect(await r2.text()).toContain("već postoji");
  });
});

describe("potpisivanje", () => {
  it("javni i anonimni potpis, razine, lanac se slaže", async () => {
    await newLetter(cookie, "asi");
    const t1 = await sign("asi", { name: "Ana Anić", title: "prof. dr. sc.", affiliation: "FER", email: "ana@fer.hr" });
    // prije potvrde se ne broji
    expect((await json<{ counts: { total: number } }>("/asi/signatures.json")).counts.total).toBe(0);
    expect(await confirm(t1)).toContain("ok=active");
    const t2 = await sign("asi", { name: "", email: "tajni@gmail.com", anonymous: "1", comment: "Podržavam" });
    await confirm(t2);

    const page = await (await call("/asi")).text();
    expect(page).toContain("Ana Anić");
    expect(page).toContain("Anonimni potpisnik");
    expect(page).not.toContain("tajni");
    expect(page).not.toContain("gmail");

    const { result, sigs } = await verifyLetter("asi");
    expect(result.errors).toEqual([]);
    expect(sigs.counts.total).toBe(2);
    expect(sigs.counts.byTier).toMatchObject({ "1": 1, "2": 1 });
    const ana = sigs.signatures.find((s) => (s as { name?: string }).name === "Ana Anić") as Record<string, unknown>;
    expect(ana.tier).toBe(2);
    expect(ana.methods).toEqual(["domain", "email"]);
    expect(JSON.stringify(sigs)).not.toMatch(/fer\.hr|gmail|email_hash/);
  });

  it("isti e-mail ne potpisuje dvaput; povlačenje i ponovni potpis", async () => {
    await newLetter(cookie, "dupli");
    const t = await sign("dupli", { name: "Iva Ivić", email: "iva@example.com" });
    await confirm(t);
    const t2 = await sign("dupli", { name: "Druga Osoba", email: "IVA@example.com" });
    expect(lastMail("iva@example.com").text).toContain("već je potpisano");
    expect((await call(`/m/${t}`)).status).toBe(404); // stari link zamijenjen
    expect((await json<{ counts: { total: number } }>("/dupli/signatures.json")).counts.total).toBe(1);

    await call(`/m/${t2}/povuci`, { form: {} });
    let v = await verifyLetter("dupli");
    expect(v.result.errors).toEqual([]);
    expect(v.sigs.counts.total).toBe(0);

    const t3 = await sign("dupli", { name: "Iva Ivić", email: "iva@example.com" });
    await confirm(t3);
    v = await verifyLetter("dupli");
    expect(v.result.errors).toEqual([]);
    expect(v.sigs.counts.total).toBe(1);
  });

  it("neispravni unosi", async () => {
    await newLetter(cookie, "unosi", { allow_anonymous: "" });
    const bad = async (f: Record<string, string>) => (await (await call("/unosi/potpisi", { form: f })).text());
    expect(await bad({ name: "A B", email: "a@b.hr" })).toContain("suglasnost");
    expect(await bad({ consent: "1", name: "A B", email: "nije-mail" })).toContain("ispravnu e-mail");
    expect(await bad({ consent: "1", name: "A B", email: "x@mailinator.com" })).toContain("Jednokratne");
    // anonimno nije dopušteno na ovom pismu → traži ime
    expect(await bad({ consent: "1", name: "", anonymous: "1", email: "a@b.hr" })).toContain("ime i prezime");
    // escape u ponovljenom obrascu
    expect(await bad({ consent: "1", name: '<script>x</script>', email: "nije-mail" })).not.toContain("<script>x");
  });

  it("POST bez Origina se odbija (CSRF)", async () => {
    expect((await call("/asi/potpisi", { form: { consent: "1" }, origin: null })).status).toBe(403);
    expect((await call("/asi/potpisi", { form: { consent: "1" }, origin: "https://zlo.example" })).status).toBe(403);
  });

  it("zatvoreno pismo ne prima potpise", async () => {
    await newLetter(cookie, "zatvoreno");
    const t = await sign("zatvoreno", { name: "Kasni Potpis", email: "kasni@example.com" });
    await call("/a/zatvoreno/zatvori", { cookie, form: {} });
    expect((await call(`/m/${t}/potvrdi`, { form: {} })).status).toBe(400);
    expect((await call("/zatvoreno/potpisi", { form: { consent: "1", name: "A B", email: "n@example.com" } })).status).toBe(400);
    expect((await verifyLetter("zatvoreno")).result.errors).toEqual([]);
  });
});

describe("moderacija", () => {
  it("red čekanja, odobravanje, ručna potvrda, odbijanje", async () => {
    await newLetter(cookie, "mod", { moderation: "1" });
    const t1 = await sign("mod", { name: "Marko Marić", email: "marko@irb.hr" });
    const t2 = await sign("mod", { name: "Spam Spamić", email: "spam@example.com" });
    expect(await confirm(t1)).toContain("ok=review");
    await confirm(t2);
    expect((await json<{ counts: { total: number } }>("/mod/signatures.json")).counts.total).toBe(0);

    const queue = await (await call("/a/mod/potpisi", { cookie })).text();
    const ids = [...queue.matchAll(/\/a\/mod\/potpisi\/(\w+)\/odobri/g)].map((m) => m[1]!);
    expect(ids).toHaveLength(2);
    const sigs0 = await E.DB.prepare("SELECT public_id, name FROM signatures WHERE letter_id = (SELECT id FROM letters WHERE slug = 'mod')").all<{ public_id: string; name: string }>();
    const marko = sigs0.results.find((s) => s.name === "Marko Marić")!.public_id;
    const spam = sigs0.results.find((s) => s.name === "Spam Spamić")!.public_id;

    await call(`/a/mod/potpisi/${marko}/odobri`, { cookie, form: {} });
    await call(`/a/mod/potpisi/${marko}/rucno`, { cookie, form: { note: "potvrđeno telefonom" } });
    await call(`/a/mod/potpisi/${spam}/odbij`, { cookie, form: { note: "lažno" } });

    const { result, sigs } = await verifyLetter("mod");
    expect(result.errors).toEqual([]);
    expect(sigs.signatures).toHaveLength(1);
    expect((sigs.signatures[0] as { tier: number }).tier).toBe(4);
    expect((await call(`/m/${t2}`)).status).toBe(200);
    expect(await (await call(`/m/${t2}`)).text()).toContain("odbio");
  });

  it("tuđe pismo nije dostupno", async () => {
    await E.DB.prepare("INSERT INTO letters (slug, title, body_md, owner_hash, created_at) VALUES ('tude', 'Tuđe', ?, 'netko', 0)").bind(BODY).run();
    expect((await call("/a/tude", { cookie })).status).toBe(404);
    expect((await call("/a/tude/objavi", { cookie, form: {} })).status).toBe(404);
  });
});

describe("lanac je otporan na izmjene", () => {
  it("verifikator hvata izmijenjen zapis i izbrisanu kariku", async () => {
    const { result } = await verifyLetter("asi");
    expect(result.ok).toBe(true);
    const log = await json<{ links: { seq: number; prev_hash: string; hash: string; event: string }[] }>("/asi/log.json");
    const sigs = await json<{ signatures: Record<string, unknown>[] }>("/asi/signatures.json");
    const letter = await json<{ body_md: string; body_sha256: string }>("/asi/letter.json");
    const forged = { ...sigs, signatures: sigs.signatures.map((s) => (s.name ? { ...s, name: "Netko Drugi" } : s)) };
    expect((await verify(log, forged, letter)).ok).toBe(false);
    expect((await verify({ links: log.links.slice(1) }, sigs, letter)).ok).toBe(false);
    expect((await verify(log, sigs, { ...letter, body_md: letter.body_md + "!" })).ok).toBe(false);
    await expect(E.DB.prepare("DELETE FROM log").run()).rejects.toThrow(/append-only/);
  });
});

// ---------- OIDC ----------

async function rsaKey() {
  const kp = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = { ...((await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey), kid: "k1", alg: "RS256", use: "sig" };
  const signJwt = async (claims: Record<string, unknown>) => {
    const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));
    const input = `${enc({ alg: "RS256", kid: "k1", typ: "JWT" })}.${enc(claims)}`;
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(input));
    return `${input}.${b64url(sig)}`;
  };
  return { jwk, signJwt };
}

function stubIdp(issuerBase: string, jwk: JsonWebKey, idToken: () => Promise<string>) {
  const disco = {
    issuer: `${issuerBase}/iss`,
    authorization_endpoint: `${issuerBase}/authorize`,
    token_endpoint: `${issuerBase}/token`,
    jwks_uri: `${issuerBase}/jwks`,
  };
  const calls: { url: string; body?: string }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.includes("openid-configuration")) return Response.json(disco);
    if (url === disco.jwks_uri) return Response.json({ keys: [jwk] });
    if (url === disco.token_endpoint) return Response.json({ id_token: await idToken() });
    return new Response("nepoznato", { status: 404 });
  });
  return { disco, calls };
}

async function startOidc(token: string, provider: string) {
  const r = await call(`/m/${token}/provjera/${provider}`, { form: {} });
  expect(r.status).toBe(303);
  return new URL(r.headers.get("location")!);
}

describe("OIDC", () => {
  it("Certilia: ime iz eOsobne, razina 3, jedan OIB po pismu", async () => {
    await newLetter(cookie, "eid");
    const { jwk, signJwt } = await rsaKey();
    const claims = { sub: "12345678901", given_name: "Ana", family_name: "Horvat" };
    const idp = stubIdp(E.CERTILIA_BASE, jwk, () =>
      signJwt({ ...claims, iss: `${E.CERTILIA_BASE}/iss`, aud: "certilia-client", exp: Math.floor(Date.now() / 1000) + 300 }),
    );
    const t = await sign("eid", { name: "A. H.", email: "ana@example.com" });
    await confirm(t);
    const auth = await startOidc(t, "certilia");
    expect(auth.origin + auth.pathname).toBe(idp.disco.authorization_endpoint);
    expect(auth.searchParams.get("scope")).toBe("openid profile eid");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    const r = await call(`/oidc/callback/certilia?state=${auth.searchParams.get("state")}&code=c1`);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe(`/m/${t}?ok=certilia`);
    expect(idp.calls.find((c) => c.url === idp.disco.token_endpoint)!.body).toContain("code_verifier=");

    const { result, sigs } = await verifyLetter("eid");
    expect(result.errors).toEqual([]);
    const s = sigs.signatures[0] as Record<string, unknown>;
    expect(s).toMatchObject({ name: "Ana Horvat", name_source: "certilia", tier: 3 });
    expect(JSON.stringify(sigs)).not.toContain("12345678901");

    // state je jednokratan
    expect((await call(`/oidc/callback/certilia?state=${auth.searchParams.get("state")}&code=c1`)).status).toBe(400);

    // isti OIB, drugi e-mail → odbijeno
    const t2 = await sign("eid", { name: "Lažna Ana", email: "druga@example.com" });
    await confirm(t2);
    const auth2 = await startOidc(t2, "certilia");
    const r2 = await call(`/oidc/callback/certilia?state=${auth2.searchParams.get("state")}&code=c2`);
    expect(r2.status).toBe(400);
    expect(await r2.text()).toContain("već vezan");
  });

  it("ORCID: nonce je obavezan, ORCID iD vidljiv kod javnog potpisa", async () => {
    await newLetter(cookie, "orcid");
    const { jwk, signJwt } = await rsaKey();
    let nonce: string | undefined;
    const base = { sub: "0000-0002-1825-0097", given_name: "Josiah", family_name: "Carberry", aud: "orcid-client" };
    stubIdp(E.ORCID_BASE, jwk, () =>
      signJwt({ ...base, iss: `${E.ORCID_BASE}/iss`, exp: Math.floor(Date.now() / 1000) + 300, nonce }),
    );
    const t = await sign("orcid", { name: "J. Carberry", email: "jc@example.com" });
    await confirm(t);

    // bez noncea → greška
    let auth = await startOidc(t, "orcid");
    expect(auth.searchParams.has("code_challenge")).toBe(false);
    expect((await call(`/oidc/callback/orcid?state=${auth.searchParams.get("state")}&code=x`)).status).toBe(500);

    auth = await startOidc(t, "orcid");
    nonce = auth.searchParams.get("nonce")!;
    expect((await call(`/oidc/callback/orcid?state=${auth.searchParams.get("state")}&code=x`)).status).toBe(303);
    const { result, sigs } = await verifyLetter("orcid");
    expect(result.errors).toEqual([]);
    expect(sigs.signatures[0]).toMatchObject({ orcid: "0000-0002-1825-0097", name: "Josiah Carberry", tier: 3 });
  });

  it("odbija token potpisan tuđim ključem i istekao token", async () => {
    await newLetter(cookie, "losi");
    const good = await rsaKey();
    const evil = await rsaKey();
    let signer = evil.signJwt;
    let exp = Math.floor(Date.now() / 1000) + 300;
    stubIdp(E.CERTILIA_BASE, good.jwk, () =>
      signer({ sub: "99999999999", iss: `${E.CERTILIA_BASE}/iss`, aud: "certilia-client", exp }),
    );
    const t = await sign("losi", { name: "Test Test", email: "t@example.com" });
    await confirm(t);
    let auth = await startOidc(t, "certilia");
    expect((await call(`/oidc/callback/certilia?state=${auth.searchParams.get("state")}&code=x`)).status).toBe(500);
    signer = good.signJwt;
    exp = Math.floor(Date.now() / 1000) - 3600;
    auth = await startOidc(t, "certilia");
    expect((await call(`/oidc/callback/certilia?state=${auth.searchParams.get("state")}&code=x`)).status).toBe(500);
    const s = await json<{ signatures: { tier: number }[] }>("/losi/signatures.json");
    expect(s.signatures[0]!.tier).toBe(1);
  });
});
