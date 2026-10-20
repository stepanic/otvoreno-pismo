// Allowlista institucijskih domena. Podudaranje po sufiksu: "fer.hr" pokriva i
// "zemris.fer.hr". Popis je početni i namjerno konzervativan; proširuje se
// ovdje (PR) ili po instanci varijablom EXTRA_DOMAINS.

export type DomainKind = "academic" | "research" | "public";

export interface Institution {
  domain: string;
  name: string;
  kind: DomainKind;
}

const HR: [string, string, DomainKind][] = [
  // Sveučilišta
  ["unizg.hr", "Sveučilište u Zagrebu", "academic"],
  ["unist.hr", "Sveučilište u Splitu", "academic"],
  ["uniri.hr", "Sveučilište u Rijeci", "academic"],
  ["unios.hr", "Sveučilište J. J. Strossmayera u Osijeku", "academic"],
  ["unizd.hr", "Sveučilište u Zadru", "academic"],
  ["unidu.hr", "Sveučilište u Dubrovniku", "academic"],
  ["unipu.hr", "Sveučilište Jurja Dobrile u Puli", "academic"],
  ["unin.hr", "Sveučilište Sjever", "academic"],
  ["unicath.hr", "Hrvatsko katoličko sveučilište", "academic"],
  // Fakulteti s vlastitim domenama
  ["fer.hr", "FER, Sveučilište u Zagrebu", "academic"],
  ["pmf.hr", "PMF, Sveučilište u Zagrebu", "academic"],
  ["ffzg.hr", "Filozofski fakultet, Sveučilište u Zagrebu", "academic"],
  ["efzg.hr", "Ekonomski fakultet, Sveučilište u Zagrebu", "academic"],
  ["fsb.hr", "FSB, Sveučilište u Zagrebu", "academic"],
  ["foi.hr", "FOI, Sveučilište u Zagrebu", "academic"],
  ["grad.hr", "Građevinski fakultet, Sveučilište u Zagrebu", "academic"],
  ["mef.hr", "Medicinski fakultet, Sveučilište u Zagrebu", "academic"],
  ["fesb.hr", "FESB, Sveučilište u Splitu", "academic"],
  ["pmfst.hr", "PMF, Sveučilište u Splitu", "academic"],
  ["riteh.hr", "Tehnički fakultet, Sveučilište u Rijeci", "academic"],
  ["ferit.hr", "FERIT, Sveučilište u Osijeku", "academic"],
  ["etfos.hr", "FERIT, Sveučilište u Osijeku", "academic"],
  ["mathos.hr", "Fakultet primijenjene matematike i informatike, Osijek", "academic"],
  // Veleučilišta i visoke škole
  ["tvz.hr", "Tehničko veleučilište u Zagrebu", "academic"],
  ["algebra.hr", "Visoko učilište Algebra", "academic"],
  // Instituti i znanstvene ustanove
  ["irb.hr", "Institut Ruđer Bošković", "research"],
  ["ifs.hr", "Institut za fiziku", "research"],
  ["hazu.hr", "Hrvatska akademija znanosti i umjetnosti", "research"],
  ["pilar.hr", "Institut društvenih znanosti Ivo Pilar", "research"],
  ["imi.hr", "Institut za medicinska istraživanja i medicinu rada", "research"],
  ["ihjj.hr", "Institut za hrvatski jezik", "research"],
  ["srce.hr", "Sveučilišni računski centar (Srce)", "research"],
  ["carnet.hr", "CARNET", "research"],
  // Javni sektor
  ["gov.hr", "Tijelo državne uprave (gov.hr)", "public"],
  ["sabor.hr", "Hrvatski sabor", "public"],
];

// Opća pravila za akademske domene izvan Hrvatske.
const GENERIC: { re: RegExp; name: string }[] = [
  { re: /\.edu$/, name: "Akademska ustanova (.edu)" },
  { re: /\.(ac|edu)\.[a-z]{2}$/, name: "Akademska ustanova (ac/edu)" },
];

// Najčešće jednokratne domene; potpis s njih se odbija.
export const DISPOSABLE = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "temp-mail.org", "yopmail.com",
  "trashmail.com", "sharklasers.com", "getnada.com", "dispostable.com", "maildrop.cc",
  "throwawaymail.com", "tempmail.dev", "mohmal.com", "emailondeck.com", "fakeinbox.com",
]);

export function parseExtra(extra: string): Institution[] {
  return extra
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [domain = "", name = ""] = p.split("=");
      return { domain: domain.trim().toLowerCase(), name: name.trim() || domain.trim(), kind: "academic" as const };
    })
    .filter((i) => i.domain.includes("."));
}

export function matchInstitution(domain: string, extra: Institution[] = []): Institution | null {
  const d = domain.toLowerCase();
  const all: Institution[] = [...extra, ...HR.map(([domain, name, kind]) => ({ domain, name, kind }))];
  // najdulji sufiks pobjeđuje (fer.hr ispred unizg.hr za fer.unizg.hr nije bitno, ali zemris.fer.hr → fer.hr)
  let best: Institution | null = null;
  for (const i of all) {
    if (d === i.domain || d.endsWith(`.${i.domain}`)) {
      if (!best || i.domain.length > best.domain.length) best = i;
    }
  }
  if (best) return best;
  for (const g of GENERIC) if (g.re.test(d)) return { domain: d, name: g.name, kind: "academic" };
  return null;
}

export function isDisposable(domain: string): boolean {
  const d = domain.toLowerCase();
  for (const x of DISPOSABLE) if (d === x || d.endsWith(`.${x}`)) return true;
  return false;
}
