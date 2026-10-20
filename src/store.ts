import { withChain, type LogEvent } from "./chain";
import { canonical, hmac, normalizeEmail, publicId, randomToken, sha256 } from "./crypto";
import { isDisposable, matchInstitution, parseExtra } from "./domains";
import type { Env } from "./env";

export type Status = "pending" | "active" | "review" | "withdrawn" | "rejected";
export type MethodKind = "email" | "domain" | "orcid" | "certilia" | "manual";

export interface Method {
  m: MethodKind;
  at: number;
  note?: string;
}

export interface Letter {
  id: number;
  slug: string;
  title: string;
  summary: string;
  body_md: string;
  lang: string;
  owner_hash: string;
  status: "draft" | "published" | "closed";
  allow_anonymous: number;
  moderation: number;
  body_sha256: string | null;
  created_at: number;
  published_at: number | null;
  closed_at: number | null;
}

export interface Signature {
  id: number;
  letter_id: number;
  public_id: string;
  name: string;
  title: string;
  affiliation: string;
  country: string;
  comment: string;
  anonymous: number;
  email_hash: string;
  email_domain: string;
  institution: string | null;
  show_institution: number;
  tier: number;
  methods: string;
  orcid: string | null;
  name_source: string;
  review_note: string | null;
  salt: string;
  status: Status;
  manage_hash: string;
  created_at: number;
  confirmed_at: number | null;
}

export const TIER_OF: Record<MethodKind, number> = { email: 1, domain: 2, orcid: 3, certilia: 3, manual: 4 };

export const now = () => Date.now();

export class UserError extends Error {}

export function methodsOf(s: Pick<Signature, "methods">): Method[] {
  return JSON.parse(s.methods) as Method[];
}

export function tierOf(methods: Method[]): number {
  return methods.reduce((t, m) => Math.max(t, TIER_OF[m.m]), 0);
}

/** Javni zapis potpisa. Njegov sha256 ide u lanac; isti oblik vraća signatures.json. */
export function publicRecord(s: Signature) {
  const kinds = [...new Set(methodsOf(s).map((m) => m.m))].sort();
  const base = {
    sig: s.public_id,
    anonymous: s.anonymous === 1,
    tier: s.tier,
    methods: kinds,
    name_source: s.anonymous ? undefined : s.name_source,
    institution: s.institution && (!s.anonymous || s.show_institution) ? s.institution : undefined,
    comment: s.comment || undefined,
    salt: s.salt,
  };
  if (s.anonymous) return base;
  return {
    ...base,
    name: s.name,
    title: s.title || undefined,
    affiliation: s.affiliation || undefined,
    country: s.country || undefined,
    orcid: s.orcid || undefined,
  };
}

export async function recordHash(s: Signature): Promise<string> {
  return sha256(canonical(publicRecord(s)));
}

// ---------- pisma ----------

export async function letterBySlug(db: D1Database, slug: string): Promise<Letter | null> {
  return db.prepare("SELECT * FROM letters WHERE slug = ?").bind(slug).first<Letter>();
}

export async function publishedLetters(db: D1Database): Promise<(Letter & { n: number })[]> {
  const r = await db
    .prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM signatures s WHERE s.letter_id = l.id AND s.status = 'active') AS n
       FROM letters l WHERE l.status IN ('published', 'closed') ORDER BY l.published_at DESC`,
    )
    .all<Letter & { n: number }>();
  return r.results;
}

export async function lettersOf(db: D1Database, ownerHash: string): Promise<(Letter & { n: number; r: number })[]> {
  const r = await db
    .prepare(
      `SELECT l.*,
         (SELECT COUNT(*) FROM signatures s WHERE s.letter_id = l.id AND s.status = 'active') AS n,
         (SELECT COUNT(*) FROM signatures s WHERE s.letter_id = l.id AND s.status = 'review') AS r
       FROM letters l WHERE l.owner_hash = ? ORDER BY l.created_at DESC`,
    )
    .bind(ownerHash)
    .all<Letter & { n: number; r: number }>();
  return r.results;
}

export interface LetterInput {
  slug: string;
  title: string;
  summary: string;
  body_md: string;
  allow_anonymous: boolean;
  moderation: boolean;
}

export function validateLetter(i: LetterInput): LetterInput {
  const slug = i.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug)) throw new UserError("Adresa smije imati mala slova, brojke i crtice (2–63 znaka).");
  if (["a", "m", "api", "login", "logout", "oidc", "kako-radi", "robots.txt"].includes(slug)) throw new UserError("Ta adresa je rezervirana.");
  const title = i.title.trim();
  if (title.length < 3 || title.length > 200) throw new UserError("Naslov mora imati 3–200 znakova.");
  if (i.body_md.trim().length < 20) throw new UserError("Tekst pisma je prekratak.");
  if (i.body_md.length > 100_000) throw new UserError("Tekst pisma je predug.");
  return { ...i, slug, title, summary: i.summary.trim().slice(0, 500) };
}

export async function createLetter(db: D1Database, ownerHash: string, input: LetterInput): Promise<void> {
  const i = validateLetter(input);
  if (await letterBySlug(db, i.slug)) throw new UserError("Pismo s tom adresom već postoji.");
  await db
    .prepare(
      `INSERT INTO letters (slug, title, summary, body_md, owner_hash, allow_anonymous, moderation, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(i.slug, i.title, i.summary, i.body_md, ownerHash, i.allow_anonymous ? 1 : 0, i.moderation ? 1 : 0, now())
    .run();
}

