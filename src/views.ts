import type { Env } from "./env";
import { html, raw, type Raw } from "./html";
import { renderMarkdown } from "./markdown";
import type { Provider } from "./oidc";
import { counts, methodsOf, type Letter, type MethodKind, type Signature } from "./store";

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1d1b;--muted:#6b6b66;--line:#e3e0d8;--card:#fff;--accent:#1f4e8c;--ok:#1d7a46;--warn:#9a5b00;--bad:#a12b2b;
--t1:#6b6b66;--t2:#1f4e8c;--t3:#1d7a46;--t4:#7a3fa0}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ecebe6;--muted:#a3a29b;--line:#2e2d2a;--card:#1c1c1a;--accent:#7fb0ff;--ok:#5fd08f;--warn:#e0a64a;--bad:#ff8a8a;
--t1:#a3a29b;--t2:#7fb0ff;--t3:#5fd08f;--t4:#c99bf0}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}header,main,footer{max-width:1100px;margin:0 auto;padding:0 16px}
header{display:flex;justify-content:space-between;align-items:center;padding-top:16px;padding-bottom:16px;border-bottom:1px solid var(--line)}
header a{text-decoration:none;color:var(--fg);font-weight:600}header nav a{font-weight:400;margin-left:16px;color:var(--muted)}
footer{color:var(--muted);font-size:14px;padding-top:32px;padding-bottom:32px}
h1{font-size:clamp(26px,4vw,38px);line-height:1.2;margin:28px 0 12px}h2{font-size:22px;margin:32px 0 12px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:40px;align-items:start}
@media (max-width:860px){.grid{grid-template-columns:1fr}}
.letter{font-size:18px;max-width:70ch}.letter p{margin:0 0 1em}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:20px}
.sticky{position:sticky;top:16px}aside{margin-top:28px}.mobile-only{display:none}
@media (max-width:860px){.mobile-only{display:inline-block}aside{margin-top:0}}
label{display:block;font-size:14px;font-weight:600;margin:12px 0 4px}
input[type=text],input[type=email],textarea,select{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg);font:inherit}
textarea{min-height:90px}.body-edit{min-height:380px;font-family:ui-monospace,monospace;font-size:14px}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400;margin:10px 0}.check input{margin-top:5px}
button,.btn{display:inline-block;background:var(--accent);color:#fff;border:0;border-radius:7px;padding:10px 16px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
@media (prefers-color-scheme:dark){button,.btn{color:#0b1a30}}
button.secondary,.btn.secondary{background:transparent;color:var(--accent);border:1px solid var(--line)}
button.danger{background:var(--bad)}
.muted{color:var(--muted)}.small{font-size:14px}
.stats{display:flex;flex-wrap:wrap;gap:8px 20px;margin:8px 0 16px}.stats b{font-size:22px}
.sigs{list-style:none;padding:0;margin:0}.sigs li{padding:10px 0;border-bottom:1px solid var(--line)}
.badge{display:inline-block;font-size:12px;font-weight:600;border:1px solid currentColor;border-radius:99px;padding:0 8px;margin-left:6px;white-space:nowrap}
.t1{color:var(--t1)}.t2{color:var(--t2)}.t3{color:var(--t3)}.t4{color:var(--t4)}
.flash{border-left:4px solid var(--ok);padding:10px 14px;background:var(--card);margin:16px 0}
.flash.err{border-color:var(--bad)}
table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.filters a{margin-right:12px}
code{font-size:14px}
`;

export const TIER_LABEL: Record<number, string> = {
  1: "E-mail potvrđen",
  2: "Institucijski e-mail",
  3: "Identitet potvrđen",
  4: "Ručno potvrđeno",
};

const METHOD_LABEL: Record<MethodKind, string> = {
  email: "e-mail",
  domain: "institucijska domena",
  orcid: "ORCID",
  certilia: "Certilia (eOsobna)",
  manual: "izravni kontakt",
};

const PROVIDER_LABEL: Record<Provider, string> = { orcid: "ORCID", certilia: "Certilia (eOsobna)" };

export function layout(env: Env, title: string, body: Raw, opts: { head?: Raw; status?: number } = {}): Response {
  const page = html`<!doctype html>
<html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · ${env.SITE_NAME}</title><style>${raw(CSS)}</style>${opts.head ?? ""}</head>
<body><header><a href="/">${env.SITE_NAME}</a><nav><a href="/kako-radi">Kako radi</a><a href="/a">Za organizatore</a></nav></header>
<main>${body}</main>
<footer>Otvoreni kod · <a href="https://github.com/stepanic/otvoreno-pismo">github.com/stepanic/otvoreno-pismo</a> · svaki potpis ulazi u javni lanac hasheva</footer>
</body></html>`;
  return new Response(page.v, {
    status: opts.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy":
        "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; img-src 'self' data:; form-action 'self' https:",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    },
  });
}

export function message(env: Env, title: string, text: Raw | string, status = 200): Response {
  return layout(env, title, html`<h1>${title}</h1><div class="letter"><p>${text}</p><p><a href="/">← Početna</a></p></div>`, { status });
}

function badge(tier: number): Raw {
  return html`<span class="badge t${tier}">${TIER_LABEL[tier] ?? "Neprovjereno"}</span>`;
}

function fmtDate(ms: number | null): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("hr-HR", { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Zagreb" });
}

export function home(env: Env, letters: (Letter & { n: number })[]): Response {
  return layout(
    env,
    "Otvorena pisma",
    html`<h1>Otvorena pisma</h1>
<p class="muted">Potpiši javno ili anonimno. Uz svaki potpis piše kako je provjeren.</p>
${letters.length === 0 ? html`<p>Još nema objavljenih pisama.</p>` : ""}
<ul class="sigs">${letters.map(
      (l) => html`<li><a href="/${l.slug}"><b>${l.title}</b></a><br><span class="muted small">${l.summary}</span>
<div class="small muted">${l.n} potpisa${l.status === "closed" ? " · zatvoreno" : ""}</div></li>`,
    )}</ul>`,
  );
}

export function letterPage(
  env: Env,
  l: Letter,
  sigs: Signature[],
  opts: { filter: number; error?: string; form?: Record<string, string> },
): Response {
  const c = counts(sigs);
  const shown = opts.filter ? sigs.filter((s) => s.tier >= opts.filter) : sigs;
  const f = opts.form ?? {};
  const turnstile = env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET;
  const form =
    l.status !== "published"
      ? html`<div class="card"><b>${l.status === "closed" ? "Potpisivanje je zatvoreno." : "Pismo još nije objavljeno."}</b></div>`
      : html`<form id="potpis" class="card sticky" method="post" action="/${l.slug}/potpisi">
<h2 style="margin-top:0">Potpiši</h2>
${opts.error ? html`<div class="flash err">${opts.error}</div>` : ""}
<label for="name">Ime i prezime</label><input id="name" name="name" type="text" maxlength="120" value="${f.name ?? ""}" autocomplete="name">
<div class="row"><div style="flex:1"><label for="title">Titula</label><input id="title" name="title" type="text" maxlength="60" placeholder="npr. prof. dr. sc." value="${f.title ?? ""}"></div>
<div style="flex:1"><label for="country">Država</label><input id="country" name="country" type="text" maxlength="60" value="${f.country ?? ""}"></div></div>
<label for="affiliation">Ustanova / zanimanje</label><input id="affiliation" name="affiliation" type="text" maxlength="160" value="${f.affiliation ?? ""}">
<label for="email">E-mail <span class="muted small">(ne objavljuje se i ne sprema)</span></label>
<input id="email" name="email" type="email" required maxlength="254" value="${f.email ?? ""}" autocomplete="email">
<label for="comment">Komentar <span class="muted small">(neobavezno, javno)</span></label><textarea id="comment" name="comment" maxlength="500">${f.comment ?? ""}</textarea>
${l.allow_anonymous
          ? html`<label class="check"><input type="checkbox" name="anonymous" value="1" ${f.anonymous ? "checked" : ""}> Potpiši anonimno: ime se ne prikazuje, ali potpis se broji i vidi se kako je provjeren.</label>
<label class="check"><input type="checkbox" name="show_institution" value="1" ${f.show_institution ? "checked" : ""}> Kod anonimnog potpisa prikaži ustanovu prema domeni e-maila.</label>`
          : ""}
<label class="check"><input type="checkbox" name="consent" value="1" required> Potpisujem ovo pismo i slažem se da se podaci iz obrasca (osim e-maila) objave.</label>
${turnstile ? html`<div class="cf-turnstile" data-sitekey="${env.TURNSTILE_SITE_KEY}"></div>` : ""}
<p><button type="submit">Pošalji potvrdu na e-mail</button></p>
<p class="muted small">Dobit ćeš link za potvrdu. Na istoj stranici možeš dodatno potvrditi identitet (ORCID, Certilia) ili povući potpis.</p>
</form>`;

  return layout(
    env,
    l.title,
    html`<div class="grid"><article>
<h1>${l.title}</h1>
<p class="muted small">Objavljeno ${fmtDate(l.published_at)}${l.status === "closed" ? html` · zatvoreno ${fmtDate(l.closed_at)}` : ""}</p>
${l.status === "published" ? html`<p><a class="btn mobile-only" href="#potpis">Potpiši pismo</a></p>` : ""}
<div class="letter">${raw(renderMarkdown(l.body_md))}</div>
<h2 id="potpisi">Potpisi</h2>
<div class="stats"><span><b>${c.total}</b> ukupno</span>${[4, 3, 2, 1].map((t) => html`<span class="t${t}"><b>${c.byTier[String(t)] ?? 0}</b> ${TIER_LABEL[t]?.toLowerCase()}</span>`)}<span><b>${c.anonymous}</b> anonimno</span></div>
<p class="filters small">Prikaži: <a href="/${l.slug}#potpisi">sve</a><a href="/${l.slug}?razina=2#potpisi">institucijski i jače</a><a href="/${l.slug}?razina=3#potpisi">potvrđen identitet i jače</a></p>
<ul class="sigs">${shown.map((s) => sigItem(s))}</ul>
<p class="small muted">Provjerljivo: <a href="/${l.slug}/log.json">lanac hasheva</a> · <a href="/${l.slug}/signatures.json">potpisi (JSON)</a> · <a href="/${l.slug}/signatures.csv">CSV</a> · <a href="/kako-radi">kako provjeriti</a></p>
</article><aside>${form}</aside></div>`,
    { head: turnstile ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : undefined },
  );
}

function sigItem(s: Signature): Raw {
  const methods = [...new Set(methodsOf(s).map((m) => METHOD_LABEL[m.m]))].join(", ");
  const manual = methodsOf(s).find((m) => m.m === "manual")?.note;
  if (s.anonymous) {
    return html`<li><b>Anonimni potpisnik</b>${badge(s.tier)}${s.show_institution && s.institution ? html`<br><span class="small">${s.institution}</span>` : ""}
${s.comment ? html`<br><span class="small">„${s.comment}”</span>` : ""}<br><span class="small muted">${methods}</span></li>`;
  }
  return html`<li><b>${s.title ? `${s.title} ` : ""}${s.name}</b>${badge(s.tier)}
${s.orcid ? html` <a class="small" href="https://orcid.org/${s.orcid}" rel="nofollow">ORCID</a>` : ""}
${s.affiliation || s.country ? html`<br><span class="small">${[s.affiliation, s.country].filter(Boolean).join(", ")}</span>` : ""}
${s.institution ? html`<br><span class="small muted">domena e-maila: ${s.institution}</span>` : ""}
${s.comment ? html`<br><span class="small">„${s.comment}”</span>` : ""}
<br><span class="small muted">${methods}${s.name_source !== "self" ? ` · ime iz izvora: ${METHOD_LABEL[s.name_source as MethodKind] ?? s.name_source}` : ""}${manual ? ` · ${manual}` : ""}</span></li>`;
}

export function checkEmail(env: Env, l: Letter): Response {
  return layout(
    env,
    "Provjeri e-mail",
    html`<h1>Provjeri e-mail</h1><div class="letter"><p>Ako je adresa ispravna, poslali smo ti link za potvrdu potpisa pisma <b>${l.title}</b>.
Potpis se broji tek nakon što otvoriš link i potvrdiš ga.</p><p class="muted">Ako ne vidiš poruku, pogledaj spam. Link vrijedi i za kasnije upravljanje potpisom, pa ga sačuvaj.</p>
<p><a href="/${l.slug}">← Natrag na pismo</a></p></div>`,
  );
}

export function managePage(env: Env, l: Letter, s: Signature, token: string, providers: Provider[], flash?: string): Response {
  const done = new Set(methodsOf(s).map((m) => m.m));
  const statusText: Record<string, string> = {
    pending: "Čeka tvoju potvrdu.",
    active: "Potpis je potvrđen i javno se broji.",
    review: "Potpis je potvrđen i čeka pregled organizatora.",
    withdrawn: "Potpis je povučen.",
    rejected: "Organizator je odbio potpis.",
  };
  const confirmed = s.status === "active" || s.status === "review";
  return layout(
    env,
    "Tvoj potpis",
    html`<h1>Tvoj potpis</h1>
${flash ? html`<div class="flash">${flash}</div>` : ""}
<div class="card" style="max-width:640px">
<p>Pismo: <a href="/${l.slug}"><b>${l.title}</b></a></p>
<p><b>${s.anonymous ? "Anonimni potpis" : `${s.title ? `${s.title} ` : ""}${s.name}`}</b>${s.tier ? badge(s.tier) : ""}<br>
<span class="muted">${statusText[s.status]}</span></p>
${s.status === "pending"
      ? html`<form method="post" action="/m/${token}/potvrdi"><button type="submit">Potvrđujem potpis</button></form>`
      : ""}
${confirmed && providers.length
      ? html`<h2>Pojačaj provjeru</h2><p class="small muted">Neobavezno. Kod javnog potpisa ime se zamjenjuje imenom iz izvora; identifikator se ne objavljuje, osim ORCID-a kod javnog potpisa.</p>
<div class="row">${providers.map((p) =>
          done.has(p)
            ? html`<span class="badge t3">${PROVIDER_LABEL[p]} ✓</span>`
            : html`<form method="post" action="/m/${token}/provjera/${p}"><button class="secondary" type="submit">Potvrdi preko: ${PROVIDER_LABEL[p]}</button></form>`,
        )}</div>`
      : ""}
${s.status === "pending" || confirmed
      ? html`<h2>Povuci potpis</h2><form method="post" action="/m/${token}/povuci"><button class="danger" type="submit">Povuci potpis</button></form>
<p class="small muted">Povlačenje ulazi u javni lanac kao događaj; tvoji podaci nestaju s popisa.</p>`
      : ""}
</div>`,
  );
}

export function loginPage(env: Env, sent = false, error?: string): Response {
  return layout(
    env,
    "Za organizatore",
    html`<h1>Za organizatore</h1>
${sent
      ? html`<div class="flash">Ako je adresa na popisu organizatora, poslali smo link za prijavu (vrijedi 30 minuta).</div>`
      : html`${error ? html`<div class="flash err">${error}</div>` : ""}<form class="card" method="post" action="/login" style="max-width:480px">
<label for="email">E-mail</label><input id="email" name="email" type="email" required>
<p><button type="submit">Pošalji link za prijavu</button></p></form>`}`,
  );
}

export function loginConfirm(env: Env, token: string): Response {
  return layout(
    env,
    "Prijava",
    html`<h1>Prijava</h1><form method="post" action="/login/${token}"><button type="submit">Prijavi me</button></form>`,
  );
}

export function dashboard(env: Env, letters: (Letter & { n: number; r: number })[]): Response {
  return layout(
    env,
    "Moja pisma",
    html`<div class="row" style="justify-content:space-between"><h1>Moja pisma</h1>
<form method="post" action="/logout"><button class="secondary" type="submit">Odjava</button></form></div>
<p><a class="btn" href="/a/novo">Novo pismo</a></p>
<table><tr><th>Pismo</th><th>Stanje</th><th>Potpisi</th><th></th></tr>
${letters.map(
      (l) => html`<tr><td><a href="/${l.slug}">${l.title}</a><br><span class="small muted">/${l.slug}</span></td>
<td>${{ draft: "nacrt", published: "objavljeno", closed: "zatvoreno" }[l.status]}</td>
<td>${l.n}${l.r ? html` <span class="badge t2">${l.r} čeka</span>` : ""}</td>
<td><a href="/a/${l.slug}">Uredi</a> · <a href="/a/${l.slug}/potpisi">Potpisi</a></td></tr>`,
    )}</table>`,
  );
}

export function editLetter(env: Env, l: Letter | null, error?: string, form?: Record<string, string>): Response {
  const v = form ?? (l ? { slug: l.slug, title: l.title, summary: l.summary, body_md: l.body_md } : {});
  const locked = !!l && l.status !== "draft";
  const anon = form ? !!form.allow_anonymous : l ? l.allow_anonymous === 1 : true;
  const mod = form ? !!form.moderation : l ? l.moderation === 1 : false;
  return layout(
    env,
    l ? `Uredi: ${l.title}` : "Novo pismo",
    html`<h1>${l ? "Uredi pismo" : "Novo pismo"}</h1>
${error ? html`<div class="flash err">${error}</div>` : ""}
${locked ? html`<div class="flash">Pismo je objavljeno: naslov i tekst su zaključani (njihov hash je u lancu). Mijenjati se mogu sažetak i postavke.</div>` : ""}
<form method="post" action="${l ? `/a/${l.slug}` : "/a/novo"}">
<label for="slug">Adresa</label><input id="slug" name="slug" type="text" value="${v.slug ?? ""}" ${l ? "disabled" : "required"} placeholder="npr. pismo-o-superinteligenciji">
<label for="title">Naslov</label><input id="title" name="title" type="text" value="${v.title ?? ""}" ${locked ? "disabled" : "required"}>
<label for="summary">Sažetak (za popis pisama)</label><input id="summary" name="summary" type="text" value="${v.summary ?? ""}">
<label for="body_md">Tekst (Markdown)</label><textarea class="body-edit" id="body_md" name="body_md" ${locked ? "disabled" : "required"}>${v.body_md ?? ""}</textarea>
<label class="check"><input type="checkbox" name="allow_anonymous" value="1" ${anon ? "checked" : ""}> Dopusti anonimne potpise</label>
<label class="check"><input type="checkbox" name="moderation" value="1" ${mod ? "checked" : ""}> Potpisi čekaju moje odobrenje prije objave</label>
<p class="row"><button type="submit">Spremi</button></p></form>
${l && l.status === "draft"
      ? html`<form method="post" action="/a/${l.slug}/objavi"><p><button type="submit">Objavi pismo</button> <span class="small muted">Nakon objave tekst se više ne može mijenjati.</span></p></form>`
      : ""}
${l && l.status === "published" ? html`<form method="post" action="/a/${l.slug}/zatvori"><p><button class="danger" type="submit">Zatvori potpisivanje</button></p></form>` : ""}`,
  );
}

export function moderation(env: Env, l: Letter, sigs: Signature[]): Response {
  return layout(
    env,
    `Potpisi: ${l.title}`,
    html`<h1>Potpisi</h1><p><a href="/a">← Moja pisma</a> · <a href="/${l.slug}">${l.title}</a></p>
<table><tr><th>Potpisnik</th><th>Provjera</th><th>Akcije</th></tr>
${sigs.map(
      (s) => html`<tr><td><b>${s.title ? `${s.title} ` : ""}${s.name}</b>${s.anonymous ? html` <span class="badge t1">anonimno</span>` : ""}<br>
<span class="small">${[s.affiliation, s.country].filter(Boolean).join(", ")}</span><br><span class="small muted">@${s.email_domain} · ${s.public_id}</span></td>
<td>${badge(s.tier)}<br><span class="small muted">${s.status === "review" ? "čeka odobrenje" : "objavljen"}</span></td>
<td><div class="row">
${s.status === "review" ? html`<form method="post" action="/a/${l.slug}/potpisi/${s.public_id}/odobri"><button type="submit">Odobri</button></form>` : ""}
<form method="post" action="/a/${l.slug}/potpisi/${s.public_id}/rucno"><input type="text" name="note" placeholder="bilješka (javna)" style="width:160px"> <button class="secondary" type="submit">Ručno potvrdi</button></form>
<form method="post" action="/a/${l.slug}/potpisi/${s.public_id}/odbij"><input type="text" name="note" placeholder="razlog (interno)" style="width:140px"> <button class="danger" type="submit">Odbij</button></form>
</div></td></tr>`,
    )}</table>`,
  );
}

export function howItWorks(env: Env): Response {
  return layout(
    env,
    "Kako radi",
    html`<h1>Kako radi</h1><div class="letter">
<h2>Razine provjere</h2>
<ol>
<li><b>${TIER_LABEL[1]}</b>: potpisnik je otvorio link poslan na e-mail i potvrdio potpis. Jedan e-mail, jedan potpis.</li>
<li><b>${TIER_LABEL[2]}</b>: e-mail je s domene sveučilišta, instituta ili javne ustanove s javnog popisa.</li>
<li><b>${TIER_LABEL[3]}</b>: potpisnik se prijavio ORCID-om ili Certilijom (hrvatska eOsobna). Jedan identitet može potpisati samo jednom.</li>
<li><b>${TIER_LABEL[4]}</b>: organizator je potpis potvrdio izravnim kontaktom.</li>
</ol>
<p>Nijedan način provjere nije obavezan. Brojke po razinama su odvojene, pa svatko može procijeniti koliko je potpisa provjereno i kako.</p>
<h2>Što se sprema</h2>
<p>E-mail se ne sprema: čuva se samo njegov HMAC (za sprječavanje dvostrukog potpisa) i domena. Isto vrijedi za OIB i ORCID. Kod anonimnog potpisa ime se ne objavljuje; operater zna samo HMAC e-maila.</p>
<h2>Kako provjeriti da nitko nije mijenjao potpise</h2>
<p>Svako pismo ima javni lanac hasheva (<code>/&lt;pismo&gt;/log.json</code>). Svaka karika je <code>sha256(prev_hash|seq|događaj)</code>; događaji su objava pisma (s hashom teksta), potpis, promjena provjere, povlačenje, odbijanje i zatvaranje. Potpis u lancu je hash javnog zapisa sa solju, pa povučeni potpis nestaje s popisa, a lanac ostaje cijel.</p>
<p>Neovisna provjera: <code>node scripts/verify-log.mjs https://…/&lt;pismo&gt;</code> iz repozitorija. Skripta provjerava lanac, tekst pisma i da se objavljeni popis potpisa točno slaže s lancem. Vrh lanca se može sidriti u Bitcoin preko OpenTimestampsa (<code>scripts/checkpoint.sh</code>).</p>
</div>`,
  );
}
