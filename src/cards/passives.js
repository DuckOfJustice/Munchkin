// Dauerwirkungen von Karten: Regeln, die ohne Zutun gelten, sobald die Karte
// im Spiel ist. Kuratiert statt per Regex - die Formulierungen auf den Karten
// sind zu uneinheitlich ("Elfen haben -4!" gegenüber "+6 gegen Elfen").
module.exports = (ctx) => {
  const { hasRace, hasClass, card, equippedItemIds } = ctx;

  // --- Fluchschutz -----------------------------------------------------------
  // SCHUTZSANDALEN: "Flüche, die du ziehst, nachdem du eine Tür
  // eintrittst, haben keine Wirkung. (Flüche von anderen Spielern wirken
  // weiterhin auf dich.)" Deshalb wird das NUR in handleDrawDoor geprüft.
  const CURSE_PROOF_ITEMS = new Set(['SCHUTZSANDALEN']);

  // --- Monster, die bestimmte Munchkins gar nicht angreifen ------------------
  // "Greift niemanden mit Stufe X oder niedriger an." Das Monster zieht weiter:
  // kein Kampf, kein Schatz, keine Stufe. Die Karte wandert auf den Ablage-
  // stapel und der Zug läuft normal mit Phase 2 weiter - damit bleiben beide
  // regulären Optionen offen (Monster aus der Hand spielen oder plündern).
  const MONSTER_REFUSES = {
    'PLUTONIUMDRACHE': (p) => p.level <= 5,
    'BULLROG': (p) => p.level <= 4,
    // "Greift niemanden mit Stufe 4 oder niedriger an, AUSSER Elfen."
    'KRAKZILLA': (p) => p.level <= 4 && !hasRace(p, 'ELF'),
    'HIPPOGREIF': (p) => p.level <= 3,
    'KÖNIG TUT': (p) => p.level <= 3,
    'GRUFTIGE GEBRÜDER': (p) => p.level <= 3,
    // "Greift keinen Dieb an (berufliche Höflichkeit)." Die zusätzliche
    // Dieb-Option (2 Schätze tauschen) bleibt manuell.
    'ANWALT': (p) => hasClass(p, 'DIEB'),
  };

  // --- Monster, die eine Rasse automatisch totstampft ----------------------
  // "Halblinge koennen sie einstampfen und automatisch toeten." Umgesetzt als
  // Staerke 0 in der Kampfrechnung: besiegt wird das Monster dann ueber die
  // normale Auswertung, Stufe und Schatz gibt es also trotzdem.
  const MONSTER_AUTO_KILL_BY_RACE = {
    'GEWALTIGER BAZILLUS': 'HALBLING',
  };

  // --- Monster, an denen man auch einfach vorbeigehen darf -----------------
  // "Waehle aus: kaempfen oder einfach vorbeigehen und winken und ihm seinen
  // Schatz lassen. (Ausnahme: Halblinge schauen lecker aus und muessen
  // kaempfen.)" Gilt nur fuer aufgedeckte Monster - ein aus der Hand
  // gespieltes Monster hat sich die kaempfende Person selbst eingeladen.
  const MONSTER_PASS_OPTION = {
    'BEKIFFTER GOLEM': { forcedFightRaces: ['HALBLING'] },
  };

  // --- Monster, die statt des Kampfes eine Alternative anbieten -------------
  // Gleiche Bauform wie MONSTER_PASS_OPTION oben, nur mit einer zusaetzlichen
  // Bedingung: die Alternative wird nur angeboten, wenn sie ueberhaupt nutzbar
  // ist (Klasse bzw. passender Gegenstand vorhanden).
  // ponytail: "Stab oder Aehnliches" (PIT BULL) laesst sich nicht aus dem
  // Kartentext ableiten - deshalb die kuratierte Liste STAFF_ITEMS. Neue
  // Staebe hier ergaenzen. "Fallen lassen" heisst getragen: nur equipped.
  const STAFF_ITEMS = new Set(['NAPALMSTAB', 'STANGE, 11-FUSS']);

  function hatStab(player) {
    return equippedItemIds(player).some((id) => { const c = card(id); return c && STAFF_ITEMS.has(c.name); });
  }
  // LAUFENDE NASE nennt einen festen Goldwert (200) - im Gegensatz zu
  // STAFF_ITEMS also direkt aus dem Kartentext ableitbar. "Bestechen" nennt
  // keinen getragenen Gegenstand, also equipped + Hand, wie ueberall sonst
  // im Server bei Goldwert-Bedingungen (pickItemsWorthGold, ZUNGENDÄMON).
  function hatGegenstandAbGold(player, minGold) {
    return equippedItemIds(player).concat(player.hand)
      .some((id) => { const c = card(id); return c && (c.gold || 0) >= minGold; });
  }

  const COMBAT_START_OPTIONS = {
    // "Statt zu kaempfen kann ein Priester den Moechtegern-Vampir wegjagen,
    // indem er 'Booga Booga' ruft und seinen Schatz nimmt. Steige keine Stufe
    // auf dafuer!"
    'MÖCHTEGERN-VAMPIR': {
      wennErfuellt: (p) => hasClass(p, 'PRIESTER'),
      label: 'Als Priester wegjagen (Schatz, keine Stufe)',
      action: { type: 'wegjagenMitSchatz' },
    },
    // "Willst du die Laufende Nase nicht bekaempfen, so bestich sie mit einem
    // Gegenstand im Wert von wenigstens 200 Goldstuecken und sie laesst dich
    // gehen."
    'LAUFENDE NASE': {
      wennErfuellt: (p) => hatGegenstandAbGold(p, 200),
      label: 'Mit einem Gegenstand (mind. 200 GS) bestechen',
      action: { type: 'bribeMonster', minGold: 200 },
    },
    // "Kannst du ihn nicht besiegen, darfst du ihn ablenken (automatische
    // Flucht), indem du einen Stab oder Aehnliches fallen laesst."
    'PIT BULL': {
      wennErfuellt: (p) => hatStab(p),
      label: 'Mit einem Stab ablenken (automatische Flucht)',
      action: { type: 'dropStaffEscape' },
    },
  };

  // --- Monster, die VOR dem Kampf einen Gegenstand kosten --------------------
  // Keine Wahl, OB abgelegt wird (anders als COMBAT_START_OPTIONS oben) - nur
  // WELCHER Gegenstand, siehe die discardOwn-Wahl beim Kampfstart in
  // server.js/handleDrawDoor.
  const COMBAT_START_COST = {
    // "Lege einen Gegenstand deiner Wahl VOR dem Kampf ab." Das Kartentext-
    // eigene "+4 gegen Priester" steht in MONSTER_TRAIT_BONUS, der Stufen-
    // verlust als Badstuff in CONSEQUENCE_OVERRIDES (src/cards/consequences.js)
    // - beide bleiben von diesem Vorab-Preis unberuehrt.
    'ZUNGENDÄMON': true,
  };

  // --- Monsterboni gegen Rassen/Klassen --------------------------------------
  // Der Bonus gilt einmal pro Monster, sobald IRGENDWER auf der Munchkin-Seite
  // die Rasse/Klasse hat (Angreifer:in oder Helfer:in) - nicht einmal pro
  // Person.
  const MONSTER_TRAIT_BONUS = {
    'UNGLAUBLICHER UNAUSSPRECHLICHER SCHRECKEN': { classes: ['KRIEGER'], bonus: 4 }, // "+4 gegen Krieger."
    'KREISCHENDER DEPP': { classes: ['KRIEGER'], bonus: 6 },                         // "+6 gegen Krieger."
    'ZUNGENDÄMON': { classes: ['PRIESTER'], bonus: 4 },                          // "+4 gegen Priester."
    'HAMMER-RATTE': { classes: ['PRIESTER'], bonus: 3 },                              // "+3 gegen Priester."
    'ENTIKOR': { classes: ['ZAUBERER'], bonus: 6 },                                   // "+6 gegen Zauberer."
    'HARFIEN': { classes: ['ZAUBERER'], bonus: 5 },                                   // "+5 gegen Zauberer."
    'BIGFOOT': { races: ['ZWERG', 'HALBLING'], bonus: 3 },                            // "+3 gegen Zwerge und Halblinge."
    '3.872 ORKS': { races: ['ZWERG'], bonus: 6 },                                     // "+6 gegen Zwerge wegen uralter Feindschaft."
    'UNTOTES PFERD': { races: ['ZWERG'], bonus: 5 },                                  // "+5 gegen Zwerge."
    'GESICHTSSAUGER': { races: ['ELF'], bonus: 6 },                                   // "+6 gegen Elfen."
    'LEPRACHAUN': { races: ['ELF'], bonus: 5 },                                       // "+5 gegen Elfen."
    'SABBERNDER SCHLEIM': { races: ['ELF'], bonus: 4 },                               // "+4 gegen Elfen."
    'KRAKZILLA': { races: ['ELF'], bonus: 4 },                                        // "Elfen haben -4!" = +4 für das Monster
    // Halbling-Boni aus Unnatural Axe und Clerical Errors - ohne die war die
    // Rasse gegen genau die Monster wirkungslos, die sie ausdrücklich nennen.
    'PTERODAKTYL': { races: ['HALBLING'], bonus: 5 },                                 // "+5 gegen zarte, leckere Halblinge."
    'FÜRCHTERLICHE CLOWNS': { races: ['HALBLING'], bonus: 5 },                        // "+5 gegen Halblinge."
    'STRICHMÄNNCHEN': { races: ['HALBLING'], bonus: 4 },                               // "+4 gegen Halblinge."
    'AFFENBANDE': { races: ['HALBLING'], bonus: 2 },                                  // "+2 gegen Halblinge."
    'ÜBERBÄR': { races: ['HALBLING', 'ZWERG'], bonus: 5 },                             // "+5 gegen Halblinge und Zwerge."
    'FÜRST YAHOO': { races: ['ELF', 'HALBLING'], classes: ['BARDE'], bonus: 5 },       // "+5 gegen Elfen, Barden und Halblinge."
  };

  // --- Monster, die die Kampfrechnung selbst verändern ---------------------
  // "Deine Stufe zählt nicht im Kampf. Bekämpfe ihn nur mit deinen Boni!"
  const MONSTER_IGNORES_LEVEL = new Set(['VERSICHERUNGSVERTRETER']);
  // "Gegen sie dürfen keine Gegenstände oder andere Boni eingesetzt werden
  // - kämpfe nur mit deiner Charakterstufe."
  const MONSTER_IGNORES_BONUSES = new Set(['GEMEINE GHOULE']);
  // "Niemand kann dir helfen. Du musst dich dem Pavillon allein stellen."
  const MONSTER_FORBIDS_HELP = new Set(['PAVILLON']);
  // Die ersten beiden Regeln gelten für die ganze Munchkin-Seite: sobald
  // jemand mithilft, kämpfen beide gegen dasselbe Monster, also trifft die
  // Einschränkung auch die Helfer:in.

  // --- Weglaufen -------------------------------------------------------------
  // Feste Modifikatoren, die ohne Zutun gelten. Der Zauberer-Flugzauber ("+1
  // pro abgelegter Karte") steht bewusst NICHT hier - er kostet Karten und
  // bleibt darum eine manuelle Eingabe im Weglaufen-Feld.
  const FLEE_ITEM_BONUS = {
    'STIEFEL ZUM ECHT SCHNELLEN DAVONLAUFEN': 2, // "Sie geben dir einen +2 Bonus auf Weglaufen."
    'TUBA DER VERZAUBERUNG': 3,                  // "... und gibt dir +3 auf Weglaufen."
  };
  const FLEE_MONSTER_MOD = {
    'SCHNECKEN AUF SPEED': -2, // "Du hast -2 auf Weglaufen."
    'FLIEGENDE FROSCHE': -1,   // "Du hast -1 auf Weglaufen."
    'GALLERT-OKTAEDER': 1,     // "Du hast +1 auf Weglaufen."
    'LAHMER GOBLIN': 1,        // "Du hast +1 auf Weglaufen."
  };
  // FILZLAUSE: "Denen kannst du nicht entkommen!"
  // LAUFENDE NASE: "Verlierst du den Kampf, kannst du nicht fliehen."
  const FLEE_IMPOSSIBLE = new Set(['FILZLAUSE', 'LAUFENDE NASE']);
  // TOPFPFLANZE, Schlimme Dinge: "Keine. Automatische Flucht."
  const FLEE_AUTOMATIC = new Set(['TOPFPFLANZE']);
  // Stufenverlust trotz gelungener Flucht.
  const FLEE_PENALTY = {
    'MR. BONES': () => 1,                          // "Auch bei einer erfolgreichen Flucht verlierst du 1 Stufe."
    'KÖNIG TUT': (p) => (p.level > 3 ? 2 : 0), // "Charaktere mit höherer Stufe verlieren zwei Stufen, auch wenn sie fliehen."
    'GRUFTIGE GEBRÜDER': (p) => (p.level > 3 ? 2 : 0),
  };
  // "Falls du erfolgreich Weglaufen kannst, zieh dir auf dem Weg nach draußen
  // noch verdeckt eine Schatzkarte."
  const FLEE_TREASURE_ITEMS = new Set(['TUBA DER VERZAUBERUNG']);

  // --- Bonusstufen und Bonusschätze beim Sieg ------------------------------
  // "Wenn du dieses Monster während deines Zugs besiegst, erhältst du eine
  // zusätzliche Stufe." (In diesem Server findet ein Kampf immer im eigenen
  // Zug statt, die Bedingung ist also erfüllt.)
  const MONSTER_EXTRA_LEVEL = new Set(['PLUTONIUMDRACHE', 'BULLROG', 'KRAKZILLA', 'HIPPOGREIF', 'KÖNIG TUT', 'GRUFTIGE GEBRÜDER']);
  // "Du gewinnst eine zusätzliche Stufe, wenn du es mit Feuer oder Flammen
  // besiegst."
  // ponytail: feste Liste der Feuer-Gegenstände des Basis-Sets - "Feuer oder
  // Flammen" lässt sich nicht zuverlässig aus dem Text ableiten. Neue
  // Feuerkarten hier ergänzen.
  const FIRE_ITEMS = new Set(['FLAMMENDE RÜSTUNG', 'NAPALMSTAB']);

  // --- Klassenkräfte: Karten im Kampf abwerfen ------------------------------
  // Drei der vier Basis-Klassen haben dieselbe Form: bis zu 3 Handkarten
  // abwerfen, jede gibt einen festen Bonus. Dafür gab es bisher überhaupt
  // keinen Weg im Spiel - nur das manuelle Bonus-Zahlenfeld, das aber keine
  // Karte abwirft.
  //
  // KRIEGER "Berserken": "Du darfst bis zu 3 Karten im Kampf ablegen. Jede
  // verleiht einen +1 Bonus."
  // PRIESTER "Vertreiben": "Du darfst bis zu 3 Karten in einem Kampf gegen eine
  // Untote Kreatur ablegen. Jede abgelegte Karte gibt dir +3 Bonus."
  const CLASS_COMBAT_DISCARD = {
    'KRIEGER': { bonus: 1, max: 3, label: 'Berserken' },
    'PRIESTER': { bonus: 3, max: 3, label: 'Vertreiben', requiresUndead: true },
  };

  // ponytail: cards.json kennt kein "Untot"-Merkmal - im Basis-Set steht es auf
  // keiner einzigen Monsterkarte im Text. Deshalb diese kuratierte Liste; sie
  // ist die EINZIGE Stelle, an der "untot" in diesem Server definiert ist.
  // Stimmt sie nicht mit euren Karten überein, hier korrigieren.
  const UNDEAD_MONSTERS = new Set(['MR. BONES', 'UNTOTES PFERD', 'KÖNIG TUT', 'GRUFTIGE GEBRÜDER']);

  // ZAUBERER "Flugzauber": "Du darfst bis zu 3 Karten ablegen, nachdem du
  // deinen Weglaufwurf gemacht hast. Jede verleiht dir +1 Bonus auf Weglaufen."
  // ponytail: hier VOR dem Wurf, weil dieser Server den Wurf sofort auflöst -
  // eine Zwischenphase "gewürfelt, aber noch nicht entschieden" gäbe es
  // bisher nirgends. Wer den Kartentext wörtlich will, braucht genau die.
  const CLASS_FLEE_DISCARD = {
    'ZAUBERER': { bonus: 1, max: 3, label: 'Flugzauber' },
  };

  // Ein paar Gegenstände geben laut Kartentext einen zusätzlichen Bonus/Malus,
  // der vom konkreten Monster im aktuellen Kampf abhängt (equippedBonusSum
  // summiert nur den festen Grundbonus). Nur die Fälle, die sich anhand
  // vorhandener Daten (Rasse, exakter Monstername) eindeutig berechnen lassen -
  // Fälle, die einen fehlenden Datenpunkt bräuchten (z.B. eine "Untot"- oder
  // "feuerimmun"-Kennzeichnung auf Monsterkarten, die es in den Daten nicht
  // gibt), bleiben bewusst manuell (siehe README, Abschnitt Item-Sonderfälle).
  const ITEM_CONDITIONAL_BONUS = {
    // "+2 Bonus für Elfen" - Grundbonus ist 1, für Elfen kommt 1 dazu.
    'GEILER HELM': (player, monsters) => (hasRace(player, 'ELF') ? 1 : 0),
    // "+10 gegen alles, was mit dem Buchstaben J beginnt."
    'VORPALE KLINGE': (player, monsters) => (monsters.some((m) => /^J/i.test(m.name || '')) ? 10 : 0),
    // "Gibt keinen Bonus gegen Krakzilla" - hebt den gedruckten Bonus (+4) wieder auf.
    'ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT': (player, monsters) => (monsters.some((m) => m.name === 'KRAKZILLA') ? -4 : 0),
    // "+5 gegen die Laufende Nase und den Schatten."
    'SCHRECKLICHE SOCKEN': (player, monsters) => (monsters.some((m) => m.name === 'LAUFENDE NASE' || m.name === 'SCHATTEN') ? 5 : 0),
  };

  // Karten, die angelegt werden, aber auf keinen der klassischen Plaetze
  // gehoeren: Kartenname -> Platz in player.equipped (plus optionale
  // Rassenbedingung). Ein weiterer Platz ist eine Zeile hier, die Labels gehen
  // ueber publicState an den Client - kein Namensspiegel im Frontend.
  const SPECIAL_SLOT_ITEMS = {
    'SINGENDES & TANZENDES SCHWERT': { slot: 'special' },
    'STRUMPFHOSE DER RIESENSTÄRK': { slot: 'special' },
    'WIRKLICH BEEINDRUCKENDER TITEL': { slot: 'special' },
    'VERDUNKELUNGSUMHANG': { slot: 'special' },
    'TRITTLEITER': { slot: 'special' },
    // "aber nur fuer Halblinge"
    'LIMBURGER UND SARDELLEN-SANDWICH': { slot: 'special', races: ['HALBLING'] },
    'SPIESSIGE KNIE': { slot: 'special' },
  };
  // Ein Spezialplatz ist ein Sammelbereich: beliebig viele Karten liegen dort
  // nebeneinander (anders als Kopf/Ruestung/Schuhe/Haende).
  const SPECIAL_SLOTS = {
    special: { label: 'Spezialausrüstung' },
  };

  return {
    CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_AUTO_KILL_BY_RACE,
    MONSTER_PASS_OPTION, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
    MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP, FLEE_ITEM_BONUS,
    FLEE_MONSTER_MOD, FLEE_IMPOSSIBLE, FLEE_AUTOMATIC, FLEE_PENALTY,
    FLEE_TREASURE_ITEMS, MONSTER_EXTRA_LEVEL, FIRE_ITEMS,
    CLASS_COMBAT_DISCARD, UNDEAD_MONSTERS, CLASS_FLEE_DISCARD,
    ITEM_CONDITIONAL_BONUS, SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS,
    COMBAT_START_OPTIONS, COMBAT_START_COST, STAFF_ITEMS,
  };
};
