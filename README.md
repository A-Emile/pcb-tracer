# PCB Tracer

Browser-Werkzeug zum Reverse Engineering von Platinen aus zwei Handyfotos (Ober- und Unterseite).
Läuft komplett lokal im Browser, auf dem Handy genauso wie am Desktop. Fotos und Projekte bleiben im
Browser-Speicher des Geräts (IndexedDB) und werden nirgends hochgeladen.

**Starten:** https://a-emile.github.io/pcb-tracer/

## Stand

- Projekte anlegen, wechseln, löschen (mit Rückgängig)
- Ansicht in voller Fotoauflösung (Kacheln), Zoomen/Verschieben per Finger, Maus oder Mausrad
- Durchsicht: Ober- und Unterseite überblenden oder per Halten kurz umschalten
- Ausrichten: Via-Paare von Hand setzen (Lupe, Einrasten auf Vias, Vorschlag des Gegenstücks),
  weitere Paare automatisch vorschlagen lassen, Abweichung je Paar als Ampelfarbe
- Ansicht drehen und spiegeln (zwei Finger, Ansicht ⟲ ⟳ Spiegeln, Tasten R / Umschalt+R / F), Kompass setzt zurück
- Platine gerade stellen (⋯ → Gerade stellen): Linie entlang einer Bahn ziehen oder 4 Ecken antippen
- Bahnen nachziehen (Bahnen, Desktop X): Ecken mit Lupe bzw. Klick. Einrasten zurückhaltend: kleiner Fang am Bildschirm,
  nur wenn das Ziel eindeutig ist, Vorschau als Ring in der Lupe; „Fang“ in der Leiste schaltet es ab (Desktop: Umschalt halten).
  Ziele: Foto-Vias (nur als Ecke), eigene Vias/Pads/Ecken/Bahnen (Abzweig). Winkel frei mit Einrasten nahe 0/45/90° oder nur 45°,
  Breite (W), letzte Ecke zurück (↶, Rücktaste), beenden (Doppeltipp/Doppelklick, Ende, Esc).
  Vias entstehen nur bewusst: Via (V) an der letzten Ecke beendet die Bahn, „Via“ im Menü einer Ecke; Größe in Stufen im Via-Menü.
  Tipp auf das Via startet auf der anderen Lage neu. Netze werden automatisch erkannt, Antippen hebt hervor, Benennen über das Menü;
  benannte Netze zeigen ihren Namen entlang der Bahn (Ansicht → Objekte → Netznamen)

Geplant: Bahnen bearbeiten, Netzliste, Export/Import, Nahaufnahmen.

## Technik

TypeScript-Module ohne Framework, gebaut mit Vite. WebGL2 für die Darstellung, ein Modul-Worker für
Import, Einrasten, Via-Suche und das Material-Modell; die Material-Masken rechnet die GPU je Kachel beim Anzeigen
(`material/gpu.ts`, Shader-Durchgänge, nichts gespeichert). Zuordnung der Seiten: Perspektive plus Thin-Plate-Spline durch alle Paare.
Aufbau: `src/main.ts` (Start), `src/state.ts` + `src/types.ts` (Zustand, Kern-Typen), darunter je Thema ein Ordner
(`render/`, `align/`, `snap/`, `material/`, `layers/`, `draw/`, `ui/`, `db/`, `worker/`).

## Entwickeln

```
npm install
npm run dev        # Entwicklungsserver mit Neuladen
npm run build      # Typprüfung + Build nach dist/ (relative Pfade, läuft unter jedem Pfad)
npm run watch      # baut dist/ bei jeder Änderung neu
npm run typecheck  # nur tsc --noEmit
```

Testhilfen: mit `?dev` in der URL liegen alle Exporte der Module als globale Namen auf `window`
(für Testskripte), dazu `__devImport(name, urlOben, urlUnten)`.

GitHub Pages baut die Action `.github/workflows/pages.yml` bei jedem Push auf `main`.