export async function updateDraft(db: D1Database, l: Letter, input: LetterInput): Promise<void> {
  const i = validateLetter({ ...input, slug: l.slug });
  if (l.status === "draft") {
    await db
      .prepare("UPDATE letters SET title = ?, summary = ?, body_md = ?, allow_anonymous = ?, moderation = ? WHERE id = ?")
      .bind(i.title, i.summary, i.body_md, i.allow_anonymous ? 1 : 0, i.moderation ? 1 : 0, l.id)
      .run();
  } else {
    // Nakon objave tekst i naslov su zaključani; mijenjaju se samo postavke.
    await db
      .prepare("UPDATE letters SET summary = ?, allow_anonymous = ?, moderation = ? WHERE id = ?")
      .bind(i.summary, i.allow_anonymous ? 1 : 0, i.moderation ? 1 : 0, l.id)
      .run();
  }
}

export async function publishLetter(db: D1Database, l: Letter): Promise<void> {
  if (l.status !== "draft") throw new UserError("Pismo je već objavljeno.");
  const t = now();
  const body_sha256 = await sha256(l.body_md);
  await withChain(db, l.id, { t: "publish", title: l.title, body_sha256, ts: t }, [
    db.prepare("UPDATE letters SET status = 'published', body_sha256 = ?, published_at = ? WHERE id = ?").bind(body_sha256, t, l.id),
  ]);
}

export async function closeLetter(db: D1Database, l: Letter): Promise<void> {
  if (l.status !== "published") throw new UserError("Zatvoriti se može samo objavljeno pismo.");
  const t = now();
  await withChain(db, l.id, { t: "close", ts: t }, [
    db.prepare("UPDATE letters SET status = 'closed', closed_at = ? WHERE id = ?").bind(t, l.id),
  ]);
}

// ---------- potpisi ----------

