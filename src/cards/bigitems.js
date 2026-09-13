// "Grosser Gegenstand": Nicht-Zwerge duerfen nur EINEN tragen.
//
// ponytail: kuratierte Namensliste statt eines Feldes in data/cards.json -
// dieselbe Bauform wie UNDEAD_MONSTERS, damit die Liste an genau einer Stelle
// korrigierbar bleibt. Die Rohdaten kennen kein "gross"-Merkmal, und die
// Kartenbilder unter public/images/ enthalten nur Artwork, keinen Text.
//
// Diese acht wurden am 2026-09-12 mit dem Nutzer gegen die echten Karten
// abgeglichen. Ausdruecklich NICHT gross, obwohl zunaechst vermutet:
// BOGEN MIT BUNTEN BAENDERN, STRUMPFHOSE DER RIESENSTAERK, NAPALMSTAB,
// KURZE BREITE RUESTUNG. Stimmt etwas nicht mit euren Karten ueberein, hier
// korrigieren - sonst nirgends.
const BIG_ITEMS = new Set([
  'KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG',
  'STANGE, 11-FUSS',
  'RIESIGER FELS',
  'MITHRIL-RÜSTUNG',
  'SCHWEIZER ARMEEHELLEBARDE',
  'GANZKÖRPER-SCHILD',
  'TUBA DER VERZAUBERUNG',
  'TRITTLEITER',
]);

function isBigItem(c) {
  return !!c && BIG_ITEMS.has(c.name);
}

module.exports = { BIG_ITEMS, isBigItem };
