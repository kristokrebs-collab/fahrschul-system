/**
 * Every page of the standalone site, as HTML.
 *
 * Each function returns a full document body; `shell()` wraps it with the
 * inlined stylesheet, fonts and runtime. Content comes from the shared
 * TypeScript layer via `ctx`, so the facts here are the same facts the
 * Next.js site publishes — including the truth gate, which still withholds
 * anything unverified.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

/* ── Chrome ─────────────────────────────────────────────────────────── */

function head(ctx, { title, description }) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="theme-color" content="#12171e">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="icon" href="${ctx.dataUri('src/app/icon.svg')}">
<style>${ctx.fontFaces}${ctx.css}</style>`
}

function header(ctx, active) {
  const nav = [
    ['fuehrerschein.html', 'Führerschein'],
    ['leistungen.html', 'Beruf & Seminare'],
    ['ausbildungsablauf.html', 'Ablauf'],
    ['digitalpaket.html', 'Digitalpaket'],
    ['simulator.html', 'Simulator'],
    ['preise.html', 'Preise'],
    ['standorte-fulda.html', 'Standorte'],
  ]
  const phone = ctx.pv(ctx.business.locations[0].phone)
  const href = ctx.pv(ctx.business.locations[0].phoneHref)
  return `<header class="hdr"><div class="shell">
  <a class="brand" href="index.html" aria-label="Fahrschule Krebs — Startseite">
    <b>KREBS</b><span class="bars"><i></i><i></i></span>
    <span><small>Fahrschule</small><small>Verkehrsbildungszentrum</small></span>
  </a>
  <nav class="nav" aria-label="Hauptnavigation">
    ${nav.map(([h, l]) => `<a href="${h}"${active === h ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}
  </nav>
  ${phone && href ? `<a class="tel" href="tel:${esc(href)}">${esc(phone)}</a>` : ''}
  <a class="btn btn-primary shine cta" href="kontakt.html" style="min-height:2.6rem;padding:0 1.1rem;font-size:.9rem">Beratung starten</a>
  <button class="burger" type="button" aria-expanded="false" aria-controls="mnav" aria-label="Menü öffnen"><span></span></button>
</div></header>
<div class="mnav" id="mnav">${nav.map(([h, l]) => `<a href="${h}">${esc(l)}</a>`).join('')}
  <a href="team.html">Team</a><a href="kontakt.html">Kontakt</a>
  ${phone && href ? `<a href="tel:${esc(href)}" style="color:var(--signal-400)">${esc(phone)} anrufen</a>` : ''}
</div>`
}

function footer(ctx) {
  const cols = [
    ['Führerschein', [['fuehrerschein-klasse-b.html', 'Klasse B'], ['fuehrerschein-bf17.html', 'Begleitetes Fahren ab 17'], ['fuehrerschein-be.html', 'Anhänger BE'], ['fuehrerschein-a.html', 'Motorrad A'], ['fuehrerschein-ce.html', 'LKW CE'], ['fuehrerschein-d.html', 'Bus D'], ['fuehrerschein.html', 'Alle Klassen']]],
    ['Beruf & Seminare', [['leistungen-berufskraftfahrer.html', 'Berufskraftfahrer'], ['leistungen-adr.html', 'Gefahrgut ADR'], ['leistungen-staplerschein.html', 'Staplerschein'], ['leistungen-asf.html', 'ASF-Seminar'], ['leistungen-handicap.html', 'Handicap-Ausbildung'], ['leistungen.html', 'Alle Leistungen']]],
    ['Fahrschule', [['ausbildungsablauf.html', 'Ausbildungsablauf'], ['digitalpaket.html', 'Digitalpaket'], ['schueler-cockpit.html', 'Schüler-Cockpit'], ['simulator.html', 'Simulator'], ['preise.html', 'Preise'], ['team.html', 'Team'], ['kontakt.html', 'Kontakt']]],
  ]
  return `<footer class="ftr"><div class="shell">
  <div class="ftr-grid">
    <div class="ftr-col">
      <a class="brand" href="index.html"><b>KREBS</b><span class="bars"><i></i><i></i></span>
        <span><small>Fahrschule</small><small>Verkehrsbildungszentrum</small></span></a>
      <p style="margin-top:1.1rem;font-size:.88rem;color:var(--chalk-dim);max-width:24rem">
        Familienbetrieb seit ${esc(ctx.pv(ctx.business.founded))} — inzwischen ${ctx.business.yearsInBusiness()} Jahre
        Fahrausbildung in Fulda und Bad Hersfeld, in zweiter Generation.</p>
      <a class="btn btn-primary shine" href="kontakt.html" style="margin-top:1.3rem">Beratung starten</a>
    </div>
    ${cols.map(([t, items]) => `<div class="ftr-col"><h4>${esc(t)}</h4><ul>${items.map(([h, l]) => `<li><a href="${h}">${esc(l)}</a></li>`).join('')}</ul></div>`).join('')}
  </div>
  <div class="grid g2" style="margin-top:3rem;padding-top:2rem;border-top:1px solid rgb(255 255 255/.09)">
    ${ctx.business.locations.map((l) => {
      const street = ctx.pv(l.street), postal = ctx.pv(l.postalCode)
      const phone = ctx.pv(l.phone), href = ctx.pv(l.phoneHref), mail = ctx.pv(l.email)
      return `<div><h3 style="font-size:1.05rem">${esc(l.name)}</h3>
        <address style="margin-top:.6rem;font-style:normal;font-size:.88rem;color:var(--chalk-dim);line-height:1.75">
        ${street && postal ? `${esc(street)}<br>${esc(postal)} ${esc(l.city)}<br>` : ''}
        ${phone && href ? `<a href="tel:${esc(href)}" style="text-decoration:none">${esc(phone)}</a><br>` : ''}
        ${mail ? `<a href="mailto:${esc(mail)}" style="text-decoration:none">${esc(mail)}</a>` : ''}
        </address></div>`
    }).join('')}
  </div>
  <p style="margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid rgb(255 255 255/.09);font-size:.8rem;color:var(--chalk-faint);display:flex;flex-wrap:wrap;gap:1.2rem;justify-content:space-between">
    <span>© ${new Date().getFullYear()} ${esc(ctx.business.business.legalName)}</span>
    <span><a href="impressum.html" style="text-decoration:none">Impressum</a> · <a href="datenschutz.html" style="text-decoration:none">Datenschutz</a></span>
  </p>
</div></footer>`
}

function shell(ctx, { title, description, active, body, jsonLd }) {
  return `<!doctype html>
<html lang="de">
<head>${head(ctx, { title, description })}</head>
<body>
<a href="#inhalt" class="btn btn-primary" style="position:fixed;left:1rem;top:1rem;z-index:100;transform:translateY(-200%);transition:transform .2s" onfocus="this.style.transform='none'" onblur="this.style.transform='translateY(-200%)'">Zum Inhalt springen</a>
<div class="sky" aria-hidden="true"></div>
<canvas id="route" aria-hidden="true"></canvas>
${header(ctx, active)}
<main id="inhalt">${body}</main>
${footer(ctx)}
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ''}
<script>window.KREBS=${JSON.stringify(ctx.clientData)};
KREBS.finder.recommend=${recommendSource(ctx)};
KREBS.referenceLabel=function(slug){
  var c=KREBS.classes.filter(function(x){return x.slug===slug})[0];
  if(c) return {label:c.name,topic:/^(c|ce|c1|c1e|d|de)$/.test(c.slug)?'beruf':'fuehrerschein'};
  var s=KREBS.services.filter(function(x){return x.slug===slug})[0];
  if(s) return {label:s.name,topic:({beruf:'beruf',logistik:'seminar',seminare:'seminar',spezial:'sonstiges'})[s.group]||'sonstiges'};
  return null;
};</script>
<script>${ctx.js}</script>
</body></html>`
}

/**
 * The finder's scoring, shipped to the client.
 *
 * Re-expressed rather than imported: the TypeScript version returns rich
 * objects the page does not need, and a 40-line pure function is cheaper to
 * inline than a module system. The questions and the classes both still come
 * from the shared content layer, so only the arithmetic lives here.
 */
function recommendSource(ctx) {
  const table = ctx.classes.licenceClasses.map((c) => ({
    slug: c.slug, code: c.code, name: c.name, summary: c.summary,
    category: c.category,
    minAge: ctx.pv(c.minAge) ?? null,
    prerequisites: c.prerequisites,
    automatic: c.slug === 'automatik' || c.slug === 'b197',
  }))
  return `(function(TBL){return function(a){
  var out=[];
  TBL.forEach(function(c){
    var s=0,why=[];
    if(a.vehicle==='auto'&&c.category==='pkw'){s+=5}
    if(a.vehicle==='motorrad'&&c.category==='zweirad'){s+=5}
    if(a.vehicle==='roller'&&(c.slug==='am'||c.slug==='mofa')){s+=6;why.push('Für Roller und Mofa bis 45 km/h.')}
    if(a.vehicle==='anhaenger'&&(c.slug==='be'||c.slug==='b96')){s+=6;why.push('Zieht schwere Anhänger.')}
    if(a.vehicle==='lkw'&&c.category==='lkw'){s+=6}
    if(a.vehicle==='bus'&&c.category==='bus'){s+=6}
    if(a.age==='u17'&&c.minAge&&/1[5-6]/.test(c.minAge)){s+=3;why.push('Schon vor dem 17. Geburtstag möglich.')}
    if(a.age==='17'&&c.slug==='bf17'){s+=7;why.push('Mit 17 fahren, begleitet — genau dafür gemacht.')}
    if(a.age==='18plus'&&c.slug==='bf17'){s-=6}
    if(a.gear==='automatik'&&c.slug==='b197'){s+=6;why.push('Automatik lernen, Schaltung trotzdem fahren dürfen.')}
    if(a.gear==='automatik'&&c.slug==='automatik'){s+=4;why.push('Reine Automatikausbildung.')}
    if(a.gear==='schaltung'&&c.slug==='klasse-b'){s+=4}
    if(a.beruf==='ja'&&(c.category==='lkw'||c.category==='bus')){s+=3;why.push('Grundlage für den Beruf am Steuer.')}
    if(a.tempo==='schnell'&&c.slug==='klasse-b'){s+=1}
    if(s>0) out.push({slug:c.slug,name:c.name,summary:c.summary,minAge:c.minAge,
      prerequisites:c.prerequisites,reasons:why,href:'fuehrerschein-'+c.slug+'.html',score:s});
  });
  out.sort(function(x,y){return y.score-x.score});
  return out;
}})(${JSON.stringify(table)})`
}

/* ── Reusable blocks ────────────────────────────────────────────────── */

function chapterHead(marker, title, lead, id) {
  const short = String(title).trim().split(/\s+/).length <= 4
  return `<header style="max-width:52rem">
    <p class="eyebrow">${esc(marker)}</p>
    <h2 class="h-chapter" id="${id}"${short ? ' data-rw' : ''}>${esc(title)}</h2>
    ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
  </header>`
}

function video(ctx, name, { poster = true, cls = '', attrs = '' } = {}) {
  const src = ctx.dataUri(`/media/video/${name}-720.webm`)
  const post = poster ? ctx.dataUri(`/media/poster/${name}.jpg`) : ''
  if (!src) return ''
  return `<video muted loop playsinline preload="none" ${post ? `poster="${post}"` : ''} data-src="${src}" class="${cls}" ${attrs} tabindex="-1" aria-hidden="true"></video>`
}

function figureVideo(ctx, name, caption) {
  const v = video(ctx, name)
  if (!v) return ''
  return `<figure class="figure">${v}<figcaption>${esc(caption)}</figcaption></figure>`
}

function bgVideo(ctx, name) {
  const v = video(ctx, name)
  return v ? `<div class="bgvid" aria-hidden="true">${v}</div>` : ''
}

/* ── Pages ──────────────────────────────────────────────────────────── */

export function page(ctx, OUT) {
  const files = []
  const emit = (name, html) => {
    writeFileSync(join(OUT, name), html)
    files.push(name)
    process.stdout.write('.')
  }

  emit('index.html', home(ctx))
  emit('fuehrerschein.html', licenceIndex(ctx))
  for (const c of ctx.classes.licenceClasses) emit(`fuehrerschein-${c.slug}.html`, licencePage(ctx, c))
  emit('leistungen.html', serviceIndex(ctx))
  for (const s of ctx.services.services) emit(`leistungen-${s.slug}.html`, servicePage(ctx, s))
  for (const l of ctx.business.locations) emit(`standorte-${l.slug}.html`, locationPage(ctx, l))
  emit('simulator.html', simulatorPage(ctx))
  emit('digitalpaket.html', digitalPage(ctx))
  emit('schueler-cockpit.html', cockpitPage(ctx))
  emit('preise.html', pricesPage(ctx))
  emit('ausbildungsablauf.html', guidePage(ctx))
  emit('team.html', teamPage(ctx))
  emit('kontakt.html', contactPage(ctx))
  emit('impressum.html', legalPage(ctx, 'impressum'))
  emit('datenschutz.html', legalPage(ctx, 'datenschutz'))
  return files
}

/* — Homepage — */
function home(ctx) {
  const b = ctx.business
  const founded = ctx.pv(b.business.founded)
  const cities = b.locations.map((l) => l.name).join(' und ')
  const nClasses = ctx.classes.licenceClasses.length

  const body = `
<section class="hero" data-atmo>
  <div class="hero-media">${video(ctx, 'hero-filament')}</div>
  <div class="haze" aria-hidden="true"></div>
  <div class="hero-scrim" aria-hidden="true"></div>
  <div class="shell hero-body">
    <p class="eyebrow">Fahrschule in ${esc(cities)} · seit ${esc(founded)}</p>
    <h1 class="h-hero">Alle Klassen.<br>Zwei Standorte.<br><span class="red outlier" data-text="Ein Weg.">Ein Weg.</span></h1>
    <p class="lead" style="max-width:52ch">Vom Roller bis zum Bus bilden wir in jeder Führerscheinklasse aus — mit
      Simulatortraining, mehreren Theorieterminen pro Tag und einem Ablauf, der von Anfang an nachvollziehbar ist.</p>
    <div style="display:flex;flex-wrap:wrap;gap:.8rem;margin-top:2.2rem">
      <span data-magnet style="display:inline-flex"><a class="btn btn-primary shine" href="#finder">Führerschein finden</a></span>
      <a class="btn btn-ghost" href="kontakt.html">Beratung starten</a>
      <a class="btn btn-quiet" href="ausbildungsablauf.html">So läuft die Ausbildung ab</a>
    </div>
    <dl class="stats">
      <div><dt class="sr">Führerscheinklassen</dt><dd><b class="tabular">${nClasses}</b><span>Führerscheinklassen</span></dd></div>
      <div><dt class="sr">Standorte</dt><dd><b class="tabular">${b.locations.length}</b><span>Standorte in ${esc(cities)}</span></dd></div>
      <div><dt class="sr">Jahre</dt><dd><b class="tabular">${b.yearsInBusiness()}</b><span>Jahre Fahrausbildung</span></dd></div>
      <div><dt class="sr">Generation</dt><dd><b>2.</b><span>Generation im Familienbetrieb</span></dd></div>
    </dl>
  </div>
</section>

<!-- Class codes as a moving index: information, not decoration -->
<div class="shell" style="padding:2.5rem 0"><div class="slider" aria-hidden="true"><div class="slider-row">
  ${[0, 1].map(() => ctx.classes.licenceClasses.map((c) => `<a href="fuehrerschein-${c.slug}.html" tabindex="-1"><b>${esc(c.code)}</b><span>${esc(c.tagline)}</span></a>`).join('')).join('')}
</div></div></div>

<section class="chapter" data-atmo id="finder">
  <canvas class="ripple" aria-hidden="true"></canvas>
  <div class="shell">
    <div class="grid" style="grid-template-columns:1fr;gap:2.5rem">
      ${chapterHead('Kapitel 02 — Entscheiden', 'Welche Klasse passt zu dir?', 'Sechs kurze Fragen. Danach weißt du, welche Klasse infrage kommt, was du dafür brauchst und was der nächste Schritt ist.', 'finder-h')}
      <div class="finder"><div class="finder-bar"><i style="width:4%"></i></div>
        <div class="finder-in" data-finder-body tabindex="-1"></div></div>
    </div>
  </div>
</section>

<section class="chapter" data-atmo>
  <div class="atmo-lanes" aria-hidden="true"></div>
  <div class="shell">
    ${chapterHead('Kapitel 03 — Klassen', 'Vom Roller bis zum Sattelzug', 'Wir bilden in jeder Fahrerlaubnisklasse aus — auf eigenen Fahrzeugen, mit eigenen LKW und einem eigenen Bus. Wähle die Spur, die dich interessiert.', 'klassen-h')}
    <div style="margin-top:2.5rem">${figureVideo(ctx, 'turntable-stops-12s', 'Studio-Inszenierung — Pkw, Motorrad, Sattelzugmaschine, Bus')}</div>
    ${lanes(ctx)}
  </div>
</section>

<section class="chapter" data-atmo>
  <div class="shell">
    ${chapterHead('Kapitel 04 — Das System', 'Ein Ablauf, der zusammenpasst', 'Theorie, Simulator und Praxis sind bei uns keine getrennten Baustellen. Sie greifen ineinander — und du siehst an jedem Punkt, wo du stehst.', 'system-h')}
    <div class="grid g3 rv" style="margin-top:2.5rem" data-spot>
      ${['Theorie mit System|Mehrere Themen pro Tag statt einer Chance pro Woche|In Fulda laufen von Montag bis Donnerstag drei verschiedene Theoriethemen pro Tag, dazu eigene Termine für LKW und Motorrad.',
        'Simulatortraining|Erst üben, dann in den Verkehr|Im Fahrsimulator lernst du Bedienung, Blickführung und Abläufe, bevor du zum ersten Mal im echten Verkehr fährst.',
        'Ferienfahrschule|Der Führerschein am Stück|Ein strukturierter Intensivkurs in Theorie und Praxis — und weil wir nicht an Schulferien gebunden sind, geht er das ganze Jahr.'
      ].map((t, i) => { const [h, s, p] = t.split('|'); return `<article class="card spot orbit"><div class="eyebrow" style="font-size:.62rem">0${i + 1}</div>
        <h3 style="font-size:1.15rem;margin-top:.9rem">${esc(h)}</h3>
        <p style="margin-top:.45rem;font-size:.9rem;font-weight:650;color:var(--signal-400)">${esc(s)}</p>
        <p style="margin-top:.7rem;font-size:.9rem;color:var(--chalk-dim)">${esc(p)}</p></article>` }).join('')}
    </div>
  </div>
</section>

${cockpitSection()}

<section class="chapter" data-atmo>
  <div class="shell">
    <div class="grid" style="gap:2.5rem">
      ${chapterHead('Kapitel 06 — Simulator', 'Erst üben. Dann in den Verkehr.', 'Die ersten Fahrstunden sind die teuersten Minuten der Ausbildung — weil so viel gleichzeitig neu ist. Im Simulator nimmst du einen Teil davon vorweg, in deinem Tempo und ohne Zuschauer.', 'simulator-h')}
      <div class="carousel" data-carousel>
        <div class="carousel-track">
          ${[['Bedienung ohne Verkehr', 'Anfahren, Schalten, Lenken und Blickführung zuerst in Ruhe — ohne dass hinter dir jemand wartet.'],
            ['Situationen wiederholen', 'Eine Kreuzung, die nicht sitzt, lässt sich zehnmal fahren. Im echten Verkehr kommt sie einmal.'],
            ['Fehler ohne Folgen', 'Was schiefgeht, kostet hier nichts außer einem Neustart. Genau das nimmt den Druck raus.'],
            ['Sicherer in die erste Fahrstunde', 'Wer die Abläufe schon kennt, kann sich vom ersten Meter an auf den Verkehr konzentrieren.']
          ].map(([h, p]) => `<div><h3 style="font-size:1.4rem">${esc(h)}</h3><p style="margin-top:.8rem;color:var(--chalk-dim);max-width:44ch">${esc(p)}</p></div>`).join('')}
        </div>
        <div class="carousel-nav" role="tablist" aria-label="Simulator-Situationen"></div>
      </div>
      ${figureVideo(ctx, 'sim-orbit', 'Studio-Inszenierung eines Simulatorplatzes mit drei Bildschirmen')}
      <p class="note">Das Simulatortraining ergänzt die praktische Ausbildung — es ersetzt keine der gesetzlich vorgeschriebenen Fahrstunden. Welche Einheiten für deine Klasse sinnvoll sind, besprechen wir bei der Anmeldung.</p>
      <div><a class="btn btn-primary shine" href="simulator.html">Simulator kennenlernen</a></div>
    </div>
  </div>
</section>

<section class="chapter day dawn" data-atmo id="rechner">
  <div class="shell">
    ${chapterHead('Kapitel 07 — Kosten', 'Angebote ehrlich vergleichen', 'Zwei Fahrschulen mit unterschiedlichen Fahrstundenzahlen zu vergleichen führt fast immer in die Irre. Dieser Rechner legt beide Angebote auf dieselben Mengen um.', 'preise-h')}
    ${calculator(ctx)}
  </div>
</section>

<section class="chapter day" data-atmo>
  <div class="shell">
    ${chapterHead('Kapitel 08 — Dein Weg', 'Was du brauchst, und wann', 'Der Führerschein ist kein Behördenlabyrinth, wenn man die Reihenfolge kennt. Hier ist sie — mit dem Hinweis, wer jeweils am Zug ist.', 'weg-h')}
    ${beam(ctx)}
  </div>
</section>

<section class="chapter day" data-atmo>
  <div class="shell">
    ${chapterHead('Kapitel 09 — Beruf & Spezial', 'Mehr als ein Führerschein', 'Ein großer Teil unserer Arbeit beginnt erst, wenn der Führerschein längst da ist: Qualifikationen für den Beruf, Schulungen für Betriebe, Seminare nach Auffälligkeiten — und eine Ausbildung, die sich nach dem Menschen richtet.', 'leistungen-h')}
    ${curatedServices(ctx)}
  </div>
</section>

<section class="chapter day" data-atmo>
  <div class="shell">
    ${chapterHead('Kapitel 10 — Menschen & Orte', 'Zwei Bahnhöfe, ein Betrieb', 'Beide Standorte liegen direkt am Bahnhof — das ist kein Zufall, sondern der Grund, warum du ohne Auto zur Fahrschule kommst.', 'orte-h')}
    ${milestones(ctx)}
    <div class="grid g2" style="margin-top:1.2rem">
      ${ctx.business.locations.map((l) => locationCard(ctx, l)).join('')}
    </div>
    ${teamStrip(ctx)}
  </div>
</section>

<!-- Ankommen: the daylight arc ends on real daylight, not on a dark card -->
<section class="chapter day arrive" data-atmo style="text-align:center">
  <div class="arrive-film" aria-hidden="true">${video(ctx, 'day-road')}</div>
  <div class="shell arrive-body">
    <div class="arrive-card">
      <p class="eyebrow" style="justify-content:center">Letztes Kapitel — Ankommen</p>
      <h2 class="h-chapter" style="max-width:18ch;margin-inline:auto">Der erste Schritt ist der kleinste.</h2>
      <p class="lead" style="margin-inline:auto;text-align:center">Du musst dich heute noch nicht festlegen. Finde heraus, welche Klasse passt — oder frag uns einfach, was du wissen willst.</p>
      <div style="display:flex;flex-wrap:wrap;gap:.8rem;justify-content:center;margin-top:2rem">
        <span data-magnet style="display:inline-flex"><a class="btn btn-primary shine" href="#finder">Führerschein finden</a></span>
        <a class="btn btn-ghost" href="kontakt.html">Beratung starten</a>
      </div>
      <p style="margin-top:2.5rem;display:flex;gap:2rem;justify-content:center;flex-wrap:wrap;font-size:.9rem;color:var(--chalk-dim)">
        ${ctx.business.locations.map((l) => { const p = ctx.pv(l.phone), h = ctx.pv(l.phoneHref)
          return p && h ? `<span>${esc(l.name)} <a class="tabular" href="tel:${esc(h)}" style="font-weight:700;text-decoration:none">${esc(p)}</a></span>` : '' }).join('')}
      </p>
    </div>
  </div>
</section>
<div class="rail" aria-label="Kapitel"></div>`

  return shell(ctx, {
    title: `${ctx.business.business.legalName} — Fahrschule in Fulda und Bad Hersfeld`,
    description: 'Fahrschule Krebs bildet in Fulda und Bad Hersfeld in allen Führerscheinklassen aus — vom Roller bis zum Bus. Mit Simulatortraining, digitalem Schüler-Cockpit und einem nachvollziehbaren Ablauf.',
    active: 'index.html',
    body,
    jsonLd: organizationJsonLd(ctx),
  })
}

/* — Blocks used by the homepage — */

function lanes(ctx) {
  const cats = ctx.classes.classCategoryOrder.filter((c) => ctx.classes.classesByCategory(c).length)
  const IMG = { pkw: '/vehicles/pkw-1600.avif', zweirad: '/vehicles/motorrad-1600.avif', lkw: '/vehicles/lkw-1600.avif', bus: '/vehicles/bus-1600.avif', spezial: null }
  return `<div style="margin-top:2.2rem" data-tabs>
  <div class="tabs" role="tablist" aria-label="Fahrzeugarten"><span class="ind" aria-hidden="true"></span>
    ${cats.map((c) => `<button class="tab" type="button" role="tab" data-tab="${c}" aria-controls="panel-${c}" aria-selected="false">${esc(ctx.classes.categories[c].label)}</button>`).join('')}
  </div>
  ${cats.map((c) => {
    const list = ctx.classes.classesByCategory(c)
    const img = IMG[c] ? ctx.dataUri(IMG[c]) : ''
    return `<div id="panel-${c}" role="tabpanel" hidden style="margin-top:1.8rem;outline-offset:6px" tabindex="0">
      ${img ? `<figure class="figure loupe" style="margin-bottom:1.6rem"><img src="${img}" alt="${esc(ctx.classes.categories[c].label)} — Studio-Darstellung" loading="lazy"><span class="lens" aria-hidden="true"></span><figcaption>Studio-Darstellung</figcaption></figure>` : ''}
      <p style="color:var(--chalk-dim);max-width:48rem">${esc(ctx.classes.categories[c].blurb)}</p>
      <div class="grid g3" style="margin-top:1.6rem" data-spot>
        ${list.map((k, i) => {
          const sf = ctx.pv(k.sonderfahrten), th = ctx.pv(k.theory), age = ctx.pv(k.minAge)
          return `<a class="card spot orbit" href="fuehrerschein-${k.slug}.html" style="text-decoration:none;display:flex;flex-direction:column">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <b style="font-family:var(--font-display);font-size:1.5rem">${esc(k.code)}</b>
              <span class="tabular" style="font-size:.68rem;font-weight:700;color:var(--chalk-faint)">${String(i + 1).padStart(2, '0')}</span></div>
            <p style="margin-top:.7rem;font-size:.9rem;font-weight:650;color:var(--signal-400)">${esc(k.tagline)}</p>
            <p style="margin-top:.5rem;font-size:.88rem;color:var(--chalk-dim)">${esc(k.summary.slice(0, 120))}${k.summary.length > 120 ? '…' : ''}</p>
            <dl style="margin-top:1.1rem;padding-top:.9rem;border-top:1px solid rgb(255 255 255/.09);display:flex;gap:1.4rem;flex-wrap:wrap;font-size:.76rem">
              ${age ? `<div><dt style="color:var(--chalk-faint)">Ab</dt><dd class="tabular" style="font-weight:650;margin-top:.15rem">${esc(age)}</dd></div>` : ''}
              ${th ? `<div><dt style="color:var(--chalk-faint)">Theorie</dt><dd class="tabular" style="font-weight:650;margin-top:.15rem">${th.grundstoff + th.zusatzstoff} DS</dd></div>` : ''}
              ${sf ? `<div><dt style="color:var(--chalk-faint)">Sonderfahrten</dt><dd class="tabular" style="font-weight:650;margin-top:.15rem">${ctx.classes.sonderfahrtenTotal(sf)}</dd></div>` : ''}
            </dl></a>`
        }).join('')}
      </div></div>`
  }).join('')}</div>`
}

function cockpitSection() {
  return `<section class="chapter cockpit" data-atmo style="padding-bottom:0">
  <div class="shell">
    ${chapterHead('Kapitel 05 — Cockpit', 'Dein Stand, jederzeit einsehbar', 'Wir bauen gerade ein digitales Cockpit für unsere Fahrschülerinnen und Fahrschüler. So wird es aussehen — die Ansicht zeigt Beispieldaten.', 'cockpit-h')}
  </div>
  <div style="height:340vh;position:relative">
    <div class="cockpit-stage shell">
      <div>
        <p class="eyebrow">Live-Demo — mit Beispieldaten</p>
        <h3 style="font-size:clamp(1.5rem,3vw,2.2rem);margin-top:1rem;max-width:18ch">Scroll, und die App bewegt sich mit</h3>
        <p style="margin-top:1rem;color:var(--chalk-dim);max-width:38ch">Theorie, Simulator, Fahrstunden, Bewertung, Protokoll — das Cockpit verbindet sie zu einem Weg. Deinem Weg zur Prüfung.</p>
        <ul style="margin-top:1.4rem;list-style:none;display:grid;gap:.6rem;font-size:.92rem">
          ${['Ein Stand statt fünf Zettel', 'Nächster Schritt immer sichtbar', 'Vom ersten Tag bis zur Prüfung'].map((t) =>
            `<li style="display:flex;gap:.6rem;color:var(--chalk-soft)"><span style="flex:none;margin-top:.6rem;width:.8rem;height:.2rem;border-radius:1px;background:var(--signal)"></span>${esc(t)}</li>`).join('')}
        </ul>
        <div class="scenes" style="justify-content:flex-start">${[0, 1, 2, 3, 4].map(() => '<i></i>').join('')}</div>
        <p style="margin-top:1.5rem;font-size:.78rem;color:var(--chalk-faint)">Demo mit Beispieldaten — nachgebaut aus der echten Cockpit-App.</p>
      </div>
      <div class="phone"><div class="phone-notch"></div><div class="phone-screen"><div class="phone-scroll">
        <div class="appsec"><p class="applabel">Ebene A — Erst-Erwerb</p>
          <h4 style="font-size:1.15rem;margin-top:.4rem">Hallo, Michael.</h4>
          <p style="font-size:.78rem;color:#a9a3b5;margin-top:.2rem">Klasse B · Fahrlehrer Herr Schäfer</p>
          <div class="appcard"><b style="font-size:.8rem">Theorie</b>
            <div style="display:flex;justify-content:space-between;font-size:.72rem;color:#a9a3b5;margin-top:.3rem">
              <span>Grundstoff & Zusatzstoff</span><span><b data-count="11" data-from="0" style="color:#fff">0</b> / 14</span></div>
            <div class="appbar"><i style="width:79%"></i></div></div>
          <div class="appcard"><b style="font-size:.8rem">Sonderfahrten</b>
            ${[['Überland', 3, 5], ['Autobahn', 2, 4], ['Nacht', 0, 3]].map(([l, a, b2]) =>
              `<div style="display:flex;justify-content:space-between;font-size:.72rem;color:#a9a3b5;margin-top:.45rem"><span>${l}</span><span class="tabular">${a} / ${b2}</span></div>
               <div class="appbar" style="height:.28rem"><i style="width:${(a / b2) * 100}%"></i></div>`).join('')}
          </div>
        </div>
        <div class="appsec"><p class="applabel">Fahrstil — nach jeder Fahrstunde</p>
          <h4 style="font-size:1.05rem;margin-top:.3rem">Bewertung des Fahrlehrers</h4>
          <div class="appcard" style="display:flex;gap:1rem;align-items:center">
            <div class="ring" style="--p:0"><i>73<span style="font-size:.5rem">%</span></i></div>
            <div style="flex:1">${['Vorausschauen', 'Kupplung & Schalten', 'Parken & Rangieren'].map((s, i) =>
              `<div style="display:flex;justify-content:space-between;align-items:center;font-size:.7rem;color:#a9a3b5;margin-top:${i ? '.5rem' : 0}">
                <span>${s}</span><span>${[0, 1, 2, 3].map((d) => `<i style="display:inline-block;width:.3rem;height:.3rem;border-radius:50%;margin-left:.2rem;background:${d <= 1 ? '#ff2e63' : 'rgba(255,255,255,.16)'}"></i>`).join('')}</span></div>`).join('')}
            </div></div>
          <div class="appcard" style="border-color:rgba(255,46,99,.35)"><span style="font-size:.75rem;color:#ff5d84;font-weight:650">↗ Solide Fortschritte – dranbleiben</span></div>
        </div>
        <div class="appsec"><p class="applabel">Protokoll — automatisch geführt</p>
          <h4 style="font-size:1.05rem;margin-top:.3rem">Deine Historie</h4>
          <div style="display:flex;gap:.4rem;margin-top:.6rem">
            <span style="font-size:.66rem;padding:.25rem .5rem;border-radius:.4rem;background:rgba(255,46,99,.16);color:#ff8ba8"><b data-count="17">0</b> Einheiten</span>
            <span style="font-size:.66rem;padding:.25rem .5rem;border-radius:.4rem;background:rgba(255,46,99,.16);color:#ff8ba8">26,3 Std.</span></div>
          ${[['Übungsfahrt', 'Prüfungsstrecken-Training Fulda', 'Mi, 15.07. · 15:00–16:30', '90 min'],
             ['Autobahnfahrt', 'A7 / A66 – Auffahren, Überholen, Abstand', 'Mo, 13.07. · 10:00–11:30', '90 min'],
             ['Überlandfahrt', 'Landstraßen & Ortsdurchfahrten in der Rhön', 'Do, 09.07. · 14:00–16:15', '135 min']].map(([t, d, w, m]) =>
            `<div class="appcard"><div style="display:flex;justify-content:space-between;align-items:baseline">
              <b style="font-size:.8rem">${t}</b><span style="font-size:.62rem;padding:.15rem .4rem;border-radius:.3rem;background:rgba(255,255,255,.08)">${m}</span></div>
              <p style="font-size:.7rem;color:#a9a3b5;margin-top:.25rem">${d}</p>
              <p style="font-size:.64rem;color:#6f6980;margin-top:.2rem">${w} · Herr Schäfer</p></div>`).join('')}
          <p style="text-align:center;font-size:.6rem;letter-spacing:.1em;color:#6f6980;margin-top:1rem">DEMO-ANSICHT MIT BEISPIELDATEN</p>
        </div>
      </div></div></div>
    </div>
  </div>
</section>`
}

function calculator(ctx) {
  const variants = ctx.clientData.prices.variants
  return `<div style="margin-top:2.5rem">
  <div data-tabs style="margin-bottom:1.2rem">
    <div class="tabs" role="tablist" aria-label="Klasse für den Vergleich"><span class="ind" aria-hidden="true"></span>
      ${variants.map((v) => `<button class="tab" type="button" role="tab" data-tab="calc-${v.slug}" aria-controls="panel-calc-${v.slug}" aria-selected="false">${esc(v.name)}</button>`).join('')}
    </div>
  </div>
  ${variants.map((v) => `<div id="panel-calc-${v.slug}" role="tabpanel" hidden tabindex="0" style="outline-offset:6px">
    <div class="calc" data-calc="${v.slug}">
      <div class="calc-head"><p style="font-size:.88rem;color:var(--chalk-dim);max-width:62ch">
        Trag die Positionen aus deinem Angebot ein und daneben die eines anderen Angebots. Der Rechner nutzt für
        beide Seiten <b>dieselben Mengen</b> — nur so ist ein Vergleich aussagekräftig.</p></div>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Position</th><th>Menge</th><th>Dein Angebot</th><th>Vergleichsangebot</th><th>Differenz</th></tr></thead>
        <tbody>
          ${v.rows.map((r) => `<tr>
            <td><b style="font-size:.92rem">${esc(r.label)}</b><br><span style="font-size:.76rem;color:var(--chalk-dim)">${esc(r.unit)}</span>
              ${r.note ? `<br><span style="font-size:.72rem;color:var(--chalk-faint)">${esc(r.note)}</span>` : ''}</td>
            <td><input class="qty tabular" id="q-${v.slug}-${r.id}" type="number" min="${r.min}" max="${r.max}" step="1" value="${r.quantity}" aria-label="Menge ${esc(r.label)}"></td>
            <td><input class="tabular" id="a-${v.slug}-${r.id}" type="text" inputmode="decimal" placeholder="0,00 €" aria-label="Preis ${esc(r.label)}, dein Angebot">
              <div class="tabular" id="sa-${v.slug}-${r.id}" style="font-size:.72rem;color:var(--chalk-dim);margin-top:.25rem">—</div></td>
            <td><input class="tabular" id="b-${v.slug}-${r.id}" type="text" inputmode="decimal" placeholder="0,00 €" aria-label="Preis ${esc(r.label)}, Vergleichsangebot">
              <div class="tabular" id="sb-${v.slug}-${r.id}" style="font-size:.72rem;color:var(--chalk-dim);margin-top:.25rem">—</div></td>
            <td class="tabular" id="d-${v.slug}-${r.id}">—</td></tr>`).join('')}
        </tbody>
        <tfoot><tr><td colspan="2">Summe bei gleichen Mengen</td>
          <td class="tabular" data-total-a>—</td><td class="tabular" data-total-b>—</td><td></td></tr></tfoot>
      </table></div>
    </div>
    <div class="verdict" data-verdict hidden></div>
  </div>`).join('')}
  <p class="note">Die Fahrschule Krebs veröffentlicht ihre Preisliste nicht online — eine im Netz kursierende Liste
    gehört nachweislich zu einem anderen Betrieb gleichen Namens. Dieser Rechner nennt deshalb bewusst keine
    Krebs-Preise, sondern rechnet aus, was <em>du</em> einträgst.
    <a href="kontakt.html" style="font-weight:650;color:var(--signal)">Frag uns nach einem konkreten Angebot</a>.</p>
</div>`
}

function beam(ctx) {
  const stages = ctx.guide.guideStages
  return `<ol class="beam" style="margin-top:2.5rem">
    <span class="line" aria-hidden="true"></span><span class="fill" aria-hidden="true"></span>
    ${stages.map((s, i) => `<li><span class="dot" aria-hidden="true"></span>
      <div class="card" style="padding:1.2rem 1.35rem">
        <div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:baseline">
          <span class="tabular" style="font-size:.68rem;font-weight:800;letter-spacing:.12em;color:var(--chalk-faint)">${String(i + 1).padStart(2, '0')}</span>
          <h3 style="font-size:1.05rem">${esc(s.title)}</h3>
          <span style="margin-left:auto;font-size:.62rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:.2rem .5rem;border-radius:.35rem;border:1px solid rgb(128 128 128/.35);color:var(--chalk-dim)">${esc(ctx.guide.whoLabels[s.who])}</span>
        </div>
        <p style="margin-top:.6rem;font-size:.9rem;color:var(--chalk-dim);max-width:62ch">${esc(s.body)}</p>
        ${s.items ? `<ul style="margin-top:.9rem;list-style:none;display:grid;gap:.35rem;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))">${s.items.map((it) =>
          `<li style="display:flex;gap:.5rem;font-size:.8rem;color:var(--chalk-soft)"><span style="flex:none;margin-top:.5rem;width:.6rem;height:.16rem;border-radius:1px;background:color-mix(in oklab,var(--signal) 65%,transparent)"></span>${esc(it)}</li>`).join('')}</ul>` : ''}
      </div></li>`).join('')}
  </ol>`
}

function curatedServices(ctx) {
  const FEATURED = [['berufskraftfahrer', 'laderampe'], ['adr', 'adr-latch'], ['handicap', 'handbedienung']]
  const picked = new Set(FEATURED.map((f) => f[0]))
  const rest = ctx.services.services.filter((s) => !picked.has(s.slug))
  return `<div class="grid g3" style="margin-top:2.5rem" data-spot>
    ${FEATURED.map(([slug, still]) => {
      const s = ctx.services.serviceBySlug(slug); if (!s) return ''
      const img = ctx.dataUri(`/stills/${still}-800.avif`)
      return `<a class="card spot orbit" href="leistungen-${slug}.html" style="padding:0;overflow:hidden;text-decoration:none;display:flex;flex-direction:column">
        ${img ? `<img src="${img}" alt="${esc(s.name)} — Studio-Inszenierung" loading="lazy" style="width:100%;aspect-ratio:16/10;object-fit:cover">` : ''}
        <div style="padding:1.4rem;display:flex;flex-direction:column;flex:1">
          <h3 style="font-size:1.1rem">${esc(s.name)}</h3>
          <p style="margin-top:.4rem;font-size:.88rem;font-weight:650;color:var(--signal-400)">${esc(s.tagline)}</p>
          <p style="margin-top:.6rem;font-size:.88rem;color:var(--chalk-dim)">${esc(s.forWhom)}</p>
        </div></a>`
    }).join('')}
  </div>
  <div style="margin-top:2.5rem;padding-top:1.8rem;border-top:1px solid rgb(128 128 128/.25)">
    <h3 class="eyebrow">Außerdem im Programm</h3>
    <ul style="list-style:none;margin-top:1.1rem;display:grid;gap:0;grid-template-columns:repeat(auto-fit,minmax(20rem,1fr));column-gap:2.5rem">
      ${rest.map((s) => `<li><a href="leistungen-${s.slug}.html" style="display:flex;gap:.8rem;align-items:baseline;padding:.8rem 0;border-bottom:1px solid rgb(128 128 128/.2);text-decoration:none">
        <b style="font-family:var(--font-display);font-size:1rem">${esc(s.name)}</b>
        <span style="font-size:.85rem;color:var(--chalk-dim)">${esc(s.tagline)}</span></a></li>`).join('')}
    </ul>
    <a class="btn btn-ghost" href="leistungen.html" style="margin-top:1.8rem">Alle ${ctx.services.services.length} Leistungen im Überblick</a>
  </div>`
}

function milestones(ctx) {
  const b = ctx.business.business
  const founded = ctx.pv(b.founded), founder = ctx.pv(b.founder)
  const succ = ctx.pv(b.successionYear), branch = ctx.pv(b.branchOpened)
  if (!founded || !founder) return ''
  const rows = [[founded, 'Gegründet', `${founder} startet in Fulda als Ein-Mann-Betrieb.`]]
  if (succ) rows.push([succ, 'Zweite Generation', 'Michael Krebs steigt in den Familienbetrieb ein.'])
  if (branch) rows.push([branch, 'Filiale', 'Bad Hersfeld kommt als zweiter Standort dazu.'])
  return `<ol class="grid g3" style="margin-top:2.5rem;list-style:none">
    ${rows.map(([y, t, p]) => `<li class="card"><b class="tabular" style="font-family:var(--font-display);font-size:2rem;color:var(--signal)">${esc(y)}</b>
      <p style="margin-top:.7rem;font-weight:700;font-size:.92rem">${esc(t)}</p>
      <p style="margin-top:.3rem;font-size:.85rem;color:var(--chalk-dim)">${esc(p)}</p></li>`).join('')}
  </ol>`
}

function locationCard(ctx, l) {
  const street = ctx.pv(l.street), postal = ctx.pv(l.postalCode)
  const phone = ctx.pv(l.phone), href = ctx.pv(l.phoneHref), theory = ctx.pv(l.theorySchedule)
  return `<article class="card tilt"><div>
    <h3 style="font-size:1.4rem">${esc(l.name)}</h3>
    <p style="margin-top:.7rem;font-size:.9rem;color:var(--chalk-dim)">${esc(l.intro)}</p>
    ${street && postal ? `<address style="margin-top:1.1rem;font-style:normal;font-size:.88rem;color:var(--chalk-soft)">
      ${esc(street)}, ${esc(postal)} ${esc(l.city)}${phone && href ? ` · <a href="tel:${esc(href)}" style="font-weight:650;text-decoration:none">${esc(phone)}</a>` : ''}</address>` : ''}
    ${theory && theory.length ? `<dl style="margin-top:1.1rem;padding-top:.9rem;border-top:1px solid rgb(128 128 128/.25);display:grid;gap:.5rem">
      ${theory.map((s) => `<div><dt style="font-size:.76rem;font-weight:650;color:var(--chalk-soft)">${esc(s.label)}</dt>
        <dd style="font-size:.76rem;color:var(--chalk-dim)">${esc(s.detail)}</dd></div>`).join('')}</dl>` : ''}
    <ul style="margin-top:1.1rem;list-style:none;display:flex;flex-wrap:wrap;gap:.45rem">
      ${l.highlights.map((h) => `<li style="font-size:.74rem;padding:.28rem .6rem;border-radius:.45rem;border:1px solid rgb(128 128 128/.3);color:var(--chalk-dim)">${esc(h)}</li>`).join('')}</ul>
    <a href="standorte-${l.slug}.html" style="display:inline-flex;align-items:center;min-height:2.4rem;margin-top:1rem;font-weight:650;font-size:.9rem;color:var(--signal);text-decoration:none">Standort ${esc(l.name)} ansehen →</a>
  </div></article>`
}

function teamStrip(ctx) {
  const team = ctx.pv(ctx.business.business.instructorTeam)
  const img = ctx.dataUri('/team/k-team-strip.avif')
  if (!team || !img) return ''
  return `<figure class="figure" style="margin-top:1.2rem">
    <img src="${img}" alt="Das Team der Fahrschule Krebs — rund zwanzig Fahrlehrerinnen, Fahrlehrer und Büromitarbeitende in schwarzen Krebs-Jacken" loading="lazy" style="aspect-ratio:auto">
    <figcaption style="left:1rem;right:auto;bottom:.8rem;font-size:1rem;font-weight:800;font-family:var(--font-display);color:#fff">Das K-Team</figcaption>
  </figure>`
}

/* — Inner pages — */

function pageHead(ctx, { eyebrow, title, lead, trail }) {
  return `<header class="pagehead">
    ${bgVideo(ctx, 'asphalt-loop')}
    <div class="shell">
      ${trail ? `<ol class="crumbs" style="margin-bottom:1.6rem">${trail.map((c, i) =>
        `<li>${i ? '<span aria-hidden="true">/</span> ' : ''}${c.href ? `<a href="${c.href}">${esc(c.name)}</a>` : `<span aria-current="page">${esc(c.name)}</span>`}</li>`).join('')}</ol>` : ''}
      <p class="eyebrow">${esc(eyebrow)}</p>
      <h1 class="h-page">${esc(title)}</h1>
      ${lead ? `<p class="lead">${esc(lead)}</p>` : ''}
    </div>
  </header>`
}

function licenceIndex(ctx) {
  const body = `${pageHead(ctx, { eyebrow: 'Führerschein', title: 'Jede Klasse, die es gibt',
    lead: `Wir bilden in ${ctx.classes.licenceClasses.length} Fahrerlaubnisklassen aus — vom Mofa bis zum Sattelzug, auf eigenen Fahrzeugen. Wenn du nicht weißt, welche du brauchst, beantworte kurz sechs Fragen.`,
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Führerschein' }] })}
  <section class="chapter" data-atmo style="padding-top:0" id="finder">
    <canvas class="ripple" aria-hidden="true"></canvas>
    <div class="shell"><div class="finder"><div class="finder-bar"><i style="width:4%"></i></div>
      <div class="finder-in" data-finder-body tabindex="-1"></div></div></div>
  </section>
  <section class="chapter" data-atmo style="padding-top:0"><div class="shell">
    ${chapterHead('Alle Klassen', 'Nach Fahrzeugart sortiert', null, 'alle-h')}
    ${lanes(ctx)}
  </div></section>
  <div class="rail" aria-label="Kapitel"></div>`
  return shell(ctx, { title: 'Führerscheinklassen in Fulda und Bad Hersfeld', description: 'Alle Führerscheinklassen bei der Fahrschule Krebs: PKW, Anhänger, Motorrad, LKW und Bus — mit Führerschein-Finder, Voraussetzungen und Ablauf je Klasse.', active: 'fuehrerschein.html', body })
}

const CLASS_CLIP = { 'klasse-b': 'cabin-three-views', c: 'wheelnut-truck', ce: 'wheelnut-truck', c1: 'wheelnut-truck', c1e: 'wheelnut-truck', am: 'roller-turntable', mofa: 'roller-turntable' }
const CLASS_STILL = { bf17: 'pkw-studio-hoch', automatik: 'cockpit-lenkrad', b197: 'cockpit-lenkrad', be: 'be-anhaengerkupplung', b96: 'be-anhaengerkupplung', a: 'motorrad-gabel', a1: 'motorrad-gabel', a2: 'motorrad-gabel', d: 'bus-depot', de: 'bus-depot' }

function licencePage(ctx, c) {
  const minAge = ctx.pv(c.minAge), theory = ctx.pv(c.theory), sf = ctx.pv(c.sonderfahrten)
  const clip = CLASS_CLIP[c.slug], still = CLASS_STILL[c.slug]
  const media = clip ? figureVideo(ctx, clip, 'Studio-Inszenierung')
    : still ? (() => { const i = ctx.dataUri(`/stills/${still}-800.avif`)
        return i ? `<figure class="figure loupe"><img src="${i}" alt="${esc(c.name)} — Studio-Inszenierung" loading="lazy" style="aspect-ratio:3/4"><span class="lens" aria-hidden="true"></span><figcaption>Studio-Inszenierung</figcaption></figure>` : '' })()
    : ''
  const body = `${pageHead(ctx, { eyebrow: c.tagline, title: c.name, lead: c.summary,
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Führerschein', href: 'fuehrerschein.html' }, { name: c.name }] })}
  <div class="shell" style="padding-bottom:5rem">
    <dl class="grid g3" style="margin-bottom:3rem">
      <div class="card"><dt class="eyebrow" style="font-size:.62rem">Mindestalter</dt><dd style="margin-top:.6rem;font-size:1.2rem;font-weight:700" class="tabular">${esc(minAge ?? 'Auf Anfrage')}</dd></div>
      <div class="card"><dt class="eyebrow" style="font-size:.62rem">Theorieunterricht</dt><dd style="margin-top:.6rem;font-size:1.2rem;font-weight:700">${theory ? `${theory.grundstoff + theory.zusatzstoff} Doppelstunden` : 'Keine Theorieprüfung nötig'}</dd></div>
      <div class="card"><dt class="eyebrow" style="font-size:.62rem">Sonderfahrten</dt><dd style="margin-top:.6rem;font-size:1.2rem;font-weight:700">${sf ? `${ctx.classes.sonderfahrtenTotal(sf)} à 45 Min.` : 'Individuell'}</dd>
        ${sf ? `<p style="margin-top:.4rem;font-size:.76rem;color:var(--chalk-dim)">${sf.ueberland} Überland · ${sf.autobahn} Autobahn · ${sf.nacht} Nacht</p>` : ''}</div>
    </dl>
    <div class="grid" style="grid-template-columns:1fr;gap:2.5rem">
      <div style="display:grid;gap:2.5rem">
        ${block('Was du damit fahren darfst', c.allows)}
        ${c.prerequisites.length ? block('Was du dafür brauchst', c.prerequisites) : ''}
        ${c.goodToKnow.length ? block('Gut zu wissen', c.goodToKnow) : ''}
        <p class="note">Rechtsstand Juli 2026. Fahrerlaubnisrecht ändert sich — was konkret für dich gilt, klären wir persönlich.</p>
        <div style="display:flex;flex-wrap:wrap;gap:.8rem">
          <a class="btn btn-primary shine" href="kontakt.html?bezug=${esc(c.slug)}">Beratung zu ${esc(c.code)} starten</a>
          ${c.calculatorSupported ? '<a class="btn btn-ghost" href="preise.html">Kosten vergleichen</a>' : ''}
        </div>
      </div>
      ${media ? `<aside>${media}</aside>` : ''}
    </div>
  </div>`
  return shell(ctx, { title: c.seoTitle, description: c.seoDescription, active: 'fuehrerschein.html', body })
}

function block(title, items) {
  return `<section><h2 style="font-size:1.5rem">${esc(title)}</h2>
    <ul style="margin-top:1.1rem;list-style:none;display:grid;gap:.7rem">
      ${items.map((i) => `<li style="display:flex;gap:.75rem;font-size:.95rem;color:var(--chalk-soft)">
        <span style="flex:none;margin-top:.6rem;width:.75rem;height:.2rem;border-radius:1px;background:var(--signal)"></span>${esc(i)}</li>`).join('')}
    </ul></section>`
}

function serviceIndex(ctx) {
  const body = `${pageHead(ctx, { eyebrow: 'Beruf & Seminare', title: 'Mehr als ein Führerschein',
    lead: 'Qualifikationen für den Beruf, Schulungen für Betriebe, Seminare nach Auffälligkeiten — und eine Ausbildung, die sich nach dem Menschen richtet.',
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Beruf & Seminare' }] })}
  <div class="shell" style="padding-bottom:5rem">
    ${ctx.services.serviceGroupOrder.map((g) => {
      const items = ctx.services.servicesByGroup(g)
      if (!items.length) return ''
      return `<section style="margin-bottom:3rem"><div style="display:flex;align-items:baseline;gap:1rem;padding-bottom:.9rem;border-bottom:1px solid rgb(128 128 128/.25)">
        <h2 style="font-size:1.3rem">${esc(ctx.services.serviceGroups[g].label)}</h2>
        <p style="margin-left:auto;font-size:.78rem;color:var(--chalk-faint);text-align:right">${esc(ctx.services.serviceGroups[g].blurb)}</p></div>
        <div class="grid g3" style="margin-top:1.3rem" data-spot>
          ${items.map((s) => `<a class="card spot orbit" href="leistungen-${s.slug}.html" style="text-decoration:none">
            <h3 style="font-size:1.05rem">${esc(s.name)}</h3>
            <p style="margin-top:.4rem;font-size:.88rem;font-weight:650;color:var(--signal-400)">${esc(s.tagline)}</p>
            <p style="margin-top:.6rem;font-size:.88rem;color:var(--chalk-dim)">${esc(s.forWhom)}</p></a>`).join('')}
        </div></section>`
    }).join('')}
  </div>`
  return shell(ctx, { title: 'Beruf, Seminare und Spezialausbildungen', description: 'Berufskraftfahrer-Ausbildung, BKF-Weiterbildung, ADR, Staplerschein, Ladungssicherung, ASF, FES, Handicap-Ausbildung und Ferienfahrschule bei der Fahrschule Krebs.', active: 'leistungen.html', body })
}

const SERVICE_STILL = { adr: 'adr-latch', staplerschein: 'stapler', ladungssicherung: 'laderampe', berufskraftfahrer: 'laderampe', handicap: 'handbedienung' }

function servicePage(ctx, s) {
  const format = ctx.pv(s.format), modules = ctx.pv(s.modules)
  const still = SERVICE_STILL[s.slug]
  const img = still ? ctx.dataUri(`/stills/${still}-800.avif`) : ''
  const body = `${pageHead(ctx, { eyebrow: ctx.services.serviceGroups[s.group].label, title: s.name, lead: s.summary,
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Beruf & Seminare', href: 'leistungen.html' }, { name: s.name }] })}
  <div class="shell" style="padding-bottom:5rem"><div class="grid" style="grid-template-columns:1fr;gap:2.5rem">
    <div style="display:grid;gap:2.5rem">
      <section><h2 style="font-size:1.5rem">Für wen das gedacht ist</h2>
        <p style="margin-top:.9rem;font-size:.95rem;color:var(--chalk-soft)">${esc(s.forWhom)}</p></section>
      ${block('Was dazugehört', s.includes)}
      ${modules && modules.length ? `<section><h2 style="font-size:1.5rem">Die Module</h2>
        <ol class="grid g2" style="margin-top:1.1rem;list-style:none">${modules.map((m) =>
          `<li class="card" style="padding:1.2rem"><b style="font-family:var(--font-display);font-size:.92rem">${esc(m.title)}</b>
          <p style="margin-top:.4rem;font-size:.82rem;color:var(--chalk-dim)">${esc(m.detail)}</p></li>`).join('')}</ol></section>` : ''}
      ${s.requirements.length ? block('Voraussetzungen', s.requirements) : ''}
      <p class="note">Termine, Verfügbarkeiten und Preise für diese Leistung bekommst du auf Anfrage — wir melden uns in der Regel innerhalb eines Werktags.</p>
    </div>
    <aside style="display:grid;gap:1.2rem;align-content:start">
      ${img ? `<figure class="figure loupe"><img src="${img}" alt="${esc(s.name)} — Studio-Inszenierung" loading="lazy" style="aspect-ratio:3/4"><span class="lens" aria-hidden="true"></span><figcaption>Studio-Inszenierung</figcaption></figure>` : ''}
      ${format ? `<div class="card"><h2 style="font-size:1rem">Umfang und Ablauf</h2><p style="margin-top:.6rem;font-size:.88rem;color:var(--chalk-dim)">${esc(format)}</p></div>` : ''}
      <div class="card" style="border-color:color-mix(in oklab,var(--signal) 40%,transparent)">
        <h2 style="font-size:1rem">Nächster Schritt</h2>
        <p style="margin-top:.5rem;font-size:.88rem;color:var(--chalk-dim)">${esc(s.nextStep)}.</p>
        <a class="btn btn-primary shine" href="kontakt.html?bezug=${esc(s.slug)}" style="margin-top:1rem;width:100%">Anfrage senden</a></div>
    </aside>
  </div></div>`
  return shell(ctx, { title: s.seoTitle, description: s.seoDescription, active: 'leistungen.html', body })
}

function locationPage(ctx, l) {
  const street = ctx.pv(l.street), postal = ctx.pv(l.postalCode)
  const phone = ctx.pv(l.phone), href = ctx.pv(l.phoneHref), mail = ctx.pv(l.email)
  const theory = ctx.pv(l.theorySchedule), office = ctx.pv(l.officeHours)
  const body = `${pageHead(ctx, { eyebrow: 'Standort', title: `Fahrschule Krebs ${l.name}`, lead: l.intro,
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Standorte' }, { name: l.name }] })}
  <div class="shell" style="padding-bottom:5rem"><div class="grid g2" style="align-items:start">
    <div style="display:grid;gap:1.2rem">
      <div class="card"><h2 style="font-size:1.15rem">Adresse und Kontakt</h2>
        <address style="margin-top:.8rem;font-style:normal;font-size:.95rem;color:var(--chalk-soft);line-height:1.85">
          ${street && postal ? `${esc(street)}<br>${esc(postal)} ${esc(l.city)}<br>` : ''}
          ${phone && href ? `<a href="tel:${esc(href)}" style="font-weight:650;text-decoration:none">${esc(phone)}</a><br>` : ''}
          ${mail ? `<a href="mailto:${esc(mail)}" style="text-decoration:none">${esc(mail)}</a>` : ''}
        </address></div>
      ${office && office.length ? `<div class="card"><h2 style="font-size:1.15rem">Bürozeiten</h2>
        <dl style="margin-top:.8rem;display:grid;gap:.4rem;font-size:.9rem">${office.map((h) =>
          `<div style="display:flex;gap:1rem;justify-content:space-between"><dt style="color:var(--chalk-dim)">${esc(h.days)}</dt><dd class="tabular">${esc(h.hours)}</dd></div>`).join('')}</dl></div>` : ''}
      ${theory && theory.length ? `<div class="card"><h2 style="font-size:1.15rem">Theorieunterricht</h2>
        <dl style="margin-top:.8rem;display:grid;gap:.7rem;font-size:.9rem">${theory.map((s) =>
          `<div><dt style="font-weight:650">${esc(s.label)}</dt><dd style="color:var(--chalk-dim);margin-top:.15rem">${esc(s.detail)}</dd></div>`).join('')}</dl></div>` : ''}
    </div>
    <div style="display:grid;gap:1.2rem">
      ${figureVideo(ctx, 'day-training-area', 'Studio-Inszenierung — Übungsplatz bei Tageslicht')}
      <div class="card"><h2 style="font-size:1.15rem">Was hier besonders ist</h2>
        <ul style="margin-top:.8rem;list-style:none;display:grid;gap:.55rem">${l.highlights.map((h) =>
          `<li style="display:flex;gap:.7rem;font-size:.92rem;color:var(--chalk-soft)"><span style="flex:none;margin-top:.6rem;width:.7rem;height:.18rem;border-radius:1px;background:var(--signal)"></span>${esc(h)}</li>`).join('')}</ul></div>
      <a class="btn btn-primary shine" href="kontakt.html?standort=${esc(l.slug)}">Beratung in ${esc(l.name)} anfragen</a>
    </div>
  </div></div>`
  return shell(ctx, { title: `Fahrschule in ${l.name} — Krebs`, description: `Fahrschule Krebs in ${l.name}: ${l.intro}`, active: 'standorte-fulda.html', body, jsonLd: locationJsonLd(ctx, l) })
}

function simulatorPage(ctx) {
  const body = `${pageHead(ctx, { eyebrow: 'Simulator', title: 'Die ersten Meter ohne Verkehr',
    lead: 'Am Anfang ist alles gleichzeitig neu: Kupplung, Spiegel, Schilder, Blick, andere Autos. Im Simulator nimmst du einen Teil davon vorweg — in deinem Tempo.',
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Simulator' }] })}
  <div class="shell" style="padding-bottom:5rem;display:grid;gap:2.5rem">
    ${figureVideo(ctx, 'sim-to-real', 'Studio-Inszenierung — aus dem Simulator auf die echte Straße')}
    <div class="carousel" data-carousel><div class="carousel-track">
      ${[['Bedienung ohne Verkehr', 'Anfahren, Schalten, Lenken und Blickführung zuerst in Ruhe — ohne dass hinter dir jemand wartet.'],
        ['Situationen wiederholen', 'Eine Kreuzung, die nicht sitzt, lässt sich zehnmal fahren. Im echten Verkehr kommt sie einmal.'],
        ['Fehler ohne Folgen', 'Was schiefgeht, kostet hier nichts außer einem Neustart. Genau das nimmt den Druck raus.'],
        ['Sicherer in die erste Fahrstunde', 'Wer die Abläufe schon kennt, kann sich vom ersten Meter an auf den Verkehr konzentrieren.']
      ].map(([h, p]) => `<div><h3 style="font-size:1.4rem">${esc(h)}</h3><p style="margin-top:.8rem;color:var(--chalk-dim);max-width:44ch">${esc(p)}</p></div>`).join('')}
    </div><div class="carousel-nav"></div></div>
    <p class="note">Das Simulatortraining ergänzt die praktische Ausbildung — es ersetzt keine der gesetzlich vorgeschriebenen Fahrstunden.</p>
    <div><a class="btn btn-primary shine" href="kontakt.html?thema=fuehrerschein">Nach Simulatorterminen fragen</a></div>
  </div>`
  return shell(ctx, { title: 'Fahrsimulator', description: 'Simulatortraining bei der Fahrschule Krebs: Bedienung, Blickführung und Abläufe üben, bevor es in den echten Verkehr geht.', active: 'simulator.html', body })
}

function digitalPage(ctx) {
  const body = `${pageHead(ctx, { eyebrow: 'Das System', title: 'Nicht nur Fahrstunden',
    lead: 'Theorie, Simulator und Praxis sind keine getrennten Baustellen. Sie greifen ineinander — und du siehst an jedem Punkt, wo du stehst.',
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Digitalpaket' }] })}
  <div class="shell" style="padding-bottom:5rem;display:grid;gap:2.5rem">
    ${figureVideo(ctx, 'phone-scroll', 'Studio-Inszenierung — das Cockpit-Interface in Bewegung')}
    <div class="grid g2" data-spot>
      ${ctx.services.services.slice(0, 4).map((s) => `<a class="card spot orbit" href="leistungen-${s.slug}.html" style="text-decoration:none">
        <h3 style="font-size:1.05rem">${esc(s.name)}</h3><p style="margin-top:.5rem;font-size:.88rem;color:var(--chalk-dim)">${esc(s.tagline)}</p></a>`).join('')}
    </div>
    <div><a class="btn btn-primary shine" href="schueler-cockpit.html">Schüler-Cockpit ansehen</a></div>
  </div>`
  return shell(ctx, { title: 'Digitalpaket', description: 'Theorie, Simulator, Praxis und das digitale Schüler-Cockpit der Fahrschule Krebs greifen ineinander.', active: 'digitalpaket.html', body })
}

function cockpitPage(ctx) {
  const body = `${pageHead(ctx, { eyebrow: 'In Entwicklung', title: 'Schluss mit „Wie weit bin ich eigentlich?"',
    lead: 'Wir bauen gerade ein digitales Cockpit für unsere Fahrschülerinnen und Fahrschüler. Die folgenden Ansichten zeigen mit Beispieldaten, wie es aussehen wird.',
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Schüler-Cockpit' }] })}
  ${cockpitSection()}
  <div class="shell" style="padding-bottom:5rem;display:grid;gap:1.5rem;max-width:36rem">
    <div class="signin"><canvas aria-hidden="true"></canvas>
      <p class="eyebrow">Vorschau</p>
      <h2 style="font-size:1.4rem;margin-top:.8rem">So meldest du dich später an</h2>
      <p style="margin-top:.6rem;font-size:.88rem;color:var(--chalk-dim)">Der Login kommt mit dem Cockpit. Diese Ansicht ist eine Gestaltungsvorschau — sie nimmt noch keine Daten entgegen.</p>
      <label class="field"><span>E-Mail</span><input type="email" disabled placeholder="du@beispiel.de" autocomplete="off"></label>
      <label class="field"><span>Passwort</span><input type="password" disabled placeholder="••••••••" autocomplete="off"></label>
      <button class="btn btn-primary shine" style="margin-top:1.1rem;width:100%" disabled aria-disabled="true">Anmelden — noch nicht verfügbar</button>
    </div>
    <p class="note">Wir zeigen hier bewusst eine Vorschau statt eines funktionierenden Logins: Ein Formular, das so tut, als würde es etwas speichern, wäre eine Demo-Attrappe.</p>
  </div>`
  return shell(ctx, { title: 'Schüler-Cockpit', description: 'Das digitale Schüler-Cockpit der Fahrschule Krebs: Theoriefortschritt, Sonderfahrten, Fahrstil-Bewertung und Protokoll an einem Ort.', active: 'digitalpaket.html', body })
}

function pricesPage(ctx) {
  const body = `${pageHead(ctx, { eyebrow: 'Kosten', title: 'Angebote ehrlich vergleichen',
    lead: 'Zwei Fahrschulen mit unterschiedlichen Fahrstundenzahlen zu vergleichen führt fast immer in die Irre. Dieser Rechner legt beide Angebote auf dieselben Mengen um.',
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Preise' }] })}
  <div class="shell day" style="padding:2.5rem 2rem 3rem;border-radius:1.2rem;margin-bottom:5rem" id="rechner">
    ${calculator(ctx)}
    <div style="margin-top:2.5rem"><h2 style="font-size:1.3rem">Wer bekommt eigentlich welches Geld?</h2>
      <div class="grid g4" style="margin-top:1.2rem">${ctx.guide.costCategories.map((c) =>
        `<div class="card"><b style="font-family:var(--font-display);font-size:.92rem">${esc(c.label)}</b>
        <p style="margin-top:.5rem;font-size:.82rem;color:var(--chalk-dim)">${esc(c.body)}</p></div>`).join('')}</div>
    </div>
  </div>`
  return shell(ctx, { title: 'Preise vergleichen', description: 'Fahrschul-Angebote fair vergleichen: Der Rechner der Fahrschule Krebs legt zwei Angebote auf dieselben Mengen um.', active: 'preise.html', body })
}

function guidePage(ctx) {
  const sources = ctx.pv(ctx.guide.guideSources)
  const body = `${pageHead(ctx, { eyebrow: 'Ablauf', title: 'Kein Behördenlabyrinth',
    lead: 'Der Führerschein wirkt kompliziert, weil niemand die Reihenfolge erklärt. Hier ist sie — mit dem Hinweis, wer bei jedem Schritt handeln muss.',
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Ausbildungsablauf' }] })}
  <div class="shell day" style="padding:3rem 2rem;border-radius:1.2rem;margin-bottom:5rem">
    ${figureVideo(ctx, 'documents-road', 'Studio-Inszenierung — aus Unterlagen wird eine Straße')}
    <div style="margin-top:2.5rem">${beam(ctx)}</div>
    ${sources ? `<p style="margin-top:2rem;font-size:.8rem;color:var(--chalk-faint)">Rechtliche Grundlage: ${esc(sources)}. Stand: Juli 2026.</p>` : ''}
  </div>`
  return shell(ctx, { title: 'Ausbildungsablauf', description: 'Vom Antrag bis zur praktischen Prüfung: der komplette Ablauf der Führerscheinausbildung, mit Zuständigkeiten je Schritt.', active: 'ausbildungsablauf.html', body })
}

function teamPage(ctx) {
  const b = ctx.business.business
  const team = ctx.pv(b.instructorTeam), scope = ctx.pv(b.instructorScope)
  const fleet = ctx.pv(b.fleet), fleetNote = ctx.pv(b.fleetNote)
  const banner = ctx.dataUri('/team/k-team-banner.avif')
  const body = `${pageHead(ctx, { eyebrow: 'Die Fahrschule', title: 'Ein Familienbetrieb, kein Franchise',
    lead: `Seit ${ctx.pv(b.founded)} bilden wir in Fulda aus — inzwischen ${ctx.business.yearsInBusiness()} Jahre, in zweiter Generation.`,
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Team' }] })}
  <div class="shell" style="padding-bottom:5rem;display:grid;gap:3rem">
    ${milestones(ctx)}
    ${team ? `<section><h2 style="font-size:1.5rem">Das K-Team</h2>
      <p style="margin-top:.9rem;font-size:.95rem;color:var(--chalk-soft);max-width:62ch">Bei uns unterrichten ${esc(team)}${scope ? ` in den Klassen ${esc(scope)}` : ''}.</p>
      ${banner ? `<figure class="figure" style="margin-top:1.3rem"><img src="${banner}" alt="Das K-Team der Fahrschule Krebs" loading="lazy" style="aspect-ratio:auto"></figure>` : ''}
      ${figureVideo(ctx, 'team-gallery', 'Studio-Inszenierung — das K-Team-Foto als Galerieabzug')}
      <p class="note">Einzelporträts mit Klassen und Schwerpunkten folgen, sobald sie freigegeben sind — erfundene Profile zeigen wir nicht.</p></section>` : ''}
    <section><h2 style="font-size:1.5rem">Fahrzeuge</h2>
      ${fleetNote ? `<p style="margin-top:.9rem;font-size:.95rem;color:var(--chalk-soft);max-width:62ch">${esc(fleetNote)}</p>` : ''}
      ${fleet && fleet.length ? `<ul style="margin-top:1.1rem;list-style:none;display:flex;flex-wrap:wrap;gap:.5rem">${fleet.map((f) =>
        `<li style="padding:.5rem .85rem;border-radius:.5rem;border:1px solid rgb(255 255 255/.14);font-size:.88rem;color:var(--chalk-dim)">${esc(f)}</li>`).join('')}</ul>` : ''}
    </section>
  </div>`
  return shell(ctx, { title: 'Team, Fahrzeuge und Geschichte', description: 'Die Fahrschule Krebs ist ein Familienbetrieb aus Fulda — seit 1964, heute in zweiter Generation, mit eigenem Fuhrpark.', active: 'team.html', body })
}

function contactPage(ctx) {
  const mail = ctx.pv(ctx.business.locations[0].email) ?? 'info@fahrschule-krebs.de'
  const body = `${pageHead(ctx, { eyebrow: 'Kontakt', title: 'Frag uns einfach',
    lead: 'Du musst dich nicht festlegen, um mit uns zu sprechen. Schreib uns, was du wissen willst — oder ruf an, das geht meistens schneller.',
    trail: [{ name: 'Start', href: 'index.html' }, { name: 'Kontakt' }] })}
  <div class="shell" style="padding-bottom:5rem"><div class="grid g2" style="align-items:start">
    <form class="card" id="anfrage" data-to="${esc(mail)}" novalidate>
      <p style="display:none;padding:.85rem 1rem;border-radius:.7rem;font-size:.88rem;margin-bottom:1rem;border:1px solid color-mix(in oklab,var(--signal) 30%,transparent);background:color-mix(in oklab,var(--signal) 8%,transparent)" data-bezug hidden></p>
      <input type="hidden" id="ref" name="ref" value="">
      <div class="grid g2">
        <label class="field"><span>Name *</span><input id="name" name="name" required autocomplete="name"></label>
        <label class="field"><span>E-Mail *</span><input id="email" name="email" type="email" required autocomplete="email"></label>
        <label class="field"><span>Telefon</span><input id="phone" name="phone" type="tel" autocomplete="tel"></label>
        <label class="field"><span>Standort</span>
          <select id="standort" name="standort" style="width:100%;height:2.9rem;padding:0 .8rem;border-radius:.6rem;border:1px solid rgb(255 255 255/.15);background:rgb(255 255 255/.04)">
            ${ctx.business.locations.map((l) => `<option value="${esc(l.name)}">${esc(l.name)}</option>`).join('')}<option value="Noch offen">Noch offen</option></select></label>
      </div>
      <label class="field"><span>Thema</span>
        <select id="thema" name="thema" style="width:100%;height:2.9rem;padding:0 .8rem;border-radius:.6rem;border:1px solid rgb(255 255 255/.15);background:rgb(255 255 255/.04)">
          <option value="fuehrerschein">Führerschein — private Ausbildung</option>
          <option value="beruf">Beruf — LKW, Bus, Berufskraftfahrer</option>
          <option value="seminar">Seminar — ASF, FES, ADR, Stapler</option>
          <option value="sonstiges">Etwas anderes</option></select></label>
      <label class="field"><span>Deine Nachricht *</span>
        <textarea id="nachricht" name="nachricht" required rows="5" style="width:100%;padding:.7rem .8rem;border-radius:.6rem;border:1px solid rgb(255 255 255/.15);background:rgb(255 255 255/.04);resize:vertical"></textarea></label>
      <button class="btn btn-primary shine" type="submit" style="margin-top:1.2rem;width:100%">Anfrage per E-Mail senden</button>
      <p style="margin-top:.8rem;font-size:.78rem;color:var(--chalk-faint)">Der Knopf öffnet dein E-Mail-Programm mit der fertig ausgefüllten Nachricht an ${esc(mail)} — diese Datei läuft ohne Server, verschickt also nichts selbst und speichert nichts.</p>
      <p data-sent hidden style="margin-top:.8rem;font-size:.88rem;color:var(--ok)">Dein E-Mail-Programm wurde geöffnet. Falls nichts passiert ist, schreib uns direkt an <a href="mailto:${esc(mail)}">${esc(mail)}</a>.</p>
    </form>
    <aside style="display:grid;gap:1.2rem">
      ${ctx.business.locations.map((l) => {
        const p = ctx.pv(l.phone), h = ctx.pv(l.phoneHref), st = ctx.pv(l.street), pc = ctx.pv(l.postalCode)
        return `<div class="card tilt"><div><h2 style="font-size:1.1rem">${esc(l.name)}</h2>
          <address style="margin-top:.6rem;font-style:normal;font-size:.9rem;color:var(--chalk-dim);line-height:1.8">
          ${st && pc ? `${esc(st)}<br>${esc(pc)} ${esc(l.city)}<br>` : ''}
          ${p && h ? `<a href="tel:${esc(h)}" style="font-weight:650;text-decoration:none;color:var(--signal)">${esc(p)}</a>` : ''}
          </address></div></div>`
      }).join('')}
    </aside>
  </div></div>`
  return shell(ctx, { title: 'Kontakt und Beratung', description: 'Beratung, Voranmeldung und Anfragen an die Fahrschule Krebs in Fulda und Bad Hersfeld.', active: 'kontakt.html', body })
}

function legalPage(ctx, which) {
  const b = ctx.business.business
  const isImp = which === 'impressum'
  const body = `${pageHead(ctx, { eyebrow: 'Rechtliches', title: isImp ? 'Impressum' : 'Datenschutz',
    trail: [{ name: 'Start', href: 'index.html' }, { name: isImp ? 'Impressum' : 'Datenschutz' }] })}
  <div class="shell" style="padding-bottom:5rem;max-width:50rem">
    ${isImp ? `
      <h2 style="font-size:1.2rem">Angaben gemäß § 5 DDG</h2>
      <p style="margin-top:.8rem;color:var(--chalk-soft);line-height:1.9">${esc(b.legalName)}<br>
        ${esc(ctx.pv(ctx.business.locations[0].street) ?? '')}<br>
        ${esc(ctx.pv(ctx.business.locations[0].postalCode) ?? '')} ${esc(ctx.business.locations[0].city)}</p>
      ${ctx.pv(b.managingDirector) ? `<p style="margin-top:1.2rem;color:var(--chalk-soft)">Geschäftsführer: ${esc(ctx.pv(b.managingDirector))}</p>` : ''}
      <p style="margin-top:1.2rem;color:var(--chalk-soft)">Telefon: ${esc(ctx.pv(ctx.business.locations[0].phone) ?? '')}<br>
        E-Mail: ${esc(ctx.pv(ctx.business.locations[0].email) ?? '')}</p>
      <p class="note">Weitere Pflichtangaben (Registergericht, Registernummer, Umsatzsteuer-Identifikationsnummer,
        zuständige Aufsichtsbehörde) ergänzen wir, sobald sie uns vollständig vorliegen — wir tragen hier keine
        Platzhalter ein.</p>
    ` : `
      <h2 style="font-size:1.2rem">Diese Datei arbeitet offline</h2>
      <p style="margin-top:.8rem;color:var(--chalk-soft);line-height:1.9">Diese Seite ist eine eigenständige HTML-Datei.
        Sie lädt nichts nach, setzt keine Cookies, bindet keine Schriften, Karten, Videos oder Analysedienste von
        fremden Servern ein und überträgt beim Betrachten keinerlei Daten. Alle Bilder, Videos und Schriften stecken
        in der Datei selbst.</p>
      <h2 style="font-size:1.2rem;margin-top:2rem">Kontaktformular</h2>
      <p style="margin-top:.8rem;color:var(--chalk-soft);line-height:1.9">Das Formular auf der Kontaktseite sendet
        nichts an einen Server. Es öffnet dein eigenes E-Mail-Programm mit einer vorbereiteten Nachricht — was du
        absendest, entscheidest du dort.</p>
      <h2 style="font-size:1.2rem;margin-top:2rem">Beim Betrieb auf einem Webserver</h2>
      <p style="margin-top:.8rem;color:var(--chalk-soft);line-height:1.9">Sobald diese Seiten auf einem Server
        veröffentlicht werden, fallen dort technisch bedingt Server-Logdateien an (IP-Adresse, Zeitpunkt, abgerufene
        Datei). Die vollständige Datenschutzerklärung dafür ergänzen wir gemeinsam mit dem Hoster.</p>
    `}
  </div>`
  return shell(ctx, { title: isImp ? 'Impressum' : 'Datenschutz', description: isImp ? 'Impressum der Fahrschule Krebs GmbH.' : 'Datenschutzhinweise der Fahrschule Krebs GmbH.', active: '', body })
}

/* ── Structured data ────────────────────────────────────────────────── */

function organizationJsonLd(ctx) {
  const b = ctx.business.business
  return {
    '@context': 'https://schema.org', '@type': 'DrivingSchool',
    name: b.legalName,
    foundingDate: String(ctx.pv(b.founded) ?? ''),
    location: ctx.business.locations.map((l) => locationJsonLd(ctx, l)),
  }
}

function locationJsonLd(ctx, l) {
  const street = ctx.pv(l.street), postal = ctx.pv(l.postalCode), phone = ctx.pv(l.phone)
  return {
    '@context': 'https://schema.org', '@type': 'DrivingSchool',
    name: `Fahrschule Krebs ${l.name}`,
    ...(phone ? { telephone: phone } : {}),
    ...(street && postal ? { address: { '@type': 'PostalAddress', streetAddress: street, postalCode: postal, addressLocality: l.city, addressCountry: 'DE' } } : {}),
  }
}
