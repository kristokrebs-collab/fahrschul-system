export interface Termin {
  buchung: {
    id: string;
    beginnAt: string;
    endeAt: string;
    art: string;
    status: string;
    verspaetungMinuten: number | null;
  };
  schueler: { id: string; vorname: string; nachname: string } | null;
  fahrzeug: { id: string; kennzeichen: string; status: string } | null;
  raum: { id: string; name: string } | null;
  simulator: { id: string; name: string } | null;
}

export interface Briefing {
  heuteUeben: string;
  daraufAchten: string | null;
  letzterFortschritt: { wentWell: string | null; at: string } | null;
  offeneLernziele: (string | null)[];
  fahrzeugBedarf: { getriebeart: string; handicapBedarf: string[] } | null;
  naechsterFormalerSchritt: string;
  kompetenzraster: unknown[];
  dataAsOf: string;
}
