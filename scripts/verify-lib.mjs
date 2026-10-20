// Neovisna provjera lanca i popisa potpisa. Bez ovisnosti; radi u Nodeu ≥ 20,
// pregledniku i Workeru. Namjerno ne uvozi ništa iz src/.

const GENESIS = "0".repeat(64);

export function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .filter((k) => v[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(",")}}`;
}

export async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * @param {{links: {seq:number, prev_hash:string, hash:string, event:string}[]}} log
 * @param {{signatures: object[], counts?: {total:number}}} sigs
 * @param {{body_md:string, body_sha256:string} | null} letter
 * @returns {Promise<{ok: boolean, errors: string[], head: string, active: number, events: number}>}
 */
export async function verify(log, sigs, letter) {
  const errors = [];
  let prev = GENESIS;
  const state = new Map(); // sig -> rec hash
  let publishHash = null;
  for (const [i, l] of log.links.entries()) {
    if (l.seq !== i + 1) errors.push(`karika ${i + 1}: seq je ${l.seq}`);
    if (l.prev_hash !== prev) errors.push(`karika ${l.seq}: prev_hash se ne nastavlja na prethodnu`);
    const h = await sha256(`${l.prev_hash}|${l.seq}|${l.event}`);
    if (h !== l.hash) errors.push(`karika ${l.seq}: hash ne odgovara sadržaju`);
    if (canonical(JSON.parse(l.event)) !== l.event) errors.push(`karika ${l.seq}: događaj nije u kanonskom obliku`);
    prev = l.hash;
    const ev = JSON.parse(l.event);
    if (ev.t === "publish") publishHash = ev.body_sha256;
    else if (ev.t === "sign" || ev.t === "update") {
      if (ev.t === "update" && !state.has(ev.sig)) errors.push(`karika ${l.seq}: update za nepostojeći potpis ${ev.sig}`);
      if (ev.t === "sign" && state.has(ev.sig)) errors.push(`karika ${l.seq}: dvostruki potpis ${ev.sig}`);
      state.set(ev.sig, ev.rec);
    } else if (ev.t === "withdraw" || ev.t === "reject") {
      if (!state.delete(ev.sig)) errors.push(`karika ${l.seq}: ${ev.t} za nepostojeći potpis ${ev.sig}`);
    }
  }
  if (letter) {
    if ((await sha256(letter.body_md)) !== letter.body_sha256) errors.push("tekst pisma ne odgovara body_sha256");
    if (publishHash !== letter.body_sha256) errors.push("hash teksta u lancu ne odgovara objavljenom tekstu");
  }
  const seen = new Set();
  for (const r of sigs.signatures) {
    seen.add(r.sig);
    const want = state.get(r.sig);
    if (!want) errors.push(`potpis ${r.sig} je na popisu, a nije u lancu`);
    else if ((await sha256(canonical(r))) !== want) errors.push(`potpis ${r.sig}: zapis ne odgovara lancu`);
  }
  for (const sig of state.keys()) if (!seen.has(sig)) errors.push(`potpis ${sig} je u lancu, a nedostaje na popisu`);
  if (sigs.counts && sigs.counts.total !== sigs.signatures.length) errors.push("counts.total ne odgovara popisu");
  return { ok: errors.length === 0, errors, head: prev, active: state.size, events: log.links.length };
}
