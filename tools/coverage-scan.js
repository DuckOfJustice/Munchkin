// Abdeckungs-Scan: welche Basis-Set-Karte hat KEINEN automatischen
// Ausspielweg? Aufruf: node tools/coverage-scan.js
//
// Jede Ausgabezeile ist entweder eine Luecke oder gehoert in die Liste der
// bewusst nicht umgesetzten Karten (HANDOVER.md 8.6). Wer eine neue
// Kartentabelle einfuehrt, traegt sie unten in abgedeckt() nach - sonst
// meldet der Scan sie faelschlich als Luecke.
const S = require('../server.js');
const SET = process.argv[2] || 'base';
const base = S.ALL_CARDS.filter((c) => c.set === SET);
const p = { id: 'p1', name: 'T', level: 5, hand: [], races: [], classes: [], powerGroups: [],
  equipped: S.newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [] };
const room = { doorDiscard: [], treasureDiscard: [], players: [p], logs: [] };

// Von Hand gepflegte Einzelfaelle, die keine Tabelle haben, aber einen Handler.
const HANDGEBAUT = new Set([
  'SCHUMMELN!',                  // handlePlayCheat (M5)
  'KNIESCHÜTZER DER VERLOCKUNG', // handleRequestHelp/checkWin (M5/M6)
  'SUPER MUNCHKIN', 'HALB-BLUT', // traitImmun in monsterTraitBonusSum
  // Clerical Errors: wirken ohne Ausspielweg, sobald sie getragen werden -
  // fluchZiel() in server.js fragt sie beim Eintreffen jedes Fluchs ab.
  'DAS MANCHMAL VERLÄSSLICHE AMULETT', 'PRÄCHTIGER HUT',
]);

const abgedeckt = (c) => HANDGEBAUT.has(c.name)
  || S.LINGERING_CURSES[c.name] !== undefined
  || S.COMBAT_REACTION_CARDS[c.name] !== undefined
  || S.DOOR_POWER_CARDS[c.name] !== undefined
  || S.DOOR_COMBAT_CARDS[c.name] !== undefined
  || S.TREASURE_POWER_OVERRIDES[c.name] !== undefined
  || S.SPECIAL_SLOT_ITEMS[c.name] !== undefined
  || S.ROLL_REACTION_CARDS.has(c.name)
  || S.ESCAPE_REACTION_CARDS.has(c.name)
  || S.LAMP_CARDS.has(c.name)
  || S.GUARANTEED_FLEE_CARDS.has(c.name)
  || S.POST_FLEE_ESCAPE_CARDS.has(c.name)
  || S.isMonsterEnhancerCard(c)
  || S.isInstantLevelUpCard(c)
  || S.isCombatPotionCard(c)
  // Clerical Errors: Rassen/Klassen in "door_other" (ORK/GNOM/BARDE),
  // Kartenanhaenge (VERGIFTET/GESEGNET/NÜTZLICHE GRIFFE) und Gegenstaende,
  // die eine Rasse/Klasse verleihen (FALSCHE OHREN/ZAUBERCOUCH).
  || S.TRAIT_DOOR_CARDS[c.name] !== undefined
  || S.ATTACHMENT_CARDS[c.name] !== undefined
  || S.ITEM_GRANTS_TRAIT[c.name] !== undefined;

const zeile = (c) => ` - ${c.name}  ::  ${String(c.text || c.badstuff || '').replace(/<br>/g, ' | ').slice(0, 160)}`;

console.log('### MONSTER: badstuff ohne Automatik');
base.filter((c) => c.category === 'monster').forEach((c) => {
  let spec = null;
  try { spec = S.resolveConsequenceSpec(c.name, c.badstuff, p, room); } catch (e) { spec = 'ERR ' + e.message; }
  if (!spec) console.log(zeile(c));
});

console.log('\n### FLUCH/DOOR_OTHER_AS_CURSE ohne Automatik');
base.filter((c) => c.category === 'curse' || S.DOOR_OTHER_AS_CURSE.has(c.name)).forEach((c) => {
  let spec = null;
  try { spec = S.resolveConsequenceSpec(c.name, c.text || c.badstuff, p, room); } catch (e) { spec = 'ERR ' + e.message; }
  if (!spec && !abgedeckt(c)) console.log(zeile(c));
});

console.log('\n### door_other ohne jede Automatik');
base.filter((c) => c.category === 'door_other' && !S.DOOR_OTHER_AS_CURSE.has(c.name) && !abgedeckt(c))
  .forEach((c) => console.log(zeile(c)));

console.log('\n### treasure_other ohne jede Automatik');
base.filter((c) => c.category === 'treasure_other' && !abgedeckt(c))
  .forEach((c) => console.log(zeile(c)));
