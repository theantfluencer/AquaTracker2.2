# AquaTracker 2.2

## Installation auf GitHub Pages

1. Inhalt dieses Ordners in das Root-Verzeichnis des GitHub-Repositories hochladen.
2. Unter **Settings → Pages** als Quelle **Deploy from a branch** wählen.
3. Branch **main** und Ordner **/(root)** auswählen.
4. Nach dem Deployment die Seite einmal neu laden.

Wichtig: Beim Update von einer älteren Version kann der Browser noch einen alten Service Worker zwischenspeichern. Dann die Seite zweimal neu laden oder die Website-Daten im Browser löschen.

## Funktionen

- Mehrere Aquarien
- Individuelle Dashboard-Reihenfolge per Drag & Drop
- Pflegezustand je Aquarium
- Wiederkehrende Pflegepläne
- Kalender und Historie
- Ereignisse nachträglich bearbeiten und löschen
- Korrekte Rückrechnung des Produktbestands bei Änderungen
- Fotos über Kamera oder Galerie
- Benennbare Fotos
- Aquarium-Titelbild
- Wasseranalyse mit wählbaren Parametern
- Produktkatalog und globaler Bestand
- Offline-PWA
- Datenexport und Datenimport

Fotos werden lokal im Browser in IndexedDB gespeichert. Die restlichen Daten liegen in localStorage.
