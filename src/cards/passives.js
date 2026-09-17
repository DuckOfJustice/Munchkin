// Dauerwirkungen von Karten: Regeln, die ohne Zutun gelten, sobald die Karte
// im Spiel ist. Kuratiert statt per Regex - die Formulierungen auf den Karten
// sind zu uneinheitlich ("Elfen haben -4!" gegenüber "+6 gegen Elfen").
module.exports = (ctx) => {
  const {
    hasRace, hasClass, card, equippedItemIds, istGeschlecht, monsterSeesRace, handItemIds,
  } = ctx;

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
    // "Greift niemanden mit Stufe 2 oder niedriger an."
    'SIEBENJÄHRIGER LICH': (p) => p.level <= 2,
    // "Greift keine Spielerinnen oder geschlechtsumgewandelte Spieler an. Sie
    // erhalten stattdessen 1 Schatz." Alle starten maennlich, geaendert wird
    // das Geschlecht nur durch Karten - "geschlechtsumgewandelt" ist hier also
    // deckungsgleich mit "weiblich". Den Schatz gibt MONSTER_REFUSES_TREASURE.
    'AMAZONE': (p) => istGeschlecht(p, 'w'),
    // --- Unnatural Axe ---
    'FEUERLÖSCHER': (p) => p.level <= 2,   // "Greift niemanden mit Stufe 2 oder niedriger an."
    'TENTAKELDÄMON': (p) => p.level <= 2,  // "Greift niemanden mit Stufe 2 oder niedriger an."
    'JABBERWOCK': (p) => p.level <= 4,     // "Greift niemanden mit Stufe 4 oder niedriger an."
    // "Greift keine Frauen an oder Traeger des Stacheligen Genitalschoners."
    // ponytail: nur die Geschlechts-Klausel. Der STACHELIGE GENITALSCHONER
    // liegt in den Rohdaten als treasure_other ohne slotKind und laesst sich
    // deshalb gar nicht tragen - die Klausel kommt in der Runde nach, in der
    // die Unnatural-Axe-Schatzkarten ihren Slot bekommen.
    'PSYCHO-EICHHÖRNCHEN': (p) => istGeschlecht(p, 'w'),
    // "Fluechtet vor Orks, statt anzugreifen und hinterlaesst den Schatz."
    'PESTRATTEN': (p) => hasRace(p, 'ORK'),
  };

  // Monster aus MONSTER_REFUSES, die beim Weiterziehen trotzdem etwas
  // dalassen: Kartenname -> Anzahl Schatzkarten.
  const MONSTER_REFUSES_TREASURE = {
    'AMAZONE': 1,
    'PESTRATTEN': 2,  // "... und hinterlaesst den Schatz." - die Karte nennt 2 Schaetze.
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
  // nurRassen ist die Umkehrung von forcedFightRaces: nicht "alle ausser
  // diesen", sondern "nur diese".
  const MONSTER_PASS_OPTION = {
    'BEKIFFTER GOLEM': { forcedFightRaces: ['HALBLING'] },
    // "Elfen finden ihn niedlich und bekaempfen ihn vielleicht nicht (Karte
    // einfach abwerfen) oder helfen nicht."
    'BOBBELKOPF': { nurRassen: ['ELF'] },
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
    // "Wenn du keine Gegenstaende im Spiel hast, erhaeltst du einen von der
    // Packratte. Ziehe zwei offene Schaetze und waehle einen aus. Du kannst
    // stattdessen auch kaempfen, wenn du moechtest."
    'PACKRATTE': {
      wennErfuellt: (p) => equippedItemIds(p).length === 0,
      label: 'Geschenk annehmen (2 offene Schaetze, einen behalten)',
      action: { type: 'packratteGeschenk' },
    },
    // ponytail: EISKALTES HÄNDCHEN bewusst NICHT hier verdrahtet. Sein
    // Kampftext bietet keine Alternative WIE oben (bestechen/ablenken/
    // Geschenk), sondern ersetzt den Kampf komplett durch einen Wunschring -
    // und die Monsterkarte selbst wird danach ein +3-Gegenstand in der Hand.
    // Das sprengt die Aktions-Bauform hier (die Optionen oben aendern nie die
    // Kategorie der Karte) und braucht eher einen eigenen primitiven Typ
    // (Monster -> Gegenstand). Die Schlimmen Dinge sind schon verdrahtet,
    // nur dieser Kampf-Alternativpfad fehlt - siehe Design-Spec §6, Welle 3
    // (docs/superpowers/specs/2026-09-16-unnatural-axe-monster-design.md).
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

  // --- Rassen/Klassen, die in den Rohdaten als "door_other" stehen ----------
  // ORK, GNOM (Clerical Errors / Unnatural Axe) und BARDE sind Rassen- bzw.
  // Klassenkarten, haben in data/cards.json aber category "door_other" - ohne
  // diese Tabelle laesst handlePlayRaceOrClass sie gar nicht erst ausspielen,
  // sie liegen tot auf der Hand. Gleiche Bauform wie POWER_GROUP_NAMES.
  const TRAIT_DOOR_CARDS = {
    'ORK': 'race',
    'GNOM': 'race',
    'BARDE': 'class',
  };

  // GNOM: "Monster behandeln dich wie einen Halbling."
  // ponytail: gilt bewusst nur fuer die Monsterboni (MONSTER_TRAIT_BONUS) -
  // nicht fuer Faehigkeiten, die ein Halbling selbst hat (Einstampfen,
  // doppelter Verkaufspreis, zweiter Weglaufwurf). Wer mehr will, zieht die
  // Abfrage in hasRace selbst hoch.
  const MONSTER_SEES_AS_RACE = {
    'GNOM': 'HALBLING',
  };

  // GNOM: "Du erhaeltst +1 fuer jeden nicht-einmal einsetzbaren Gegenstand,
  // der mit den Buchstaben G oder N beginnt."
  // excludeIds (optional, von MONDJUNGFERN gesetzt - siehe combatTotals):
  // Gegenstands-Ids, die hier nicht mitzaehlen duerfen, obwohl sie angelegt
  // sind - sonst wuerde der Gnom seinen Waffenbonus ueber die Rasse
  // zurueckholen, den die Mondjungfern gerade gestrichen hat.
  const RACE_ITEM_BONUS = {
    'GNOM': (player, excludeIds) => equippedItemIds(player).filter((id) => {
      if (excludeIds && excludeIds.has(id)) return false;
      const c = card(id);
      return c && /^[GN]/i.test(c.name) && !/nur\s+einmal\s+einsetzbar/i.test(c.text || '');
    }).length,
  };

  // --- Gegenstaende, die eine Rasse/Klasse verleihen --------------------------
  // FALSCHE OHREN: "Erlaubt dem Traeger, elfen-exklusive Gegenstaende zu
  //   nutzen. Monster reagieren auch, als waere der Traeger ein Elf. Gibt
  //   keine sonstigen Elfen-Faehigkeiten." -> nurMonster: zaehlt fuer
  //   Monsterboni und Anlege-Beschraenkungen, aber nicht fuer +1 Weglaufen
  //   oder die Helfer-Stufe des Elfen.
  // ZAUBERCOUCH: "Wenn du dich auf dieser Couch ausruhst, wirst du IN ALLEN
  //   BELANGEN zusaetzlich zu deiner (oder deinen) urspruenglichen Klasse(n)
  //   als Zauberer angesehen."
  // ponytail: die Couch ist hier immer "in Benutzung" - die Karte laesst die
  // Wahl zu Kampfbeginn ("Du kannst entscheiden, ob du sie verwenden willst"),
  // dafuer braeuchte es eine Ja/Nein-Frage in jedem Kampfstart. Der Preis
  // dafuer (-1 auf Weglaufen) gilt deshalb ebenfalls dauerhaft.
  const ITEM_GRANTS_TRAIT = {
    'FALSCHE OHREN': { race: 'ELF', nurMonster: true },
    'ZAUBERCOUCH': { class: 'ZAUBERER' },
  };

  // --- Kartenanhaenge --------------------------------------------------------
  // Karten, die dauerhaft an einen GEGENSTAND geheftet werden (nicht an eine
  // Person) - siehe room.itemAttachments und handleAttachCard in server.js.
  // `bedingung` sagt, an welche Gegenstaende die Karte darf.
  const ATTACHMENT_CARDS = {
    // "Diese Karte muss mit einem Gegenstand gespielt werden, der Kampfbonus
    // verleiht. Dieser Gegenstand ist jetzt der Vergiftete Irgendwas (oder so)
    // und zusaetzlich +2 im Kampf wert." (+2 steht im bonus-Feld der Karte.)
    'VERGIFTET': { bedingung: 'kampfbonus', label: 'Vergiftet' },
    'GESEGNET': { bedingung: 'kampfbonus', label: 'Gesegnet' },
    // "Permanent an einen beliebigen grossen Gegenstand anzubringen. Der
    // Gegenstand zaehlt nicht laenger als gross."
    'NÜTZLICHE GRIFFE': { bedingung: 'gross', label: 'Nützliche Griffe' },
  };

  // --- Geschlecht ------------------------------------------------------------
  // Gegenstaende, die alle Geschlechter-Strafen aufheben. FREUD'SCHEN SLIPPER:
  // "Waehrend du die Freud'schen Slipper traegst, zaehlst du gleichzeitig als
  // beide Geschlechter, erleidest aber keine der Strafen."
  const GENDER_IMMUNE_ITEMS = new Set(["FREUD'SCHEN SLIPPER"]);

  // --- Weitere Gegenstands-Sonderfaelle --------------------------------------
  // ZWEIHÄNDIGES SCHWERT: "Dies ist eine Einhandwaffe, aber sie hat zwei
  // eigene Haende, du bekommst also eine Hand dazu, wenn du es traegst."
  // ponytail: eine Hand kosten und eine Hand geben hebt sich auf - deshalb
  // kostet die Karte hier schlicht keine Hand, statt das Zwei-Felder-Modell
  // von player.equipped.hands auf eine variable Laenge umzubauen. Sichtbarer
  // Unterschied gaebe es nur, wenn eine weitere Karte Haende schenkt.
  const FREE_HAND_ITEMS = new Set(['ZWEIHÄNDIGES SCHWERT']);

  // SPASSBREMSE: "In den falschen Haenden - und zwar den Haenden eines Gnoms -
  // ist es toedlich." (Bedeutung mit dem Nutzer geklaert: ein Gnom, der sie
  // anlegt, stirbt.)
  const DEADLY_ITEMS_BY_RACE = {
    'SPASSBREMSE': 'GNOM',
  };

  // STICH-O-MAT: "Verleiht seinem Besitzer die Macht, jemandem fuer +2 Schaden
  // wie ein Dieb in den Ruecken zu fallen ... oder fuegt einem Dieb +1 auf
  // sein 'in den Ruecken fallen' hinzu."
  const BACKSTAB_ITEMS = new Set(['STICH-O-MAT']);

  // KALI: "es sei denn, du verteidigst dich mit (mindestens) 2 eigenen
  // Waffen." Gezaehlt werden VERSCHIEDENE Handgegenstaende: eine Zweihand-
  // waffe belegt zwar beide Plaetze, ist aber nur eine Waffe. Das
  // ZWEIHÄNDIGE SCHWERT liegt in der Spezialausruestung (es kostet netto
  // keine Hand, siehe FREE_HAND_ITEMS) und zaehlt trotzdem mit.
  // ponytail: "Waffe" gegen "Schild" kennen die Kartendaten nicht - ein
  // Schild in der Hand zaehlt hier mit. Kuratierte Ausnahmeliste waere der
  // Aufruestweg. Id-Menge kommt aus handItemIds (server.js) - dieselbe
  // Definition wie bei MONDJUNGFERN, damit "Waffe" ueberall dasselbe meint.
  const waffenAnzahl = (p) => handItemIds(p).size;

  // "Mensch" ist in Munchkin keine Karte, sondern ihr Fehlen: wer keine
  // Rassenkarte hat, ist Mensch. Geprueft wird durch dieselbe Brille wie alle
  // anderen Monsterboni - wer FALSCHE OHREN traegt, gilt fuer Monster als Elf
  // (und wer spaeter den FALSCHEN BART traegt, als Zwerg) und damit nicht als
  // Mensch.
  const istMensch = (p) => !['ELF', 'ZWERG', 'HALBLING', 'ORK', 'GNOM']
    .some((r) => monsterSeesRace(p, r));

  // --- Monsterboni gegen Rassen/Klassen --------------------------------------
  // Der Bonus gilt einmal pro Monster, sobald IRGENDWER auf der Munchkin-Seite
  // die Rasse/Klasse hat (Angreifer:in oder Helfer:in) - nicht einmal pro
  // Person.
  //
  // Drei Schreibweisen sind erlaubt (siehe monsterTraitBonusSum in server.js):
  //   { races/classes: [...], bonus: n }  - der Normalfall
  //   [regel, regel]                      - mehrere Boni, die sich addieren
  //   { wennErfuellt: (p) => bool, bonus } - alles, was keine Rasse/Klasse ist
  // Ein negativer bonus schwaecht das Monster ("-3 gegen Barden").
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
    // --- Clerical Errors ---------------------------------------------------
    'TEQUILA-LIEDCHEN': { classes: ['BARDE'], bonus: 5 },                             // "+5 gegen Barden."
    'DOPPELGANGSTER': { classes: ['BARDE'], bonus: 3 },                                // "+3 gegen Barden."
    'DRECKIGE GÄNSE': { classes: ['BARDE'], bonus: -3 },                               // "-3 gegen Barden. Die dreckigen Gaense haben kein Rhythmusgefuehl."
    'GIFTEFEU KUDZU-FLIEGENFALLE': { races: ['ELF'], bonus: -4 },                      // "-4 gegen Elfen."
    'Harter Typ': { races: ['ORK'], bonus: 5 },                                        // "+5 gegen Orks."
    'REDNECK-BAUM': [{ races: ['ORK'], bonus: 5 }, { classes: ['KRIEGER'], bonus: 5 }], // "+5 gegen Orks, +5 gegen Krieger."
    'DIE TROLLE VOM TOTEN MEER': { races: ['ELF'], bonus: 5 },                         // "+5 gegen Elfen wegen ihres ueblen Gestanks."
    'MEDUSA': { races: ['ELF'], bonus: 4 },                                            // "Eklige Schlangenhaare! +4 gegen Elfen."
    'FEDERFEIND': [{ classes: ['PRIESTER'], bonus: 5 }, { classes: ['ZAUBERER'], bonus: 3 }], // "+5 gegen Priester und +3 gegen Zauberer."
    'SIEBENJÄHRIGER LICH': { classes: ['KRIEGER'], bonus: 5 },                         // "+5 gegen Krieger."
    // "+5 gegen Priester, +5 gegen maennliche Charaktere."
    'TANTE PALADIN': [
      { classes: ['PRIESTER'], bonus: 5 },
      { wennErfuellt: (p) => istGeschlecht(p, 'm'), bonus: 5 },
    ],
    // "+5 gegen Priester. Sie greift mehrmals an und erhaelt zusaetzlich +5,
    // es sei denn, du verteidigst dich mit (mindestens) 2 eigenen Waffen."
    'KALI': [
      { classes: ['PRIESTER'], bonus: 5 },
      { wennErfuellt: (p) => waffenAnzahl(p) < 2, bonus: 5, nurKaempfer: true },
    ],
    // "+3 gegen die, die keine Klasse haben."
    'RÜSSELKÄFER': { wennErfuellt: (p) => !p.classes.length, bonus: 3 },
    // "+5 gegen Super-Munchkins oder Mischlinge. +10 gegen beide." - als zwei
    // Regeln, die sich bei jemandem mit beiden Karten auf +10 addieren.
    // "+5 gegen Frauen." (Der Zusatzschatz "fuer jede Frau, die hilft"
    // bleibt manuell - dafuer gibt es keinen Schatz-pro-Person-Weg.)
    'CHAUVINISTENSCHWEIN': { wennErfuellt: (p) => istGeschlecht(p, 'w'), bonus: 5 },
    // Verstaerkerkarte statt Monster: "... aus der Hoelle." gibt "+5 fuer das
    // Monster" (ueber das bonus-Feld) und "ein zusaetzliches +5 gegen
    // Priester" - Letzteres haengt an den Kaempfenden und gehoert deshalb
    // hierher. Siehe combat.enhancerIds in server.js.
    '… aus der Hölle.': { classes: ['PRIESTER'], bonus: 5 },
    'GOTHYANKI': [
      { wennErfuellt: (p) => !!p.classCapCard, bonus: 5 },
      { wennErfuellt: (p) => !!p.raceCapCard, bonus: 5 },
    ],
    'KAMIKAZE-KOBOLDE': { classes: ['ZAUBERER'], bonus: 3 },                        // "+3 gegen Zauberer."
    // --- Unnatural Axe ------------------------------------------------------
    'KATZENMÄDCHEN': { races: ['ORK'], bonus: 5 },                                 // "Toedlich niedlich. +5 gegen Orks."
    'TEDDYBÄR': { races: ['ORK'], bonus: 5 },                                      // "Schrecklich niedlich. +5 gegen Orks."
    'JUDGE FREDD': { classes: ['DIEB'], bonus: 5 },                                // "+5 gegen Diebe."
    'M.T.-ANZUG': { classes: ['ZAUBERER', 'DIEB'], bonus: 5 },                     // "+5 gegen Zauberer oder Diebe." - "oder", also einmal.
    'DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST': { classes: ['KRIEGER'], bonus: 5 }, // "+5 gegen Krieger."
    'TENTAKELDÄMON': { classes: ['PRIESTER'], bonus: 5 },                          // "Eine Hoellenkreatur. +5 gegen Priester."
    // "+4 gegen Elfen (uuuaaaah). In Kombination mit der Laufenden Nase (oder
    // dem Schatten), erhaelt JEDER einen Bonus von +10." Regelentscheidung
    // (Review I2): "jeder" heisst jedes beteiligte Monster, nicht "einmal pro
    // Kampf" - deshalb steht dieselbe Klausel an allen drei Karten (hier,
    // sowie bei LAUFENDE NASE und DIE SCHATTENNASE weiter unten). Jede Karte
    // traegt ihren eigenen +10, monsterTraitBonusSum addiert sie: Rotz + eine
    // Nase macht +20, Rotz + beide Nasen +30 - konsistent mit der Regel, dass
    // JEDE beteiligte Karte den Bonus fuer sich bekommt.
    'ROTZ-ELEMENTAR': [
      { races: ['ELF'], bonus: 4 },
      { wennErfuellt: (p, room) => !!room.combat && room.combat.monsterIds.some((id) => {
        const m = card(id);
        return !!m && (m.name === 'LAUFENDE NASE' || m.name === 'DIE SCHATTENNASE');
      }), bonus: 10 },
    ],
    // Gegenstueck zur ROTZ-ELEMENTAR-Klausel oben: dieselbe Regelentscheidung
    // ("jeder" = jedes beteiligte Monster) verlangt denselben +10 auch hier,
    // sobald der Rotz-Elementar mit im Kampf steht.
    'LAUFENDE NASE': {
      wennErfuellt: (p, room) => !!room.combat
        && room.combat.monsterIds.some((id) => (card(id) || {}).name === 'ROTZ-ELEMENTAR'),
      bonus: 10,
    },
    // Gegenstueck zur ROTZ-ELEMENTAR-Klausel oben, siehe dort.
    'DIE SCHATTENNASE': {
      wennErfuellt: (p, room) => !!room.combat
        && room.combat.monsterIds.some((id) => (card(id) || {}).name === 'ROTZ-ELEMENTAR'),
      bonus: 10,
    },
    // "+5 gegen Elfen oder Menschen." - eine Regel, nicht zwei: ein Elf ist
    // kein Mensch, die Faelle schliessen sich aus.
    'RIESENKAKERLAKE': { wennErfuellt: (p) => monsterSeesRace(p, 'ELF') || istMensch(p), bonus: 5 },
    'GRASGNOLL': { wennErfuellt: (p) => istMensch(p), bonus: 5 },   // "+5 gegen Menschen."
    // "Greift mit zahlreichen Koepfen an. Erhaelt +5, wenn dir niemand hilft."
    // Haengt am Kampf, nicht an der Person - deshalb ueber den Raum.
    'FEUERLÖSCHER': { wennErfuellt: (p, room) => !(room.combat && room.combat.helperId), bonus: 5 },
    // "+4 gegen Zwerge, +2 gegen Frauen, -3 gegen Zauberer, -2 am Samstag."
    // Vier unabhaengige Klauseln, also vier Regeln. Der Samstag ist der echte
    // Wochentag - das ist der Gag der Karte.
    // ponytail: dadurch aendert sich die Monsterstaerke ueber Mitternacht
    // hinweg. Wer das nicht will, streicht die letzte Regel.
    'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT': [
      { races: ['ZWERG'], bonus: 4 },
      { wennErfuellt: (p) => istGeschlecht(p, 'w'), bonus: 2 },
      { classes: ['ZAUBERER'], bonus: -3 },
      { wennErfuellt: () => new Date().getDay() === 6, bonus: -2 },
    ],
    // "+3 gegen Zwerge oder Zauberer. Ja, das macht +6 gegen Zwergenzauberer."
    // Die Karte sagt die Addition ausdruecklich - deshalb zwei Regeln.
    'JABBERWOCK': [{ races: ['ZWERG'], bonus: 3 }, { classes: ['ZAUBERER'], bonus: 3 }],
    'WEIHNACHTSMANN': { races: ['ELF'], bonus: -5 },                               // "-5 gegen Elfen. Der Narr vertraut den Elfen."
    // ponytail: nur der Kampfbonus oben ist verdrahtet. Die Schlimmen Dinge
    // ("kein Schatz, bis du ein Monster allein toetest") sind bewusst
    // manuell - siehe Kommentar bei CONSEQUENCE_OVERRIDES in
    // src/cards/consequences.js (Design-Spec §6, Welle 3).
  };

  // --- Monster, die die Kampfrechnung selbst verändern ---------------------
  // "Deine Stufe zählt nicht im Kampf. Bekämpfe ihn nur mit deinen Boni!"
  const MONSTER_IGNORES_LEVEL = new Set(['VERSICHERUNGSVERTRETER']);
  // "Gegen sie dürfen keine Gegenstände oder andere Boni eingesetzt werden
  // - kämpfe nur mit deiner Charakterstufe."
  // GUMMI-GOLEM: "Er klebt an deinen Waffen ... du kannst nur auf deiner
  // Stufe kaempfen, ohne weitere Boni."
  const MONSTER_IGNORES_BONUSES = new Set(['GEMEINE GHOULE', 'GUMMI-GOLEM']);
  // --- Monster, gegen die Waffen nichts bringen ----------------------------
  // MONDJUNGFERN: "Du musst sie mit leeren Haenden bestrafen. In diesem Kampf
  // erhaeltst du keine Vorteile durch Waffen." Kleiner Bruder von
  // MONSTER_IGNORES_BONUSES, das ALLE Boni streicht.
  // ponytail: "Waffe" heisst hier wie in waffenAnzahl "belegt eine Hand" -
  // ein Schild zaehlt also mit. Kuratierte Ausnahmeliste waere der Aufruestweg.
  const MONSTER_IGNORES_WEAPONS = new Set(['MONDJUNGFERN']);
  // "Niemand kann dir helfen. Du musst dich dem Pavillon allein stellen."
  const MONSTER_FORBIDS_HELP = new Set(['PAVILLON']);
  // Die ersten beiden Regeln gelten für die ganze Munchkin-Seite: sobald
  // jemand mithilft, kämpfen beide gegen dasselbe Monster, also trifft die
  // Einschränkung auch die Helfer:in.
  //
  // RIESENSTINKTIER: "Deine 'Freunde' kommen nicht dichter als 20 Meter ...
  // Sie können dir nicht helfen, dich hintergehen, oder beliebige Karten für
  // oder gegen dich verwenden - außer Wandernde Monster und
  // Monsterverstärker." Bewusst NICHT in MONSTER_FORBIDS_HELP: das Set sperrt
  // nur die Hilfe, hier ist alles gesperrt ausser zwei Ausnahmen. Umgesetzt
  // als weisse Liste in stinktierSperre/handlePlayCombatCard (server.js) -
  // gesperrt ist, wer nicht selbst kaempft.
  const MONSTER_LOCKS_OTHERS = new Set(['RIESENSTINKTIER']);
  //
  // LUSTMONSTER: "Du musst dir von einem Charakter des anderen Geschlechts
  // helfen lassen ... sonst kannst du das Lustmonster nicht besiegen. Findest
  // du keinen passenden Charakter, musst du leider flüchten." Bewusst NICHT
  // in FLEE_AUTOMATIC: das Set laesst eine Flucht GELINGEN, hier geht es
  // darum, dass der Kampf nicht GEWONNEN werden kann (siehe resolveCombat).
  const MONSTER_REQUIRES_OTHER_GENDER = new Set(['LUSTMONSTER']);

  // --- Weglaufen -------------------------------------------------------------
  // Feste Modifikatoren, die ohne Zutun gelten. Der Zauberer-Flugzauber ("+1
  // pro abgelegter Karte") steht bewusst NICHT hier - er kostet Karten und
  // bleibt darum eine manuelle Eingabe im Weglaufen-Feld.
  const FLEE_ITEM_BONUS = {
    'STIEFEL ZUM ECHT SCHNELLEN DAVONLAUFEN': 2, // "Sie geben dir einen +2 Bonus auf Weglaufen."
    'TUBA DER VERZAUBERUNG': 3,                  // "... und gibt dir +3 auf Weglaufen."
    // "Verleiht dir einen kranken Tritt, aber du hast jetzt -2 auf Weglaufen."
    'AM FUSS BEFESTIGTER STREITKOLBEN': -2,
    'ZAUBERCOUCH': -1, // "Wenn du es tust, erhaeltst du -1 auf Weglaufen."
  };
  const FLEE_MONSTER_MOD = {
    'SCHNECKEN AUF SPEED': -2, // "Du hast -2 auf Weglaufen."
    'FLIEGENDE FROSCHE': -1,   // "Du hast -1 auf Weglaufen."
    'GALLERT-OKTAEDER': 1,     // "Du hast +1 auf Weglaufen."
    'LAHMER GOBLIN': 1,        // "Du hast +1 auf Weglaufen."
    'DIE TROLLE VOM TOTEN MEER': 1, // "Jeder erhaelt +1 auf Weglaufen."
    'WERSCHILDKRÖTE': 2,  // "Greift seeehr langsam an. +2 fuer Weglaufen."
    'PESTRATTEN': -1,     // "Alle anderen muessen kaempfen und erhalten -1 fuer Weglaufen."
  };
  // FILZLAUSE: "Denen kannst du nicht entkommen!"
  // LAUFENDE NASE: "Verlierst du den Kampf, kannst du nicht fliehen."
  const FLEE_IMPOSSIBLE = new Set(['FILZLAUSE', 'LAUFENDE NASE',
    'DIE SCHATTENNASE',  // "Du kannst nicht fluechten und wirst automatisch gefangen."
  ]);
  // TOPFPFLANZE, Schlimme Dinge: "Keine. Automatische Flucht."
  // GOLDFISCH: "Greift nicht an und du fliehst automatisch, aber ..."
  const FLEE_AUTOMATIC = new Set(['TOPFPFLANZE', 'GOLDFISCH']);
  // Dasselbe, aber nur fuer eine bestimmte Rasse und abhaengig vom Monster.
  // GNOM: "Monster, die ein 'Nase' im Namen haben, werden dich nicht
  // angreifen. Wenn du sie nicht besiegen kannst, wirst du automatisch
  // weglaufen."
  const FLEE_AUTOMATIC_BY_RACE = {
    'GNOM': (monster) => /nase/i.test(monster.name || ''),
  };
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
  // DIE SCHATTENNASE ist das einzige Monster, dessen eigener Text "untot"
  // sagt ("... funktioniert auch fuer ihren Untoten Schatten").
  const UNDEAD_MONSTERS = new Set(['MR. BONES', 'UNTOTES PFERD', 'KÖNIG TUT', 'GRUFTIGE GEBRÜDER',
    'SIEBENJÄHRIGER LICH', 'DIE SCHATTENNASE']);

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
    // "+2 Bonus für Elfen" ist ein ZUSATZ zum Grundbonus, kein Gesamtwert:
    // Grundbonus 1 für alle, Elfen also insgesamt +3. Genauso beim
    // SCHÄDELHELM ("+2 Bonus für Orks", Grundbonus 2, Orks also +4).
    'GEILER HELM': (player, monsters) => (hasRace(player, 'ELF') ? 2 : 0),
    'SCHÄDELHELM': (player, monsters) => (hasRace(player, 'ORK') ? 2 : 0),
    // "+10 gegen alles, was mit dem Buchstaben J beginnt."
    'VORPALE KLINGE': (player, monsters) => (monsters.some((m) => /^J/i.test(m.name || '')) ? 10 : 0),
    // "Gibt keinen Bonus gegen Krakzilla" - hebt den gedruckten Bonus (+4) wieder auf.
    'ALLES AUSSER KRAKZILLA ABSCHLACHTENDES SCHWERT': (player, monsters) => (monsters.some((m) => m.name === 'KRAKZILLA') ? -4 : 0),
    // "+5 gegen die Laufende Nase und den Schatten." Gemeint ist DIE
    // SCHATTENNASE - eine Karte namens SCHATTEN gibt es nicht.
    'SCHRECKLICHE SOCKEN': (player, monsters) => (monsters.some((m) => m.name === 'LAUFENDE NASE' || m.name === 'DIE SCHATTENNASE') ? 5 : 0),
    // "Zusaetzlich +3 gegen Untote." Der dritte Parameter sagt, ob im Kampf
    // etwas Untotes steht - das schliesst die Verstaerkerkarte UNTOT ein
    // ("Das Monster zaehlt jetzt als Untoter fuer alle Zwecke").
    'GHOULPEITSCHE': (player, monsters, untot) => (untot ? 3 : 0),
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
    // Clerical Errors. Die Karte hat +4 und einen Goldwert, aber keinen
    // slotKind in den Rohdaten - ohne Platz waere sie nicht anlegbar. "Am Fuss
    // befestigt" ist kein Schuhwerk-Platz, also Spezialausruestung.
    'AM FUSS BEFESTIGTER STREITKOLBEN': { slot: 'special' },
    // Beide haben in den Rohdaten keinen Platz, gehoeren aber angelegt:
    'FALSCHE OHREN': { slot: 'special' },
    'ZAUBERCOUCH': { slot: 'special' },
    // Zwei Karten, die ausdruecklich ZUSAETZLICH zu einem belegten Platz
    // getragen werden. Ein zweiter Gegenstand im selben Slot ginge nicht (die
    // Plaetze sind je ein festes Feld), der Sammelplatz "Spezialausruestung"
    // dagegen schon. mitSlot koppelt sie an den echten Platz: geht der
    // verloren, gehen sie mit.
    // GNOMEX-ANZUG: "Dieser Gegenstand kann ueber anderer Ruestung getragen
    // werden, wenn etwas aber deine Ruestung entfernt, ist die GESAMTE
    // Ruestung weg."
    'GNOMEX-ANZUG': { slot: 'special', mitSlot: 'armor' },
    // SCHRECKLICHE SOCKEN: "Du kannst die Socken unter anderem Schuhwerk
    // tragen, aber wenn du dein Schuhwerk verlierst, sind sie auch weg."
    'SCHRECKLICHE SOCKEN': { slot: 'special', mitSlot: 'feet' },
  };
  // Ein Spezialplatz ist ein Sammelbereich: beliebig viele Karten liegen dort
  // nebeneinander (anders als Kopf/Ruestung/Schuhe/Haende).
  const SPECIAL_SLOTS = {
    special: { label: 'Spezialausrüstung' },
  };

  return {
    CURSE_PROOF_ITEMS, MONSTER_REFUSES, MONSTER_REFUSES_TREASURE, MONSTER_AUTO_KILL_BY_RACE,
    MONSTER_PASS_OPTION, MONSTER_TRAIT_BONUS, MONSTER_IGNORES_LEVEL,
    MONSTER_IGNORES_WEAPONS, MONSTER_IGNORES_BONUSES, MONSTER_FORBIDS_HELP, MONSTER_LOCKS_OTHERS,
    FLEE_ITEM_BONUS,
    FLEE_MONSTER_MOD, FLEE_IMPOSSIBLE, FLEE_AUTOMATIC, FLEE_PENALTY,
    FLEE_TREASURE_ITEMS, MONSTER_EXTRA_LEVEL, FIRE_ITEMS,
    CLASS_COMBAT_DISCARD, UNDEAD_MONSTERS, CLASS_FLEE_DISCARD,
    ITEM_CONDITIONAL_BONUS, SPECIAL_SLOT_ITEMS, SPECIAL_SLOTS,
    COMBAT_START_OPTIONS, COMBAT_START_COST, STAFF_ITEMS,
    TRAIT_DOOR_CARDS, MONSTER_SEES_AS_RACE, RACE_ITEM_BONUS, FLEE_AUTOMATIC_BY_RACE,
    GENDER_IMMUNE_ITEMS, ATTACHMENT_CARDS, FREE_HAND_ITEMS, DEADLY_ITEMS_BY_RACE,
    BACKSTAB_ITEMS, ITEM_GRANTS_TRAIT, MONSTER_REQUIRES_OTHER_GENDER,
  };
};
