import type { Env } from "./env";
import { hmac, normalizeEmail } from "./crypto";
import { sendMail } from "./mail";
import { authorizeUrl, displayName, enabledProviders, exchangeCode, newFlow, type Provider } from "./oidc";
import * as store from "./store";
import { UserError, type Letter } from "./store";
import * as v from "./views";

type Handler = (req: Request, env: Env, p: Record<string, string>) => Promise<Response>;

const routes: [string, RegExp, Handler][] = [];
function route(method: string, pattern: string, h: Handler) {
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`);
  routes.push([method, re, h]);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "POST" && !sameOrigin(req, env)) return v.message(env, "Greška", "Zahtjev nije s ove stranice.", 403);
    for (const [method, re, h] of routes) {
      if (method !== req.method) continue;
      const m = re.exec(url.pathname);
      if (!m) continue;
      try {
        return await h(req, env, m.groups ?? {});
      } catch (e) {
        if (e instanceof UserError) return v.message(env, "Nije uspjelo", e.message, 400);
        console.error(e);
        return v.message(env, "Greška", "Nešto je pošlo krivo. Pokušaj ponovno.", 500);
      }
    }
    return v.message(env, "Nema stranice", "Ova stranica ne postoji.", 404);
  },
};

// ---------- pomoćne ----------

function sameOrigin(req: Request, env: Env): boolean {
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(env.BASE_URL).host;
  } catch {
    return false;
  }
}

async function form(req: Request): Promise<Record<string, string>> {
  const fd = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, val] of fd) if (typeof val === "string") out[k] = val;
  return out;
}

function redirect(to: string, headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 303, headers: { location: to, ...headers } });
}

function json(data: unknown): Response {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "max-age=30" },
  });
}

function cookie(req: Request, name: string): string | undefined {
  const c = req.headers.get("cookie") ?? "";
  for (const part of c.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

function sessionCookie(env: Env, value: string, maxAge: number): string {
  const secure = env.BASE_URL.startsWith("https:") ? "; Secure" : "";
  return `s=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function ip(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? "local";
}

async function turnstileOk(req: Request, env: Env, token: string | undefined): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITE_KEY) return true;
  if (!token) return false;
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: ip(req) }),
  });
  return ((await r.json()) as { success: boolean }).success;
}

async function requireOwner(req: Request, env: Env): Promise<string | null> {
  return store.sessionOwner(env.DB, cookie(req, "s"));
}

async function ownLetter(req: Request, env: Env, slug: string): Promise<Letter | Response> {
  const owner = await requireOwner(req, env);
  if (!owner) return redirect("/login");
  const l = await store.letterBySlug(env.DB, slug);
  if (!l || l.owner_hash !== owner) return v.message(env, "Nema pisma", "Pismo ne postoji ili nije tvoje.", 404);
  return l;
}

function letterInput(f: Record<string, string>, slug = ""): store.LetterInput {
  return {
    slug: f.slug ?? slug,
    title: f.title ?? "",
    summary: f.summary ?? "",
    body_md: f.body_md ?? "",
    allow_anonymous: f.allow_anonymous === "1",
    moderation: f.moderation === "1",
  };
}

// ---------- javne stranice ----------

route("GET", "/", async (_req, env) => v.home(env, await store.publishedLetters(env.DB)));
route("GET", "/kako-radi", async (_req, env) => v.howItWorks(env));
route("GET", "/robots.txt", async () => new Response("User-agent: *\nDisallow: /m/\nDisallow: /a/\n"));

