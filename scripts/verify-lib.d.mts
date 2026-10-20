export interface LogLink {
  seq: number;
  prev_hash: string;
  hash: string;
  event: string;
}
export function canonical(v: unknown): string;
export function sha256(s: string): Promise<string>;
export function verify(
  log: { links: LogLink[] },
  sigs: { signatures: Record<string, unknown>[]; counts?: { total: number } },
  letter: { body_md: string; body_sha256: string } | null,
): Promise<{ ok: boolean; errors: string[]; head: string; active: number; events: number }>;
