# Design Spec: Unnatural Axe Türkarten - Welle C

## Scope
Diese Spezifikation umfasst die verbleibenden 2 Türkarten der Unnatural Axe Erweiterung, die asynchrone Spielmechaniken und Deck-Interaktionen erfordern:
- **SCHICKSALHAFTE KARTEN** (Handkarten abwerfen und gezielt neu ziehen)
- **FINDE EINE KARTE** (Oberste 3 Türkarten sortieren)

## Architektur & Mechanik

### 1. SCHICKSALHAFTE KARTEN
**Kartentext:** *Spiele diese Karte jederzeit während deines Zuges aus. Lege eine beliebige oder alle Karten deiner Hand ab und ziehe dieselbe Anzahl verdeckter Karten aus einem der Decks.*
- **Kategorie & Auslösung:** Die Karte gehört zu `DOOR_POWER_CARDS`. Sie kann jederzeit im eigenen Zug (nicht im Kampf) gespielt werden.
- **Frontend-UI (Client):** 
  Wir führen einen generischen Handkarten-Selektions-Modus ein (`pendingCardAction.kind === 'multiCardSelection'`).
  - Wenn aktiv, werden Klicks auf eigene Handkarten nicht für normale Aktionen genutzt, sondern fügen die Karte einem lokalen `Set` (z.B. `multiSelection`) hinzu. 
  - Die Karten werden visuell gehighlightet (z.B. über eine CSS-Klasse `.selected`).
  - Eine neue Leiste im Hand-Bereich (ähnlich der `sellBar`) zeigt die Anzahl der markierten Karten sowie zwei Buttons an:
    - "X Karten abwerfen und [Türen] ziehen"
    - "X Karten abwerfen und [Schätze] ziehen"
- **Backend-Flow:**
  - `playDoorPower` für SCHICKSALHAFTE KARTEN setzt `room.pendingCardAction = { kind: 'multiCardSelection', sourceCardId, actionType: 'schicksalhafteKarten' }`.
  - Der Server erhält ein neues Event `resolveMultiCardSelection` mit den ausgewählten `cardIds` und der Wahl des `deck` (door/treasure).
  - Die Karten werden abgeworfen (`discardCard`), anschließend werden `cardIds.length` viele Karten vom gewählten Deck an den Spieler ausgeteilt.

### 2. FINDE EINE KARTE
**Kartentext:** *Spiele diese Karte jederzeit während deines Zuges aus, schau dir die drei nächsten Türkarten des Decks an und ordne sie in beliebiger Reihenfolge. Zeige sie nicht den anderen Spielern.*
- **Kategorie & Auslösung:** Gehört zu `DOOR_POWER_CARDS`. Jederzeit im eigenen Zug spielbar.
- **Backend-Flow (Choice-Dialog Kette):**
  - Beim Ausspielen prüft der Server, ob das Tür-Deck (inkl. Ablagestapel zum Nachmischen) mindestens 3 Karten enthält.
  - Er zieht (entfernt) die obersten 3 Karten und speichert sie im State (z.B. in `room.pendingCardAction.context.cardsToSort`).
  - Er öffnet einen normalen `choice`-Dialog (`openCardChoice`) an den Spieler: "Welche Karte soll ganz NACH OBEN auf das Deck?" (Optionen sind die 3 gezogenen Karten).
  - Nach der Auswahl wird die gewählte Karte in `context.sortedCards` gespeichert.
  - Der Server öffnet direkt den nächsten Choice-Dialog für die restlichen 2 Karten: "Welche Karte soll als ZWEITES auf das Deck?".
  - Nach dieser Wahl ist die letzte Karte automatisch die unterste der 3.
  - Der Server legt die Karten in der gewählten Reihenfolge (`unshift`) wieder auf das `doorDeck` und beendet die Aktion.
- **Vorteil:** Komplette Wiederverwendung der bereits bestehenden, sehr robusten `openCardChoice` und `handleResolveCardChoice` Mechanik im Client. Keine Frontend-Änderungen nötig.
