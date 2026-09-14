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

  const CONSEQUENCE_OVERRIDES = {
    // --- Eindeutiger Tod in ungewöhnlicher Formulierung ---
    'BULLROG': () => ({ type: 'death' }), // "Du wirst zu Tode gepeitscht."
    'JUDGE FREDD': () => ({ type: 'death' }), // "Er prügelt dich zu Tode ..."
    'KALI': () => ({ type: 'death' }), // "Stirb, stirb, stirb ..."
    'TENTAKELDÄMON': () => ({ type: 'death' }), // "Wenn du gefangen wirst, stirbst du." (Kontext: Flucht ist bereits gescheitert)
    'SIEBENJÄHRIGER LICH': () => ({ type: 'death' }), // "Wenn er dich erwischt, stirbst du ..."
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
    // Verdopplung bei angehängtem "Gigantisch" wird nicht erkannt (dafür gibt
    // es kein Datenfeld an dieser Stelle) - Basis-Effekt wird trotzdem berechnet:
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
    // "+1 Stufe zurück je sofort abgelegtem Trank" wird nicht erkannt (kein
    // Datenfeld für "Trank") - nur der garantierte Basis-Verlust:
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

    // --- Fehlkategorisierte Flüche (Pathfinder-Set): stehen in den Rohdaten in
    // "door_other" statt "curse", sind aber textlich eindeutig sofort beim
    // Ziehen wirkende Flüche (gleiche Wortwahl/Perspektive wie die echten
    // Fluch-Karten oben) - siehe DOOR_OTHER_AS_CURSE unten, das sie über
    // denselben Mechanismus wie echte Flüche laufen lässt. ---
    'SCHUHSUPPE': () => ({ type: 'discardSlot', slot: 'feet' }), // "VERLIERE DEIN SCHUHWERK"
    'OHRWÜRMER': () => ({ type: 'discardSlot', slot: 'head' }), // "VERLIERE DEINE KOPFBEDECKUNG."
    'ANTHRAKITIS': () => ({ type: 'levelDelta', amount: 1 }), // "VERLIERE 1 STUFE"
    'BRANDBAUCH': () => ({ type: 'levelDelta', amount: 1 }), // "VERLIERE 1 STUFE"
    'VERLIERE DEINE KLASSE!': () => ({ type: 'discardClassCards' }),
    'VERLIERE DEINE MACHTGRUPPE!': () => ({ type: 'discardPowerGroupCards' }),
    'WECHSLE DEINE KLASSE': () => ({ type: 'replaceTraitFromDiscard', arrField: 'classes', capField: 'classCapCard', category: 'class', label: 'Klasse' }),
    'WECHSLE DEINE MACHTGRUPPE': (player, room) => ({ type: 'replaceTraitFromDiscard', arrField: 'powerGroups', capField: 'powerGroupCapCard', category: 'door_other', label: 'Machtgruppe' }),
    'SACKGASSE': () => ({ type: 'discardDoorCardsFromHand' }), // "Lege alle Türkarten aus deiner Hand ab."
    'VERSAGEN BEI DER PRÜFUNG DES STERNSTEINS': () => ({ type: 'discardMaxBonusItem' }), // "Lege den Gegenstand ab, der dir den größten Kampfbonus gewährt."
    'ROTE VERZIERUNG': () => ({ type: 'discardHandSlotItemElseLevel' }), // "VERLIERE 1 HAND-GEGENSTAND, sonst 1 Stufe"
    // "Verliere 1 Stufe" + Sonderklausel bei "ausdrücklich an den Knien
    // getragenem" Gegenstand - dafür gibt es kein Datenfeld, nur die
    // garantierte Basis-Stufe wird automatisch verrechnet:
    'EXPLODIERENDE KNIESCHÜTZER': () => ({ type: 'levelDelta', amount: 1 }),
    // "Verliere 1 Stufe. Kundschafter können ihre Machtgruppe ablegen, anstatt
    // 1 Stufe zu verlieren" - jetzt, wo Machtgruppen erfasst werden, als echte
    // Wahl abbildbar:
    'VERLIERE DEN PFAD': (player) => (hasPowerGroup(player, 'KUNDSCHAFTER')
      ? { type: 'choice', options: [
          { id: 'level', label: '1 Stufe verlieren', action: { type: 'levelDelta', amount: 1 } },
          { id: 'group', label: 'Machtgruppe (Kundschafter) ablegen', action: { type: 'discardPowerGroupCards' } },
        ] }
      : { type: 'levelDelta', amount: 1 }),
    // "VERLIERE 1 GROSSEN GEGENSTAND. Wenn du keinen Großen Gegenstand hast,
    // verliere 1 Stufe."
    'GRÜNSCHLEIM': (player, room) => (bigItemCount(player, room) ? { type: 'discardBigItem' } : { type: 'levelDelta', amount: 1 }),
    // Betrifft, WELCHE Karte(n) andere Spieler:innen von der eigenen Hand
    // nehmen (freie/zufällige Auswahl, in den Rohdaten nicht festgelegt) -
    // bleibt bewusst manuell:
    'SCHARLACHLEPRA': () => null,
    // Freie Auswahl "irgendein kleiner Gegenstand ablegen" (hier ist ohnehin
    // JEDER Gegenstand "klein", da kein "Großer Gegenstand"-Datenfeld
    // existiert) - dafür gibt es schon die generischen Ablegen-Knöpfe, bleibt
    // bewusst manuell statt einer erzwungenen Wahl:
    'HÄNGENGELASSEN': () => null,
    'SCHNELLES GELD': () => null,
    // Hat einen alternativen Kampf-Einsatz ("+3 für Monster bei Goblins")
    // zusätzlich zum Sofort-Effekt - nur der Sofort-Effekt wird automatisch
    // berechnet, der Kampf-Bonus bleibt (wie bei Monster-Verstärkern mit
    // Zusatzklauseln) manuell:
    'GOBLINAUSSCHLAG': () => ({ type: 'discardSlot', slot: 'armor' }), // "DU VERLIERST DEINE RÜSTUNG"

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
    'BLUTSCHLEIER': () => null,
    'RAUSCHPOCKEN': () => null,
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
    'DU STOLPERST ÜBER DEINE EIGENE TRUHE': () => null,
  };

  // Karten aus dem Pathfinder-Set, die in den Rohdaten als "door_other"
  // geführt werden, aber - anders als die übrigen "Sonstige"-Türkarten -
  // textlich eindeutig sofort beim Ziehen wirkende Flüche sind (gleiche
  // Perspektive/Wortwahl wie die 4 echten "curse"-Karten, siehe Vergleich in
  // README). handleDrawDoor behandelt sie deshalb wie echte Fluch-Karten statt
  // sie kommentarlos auf die Hand zu legen.
  const DOOR_OTHER_AS_CURSE = new Set([
    'SCHUHSUPPE', 'OHRWÜRMER', 'ANTHRAKITIS', 'BRANDBAUCH', 'SACKGASSE',
    'VERLIERE DEINE KLASSE!', 'VERLIERE DEINE MACHTGRUPPE!',
    'WECHSLE DEINE KLASSE', 'WECHSLE DEINE MACHTGRUPPE',
    'VERSAGEN BEI DER PRÜFUNG DES STERNSTEINS', 'ROTE VERZIERUNG',
    'EXPLODIERENDE KNIESCHÜTZER', 'VERLIERE DEN PFAD', 'GRÜNSCHLEIM',
    'SCHARLACHLEPRA', 'HÄNGENGELASSEN', 'SCHNELLES GELD', 'GOBLINAUSSCHLAG',
    // Basis-Set + Erweiterungen (siehe CONSEQUENCE_OVERRIDES oben für Details
    // zu jeder einzelnen Karte):
    'Rüstung verlieren', 'Kopfbedeckung verlieren', 'SCHUHWERK VERLIEREN',
    'VERLIERE 1 STUFE', 'VERLIERE DEINE KLASSE', 'VERLIERE DEINE RASSE',
    'KLASSE WECHSELN', 'RASSE WECHSELN', 'QUANTEN', 'REGELN DER NEUAUFLAGE',
    'WINZIGE HÄNDE', 'VERLIERE ZWEI KARTEN', 'VERLIERE 1 GROSSEN GEGENSTAND',
    'VERLIERE 1 KLEINEN GEGENSTAND', 'GESCHLECHTSUMWANDLUNG',
    'HUHN AUF DEINEM KOPF', 'NARRENGOLD', 'BLUTSCHLEIER', 'RAUSCHPOCKEN',
    'TOURISTENFALLE', 'EDELMUT', 'HUNGRIGER RUCKSACK', 'KLEINER FEHLER',
    'TEMPORÄRE ANMNESIE', 'DU STOLPERST ÜBER DEINE EIGENE TRUHE',
    'ENTE DES SCHRECKENS', 'MIESER SPIEGEL', 'STINKER', 'ZWERGENBIER',
  ]);

  return { CONSEQUENCE_OVERRIDES, DOOR_OTHER_AS_CURSE };
};
