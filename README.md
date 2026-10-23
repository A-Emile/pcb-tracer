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

Geplant: Signale verfolgen, Notizen und Markierungen, Export/Import, Nahaufnahmen.

## Technik

Eine einzige Datei (`index.html`), kein Build-Schritt. WebGL2 für die Darstellung, Web Worker für
Import, Einrasten und Via-Suche. Zuordnung der Seiten: Perspektive plus Thin-Plate-Spline durch alle Paare.