route("POST", "/:slug/potpisi", async (req, env, p) => {
  const l = await store.letterBySlug(env.DB, p.slug!);
  if (!l || l.status === "draft") return v.message(env, "Nema pisma", "Ovo pismo ne postoji.", 404);
  if (l.status === "closed") return v.message(env, "Zatvoreno", "Potpisivanje ovog pisma je zatvoreno.", 400);
  const f = await form(req);
  const back = async (error: string) =>
    v.letterPage(env, l, await store.activeSignatures(env.DB, l.id), { filter: 0, error, form: f });
  if (f.consent !== "1") return back("Za potpis treba označiti suglasnost.");
  if (!(await store.rateLimit(env.DB, `sign:${ip(req)}`, 20, 3600))) return back("Previše pokušaja s ove adrese. Pokušaj za sat vremena.");
  if (!(await turnstileOk(req, env, f["cf-turnstile-response"]))) return back("Provjera protiv spama nije prošla.");
  const emailKey = await hmac(env.HMAC_KEY, "rate", normalizeEmail(f.email ?? ""));
  if (!(await store.rateLimit(env.DB, `sign-email:${emailKey}`, 5, 3600))) return v.checkEmail(env, l);
  let res;
  try {
    res = await store.requestSignature(env, l, {
      name: f.name ?? "",
      title: f.title ?? "",
      affiliation: f.affiliation ?? "",
      country: f.country ?? "",
      comment: f.comment ?? "",
      email: f.email ?? "",
      anonymous: f.anonymous === "1",
      show_institution: f.show_institution === "1",
    });
  } catch (e) {
    if (e instanceof UserError) return back(e.message);
    throw e;
  }
  const link = `${env.BASE_URL}/m/${res.token}`;
  const text =
    res.state === "existing"
      ? `Ovom adresom već je potpisano pismo „${l.title}”.\n\nUpravljanje potpisom (pojačana provjera, povlačenje):\n${link}\n`
      : `Potvrdi potpis pisma „${l.title}”:\n${link}\n\nIsti link služi i za kasnije upravljanje potpisom, pa ga sačuvaj.\nAko nisi ti potpisao, zanemari ovu poruku.\n`;
  await sendMail(env, { to: normalizeEmail(f.email ?? ""), subject: `Potpis: ${l.title}`, text });
  return v.checkEmail(env, l);
});

route("GET", "/:slug/log.json", async (_req, env, p) => {
  const l = await store.letterBySlug(env.DB, p.slug!);
  if (!l || l.status === "draft") return v.message(env, "Nema pisma", "Ovo pismo ne postoji.", 404);
  const r = await env.DB.prepare("SELECT seq, prev_hash, hash, event, ts FROM log WHERE letter_id = ? ORDER BY seq")
    .bind(l.id)
    .all<{ seq: number; prev_hash: string; hash: string; event: string; ts: number }>();
  return json({ letter: l.slug, algorithm: "sha256(prev_hash|seq|event)", genesis: "0".repeat(64), links: r.results });
});

route("GET", "/:slug/letter.json", async (_req, env, p) => {
  const l = await store.letterBySlug(env.DB, p.slug!);
  if (!l || l.status === "draft") return v.message(env, "Nema pisma", "Ovo pismo ne postoji.", 404);
  return json({ slug: l.slug, title: l.title, body_md: l.body_md, body_sha256: l.body_sha256, status: l.status,
    published_at: l.published_at, closed_at: l.closed_at });
});

route("GET", "/:slug/signatures.json", async (_req, env, p) => {
  const l = await store.letterBySlug(env.DB, p.slug!);
  if (!l || l.status === "draft") return v.message(env, "Nema pisma", "Ovo pismo ne postoji.", 404);
  const sigs = await store.activeSignatures(env.DB, l.id);
  return json({ letter: l.slug, counts: store.counts(sigs), signatures: sigs.map(store.publicRecord) });
});

route("GET", "/:slug/signatures.csv", async (_req, env, p) => {
  const l = await store.letterBySlug(env.DB, p.slug!);
  if (!l || l.status === "draft") return v.message(env, "Nema pisma", "Ovo pismo ne postoji.", 404);
  const sigs = await store.activeSignatures(env.DB, l.id);
  const q = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const rows = [["sig", "anonimno", "titula", "ime", "ustanova", "drzava", "razina", "provjere", "institucija_po_domeni", "orcid"]];
  for (const s of sigs) {
    const r = store.publicRecord(s) as Record<string, unknown>;
    rows.push([s.public_id, s.anonymous ? "da" : "ne", String(r.title ?? ""), String(r.name ?? ""), String(r.affiliation ?? ""),
      String(r.country ?? ""), String(s.tier), (r.methods as string[]).join(" "), String(r.institution ?? ""), String(r.orcid ?? "")]);
  }
  return new Response(rows.map((r) => r.map(q).join(",")).join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${l.slug}.csv"` },
  });
});

// ---------- upravljanje potpisom (link iz e-maila) ----------

async function manageCtx(env: Env, token: string) {
  const s = await store.signatureByToken(env.DB, token);
  if (!s) return null;
  const l = (await env.DB.prepare("SELECT * FROM letters WHERE id = ?").bind(s.letter_id).first<Letter>())!;
  return { s, l };
}

