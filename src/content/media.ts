/**
 * The approved motion archive, by scene name.
 *
 * Every clip here was generated for this site in its own visual language
 * (near-black studio, signal red as emitted light only) and approved by the
 * owner. Files live in /public/media: a 720p H.264 tier for every clip,
 * 1080p for the ones that carry a scene, plus a poster JPEG that doubles as
 * the reduced-motion/Save-Data representation.
 *
 * `hd` mirrors which clips CI transcodes at 1080p — keep in sync with
 * scripts/higgsfield-manifest.json.
 */

export type SceneClip = {
  readonly name: string
  readonly hd: boolean
  /** What the clip shows — used for captions and internal docs. */
  readonly beschreibung: string
}

export const sceneClips = {
  heroFilament: {
    name: 'hero-filament',
    hd: true,
    beschreibung: 'Ein rotes Lichtfilament wandert über nassen Asphalt und richtet sich zur Linie',
  },
  asphaltLoop: {
    name: 'asphalt-loop',
    hd: true,
    beschreibung: 'Dunkler Asphalt zieht ruhig und endlos nach oben — Hintergrund hinter Typografie',
  },
  turntableStops: {
    name: 'turntable-stops-12s',
    hd: true,
    beschreibung: 'Drehbühne mit Kombi, Motorrad, Sattelzugmaschine und Stadtbus — vier Stopps, volle Runde',
  },
  vehicleMorph: {
    name: 'vehicle-morph',
    hd: true,
    beschreibung: 'Eine Lichtkante verformt sich vom Pkw übers Motorrad und den Lkw zum Bus',
  },
  simOrbit: {
    name: 'sim-orbit',
    hd: true,
    beschreibung: 'Kamerafahrt um den Simulatorplatz mit drei gebogenen Bildschirmen',
  },
  simToReal: {
    name: 'sim-to-real',
    hd: true,
    beschreibung: 'Der Blick fährt in den Simulator-Bildschirm — und die gerenderte Straße wird real',
  },
  phoneScroll: {
    name: 'phone-scroll',
    hd: true,
    beschreibung: 'Das Cockpit-Interface scrollt auf einem Telefon im dunklen Raum',
  },
  teamGallery: {
    name: 'team-gallery',
    hd: true,
    beschreibung: 'Ein Galerielicht wandert über den gerahmten Abzug des K-Team-Fotos',
  },
  aerialRoute: {
    name: 'aerial-route',
    hd: true,
    beschreibung: 'Blaue Stunde über Osthessen: eine leuchtende Route verbindet zwei Orte',
  },
  documentsRoad: {
    name: 'documents-road',
    hd: true,
    beschreibung: 'Unterlagen ordnen sich und werden zur Straße — der Weg zur Prüfung',
  },
  lineArrives: {
    name: 'line-arrives',
    hd: true,
    beschreibung: 'Die rote Linie kommt an und bleibt stehen — Platz für den nächsten Schritt',
  },
  pointsToCard: {
    name: 'points-to-card',
    hd: false,
    beschreibung: 'Lichtpunkte sammeln sich zur Oberkante einer Interface-Karte',
  },
  handcontrolMacro: {
    name: 'handcontrol-macro',
    hd: false,
    beschreibung: 'Makroaufnahme einer Handbedienung am Lenkrad, präzise gefertigt',
  },
  branchTrainingArea: {
    name: 'branch-training-area',
    hd: false,
    beschreibung: 'Eine abzweigende Linie wird zum Übungsplatz im Abendlicht',
  },
  wheelnutTruck: {
    name: 'wheelnut-truck',
    hd: false,
    beschreibung: 'Von der Radmutter zum ganzen Lkw — eine einzige Rückfahrt',
  },
  cabinThreeViews: {
    name: 'cabin-three-views',
    hd: false,
    beschreibung: 'Fahrersicht: Straße, Rückspiegel und Außenspiegel bewegen sich stimmig',
  },
  rainMacro: {
    name: 'rain-macro',
    hd: false,
    beschreibung: 'Regentropfen auf der Windschutzscheibe, ein Wischerblatt räumt den Blick frei',
  },
  ringArc: {
    name: 'ring-arc',
    hd: false,
    beschreibung: 'Ein roter Lichtbogen schließt sich langsam — fast, nicht ganz',
  },
} as const satisfies Record<string, SceneClip>

export type SceneClipKey = keyof typeof sceneClips

/* ── Per-page media assignments ──────────────────────────────────────── */

export type PageMediaEntry = {
  readonly kind: 'video' | 'still'
  /** Clip key (videos) or /stills base name (stills). */
  readonly ref: string
  readonly alt: string
  /** Honest framing: these are staged studio renders, not fleet photos. */
  readonly caption: string
  readonly aspect?: string
}

/**
 * Which staged visual belongs to which detail page. Pages without a truthful
 * match simply have no entry — no visual beats a misleading one (the AM
 * scooter class does not get a superbike fork).
 */
