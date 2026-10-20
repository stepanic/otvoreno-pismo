import { b64url, b64urlDecode, randomToken } from "./crypto";
import type { Env } from "./env";

export type Provider = "orcid" | "certilia";

interface ProviderConfig {
  discovery: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  pkce: boolean;
  /** Certilia ne vraća uvijek nonce u id_tokenu; tada se oslanjamo na state + izravnu razmjenu koda. */
  nonceOptional: boolean;
}

export function providerConfig(env: Env, p: Provider): ProviderConfig | null {
  if (p === "orcid" && env.ORCID_CLIENT_ID && env.ORCID_CLIENT_SECRET) {
    return {
      discovery: `${env.ORCID_BASE}/.well-known/openid-configuration`,
      clientId: env.ORCID_CLIENT_ID,
      clientSecret: env.ORCID_CLIENT_SECRET,
      scope: "openid",
      pkce: false,
      nonceOptional: false,
    };
  }
  if (p === "certilia" && env.CERTILIA_CLIENT_ID && env.CERTILIA_CLIENT_SECRET) {
    return {
      discovery: `${env.CERTILIA_BASE}/oauth2/oidcdiscovery/.well-known/openid-configuration`,
      clientId: env.CERTILIA_CLIENT_ID,
      clientSecret: env.CERTILIA_CLIENT_SECRET,
      scope: "openid profile eid",
      pkce: true,
      nonceOptional: true,
    };
  }
  return null;
}

export function enabledProviders(env: Env): Provider[] {
  return (["orcid", "certilia"] as const).filter((p) => providerConfig(env, p));
}

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoCache = new Map<string, { d: Discovery; at: number }>();
const jwksCache = new Map<string, { keys: JsonWebKey[]; at: number }>();

async function discovery(url: string): Promise<Discovery> {
  const c = discoCache.get(url);
  if (c && Date.now() - c.at < 3600_000) return c.d;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`discovery ${r.status}`);
  const d = (await r.json()) as Discovery;
  discoCache.set(url, { d, at: Date.now() });
  return d;
}

async function jwks(url: string, force = false): Promise<JsonWebKey[]> {
  const c = jwksCache.get(url);
  if (!force && c && Date.now() - c.at < 3600_000) return c.keys;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`jwks ${r.status}`);
  const { keys } = (await r.json()) as { keys: JsonWebKey[] };
  jwksCache.set(url, { keys, at: Date.now() });
  return keys;
}

export function redirectUri(env: Env, p: Provider): string {
  return `${env.BASE_URL}/oidc/callback/${p}`;
}

export async function authorizeUrl(env: Env, p: Provider, state: string, nonce: string, verifier: string): Promise<string> {
  const cfg = providerConfig(env, p);
  if (!cfg) throw new Error(`${p} nije konfiguriran`);
  const d = await discovery(cfg.discovery);
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", redirectUri(env, p));
  u.searchParams.set("scope", cfg.scope);
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  if (cfg.pkce) {
    const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    u.searchParams.set("code_challenge", challenge);
    u.searchParams.set("code_challenge_method", "S256");
  }
  return u.toString();
}

export function newFlow() {
  return { state: randomToken(), nonce: randomToken(), verifier: randomToken(32) };
}

export interface IdClaims {
  sub: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  [k: string]: unknown;
}

export async function exchangeCode(env: Env, p: Provider, code: string, verifier: string, nonce: string): Promise<IdClaims> {
  const cfg = providerConfig(env, p);
  if (!cfg) throw new Error(`${p} nije konfiguriran`);
  const d = await discovery(cfg.discovery);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(env, p),
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });
  if (cfg.pkce) body.set("code_verifier", verifier);
  const r = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  if (!r.ok) throw new Error(`token ${r.status}: ${await r.text()}`);
  const tok = (await r.json()) as { id_token?: string };
  if (!tok.id_token) throw new Error("nema id_token");
  return verifyIdToken(tok.id_token, {
    issuer: d.issuer,
    audience: cfg.clientId,
    jwksUri: d.jwks_uri,
    nonce,
    nonceOptional: cfg.nonceOptional,
  });
}

export async function verifyIdToken(
  jwt: string,
  o: { issuer: string; audience: string; jwksUri: string; nonce: string; nonceOptional: boolean; now?: number },
): Promise<IdClaims> {
  const [h, p, s] = jwt.split(".");
  if (!h || !p || !s) throw new Error("neispravan JWT");
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h))) as { alg: string; kid?: string };
  if (header.alg !== "RS256") throw new Error(`nepodržan alg ${header.alg}`);
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(p))) as IdClaims & {
    iss: string;
    aud: string | string[];
    exp: number;
    nonce?: string;
  };
  let keys = await jwks(o.jwksUri);
  let jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid) ?? (keys.length === 1 ? keys[0] : undefined);
  if (!jwk) {
    keys = await jwks(o.jwksUri, true);
    jwk = keys.find((k) => (k as { kid?: string }).kid === header.kid);
  }
  if (!jwk) throw new Error("nepoznat kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlDecode(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("neispravan potpis tokena");
  const now = o.now ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== o.issuer) throw new Error("iss");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(o.audience)) throw new Error("aud");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("token istekao");
  if (claims.nonce !== undefined ? claims.nonce !== o.nonce : !o.nonceOptional) throw new Error("nonce");
  if (!claims.sub) throw new Error("nema sub");
  return claims;
}

export function displayName(c: IdClaims): string | null {
  const n = (c.name ?? `${c.given_name ?? ""} ${c.family_name ?? ""}`).trim();
  return n || null;
}

export const _caches = { discoCache, jwksCache };