const FLASH: Record<string, string> = {
  active: "Hvala! Potpis je potvrđen i javno se broji.",
  review: "Hvala! Potpis je potvrđen i čeka pregled organizatora.",
  withdrawn: "Potpis je povučen.",
  orcid: "ORCID je potvrđen.",
  certilia: "Identitet je potvrđen preko Certilije.",
};

route("GET", "/m/:token", async (req, env, p) => {
  const c = await manageCtx(env, p.token!);
  if (!c) return v.message(env, "Link ne vrijedi", "Link je istekao ili je zamijenjen novijim. Potpiši ponovno istom adresom za novi link.", 404);
  const flash = FLASH[new URL(req.url).searchParams.get("ok") ?? ""];
  return v.managePage(env, c.l, c.s, p.token!, enabledProviders(env), flash);
});

route("POST", "/m/:token/potvrdi", async (_req, env, p) => {
  const c = await manageCtx(env, p.token!);
  if (!c) return v.message(env, "Link ne vrijedi", "Link je istekao ili je zamijenjen novijim.", 404);
  const st = await store.confirmSignature(env, c.l, c.s);
  return redirect(`/m/${p.token}?ok=${st}`);
});

route("POST", "/m/:token/povuci", async (_req, env, p) => {
  const c = await manageCtx(env, p.token!);
  if (!c) return v.message(env, "Link ne vrijedi", "Link je istekao ili je zamijenjen novijim.", 404);
  await store.withdrawSignature(env.DB, c.s);
  return redirect(`/m/${p.token}?ok=withdrawn`);
});