export interface SignInput {
  name: string;
  title: string;
  affiliation: string;
  country: string;
  comment: string;
  email: string;
  anonymous: boolean;
  show_institution: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Upiši ili osvježi potpis i vrati novi upravljački token koji ide e-mailom.
 * Odgovor je isti bez obzira postoji li potpis (nema enumeracije e-mailova).
 */
export async function requestSignature(
  env: Env,
  l: Letter,
  input: SignInput,
): Promise<{ token: string; state: "new" | "pending" | "existing" }> {
  if (l.status !== "published") throw new UserError("Ovo pismo trenutno ne prima potpise.");
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email) || email.length > 254) throw new UserError("Upiši ispravnu e-mail adresu.");
  const domain = email.split("@")[1]!;
  if (isDisposable(domain)) throw new UserError("Jednokratne e-mail adrese nisu dopuštene.");
  const anonymous = input.anonymous && l.allow_anonymous === 1;
  const name = input.name.trim().slice(0, 120);
  if (!anonymous && name.length < 2) throw new UserError("Upiši ime i prezime (ili odaberi anonimni potpis).");
  const fields = {
    name: name || "Anonimno",
    title: input.title.trim().slice(0, 60),
    affiliation: input.affiliation.trim().slice(0, 160),
    country: input.country.trim().slice(0, 60),
    comment: input.comment.trim().slice(0, 500),
  };

  const db = env.DB;
  const emailHash = await hmac(env.HMAC_KEY, "email", email);
  const token = randomToken();
  const manageHash = await sha256(token);
  const inst = matchInstitution(domain, parseExtra(env.EXTRA_DOMAINS));
  const existing = await db
    .prepare("SELECT * FROM signatures WHERE letter_id = ? AND email_hash = ?")
    .bind(l.id, emailHash)
    .first<Signature>();

  if (existing && existing.status !== "withdrawn") {
    // Novi link; podaci postojećeg potpisa se mijenjaju samo dok nije potvrđen.
    if (existing.status === "pending") {
      await db
        .prepare(
          `UPDATE signatures SET name = ?, title = ?, affiliation = ?, country = ?, comment = ?, anonymous = ?,
             show_institution = ?, manage_hash = ? WHERE id = ?`,
        )
        .bind(fields.name, fields.title, fields.affiliation, fields.country, fields.comment, anonymous ? 1 : 0,
          input.show_institution ? 1 : 0, manageHash, existing.id)
        .run();
      return { token, state: "pending" };
    }
    await db.prepare("UPDATE signatures SET manage_hash = ? WHERE id = ?").bind(manageHash, existing.id).run();
    return { token, state: "existing" };
  }

  const salt = randomToken(16);
  if (existing) {
    // ponovni potpis nakon povlačenja: isti javni ID, nova sol, nove provjere
    await db
      .prepare(
        `UPDATE signatures SET name = ?, title = ?, affiliation = ?, country = ?, comment = ?, anonymous = ?,
           show_institution = ?, institution = ?, tier = 0, methods = '[]', orcid = NULL, name_source = 'self',
           salt = ?, status = 'pending', manage_hash = ?, confirmed_at = NULL WHERE id = ?`,
      )
      .bind(fields.name, fields.title, fields.affiliation, fields.country, fields.comment, anonymous ? 1 : 0,
        input.show_institution ? 1 : 0, inst?.name ?? null, salt, manageHash, existing.id)
      .run();
    await db.prepare("DELETE FROM identity_claims WHERE signature_id = ?").bind(existing.id).run();
    return { token, state: "new" };
  }
  await db
    .prepare(
      `INSERT INTO signatures (letter_id, public_id, name, title, affiliation, country, comment, anonymous,
         email_hash, email_domain, institution, show_institution, salt, manage_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(l.id, publicId(), fields.name, fields.title, fields.affiliation, fields.country, fields.comment,
      anonymous ? 1 : 0, emailHash, domain, inst?.name ?? null, input.show_institution ? 1 : 0, salt, manageHash, now())
    .run();
  return { token, state: "new" };
}

export async function signatureByToken(db: D1Database, token: string): Promise<Signature | null> {
  if (!token || token.length > 100) return null;
  return db.prepare("SELECT * FROM signatures WHERE manage_hash = ?").bind(await sha256(token)).first<Signature>();
}

export async function signatureById(db: D1Database, id: number): Promise<Signature | null> {
  return db.prepare("SELECT * FROM signatures WHERE id = ?").bind(id).first<Signature>();
}

function withMethod(s: Signature, m: Method): Signature {
  const methods = methodsOf(s).filter((x) => x.m !== m.m);
  methods.push(m);
  return { ...s, methods: JSON.stringify(methods), tier: tierOf(methods) };
}

function updateStmt(db: D1Database, s: Signature, status: Status): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE signatures SET name = ?, name_source = ?, orcid = ?, tier = ?, methods = ?, review_note = ?,
         status = ?, confirmed_at = ? WHERE id = ?`,
    )
    .bind(s.name, s.name_source, s.orcid, s.tier, s.methods, s.review_note, status, s.confirmed_at, s.id);
}

/** Potvrda e-maila (gumb na stranici potpisa). */
export async function confirmSignature(env: Env, l: Letter, s0: Signature): Promise<Status> {
  if (s0.status !== "pending") return s0.status;
  if (l.status !== "published") throw new UserError("Ovo pismo više ne prima potpise.");
  const t = now();
  let s = withMethod({ ...s0, confirmed_at: t }, { m: "email", at: t });
  if (s.institution) s = withMethod(s, { m: "domain", at: t, note: s.email_domain });
  const db = env.DB;
  if (l.moderation) {
    await updateStmt(db, s, "review").run();
    return "review";
  }
  await withChain(db, l.id, { t: "sign", sig: s.public_id, rec: await recordHash(s), ts: t }, [updateStmt(db, s, "active")]);
  return "active";
}

