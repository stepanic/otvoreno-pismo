const enc = new TextEncoder();

export function hex(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** HMAC-SHA256 s ključem instance; `purpose` odvaja domene (email, oib, orcid…). */
export async function hmac(key: string, purpose: string, value: string): Promise<string> {
  if (!key) throw new Error("HMAC_KEY nije postavljen");
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, enc.encode(`${purpose}:${value}`)));
}

export function randomToken(bytes = 24): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Kratki javni ID potpisa (bez dvosmislenih znakova). */
export function publicId(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const r = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(r, (x) => alphabet[x % alphabet.length]).join("");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Kanonski JSON: sortirani ključevi, bez razmaka. Isti algoritam je u scripts/verify-log.mjs. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}
