#!/usr/bin/env node
// Uporaba: node scripts/verify-log.mjs https://instanca/<pismo>
//          node scripts/verify-log.mjs ./mapa   (log.json, signatures.json, letter.json)
import { readFile } from "node:fs/promises";
import { verify } from "./verify-lib.mjs";

const src = process.argv[2];
if (!src) {
  console.error("Uporaba: node scripts/verify-log.mjs <URL pisma | mapa s JSON datotekama>");
  process.exit(2);
}
const load = async (name) =>
  /^https?:/.test(src)
    ? (await fetch(`${src.replace(/\/$/, "")}/${name}`, { headers: { accept: "application/json" } })).json()
    : JSON.parse(await readFile(`${src}/${name}`, "utf8"));

const [log, sigs, letter] = await Promise.all([load("log.json"), load("signatures.json"), load("letter.json")]);
const r = await verify(log, sigs, letter);
console.log(`karika: ${r.events}, aktivnih potpisa u lancu: ${r.active}, na popisu: ${sigs.signatures.length}`);
console.log(`vrh lanca: ${r.head}`);
if (r.ok) console.log("✓ lanac, tekst pisma i popis potpisa se slažu");
else {
  for (const e of r.errors) console.log(`✗ ${e}`);
  process.exit(1);
}
