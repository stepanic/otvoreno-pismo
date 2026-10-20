import { canonical, sha256 } from "./crypto";

export const GENESIS = "0".repeat(64);

export type LogEvent =
  | { t: "publish"; title: string; body_sha256: string; ts: number }
  | { t: "close"; ts: number }
  | { t: "sign"; sig: string; rec: string; ts: number }
  | { t: "update"; sig: string; rec: string; ts: number }
  | { t: "withdraw"; sig: string; ts: number }
  | { t: "reject"; sig: string; ts: number };

export async function linkHash(prev: string, seq: number, event: string): Promise<string> {
  return sha256(`${prev}|${seq}|${event}`);
}

/**
 * Pripremi INSERT sljedeće karike. Vraća statement za batch s drugim izmjenama,
 * pa se karika i promjena stanja zapisuju atomarno. PK (letter_id, seq) hvata
 * utrku dvaju zapisa; pozivatelj ponavlja (vidi withChain).
 */
export async function nextLink(db: D1Database, letterId: number, ev: LogEvent): Promise<D1PreparedStatement> {
  const last = await db
    .prepare("SELECT seq, hash FROM log WHERE letter_id = ? ORDER BY seq DESC LIMIT 1")
    .bind(letterId)
    .first<{ seq: number; hash: string }>();
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.hash ?? GENESIS;
  const event = canonical(ev);
  const hash = await linkHash(prev, seq, event);
  return db
    .prepare("INSERT INTO log (letter_id, seq, prev_hash, hash, event, ts) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(letterId, seq, prev, hash, event, ev.ts);
}

/** Izvrši izmjene zajedno s novom karikom; do 5 pokušaja kod sudara na seq. */
export async function withChain(
  db: D1Database,
  letterId: number,
  ev: LogEvent,
  stmts: D1PreparedStatement[],
): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await db.batch([...stmts, await nextLink(db, letterId, ev)]);
      return;
    } catch (e) {
      if (i >= 4 || !/UNIQUE|PRIMARY KEY/i.test(String(e))) throw e;
    }
  }
}

export interface LogRow {
  seq: number;
  prev_hash: string;
  hash: string;
  event: string;
}

export async function verifyChain(rows: LogRow[]): Promise<{ ok: boolean; error?: string }> {
  let prev = GENESIS;
  for (const [i, r] of rows.entries()) {
    if (r.seq !== i + 1) return { ok: false, error: `seq ${r.seq} na mjestu ${i + 1}` };
    if (r.prev_hash !== prev) return { ok: false, error: `prev_hash ne odgovara na seq ${r.seq}` };
    if ((await linkHash(prev, r.seq, r.event)) !== r.hash) return { ok: false, error: `hash ne odgovara na seq ${r.seq}` };
    prev = r.hash;
  }
  return { ok: true };
}