export async function withdrawSignature(db: D1Database, s: Signature): Promise<void> {
  if (s.status === "withdrawn" || s.status === "rejected") return;
  const stmts = [
    db.prepare("UPDATE signatures SET status = 'withdrawn' WHERE id = ?").bind(s.id),
    db.prepare("DELETE FROM identity_claims WHERE signature_id = ?").bind(s.id),
  ];
  if (s.status === "active") await withChain(db, s.letter_id, { t: "withdraw", sig: s.public_id, ts: now() }, stmts);
  else await db.batch(stmts);
}

/** Organizator: odobri potpis iz reda čekanja. */
export async function approveSignature(db: D1Database, s: Signature): Promise<void> {
  if (s.status !== "review") throw new UserError("Potpis nije u redu čekanja.");
  await withChain(db, s.letter_id, { t: "sign", sig: s.public_id, rec: await recordHash(s), ts: now() }, [
    updateStmt(db, s, "active"),
  ]);
}

export async function rejectSignature(db: D1Database, s: Signature, note: string): Promise<void> {
  if (s.status !== "review" && s.status !== "active") throw new UserError("Ovaj potpis se ne može odbiti.");
  const stmts = [
    db.prepare("UPDATE signatures SET status = 'rejected', review_note = ? WHERE id = ?").bind(note.slice(0, 300) || null, s.id),
    db.prepare("DELETE FROM identity_claims WHERE signature_id = ?").bind(s.id),
  ];
  if (s.status === "active") await withChain(db, s.letter_id, { t: "reject", sig: s.public_id, ts: now() }, stmts);
  else await db.batch(stmts);
}

/** Primijeni promjenu na potvrđen potpis; aktivni dobiva novu kariku "update". */
async function applyUpdate(db: D1Database, s: Signature, extra: D1PreparedStatement[] = []): Promise<void> {
  if (s.status === "active") {
    const ev: LogEvent = { t: "update", sig: s.public_id, rec: await recordHash(s), ts: now() };
    await withChain(db, s.letter_id, ev, [...extra, updateStmt(db, s, "active")]);
  } else {
    await db.batch([...extra, updateStmt(db, s, s.status)]);
  }
}

/** Organizator: ručna potvrda (izravni kontakt), s javnom bilješkom. */
export async function manualVerify(db: D1Database, s: Signature, note: string): Promise<void> {
  if (s.status !== "active" && s.status !== "review") throw new UserError("Potpis mora biti potvrđen e-mailom.");
  const n = note.trim().slice(0, 200);
  await applyUpdate(db, withMethod(s, { m: "manual", at: now(), note: n || undefined }));
}

/** ORCID / Certilia: veži identitet (jedan po pismu) i preuzmi ime iz izvora. */
export async function attachIdentity(
  env: Env,
  s: Signature,
  kind: "orcid" | "certilia",
  subject: string,
  name: string | null,
): Promise<void> {
  if (s.status !== "active" && s.status !== "review") throw new UserError("Potpis mora biti potvrđen e-mailom.");
  const db = env.DB;
  const subjectHash = await hmac(env.HMAC_KEY, kind, subject);
  const claim = await db
    .prepare("SELECT signature_id FROM identity_claims WHERE letter_id = ? AND kind = ? AND subject_hash = ?")
    .bind(s.letter_id, kind, subjectHash)
    .first<{ signature_id: number }>();
  if (claim && claim.signature_id !== s.id) throw new UserError("Ovaj identitet je već vezan uz drugi potpis na ovom pismu.");
  let next = withMethod(s, { m: kind, at: now() });
  if (name && !s.anonymous) next = { ...next, name, name_source: kind };
  if (kind === "orcid" && !s.anonymous) next = { ...next, orcid: subject };
  const extra = claim
    ? []
    : [
        db
          .prepare("INSERT INTO identity_claims (letter_id, kind, subject_hash, signature_id) VALUES (?, ?, ?, ?)")
          .bind(s.letter_id, kind, subjectHash, s.id),
      ];
  await applyUpdate(db, next, extra);
}

