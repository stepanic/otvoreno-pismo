export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Tagirani predložak: interpolacije se escapeaju, osim `raw(...)`. */
export class Raw {
  constructor(readonly v: string) {}
  toString() {
    return this.v;
  }
}
export const raw = (v: string) => new Raw(v);

export function html(strings: TemplateStringsArray, ...vals: unknown[]): Raw {
  let out = strings[0] ?? "";
  vals.forEach((v, i) => {
    out += render(v) + (strings[i + 1] ?? "");
  });
  return new Raw(out);
}

function render(v: unknown): string {
  if (v instanceof Raw) return v.v;
  if (Array.isArray(v)) return v.map(render).join("");
  if (v === false || v === null || v === undefined) return "";
  return esc(v);
}
