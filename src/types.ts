// Kern-Typen. Gespeichert wird das Projekt (IndexedDB `pcbtracer`, Store `projects`) genau in dieser Form;
// Felder nicht umbenennen, sonst laufen bestehende Projekte nicht mehr (Migration siehe migrateLook/migrateObjs).

export type Pt = [number, number];
// Abbildung Rohpixel ↔ Platine; loo: Leave-one-out-Fehler je Paar (ab 5 Paaren)
export type MapFn = ((x: number, y: number) => number[]) & { loo?: any };

// Ein Foto (Seite), in Kacheln zerlegt: w×h Pixel, Stufen 0..L
export interface Side { w: number; h: number; L: number }

// Spiegeln/Drehen der Rückseite fürs Ausrichte-Fenster
export interface Pre { fx: boolean; fy: boolean; rot: number }

// Ausricht-Paar: f = Punkt auf der Vorderseite, b = derselbe Punkt auf der Rückseite (Rohpixel), r* = Via-Radius
export interface Pair {
  f: Pt; b: Pt; rf: number; rb: number; auto?: boolean;
  zf?: number[]; zrf?: number; zb?: number[]; zrb?: number;   // Farbzonen (Vorbild für die Via-Suche)
}

// Lage (physikalische Reihenfolge: [0] = Oberseite … zuletzt Unterseite); id = Bild-/Lagen-ID ('front' | 'back' | später 'i…')
export interface Layer { id: string; on: boolean; op: number; color: string; name?: string }

// Material-Ansicht (für alle Lagen gemeinsam)
export interface MatLook { cu: boolean; pour: boolean; silk: boolean; bg: boolean }

export type LayerMode = 'normal' | 'dim' | 'hide';

export interface Look {
  bahnen: number;            // „Bahnen deutlicher“ 0..1
  layers: Layer[];
  active?: string;           // aktive Lage
  mode?: LayerMode | string; // andere Lagen: normal, gedimmt, ausgeblendet
  hideObjs?: boolean;        // Zeichnungen ausgeblendet
  pen?: string;              // Stiftfarbe
  mat?: MatLook;
  orient?: { a: number; f: boolean };   // Ansicht gedreht (Grad, im Uhrzeigersinn) / gespiegelt, nur Darstellung
  hideTr?: boolean;          // Bahnen ausgeblendet
  tw?: number;               // Bahnbreite: 0 schmal, 1 normal, 2 breit
  tang?: number;             // Winkel beim Nachziehen: 0 frei (rastet nahe 0/45/90° ein), 1 nur 45°
}

// Gespeicherte Hauptansicht
export interface View { cx: number; cy: number; s: number; t: number; draw: boolean; tr?: boolean }

// Objekt (Zeichnung/Text). Gemeinsam: id, t, L, img, color, note.
//   text: x, y (Mitte, Platine) + u, v (Anker im Bild img), note = Text, h Schrifthöhe und rot Drehung (Grad) in Platinenkoordinaten,
//         lead Hinweislinie an, lx, ly + lu, lv deren Ziel (siehe draw/text.ts). Alt: pin (Nadel x, y), wird beim Öffnen zu text.
//   ink: pts (Platine) + uv (Anker), arrow
//   Bahnen (draw/trace.ts): node, via, pad (Punkt x, y + Anker img, u, v), seg (a, b = Punkt-IDs, w Breite), net (name, seeds, num, siehe draw/nets.ts)
export interface Obj {
  id: string; t: 'text' | 'ink' | 'pin' | 'node' | 'via' | 'pad' | 'seg' | 'net' | string; L: string; img?: string; color?: string; note?: string;
  a?: string; b?: string; w?: number; d?: number; name?: string; ok?: boolean; seeds?: string[]; num?: number;
  x?: number; y?: number; u?: number; v?: number;
  h?: number; rot?: number; lead?: boolean; lx?: number; ly?: number; lu?: number; lv?: number;
  pts?: Pt[]; uv?: Pt[]; arrow?: boolean;
}

export interface Project {
  id: string; name: string; created: number; updated: number;
  sides: Record<string, Side>;
  align: { pre: Pre; pairs: Pair[] };
  view: View | null;
  matAuto?: boolean;
  look?: Look;
  objs?: Record<string, Obj>;
  straight?: number[];
  route?: Route | null;      // angefangene Bahn (draw/trace.ts), übersteht Neuladen       // Geradestellung: Homografie Rohpixel oben → Platine (3×3 zeilenweise), fehlt = Identität
  fx?: any;                  // alter Filter-Prototyp, wird von migrateLook entfernt
}

// Angefangene Bahn: Lage, letzter Punkt (ID), Breite in Platinen-px, Kennung des Zugs
export interface Route { L: string; last: string; w: number; rid: string; n?: number }   // n: gesetzte Stücke

export interface Cam { cx: number; cy: number; s: number }
export interface Pane { id: string; x: number; y: number; w: number; h: number; loupe?: boolean }

// Laufzeit-Zustand der App (nicht gespeichert)
export interface AppState {
  db: IDBDatabase; proj: Project; mode: 'list' | 'main' | 'align' | string;
  t: number; hold: boolean; before: boolean;
  cams: Record<string, Cam>; panes: Pane[];
  pre: { m: number[]; w: number; h: number }; preInv: number[]; fwd: MapFn; inv: MapFn; loo: number[]; alignVer: number;
  pending: any; sel: number; link: boolean; undo: string[];
  loupe: any; preview: any;
  draw: boolean; pick: Set<string>; oundo: any[]; note: any; stroke: any; omove: any; tr: boolean;
  suggesting?: boolean; props?: any[]; viaDebug?: any;
}