export const pageMedia: Record<string, PageMediaEntry> = {
  'fuehrerschein/klasse-b': {
    kind: 'video',
    ref: 'cabinThreeViews',
    alt: 'Fahrersicht aus einem Pkw: Straße, Rückspiegel und Außenspiegel in Bewegung',
    caption: 'Studio-Inszenierung — Fahrersicht mit drei Blickachsen',
  },
  'fuehrerschein/bf17': {
    kind: 'still',
    ref: 'pkw-studio-hoch',
    alt: 'Schwarzer Kombi in dunklem Studio mit rotem Lichtband am Boden',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'fuehrerschein/automatik': {
    kind: 'still',
    ref: 'cockpit-lenkrad',
    alt: 'Lenkrad mit roter Ziernaht und digitalem Kombiinstrument bei Nacht',
    caption: 'Studio-Inszenierung',
  },
  'fuehrerschein/b197': {
    kind: 'still',
    ref: 'cockpit-lenkrad',
    alt: 'Lenkrad mit roter Ziernaht und digitalem Kombiinstrument bei Nacht',
    caption: 'Studio-Inszenierung',
  },
  'fuehrerschein/be': {
    kind: 'still',
    ref: 'be-anhaengerkupplung',
    alt: 'Heck eines Kombis mit Anhängerkupplung, rotes Rücklicht spiegelt sich im Lack',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'fuehrerschein/b96': {
    kind: 'still',
    ref: 'be-anhaengerkupplung',
    alt: 'Heck eines Kombis mit Anhängerkupplung, rotes Rücklicht spiegelt sich im Lack',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'fuehrerschein/a': {
    kind: 'still',
    ref: 'motorrad-gabel',
    alt: 'Vorderrad und Gabel eines Sportmotorrads, Bremsscheibe scharf im Licht',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'fuehrerschein/a2': {
    kind: 'still',
    ref: 'motorrad-gabel',
    alt: 'Vorderrad und Gabel eines Sportmotorrads, Bremsscheibe scharf im Licht',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'fuehrerschein/a1': {
    kind: 'still',
    ref: 'motorrad-gabel',
    alt: 'Vorderrad und Gabel eines Sportmotorrads, Bremsscheibe scharf im Licht',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'fuehrerschein/c': {
    kind: 'video',
    ref: 'wheelnutTruck',
    alt: 'Kamerafahrt von einer Radmutter zurück bis zur ganzen Sattelzugmaschine',
    caption: 'Studio-Inszenierung — von der Radmutter zum Lkw',
  },
  'fuehrerschein/ce': {
    kind: 'video',
    ref: 'wheelnutTruck',
    alt: 'Kamerafahrt von einer Radmutter zurück bis zur ganzen Sattelzugmaschine',
    caption: 'Studio-Inszenierung — von der Radmutter zum Lkw',
  },
  'fuehrerschein/c1': {
    kind: 'video',
    ref: 'wheelnutTruck',
    alt: 'Kamerafahrt von einer Radmutter zurück bis zur ganzen Sattelzugmaschine',
    caption: 'Studio-Inszenierung — von der Radmutter zum Lkw',
  },
  'fuehrerschein/c1e': {
    kind: 'video',
    ref: 'wheelnutTruck',
    alt: 'Kamerafahrt von einer Radmutter zurück bis zur ganzen Sattelzugmaschine',
    caption: 'Studio-Inszenierung — von der Radmutter zum Lkw',
  },
  'fuehrerschein/d': {
    kind: 'still',
    ref: 'bus-depot',
    alt: 'Flanke eines schwarzen Stadtbusses im dunklen Depot, ein Fenster rot erleuchtet',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'fuehrerschein/de': {
    kind: 'still',
    ref: 'bus-depot',
    alt: 'Flanke eines schwarzen Stadtbusses im dunklen Depot, ein Fenster rot erleuchtet',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'leistungen/handicap': {
    kind: 'video',
    ref: 'handcontrolMacro',
    alt: 'Makroaufnahme einer präzise gefertigten Handbedienung an der Lenksäule',
    caption: 'Studio-Inszenierung — Handbedienung am Lenkrad',
  },
  'leistungen/berufskraftfahrer': {
    kind: 'video',
    ref: 'wheelnutTruck',
    alt: 'Kamerafahrt von einer Radmutter zurück bis zur ganzen Sattelzugmaschine',
    caption: 'Studio-Inszenierung — von der Radmutter zum Lkw',
  },
  'leistungen/adr': {
    kind: 'still',
    ref: 'adr-latch',
    alt: 'Massiver Metallverschluss an einer dunklen Tankwagen-Blende, rote Kontrollleuchte im Hintergrund',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'leistungen/staplerschein': {
    kind: 'still',
    ref: 'stapler',
    alt: 'Hubmast und Gabeln eines Staplers in einer dunklen Lagerhalle',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
  'leistungen/ladungssicherung': {
    kind: 'still',
    ref: 'laderampe',
    alt: 'Hecktüren eines schwarzen Aufliegers an der Laderampe im Morgengrauen',
    caption: 'Studio-Inszenierung',
    aspect: 'aspect-[3/4]',
  },
}
