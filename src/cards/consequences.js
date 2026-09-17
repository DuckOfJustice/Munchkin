// Kuratierte Sonderfälle (siehe Erklärung oben). Schlüssel = exakter Karten-
// name aus data/cards.json. Jede Funktion bekommt (player, room) und gibt
// zurück: eine Aktion (siehe applyPrimitiveAction) zum automatischen
// Anwenden, `null` um EXPLIZIT den generischen Fallback zu unterdrücken
// (bleibt manuell), oder `undefined` um an den generischen Regex-Fallback
// durchzureichen.
module.exports = (ctx) => {
  const {
    card, hasRace, hasPowerGroup, isMonsterEnhancerCard, resolveConsequenceSpec, bigItemCount,
    equippedItemIds, isBigItem, istGeschlecht, istGrosserGegenstand,
  } = ctx;

  // "alle kleinen Gegenstaende": die Anzahl steht erst im Moment der
  // Konsequenz fest, weil Anhaenge (NÜTZLICHE GRIFFE) aus einem Grossen einen
  // kleinen machen koennen.
  const kleineGegenstaendeAnzahl = (player, room) =>
    equippedItemIds(player).filter((id) => !istGrosserGegenstand(room, id)).length;

  // ponytail: LUSTMONSTER und WEIHNACHTSMANN haben bewusst KEINEN Eintrag in
  // CONSEQUENCE_OVERRIDES - ihr Text faellt durch den generischen Parser
  // (parseAutoConsequence) und bleibt manuell (siehe tests/auto-consequence.
  // test.js, "manualOhneOverride"). Beide brauchen einen zugübergreifenden
  // Zustand am Spieler (gilt erst im naechsten Kampf, oder bis ein Ereignis
  // eintritt, das ueber diese eine Konsequenz hinausreicht) - genau die
  // Erweiterung, die das Design bewusst in eine eigene, zuletzt geplante
  // Welle 3 gelegt hat (siehe docs/superpowers/specs/2026-09-16-unnatural-
  // axe-monster-design.md §6):
  //   - LUSTMONSTER: "Verliere eine Stufe ... im naechsten Kampf sind deine
  //     Hand-Gegenstaende nutzlos." Waere strukturell ein LINGERING_CURSES-
  //     Eintrag (src/cards/reactions.js) mit kind 'noHandItemBonus' - dieser
  //     Tracker haengt aber an FLUCH-Karten (handleDrawDoor), nicht an
  //     Monster-Konsequenzen (autoApplyLossConsequence). Aufruestweg: den
  //     LINGERING_CURSES-Mechanismus fuer Monster-Badstuffs oeffnen, oder
  //     einen zweiten, gleich gebauten Tracker daneben.
  //   - WEIHNACHTSMANN: "Du erhaeltst keine Schatzkarten ... bis du ein
  //     Monster OHNE Hilfe toetest." Aufruestweg: ein Flag am Spieler, das
  //     resolveCombatWin vor jeder Schatzvergabe prueft und beim naechsten
  //     hilfsfreien Sieg selbst loescht.
  const CONSEQUENCE_OVERRIDES = {
    // --- Eindeutiger Tod in ungewöhnlicher Formulierung ---
    'BULLROG': () => ({ type: 'death' }), // "Du wirst zu Tode gepeitscht."
    'JUDGE FREDD': () => ({ type: 'death' }), // "Er prügelt dich zu Tode ..."
    // "Stirb, stirb, stirb - und setze auch deinen naechsten Zug aus."
    'KALI': () => ({ type: 'combo', actions: [{ type: 'death' }, { type: 'skipNextTurn' }] }),
    'TENTAKELDÄMON': () => ({ type: 'death' }), // "Wenn du gefangen wirst, stirbst du." (Kontext: Flucht ist bereits gescheitert)
    // "Wenn er dich erwischt, stirbst du nicht nur, sondern verlierst auch
    // eine Stufe." Der Tod kostet nur die Karten, die Stufe bleibt (siehe
    // applyDeathConsequence) - die zusaetzliche Stufe ist also spuerbar.
    'SIEBENJÄHRIGER LICH': () => ({ type: 'combo', actions: [{ type: 'death' }, { type: 'levelDelta', amount: 1 }] }),
    // Enthält zwar "stirbst", bezieht sich aber auf einen ZUKÜNFTIGEN Tod
    // (persistenter Fluch) - explizit NICHT automatisch:
    'VERFLUCHTER GEGENSTAND': () => null,

    // --- Reine Flavor-Texte ohne Spielmechanik ---
    'GOLDFISCH': () => ({ type: 'noEffect' }), // "Du musst den Hohn der anderen Spieler ertragen."
    'TOPFPFLANZE': () => ({ type: 'noEffect' }), // "Keine. Automatische Flucht."

    // --- Fester Ausrüstungsverlust (kein Auswahl nötig) ---
    'GALLERT-OKTAEDER': () => ({ type: 'discardBigItem' }), // "Lass alle deine Großen Gegenstände fallen."
    'BIGFOOT': () => ({ type: 'discardSlot', slot: 'head' }),
    'RIESENKAKERLAKE': () => ({ type: 'discardSlot', slot: 'head' }),
    'FÜRST YAHOO': () => ({ type: 'discardSlot', slot: 'head' }),
    'RAPIER-TROTTEL': () => ({ type: 'discardSlot', slot: 'armor' }),
    'DRECKIGE GÄNSE': () => ({ type: 'discardSlot', slot: 'feet' }),
    'GIFTEFEU KUDZU-FLIEGENFALLE': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'discardSlot', slot: 'head' }] }),
    'FILZLAUSE': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'discardSlot', slot: 'feet' }] }),
    'KÖNIG TUT': () => ({ type: 'combo', actions: [{ type: 'discardAllEquipped' }, { type: 'discardWholeHand' }] }),
    // Persistenter "-10 gegen Pflanzen"-Malus wird - wie andere Dauereffekte
    // im Spiel - nicht mechanisch durchgesetzt, nur der sofortige Teil:
    'REDNECK-BAUM': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'levelDelta', amount: 2 }] }),
    'TANTE PALADIN': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'armor' }, { type: 'levelDelta', amount: 3 }] }),

    // --- Ganze Hand ablegen ---
    'PIKOTZU': () => ({ type: 'discardWholeHand' }),
    'TEDDYBÄR': () => ({ type: 'discardWholeHandWithBonusDraw' }), // "... mehr als eine Karte abgelegt -> Schatz ziehen"

    // --- Rassen-/Klassenkarten ---
    'KREISCHENDER DEPP': () => ({ type: 'combo', actions: [{ type: 'discardRaceCards' }, { type: 'discardClassCards' }] }),
    'WERSCHILDKRÖTE': () => ({ type: 'discardOneRaceCardIfAny' }), // Halb-Blut verliert eine Rasse, reiner Mensch: nichts
    'AMAZONE': (player) => (player.classes.length ? { type: 'discardClassCards' } : { type: 'levelDelta', amount: 3 }),
    'UNGLAUBLICHER UNAUSSPRECHLICHER SCHRECKEN': () => ({ type: 'discardClassCardMatchingElseDeath', substr: 'ZAUBERER' }),

    // --- Rassen-bedingte Stufenzahl ---
    'ZUNGENDÄMON': (player) => ({ type: 'levelDelta', amount: hasRace(player, 'ELF') ? 3 : 2 }),
    // ponytail: "Verdoppelt die Strafe, wenn der Fungus Gigantisch ist" fehlt -
    // die Konsequenz weiss nicht, welche Verstaerker im Kampf lagen. Aufruestweg:
    // den Verstaerker-Zustand in die Konsequenz durchreichen.
    'FUNGUS': (player) => ({ type: 'levelDelta', amount: hasRace(player, 'ELF') ? 2 : 1 }),

    // --- Bedingt auf aktuellen Ausrüstungszustand (zum Zeitpunkt der Konsequenz bekannt) ---
    'FEDERFEIND': (player) => (player.equipped.head ? { type: 'discardSlot', slot: 'head' } : { type: 'levelDelta', amount: 2 }),
    'SABBERNDER SCHLEIM': (player) => (player.equipped.feet ? { type: 'discardSlot', slot: 'feet' } : { type: 'levelDelta', amount: 1 }),
    'ÜBERBÄR': (player) => (player.equipped.armor ? { type: 'noEffect' } : { type: 'levelDelta', amount: 1 }),
    'GESICHTSSAUGER': () => ({ type: 'combo', actions: [{ type: 'discardSlot', slot: 'head' }, { type: 'levelDelta', amount: 1 }] }),

    // --- Würfelbasiert ---
    '3.872 ORKS': () => ({ type: 'diceThresholdDeath', deathValues: [1, 2] }), // "bei 1/2 Tod, sonst so viele Stufen wie gewürfelt"
    'DIE TROLLE VOM TOTEN MEER': () => ({ type: 'diceLevelLoss' }),
    'FEUERLÖSCHER': () => ({ type: 'diceLevelLoss' }),
    // "Kratzer und Allergien. Wirf den Wuerfel und lege so viele Karten aus
    // deiner Hand ab."
    'KATZENMÄDCHEN': () => ({ type: 'diceDiscardHand', cardName: 'KATZENMÄDCHEN' }),
    // ponytail: "Du erhaeltst eine Stufe zurueck fuer jeden Trank, den du SOFORT
    // ablegst" fehlt - ein Zeitfenster fuer freiwilliges Ablegen gibt es nicht.
    'GRASGNOLL': () => ({ type: 'levelDelta', amount: 3 }),

    // --- Werte-/textbasierter Gegenstandsverlust ---
    'WIRKLICH BESCHISSENER FLUCH!': () => ({ type: 'discardMaxBonusItem' }),
    'DRYADE': () => ({ type: 'discardItemsAboveBonus', threshold: 2 }),
    'EISRIESE': () => ({ type: 'discardItemsByTextMatch', pattern: /feuer|flamme/i }),
    'Harter Typ': () => ({ type: 'discardHandCardsMatching', predicate: (c) => !!c && (c.category === 'monster' || isMonsterEnhancerCard(c)) }),

    // --- Eigene Tischwerte (keine Fremdeinwirkung auf andere Spieler) ---
    'GEMEINE GHOULE': () => ({ type: 'setLevelToTableMin' }),
    // "Erzwungener Tausch! Wirf den Gegenstand mit dem hoechsten Wert ab, den
    // du im Spiel hast, UND ziehe einen offenen Schatz." - der Schatz ist Teil
    // der Schlimmen Dinge, nicht optional.
    'PACKRATTE': () => ({ type: 'combo', actions: [{ type: 'discardMaxGoldItem' }, { type: 'drawTreasureN', n: 1 }] }),
    'ROTZ-ELEMENTAR': () => ({ type: 'discardTraitBonusItems', which: 'race' }),
    'DING MIT EINEM ÜBERLANGEN NAMEN, DESSEN BILD NICHT AUF DIE KARTE PASST': () => ({ type: 'discardTraitBonusItems', which: 'class' }),
    // "... und 1 kleinen Gegenstand" bleibt bewusst manuell (freie Auswahl über
    // das Ablege-Dropdown) - nur der garantierte Stufenverlust wird berechnet:
    'AFFENBANDE': () => ({ type: 'levelDelta', amount: 1 }),

    // --- Schlimme Dinge mit Fremdbeteiligung: andere Spieler:innen nehmen
    // sich Karten/Gegenstaende ueber die Aktions-Warteschlange (Task 3).
    // "mode" ist die Reihenfolge/Auswahl laut Kartentext, siehe
    // playerQueueFrom in server.js. ---
    // "Beginnend mit dem Spieler VOR dir in Zugreihenfolge darf jeder Spieler
    // eine Schatzkarte vor dir oder (ohne hinzusehen) aus deiner Hand nehmen."
    'HIPPOGREIF': () => ({ type: 'queuedTakeFromHand', mode: 'before' }),
    // "Jeder Spieler darf eine Karte aus deiner Hand ziehen, beginnend mit dem
    // Spieler NACH dir in Zugreihenfolge. Lege alle uebrigen Karten ab."
    'ANWALT': () => ({ type: 'queuedTakeFromHand', mode: 'after', discardRest: true }),
    // "Er nimmt dir zwei Gegenstaende weg - ausgewaehlt von den Spielern vor
    // und nach dir in Zugreihenfolge."
    'LEPRACHAUN': () => ({ type: 'queuedTakeItem', mode: 'neighbours' }),
    // "... indem er dich dazu zwingt, den (die) Spieler mit der hoechsten
    // Stufe (jeweils) 1 Gegenstand von dir nehmen zu lassen."
    'NETZ-TROLL': () => ({ type: 'queuedTakeItem', mode: 'topLevel' }),
    // "Du kaufst eine Versicherung. Verliere Gegenstaende im Wert von 1.000
    // Goldstuecken. Hast du nicht genug, verlierst du alles, was du hast."
    'VERSICHERUNGSVERTRETER': () => ({ type: 'discardItemsWorthGold', gold: 1000 }),
    // "Sie stehlen deinen Schatz. Wuerfle und verliere entsprechend viele
    // Gegenstaende oder Karten von deiner Hand - deine Wahl."
    'SCHNECKEN AUF SPEED': () => ({ type: 'diceItemOrHandLoss' }),
    // "Lege einen Gegenstand deiner Wahl ab. Jeder andere Spieler muss nun
    // einen oder mehrere Gegenstaende ablegen, deren Wert mindestens dem
    // entspricht, den du abgelegt hast. Sollten sie nicht genug haben, um die
    // ganze Steuer zu zahlen, muessen sie alle ihre Gegenstaende ablegen und
    // verlieren eine Stufe." Betrifft laut Text ALLE anderen (kein Nachbar-
    // oder Stufen-Bezug wie bei den Monstern oben).
    'FLUCH! EINKOMMENSSTEUER': () => ({ type: 'curseIncomeTax', mode: 'allOthers' }),

    // --- Clerical Errors: Schlimme Dinge mit freier eigener Auswahl -------
    // "Du hast den Wurm gegessen! Lege zwei Karten (deiner Wahl) aus deiner
    // Hand ab."
    'TEQUILA-LIEDCHEN': () => ({ type: 'queuedDiscardOwn', count: 2, quelle: 'hand',
      cardName: 'TEQUILA-LIEDCHEN', prompt: 'Eine Handkarte ablegen' }),
    // MECHA-DIRE-WOLF: "Beisst die Hand, die ihn fuettert. Lege drei Karten aus
    // deiner Hand ab." Der generische Parser erkennt den Satz nicht (er steht
    // hinter einem Flavor-Satz und nennt die Zahl ausgeschrieben).
    'MECHA-DIRE-WOLF': () => ({ type: 'queuedDiscardOwn', count: 3, quelle: 'hand',
      cardName: 'MECHA-DIRE-WOLF', prompt: 'Eine Handkarte ablegen' }),
    // "Opfere eine Karte deiner Wahl dem Uebel des Ruesselkaefers."
    'RÜSSELKÄFER': () => ({ type: 'queuedDiscardOwn', count: 1, quelle: 'hand',
      cardName: 'RÜSSELKÄFER', prompt: 'Eine Handkarte opfern' }),
    // "Verliere 2 kleine Gegenstaende deiner Wahl."
    'DOPPELGANGSTER': () => ({ type: 'queuedDiscardOwn', count: 2, quelle: 'kleineGegenstaende',
      cardName: 'DOPPELGANGSTER', prompt: 'Einen kleinen Gegenstand ablegen' }),
    // "Sie explodieren ueberall um dich herum. Du verlierst 2 Gegenstaende
    // deiner Wahl. Alle anderen verlieren 1 Gegenstand ihrer Wahl."
    'KAMIKAZE-KOBOLDE': () => ({ type: 'combo', actions: [
      { type: 'queuedDiscardOwn', count: 2, quelle: 'gegenstaende', cardName: 'KAMIKAZE-KOBOLDE', prompt: 'Einen Gegenstand ablegen' },
      { type: 'queuedDiscardEachOther', cardName: 'KAMIKAZE-KOBOLDE' },
    ] }),
    // "Sie machen dir Schuldgefuehle. Jeder Spieler, dessen Stufe niedriger
    // ist als deine, steigt eine Stufe auf. Du verlierst dann diese Anzahl an
    // Stufen."
    'GOTHYANKI': () => ({ type: 'levelUpLowerPlayersAndLose' }),
    // "Lass jeden Ork im Spiel eine Karte aus deiner Hand ziehen."
    'BOBBELKOPF': () => ({ type: 'queuedTakeFromHand', mode: 'after', nurRasse: 'ORK' }),
    // "Zuckerschock! Du musst in jedem Kampf deine Hilfe anbieten, darfst
    // keinen Schatz annehmen, bis du einen verlierst." - eine Dauerpflicht
    // ueber viele Zuege, fuer die es keinen Tracker gibt; bleibt manuell:
    'GUMMI-GOLEM': () => null,
    // "Ein Strichmaennchen hat kein Geschlecht, und du jetzt auch nicht. Du
    // bist weder maennlich noch weiblich, bis ein anderer Spieler das
    // Geschlecht wechselt ... dann nimmst du dessen Geschlecht an."
    'STRICHMÄNNCHEN': () => ({ type: 'setGender', value: null }),
    // "Frauen verlieren ihre Ruestung. Maenner muessen ein Bier mit ihm
    // teilen, verliere 1 Stufe." (Wer die Freud'schen Slipper traegt, gilt als
    // keins von beiden - siehe istGeschlecht - und kommt davon.)
    'CHAUVINISTENSCHWEIN': (player) => {
      if (istGeschlecht(player, 'w')) return { type: 'discardSlot', slot: 'armor' };
      if (istGeschlecht(player, 'm')) return { type: 'levelDelta', amount: 1 };
      return { type: 'noEffect' };
    },

    // --- Unnatural Axe: Schlimme Dinge mit freier Auswahl -------
    // "Du niest unaufhoerlich und laesst deine Karten fallen. Lege zwei Karten
    // (deiner Wahl) aus deiner Hand ab."
    'GEWALTIGER BAZILLUS': () => ({ type: 'queuedDiscardOwn', count: 2, quelle: 'hand',
      cardName: 'GEWALTIGER BAZILLUS', prompt: 'Eine Handkarte ablegen' }),
    // "Decke deine Hand auf und jeder andere Spieler darf eine Karte waehlen."
    // Gleiche Bauform wie HIPPOGREIF/ANWALT - das Aufdecken selbst braucht
    // keinen eigenen Schritt, der Waehler zeigt die Hand ohnehin.
    'MONDJUNGFERN': () => ({ type: 'queuedTakeFromHand', mode: 'allOthers' }),
    // "Er hebt dich auf und laesst dich aus grosser Hoehe fallen. Lege deine
    // ganze Hand oder alle kleinen Gegenstaende ab ... Du hast die Wahl."
    // Die Zahl der kleinen Gegenstaende steht erst beim Ausspielen fest,
    // deshalb queuedDiscardOwn ueber die ganze Menge statt einer festen Zahl.
    'PTERODAKTYL': (player, room) => ({
      type: 'choice',
      options: [
        { id: 'hand', label: 'Die ganze Hand ablegen', action: { type: 'discardWholeHand' } },
        { id: 'klein', label: 'Alle kleinen Gegenstaende ablegen',
          action: { type: 'queuedDiscardOwn', count: kleineGegenstaendeAnzahl(player, room),
            quelle: 'kleineGegenstaende', cardName: 'PTERODAKTYL',
            prompt: 'Einen kleinen Gegenstand ablegen' } },
      ],
    }),
    // "Besprüht! Niemand wird dir im Kampf helfen, bevor du nicht alle
    // getragene Kleidung und Rüstung ablegst. Der Goldwert ist halbiert."
    // Beide Wirkungen haengen an EINEM Tracker-Eintrag, weil sie dieselbe
    // Löschbedingung teilen (siehe stinktierStrafeAktiv in server.js).
    'RIESENSTINKTIER': () => ({
      type: 'lingeringCurse', name: 'RIESENSTINKTIER', kind: 'noHelpHalfGold',
      dauer: 'dauerhaft',
      hinweis: 'Besprüht: niemand hilft dir, und dein Goldwert ist halbiert - bis du alle Kleidung und Rüstung abgelegt hast.',
    }),

    // --- Echte Entweder-Oder-Wahl: zwei Buttons statt Rechnerei ---
    'ENTIKOR': () => ({
      type: 'choice',
      options: [
        { id: 'hand', label: 'Ganze Hand ablegen', action: { type: 'discardWholeHand' } },
        { id: 'levels', label: '2 Stufen verlieren', action: { type: 'levelDelta', amount: 2 } },
      ],
    }),
    'JABBERWOCK': () => ({
      type: 'choice',
      options: [
        { id: 'level1', label: 'Auf Stufe 1 zurückkehren', action: { type: 'setLevel1' } },
        { id: 'items', label: 'Alle Gegenstände verlieren', action: { type: 'discardAllEquipped' } },
      ],
    }),
    // "Halblinge verlieren eine Stufe. Elfen verlieren zwei Stufen. Maenner
    // verlieren eine zusaetzliche Stufe und muessen eine Karte ablegen.
    // Diejenigen, die nicht unter die Kriterien oben fallen, muessen zwei
    // Karten ablegen."
    'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT': (player) => {
      const stufen = (hasRace(player, 'ELF') ? 2 : 0) + (hasRace(player, 'HALBLING') ? 1 : 0)
        + (istGeschlecht(player, 'm') ? 1 : 0);
      // "nicht unter die Kriterien oben" = weder Halbling noch Elf noch Mann.
      const karten = stufen === 0 ? 2 : (istGeschlecht(player, 'm') ? 1 : 0);
      const actions = [];
      if (stufen) actions.push({ type: 'levelDelta', amount: stufen });
      if (karten) actions.push({ type: 'queuedDiscardOwn', count: karten, quelle: 'hand',
        cardName: 'MONSTER, DAS DER SL SICH SELBST AUSGEDACHT HAT', prompt: 'Eine Handkarte ablegen' });
      // Kein Leerfall moeglich: stufen===0 erzwingt karten=2, stufen!=0
      // liefert selbst schon einen Eintrag - actions ist nie leer.
      return actions.length === 1 ? actions[0] : { type: 'combo', actions };
    },

    // "Verliere 1 Stufe" + Sonderklausel bei "ausdrücklich an den Knien
    // getragenem" Gegenstand - dafür gibt es kein Datenfeld, nur die
    // garantierte Basis-Stufe wird automatisch verrechnet:
    'EXPLODIERENDE KNIESCHÜTZER': () => ({ type: 'levelDelta', amount: 1 }),
    // --- Fluch, der die Konsequenz des obersten Monsters im Ablagestapel auslöst ---
    'STERBENDER FLUCH': (player, room) => {
      for (let i = room.doorDiscard.length - 1; i >= 0; i--) {
        const c = card(room.doorDiscard[i]);
        if (c && c.category === 'monster') {
          return resolveConsequenceSpec(c.name, c.badstuff, player, room) || { type: 'noEffect' };
        }
      }
      return { type: 'noEffect' };
    },

    // --- Fehlkategorisierte Flüche (Basis-Set + Erweiterungen): stehen in den
    // Rohdaten in "door_other" statt "curse", sind aber textlich eindeutig
    // sofort beim Ziehen wirkende Flüche - siehe DOOR_OTHER_AS_CURSE unten. ---
    'Rüstung verlieren': () => ({ type: 'discardSlot', slot: 'armor' }),
    'Kopfbedeckung verlieren': () => ({ type: 'discardSlot', slot: 'head' }),
    'SCHUHWERK VERLIEREN': () => ({ type: 'discardSlot', slot: 'feet' }),
    'VERLIERE 1 STUFE': () => ({ type: 'levelDelta', amount: 1 }),
    'VERLIERE DEINE KLASSE': (player) => {
      if (player.classes.length >= 2) {
        return {
          type: 'choice',
          options: player.classes.map((cid) => ({
            id: `class-${cid}`,
            label: `${card(cid) ? card(cid).name : 'Klasse'} ablegen`,
            action: { type: 'discardSpecificClassCard', cardId: cid },
          })),
        };
      }
      if (player.classes.length === 1) return { type: 'discardClassCards' };
      return { type: 'levelDelta', amount: 1 };
    },
    'VERLIERE DEINE RASSE': () => ({ type: 'discardRaceCards' }),
    'KLASSE WECHSELN': () => ({ type: 'replaceTraitFromDiscard', arrField: 'classes', capField: 'classCapCard', category: 'class', label: 'Klasse' }),
    'RASSE WECHSELN': () => ({ type: 'replaceTraitFromDiscard', arrField: 'races', capField: 'raceCapCard', category: 'race', label: 'Rasse' }),
    // "Du darfst kein Schuhwerk tragen. Wenn du gerade Schuhwerk trägst, wird
    // es zerstört ...":
    'QUANTEN': (player) => (player.equipped.feet ? { type: 'discardSlot', slot: 'feet' } : { type: 'noEffect' }),
    'REGELN DER NEUAUFLAGE': () => ({ type: 'levelDeltaAllPlayers', amount: 1 }), // Wunschring-Sonderfall bleibt manuell
    // "Du kannst keine Gegenstände tragen, die mehr als eine Hand benötigen." -
    // Dauereffekt, den dieser Server (wie andere Dauer-Mali) nicht mechanisch
    // durchsetzt; nur zur Anzeige als Fluch, kein Sofort-Effekt:
    'WINZIGE HÄNDE': () => ({ type: 'noEffect' }),
    'VERLIERE ZWEI KARTEN': () => ({ type: 'giveHandCardsToNeighbors' }),
    // "Verliere 2 Stufen" (fällt bereits unter den generischen Fallback, hier
    // nur zur Klarheit/Dokumentation nicht nötig - kein Override nötig).
    // "Wähle einen Großen Gegenstand aus, den du ablegst." Bei 0 oder 1
    // getragenem Großen Gegenstand ist discardBigItem (alle ablegen)
    // gleichwertig zu "einen auswählen" - erst ein Zwerg mit mehreren
    // braucht die echte Wahl, siehe 'discardSpecificItem' in server.js.
    'VERLIERE 1 GROSSEN GEGENSTAND': (player, room) => {
      const ids = equippedItemIds(player).filter((id) => istGrosserGegenstand(room, id));
      if (ids.length <= 1) return { type: 'discardBigItem' };
      return {
        type: 'choice',
        options: ids.map((id) => ({
          id: `item-${id}`,
          label: `"${card(id).name}" ablegen`,
          action: { type: 'discardSpecificItem', itemId: id },
        })),
      };
    },
    // "Waehle einen kleinen Gegenstand aus und lege ihn ab. Jeder Gegenstand,
    // der nicht >>Gross<< ist, gilt als klein." Seit isBigItem (Grosse
    // Gegenstaende) ist "klein" definierbar - vorher musste diese Karte
    // manuell bleiben. Die Karte nennt keinen Ersatz-Malus, wer nichts
    // Kleines traegt, kommt also davon.
    'VERLIERE 1 KLEINEN GEGENSTAND': (player, room) => {
      const ids = equippedItemIds(player).filter((id) => !istGrosserGegenstand(room, id));
      if (!ids.length) return { type: 'noEffect' };
      if (ids.length === 1) return { type: 'discardSpecificItem', itemId: ids[0] };
      return {
        type: 'choice',
        options: ids.map((id) => ({
          id: `item-${id}`,
          label: `"${card(id).name}" ablegen`,
          action: { type: 'discardSpecificItem', itemId: id },
        })),
      };
    },
    // Persistente Mali/Flags ohne laufenden Status-Tracker in diesem Server -
    // bleiben nach dem Einordnen als Fluch bewusst manuell/nur textlich:
    // "-5 auf deinen naechsten Kampf, weil du abgelenkt bist. ... Die
    // Umwandlung ist jedoch permanent." Der -5-Teil laeuft weiter ueber
    // LINGERING_CURSES, der Wechsel selbst hier:
    'GESCHLECHTSUMWANDLUNG': () => ({ type: 'setGender', value: 'wechseln' }),
    'HUHN AUF DEINEM KOPF': () => null,
    'NARRENGOLD': () => null,
    'TOURISTENFALLE': () => null,
    'MIESER SPIEGEL': () => null,
    // ZWERGENBIER wirkt ausschliesslich ueber den Fluch-Tracker
    // (LINGERING_CURSES) - kein Sofort-Effekt:
    'ZWERGENBIER': () => null,
    'STINKER': () => null,
    // Braucht Datenpunkte/Mechaniken, die es hier nicht gibt (freie Handel-
    // Reihenfolge, wiederkehrender Rundenend-Hook, neue Kampfauslösung
    // mitten in der Konsequenz-Auflösung, unterdrückter Rassen/Klassen-
    // Status) - bleiben bewusst manuell:
    'EDELMUT': () => null,
    'HUNGRIGER RUCKSACK': () => null,
    'KLEINER FEHLER': () => null,
    'TEMPORÄRE ANMNESIE': () => null,

    // "Du verlierst deinen wertvollsten Gegenstand, den du im Spiel ausliegen
    // hast" - wertvoll = Goldwert (dasselbe Primitiv wie bei der PACKRATTE),
    // "ausliegen" = angelegt; Handkarten bleiben unangetastet.
    'DU STOLPERST ÜBER DEINE EIGENE TRUHE': () => ({ type: 'discardMaxGoldItem' }),
    // "Der Spieler, der nach dem Opfer an der Reihe ist, waehlt einen der
    // Gegenstaende des Opfers, die im Spiel sind. Leg es ab."
    'PIÑATA': () => ({ type: 'queuedDiscardItemOfVictim', cardName: 'PIÑATA' }),
  };

  // Karten, die in den Rohdaten als "door_other" geführt werden, aber - anders
  // als die übrigen "Sonstige"-Türkarten -
  // textlich eindeutig sofort beim Ziehen wirkende Flüche sind (gleiche
  // Perspektive/Wortwahl wie die 4 echten "curse"-Karten, siehe Vergleich in
  // README). handleDrawDoor behandelt sie deshalb wie echte Fluch-Karten statt
  // sie kommentarlos auf die Hand zu legen.
  const DOOR_OTHER_AS_CURSE = new Set([
    'EXPLODIERENDE KNIESCHÜTZER',
    // Basis-Set + Erweiterungen (siehe CONSEQUENCE_OVERRIDES oben für Details
    // zu jeder einzelnen Karte):
    'Rüstung verlieren', 'Kopfbedeckung verlieren', 'SCHUHWERK VERLIEREN',
    'VERLIERE 1 STUFE', 'VERLIERE DEINE KLASSE', 'VERLIERE DEINE RASSE',
    'KLASSE WECHSELN', 'RASSE WECHSELN', 'QUANTEN', 'REGELN DER NEUAUFLAGE',
    'WINZIGE HÄNDE', 'VERLIERE ZWEI KARTEN', 'VERLIERE 1 GROSSEN GEGENSTAND',
    'VERLIERE 1 KLEINEN GEGENSTAND', 'GESCHLECHTSUMWANDLUNG',
    'HUHN AUF DEINEM KOPF', 'NARRENGOLD',
    'TOURISTENFALLE', 'EDELMUT', 'HUNGRIGER RUCKSACK', 'KLEINER FEHLER',
    'TEMPORÄRE ANMNESIE', 'DU STOLPERST ÜBER DEINE EIGENE TRUHE',
    'ENTE DES SCHRECKENS', 'MIESER SPIEGEL', 'STINKER', 'ZWERGENBIER',
  ]);

  return { CONSEQUENCE_OVERRIDES, DOOR_OTHER_AS_CURSE };
};