route("POST", "/m/:token/provjera/:provider", async (_req, env, p) => {
  const provider = p.provider as Provider;
  if (!enabledProviders(env).includes(provider)) return v.message(env, "Nije dostupno", "Ova provjera nije uključena.", 404);
  const c = await manageCtx(env, p.token!);
  if (!c) return v.message(env, "Link ne vrijedi", "Link je istekao ili je zamijenjen novijim.", 404);
  const f = newFlow();
  await env.DB.prepare(
    "INSERT INTO oidc_states (state, provider, signature_id, nonce, verifier, return_to, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(f.state, provider, c.s.id, f.nonce, f.verifier, `/m/${p.token}`, store.now() + 10 * 60_000)
    .run();
  return redirect(await authorizeUrl(env, provider, f.state, f.nonce, f.verifier));
});

route("GET", "/oidc/callback/:provider", async (req, env, p) => {
  const url = new URL(req.url);
  const state = url.searchParams.get("state") ?? "";
  const row = await env.DB.prepare("DELETE FROM oidc_states WHERE state = ? AND provider = ? AND expires_at > ? RETURNING *")
    .bind(state, p.provider, store.now())
    .first<{ signature_id: number; nonce: string; verifier: string; return_to: string }>();
  if (!row) return v.message(env, "Provjera nije uspjela", "Sesija provjere je istekla. Pokušaj ponovno sa stranice potpisa.", 400);
  const code = url.searchParams.get("code");
  if (!code) return redirect(row.return_to);
  const provider = p.provider as Provider;
  const claims = await exchangeCode(env, provider, code, row.verifier, row.nonce);
  const s = await store.signatureById(env.DB, row.signature_id);
  if (!s) return v.message(env, "Nema potpisa", "Potpis više ne postoji.", 404);
  await store.attachIdentity(env, s, provider, claims.sub, displayName(claims));
  return redirect(`${row.return_to}?ok=${provider}`);
});

// ---------- organizatori ----------

route("GET", "/login", async (_req, env) => v.loginPage(env));

route("POST", "/login", async (req, env) => {
  const f = await form(req);
  const email = normalizeEmail(f.email ?? "");
  if (!(await store.rateLimit(env.DB, `login:${ip(req)}`, 10, 3600))) return v.loginPage(env, false, "Previše pokušaja. Pokušaj kasnije.");
  if (email && store.isOrganizerAllowed(env, email)) {
    const token = await store.createLoginToken(env, email);
    await sendMail(env, {
      to: email,
      subject: `Prijava: ${env.SITE_NAME}`,
      text: `Link za prijavu (vrijedi 30 minuta):\n${env.BASE_URL}/login/${token}\n`,
    });
  }
  return v.loginPage(env, true);
});

route("GET", "/login/:token", async (_req, env, p) => {
  if (!(await store.loginTokenValid(env.DB, p.token!))) return v.message(env, "Link ne vrijedi", "Link za prijavu je istekao ili je već iskorišten.", 400);
  return v.loginConfirm(env, p.token!);
});

route("POST", "/login/:token", async (_req, env, p) => {
  const session = await store.consumeLoginToken(env.DB, p.token!);
  if (!session) return v.message(env, "Link ne vrijedi", "Link za prijavu je istekao ili je već iskorišten.", 400);
  return redirect("/a", { "set-cookie": sessionCookie(env, session, 30 * 86400) });
});

route("POST", "/logout", async (req, env) => {
  await store.endSession(env.DB, cookie(req, "s"));
  return redirect("/", { "set-cookie": sessionCookie(env, "", 0) });
});

route("GET", "/a", async (req, env) => {
  const owner = await requireOwner(req, env);
  if (!owner) return redirect("/login");
  return v.dashboard(env, await store.lettersOf(env.DB, owner));
});

route("GET", "/a/novo", async (req, env) => {
  if (!(await requireOwner(req, env))) return redirect("/login");
  return v.editLetter(env, null);
});

route("POST", "/a/novo", async (req, env) => {
  const owner = await requireOwner(req, env);
  if (!owner) return redirect("/login");
  const f = await form(req);
  try {
    await store.createLetter(env.DB, owner, letterInput(f));
  } catch (e) {
    if (e instanceof UserError) return v.editLetter(env, null, e.message, f);
    throw e;
  }
  return redirect(`/a/${f.slug!.trim().toLowerCase()}`);
});

route("GET", "/a/:slug", async (req, env, p) => {
  const l = await ownLetter(req, env, p.slug!);
  return l instanceof Response ? l : v.editLetter(env, l);
});

route("POST", "/a/:slug", async (req, env, p) => {
  const l = await ownLetter(req, env, p.slug!);
  if (l instanceof Response) return l;
  const f = await form(req);
  try {
    await store.updateDraft(env.DB, l, letterInput({ ...f, title: f.title ?? l.title, body_md: f.body_md ?? l.body_md }, l.slug));
  } catch (e) {
    if (e instanceof UserError) return v.editLetter(env, l, e.message, { ...f, slug: l.slug });
    throw e;
  }
  return redirect(`/a/${l.slug}`);
});

route("POST", "/a/:slug/objavi", async (req, env, p) => {
  const l = await ownLetter(req, env, p.slug!);
  if (l instanceof Response) return l;
  await store.publishLetter(env.DB, l);
  return redirect(`/${l.slug}`);
});

route("POST", "/a/:slug/zatvori", async (req, env, p) => {
  const l = await ownLetter(req, env, p.slug!);
  if (l instanceof Response) return l;
  await store.closeLetter(env.DB, l);
  return redirect(`/a/${l.slug}`);
});

route("GET", "/a/:slug/potpisi", async (req, env, p) => {
  const l = await ownLetter(req, env, p.slug!);
  return l instanceof Response ? l : v.moderation(env, l, await store.reviewQueue(env.DB, l.id));
});

route("POST", "/a/:slug/potpisi/:sig/:action", async (req, env, p) => {
  const l = await ownLetter(req, env, p.slug!);
  if (l instanceof Response) return l;
  const s = await store.signatureByPublicId(env.DB, l.id, p.sig!);
  if (!s) return v.message(env, "Nema potpisa", "Potpis ne postoji.", 404);
  const f = await form(req);
  if (p.action === "odobri") await store.approveSignature(env.DB, s);
  else if (p.action === "odbij") await store.rejectSignature(env.DB, s, f.note ?? "");
  else if (p.action === "rucno") await store.manualVerify(env.DB, s, f.note ?? "");
  else return v.message(env, "Nema akcije", "Nepoznata akcija.", 404);
  return redirect(`/a/${l.slug}/potpisi`);
});

// Mora biti zadnja: "/:slug" bi inače progutao /a, /login, /kako-radi.
route("GET", "/:slug", async (req, env, p) => {
  const l = await store.letterBySlug(env.DB, p.slug!);
  if (!l || l.status === "draft") {
    // nacrt vidi samo vlasnik
    const owner = l && (await requireOwner(req, env));
    if (!l || owner !== l.owner_hash) return v.message(env, "Nema pisma", "Ovo pismo ne postoji.", 404);
  }
  const filter = Number(new URL(req.url).searchParams.get("razina") ?? 0) || 0;
  return v.letterPage(env, l, await store.activeSignatures(env.DB, l.id), { filter });
});