export async function activeSignatures(db: D1Database, letterId: number): Promise<Signature[]> {
  const r = await db
    .prepare("SELECT * FROM signatures WHERE letter_id = ? AND status = 'active' ORDER BY tier DESC, confirmed_at ASC")
    .bind(letterId)
    .all<Signature>();
  return r.results;
}

export async function reviewQueue(db: D1Database, letterId: number): Promise<Signature[]> {
  const r = await db
    .prepare("SELECT * FROM signatures WHERE letter_id = ? AND status IN ('review', 'active') ORDER BY status DESC, confirmed_at DESC")
    .bind(letterId)
    .all<Signature>();
  return r.results;
}

export async function signatureByPublicId(db: D1Database, letterId: number, pid: string): Promise<Signature | null> {
  return db.prepare("SELECT * FROM signatures WHERE letter_id = ? AND public_id = ?").bind(letterId, pid).first<Signature>();
}

export function counts(sigs: Signature[]) {
  const byTier: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0 };
  let anonymous = 0;
  for (const s of sigs) {
    byTier[String(s.tier)] = (byTier[String(s.tier)] ?? 0) + 1;
    if (s.anonymous) anonymous++;
  }
  return { total: sigs.length, anonymous, byTier };
}

// ---------- organizatori ----------

export function isOrganizerAllowed(env: Env, email: string): boolean {
  const list = (env.ORGANIZERS ?? "").split(",").map((e) => normalizeEmail(e)).filter(Boolean);
  return list.includes("*") || list.includes(normalizeEmail(email));
}

export async function createLoginToken(env: Env, email: string): Promise<string> {
  const token = randomToken();
  await env.DB.prepare("INSERT INTO login_tokens (hash, email_hash, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(token), await hmac(env.HMAC_KEY, "email", normalizeEmail(email)), now() + 30 * 60_000)
    .run();
  return token;
}

export async function loginTokenValid(db: D1Database, token: string): Promise<boolean> {
  const r = await db
    .prepare("SELECT 1 FROM login_tokens WHERE hash = ? AND used_at IS NULL AND expires_at > ?")
    .bind(await sha256(token), now())
    .first();
  return !!r;
}

/** Iskoristi login token i vrati token sesije. */
export async function consumeLoginToken(db: D1Database, token: string): Promise<string | null> {
  const hash = await sha256(token);
  const row = await db
    .prepare("UPDATE login_tokens SET used_at = ? WHERE hash = ? AND used_at IS NULL AND expires_at > ? RETURNING email_hash")
    .bind(now(), hash, now())
    .first<{ email_hash: string }>();
  if (!row) return null;
  const session = randomToken(32);
  await db
    .prepare("INSERT INTO sessions (hash, email_hash, expires_at) VALUES (?, ?, ?)")
    .bind(await sha256(session), row.email_hash, now() + 30 * 86400_000)
    .run();
  return session;
}

export async function sessionOwner(db: D1Database, session: string | undefined): Promise<string | null> {
  if (!session) return null;
  const r = await db
    .prepare("SELECT email_hash FROM sessions WHERE hash = ? AND expires_at > ?")
    .bind(await sha256(session), now())
    .first<{ email_hash: string }>();
  return r?.email_hash ?? null;
}

export async function endSession(db: D1Database, session: string | undefined): Promise<void> {
  if (session) await db.prepare("DELETE FROM sessions WHERE hash = ?").bind(await sha256(session)).run();
}

// ---------- rate limit ----------

/** Vraća false ako je ključ prešao `limit` u prozoru od `windowSec`. */
export async function rateLimit(db: D1Database, key: string, limit: number, windowSec: number): Promise<boolean> {
  const t = now();
  const row = await db
    .prepare(
      `INSERT INTO rate (key, n, reset_at) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         n = CASE WHEN reset_at < ? THEN 1 ELSE n + 1 END,
         reset_at = CASE WHEN reset_at < ? THEN ? ELSE reset_at END
       RETURNING n`,
    )
    .bind(key, t + windowSec * 1000, t, t, t + windowSec * 1000)
    .first<{ n: number }>();
  return (row?.n ?? 0) <= limit;
}
