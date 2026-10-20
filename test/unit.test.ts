import { describe, expect, it } from "vitest";
import { GENESIS, linkHash, verifyChain } from "../src/chain";
import { canonical, sha256 } from "../src/crypto";
import { isDisposable, matchInstitution, parseExtra } from "../src/domains";
import { renderMarkdown } from "../src/markdown";
import { canonical as canonicalLib } from "../scripts/verify-lib.mjs";

describe("canonical", () => {
  it("sortira ključeve i izbacuje undefined", () => {
    expect(canonical({ b: 1, a: [2, { d: undefined, c: "x" }] })).toBe('{"a":[2,{"c":"x"}],"b":1}');
  });
  it("isti rezultat kao neovisni verifikator", () => {
    const v = { z: "č", a: [null, true, 1.5], m: { y: undefined, x: "\"" } };
    expect(canonicalLib(v)).toBe(canonical(v));
  });
});

describe("lanac", () => {
  it("provjerava ispravan lanac i hvata izmjenu", async () => {
    const rows = [];
    let prev = GENESIS;
    for (let seq = 1; seq <= 3; seq++) {
      const event = canonical({ t: "close", ts: seq });
      const hash = await linkHash(prev, seq, event);
      rows.push({ seq, prev_hash: prev, hash, event });
      prev = hash;
    }
    expect((await verifyChain(rows)).ok).toBe(true);
    rows[1]!.event = canonical({ t: "close", ts: 99 });
    expect((await verifyChain(rows)).ok).toBe(false);
  });
  it("sha256 poznate vrijednosti", async () => {
    expect(await sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("domene", () => {
  it("sufiks i najdulje podudaranje", () => {
    expect(matchInstitution("fer.hr")?.name).toMatch(/FER/);
    expect(matchInstitution("zemris.fer.hr")?.name).toMatch(/FER/);
    expect(matchInstitution("pmf.unizg.hr")?.name).toBe("Sveučilište u Zagrebu");
    expect(matchInstitution("mzo.gov.hr")?.kind).toBe("public");
    expect(matchInstitution("notfer.hr")).toBeNull();
    expect(matchInstitution("gmail.com")).toBeNull();
  });
  it("opća pravila i dodatne domene", () => {
    expect(matchInstitution("mit.edu")?.kind).toBe("academic");
    expect(matchInstitution("ox.ac.uk")?.kind).toBe("academic");
    const extra = parseExtra("primjer.hr=Primjer institut; los");
    expect(extra).toHaveLength(1);
    expect(matchInstitution("lab.primjer.hr", extra)?.name).toBe("Primjer institut");
  });
  it("jednokratne domene", () => {
    expect(isDisposable("mailinator.com")).toBe(true);
    expect(isDisposable("x.yopmail.com")).toBe(true);
    expect(isDisposable("fer.hr")).toBe(false);
  });
});

describe("markdown", () => {
  it("escapea HTML i opasne linkove", () => {
    const out = renderMarkdown('# Naslov\n\n<script>alert(1)</script>\n\n[x](javascript:alert(1)) [y](https://e.org) ![i](https://e.org/a.png)');
    expect(out).toContain("<h1>Naslov</h1>");
    expect(out).not.toContain("<script>");
    expect(out).not.toContain("javascript:");
    expect(out).toContain('href="https://e.org"');
    expect(out).not.toContain("<img");
  });
});
