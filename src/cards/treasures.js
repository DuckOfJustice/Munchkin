// Kuratierte Schatzkarten-Tabellen: Sofort-Kräfte (TREASURE_POWER_OVERRIDES),
// Kampf-Tränke (COMBAT_POTION_OVERRIDES, DOOR_COMBAT_CARDS) und
// Weglaufen-Sonderfälle (POST_FLEE_ESCAPE_CARDS, GUARANTEED_FLEE_CARDS,
// GUARANTEED_FLEE_MAX_MONSTER_LEVEL). Kuratiert statt per Regex - siehe die
// Erklärung bei den anderen Kartentabellen.
module.exports = (ctx) => {
  const { card, hasRace, findPlayer, currentPlayer, isTopLevel, combatParticipants, equippedItemIds } = ctx;

  const TREASURE_POWER_OVERRIDES = {
    // --- Ziel-Auswahl (Spieler-Picker) ---
    // "Wähle den Spieler aus, von dem du eine Stufe stehlen willst. Du
    // steigst eine auf und der Gegenspieler steigt eine ab."
    'KLAUE EINE STUFE': () => ({
      type: 'targetPlayer',
      prompt: 'Von wem eine Stufe stehlen?',
      action: { type: 'stealLevel' },
    }),

    // --- Echte Wahl ---
    // "Steige eine Stufe auf. Legst du deine ganze Hand ab (mind. drei
    // Karten), steige zwei Stufen und nicht eine auf!"
    'SINNIEREN': (player) => {
      const options = [{ id: 'one', label: '1 Stufe aufsteigen', action: { type: 'levelUp', amount: 1 } }];
      if (player.hand.length >= 3) {
        options.push({ id: 'hand', label: 'Ganze Hand ablegen (mind. 3 Karten) -> 2 Stufen aufsteigen', action: { type: 'combo', actions: [{ type: 'discardWholeHand' }, { type: 'levelUp', amount: 2 }] } });
      }
      return { type: 'choice', options };
    },
    // "Steige eine Stufe auf. Statt eine Stufe aufzusteigen, kannst du dies
    // auf einen Rivalen spielen, um ihn dazu zu zwingen, dir den Gegenstand
    // zu geben, der ihm den größten Bonus bringt, und er bekommt stattdessen
    // eine Stufe."
    'SINNLOSER AKT DER FREUNDLICHKEIT': () => ({
      type: 'choice',
      options: [
        { id: 'self', label: 'Selbst 1 Stufe aufsteigen', action: { type: 'levelUp', amount: 1 } },
        { id: 'target', label: 'Auf einen Mitspieler anwenden', action: { type: 'targetPlayer', prompt: 'Wen dazu zwingen, seinen besten Gegenstand herzugeben?', action: { type: 'stealBestItemGiveLevel' } } },
      ],
    }),

    // --- Bedingung prüfbar (blockiert, wenn nicht erfüllt) ---
    // "... nicht einsetzbar, wenn du im Augenblick der (oder einer der)
    // höchststufige(n) Spieler bist." / "... wenn du aktuell die höchste
    // Stufe hast oder die höchste Stufe teilst."
    'JAMMER DEN SPIELLEITER AN': (player, room) => (isTopLevel(room, player) ? null : { type: 'levelUp', amount: 1 }),
    'CHARAKTERSEITEN WECHSELN': (player, room) => (isTopLevel(room, player) ? null : { type: 'levelUp', amount: 1 }),
    // "Steige eine Stufe auf. Diese Karte darf nur nach einem Kampf
    // ausgespielt werden, aber es muss nicht dein Kampf gewesen sein."
    // Ohne diesen Eintrag greift die allgemeine "Steige eine Stufe
    // auf"-Erkennung (isInstantLevelUpCard) und die Karte waere jederzeit
    // spielbar - der kuratierte Eintrag hat Vorrang und haengt die
    // Zeitbedingung daran.
    // ponytail: room.combatHappenedThisTurn wird bei jedem Zugwechsel
    // zurueckgesetzt, "nicht dein Kampf" heisst hier also "ein fremder Kampf
    // in DEINEM Zug" (Mithilfe, Wanderndes Monster). Ein Kampf im Zug davor
    // zaehlt nicht mit. Aufruestweg: ein Zaehler, der erst beim Ausspielen
    // der Karte zurueckgesetzt wird, statt beim Zugwechsel.
    'VERSTÜMMLE DIE LEICHEN': (player, room) => (room.combatHappenedThisTurn ? { type: 'levelUp', amount: 1 } : null),
    // "Spielen, wenn ein Rivale einen Kampf gewinnt und eine Stufe aufsteigt.
    // Du tust das auch." - gleiche Bauform wie VERSTÜMMLE DIE LEICHEN, nur
    // strenger: es muss ein FREMDER Sieg gewesen sein.
    // room.lastCombatWinnerId wird NICHT sofort beim Zugwechsel geleert
    // (sonst waere die Karte wirkungslos: der fremde Sieg liegt per
    // Definition im fremden Zug, beim eigenen Zug waere das Feld schon
    // wieder null) - das Fenster bleibt stattdessen eine ganze Runde offen
    // (bis turnIndex wieder beim Sieger ankommt) oder wird vorher schon vom
    // naechsten Sieg ueberschrieben (siehe endTurn/resolveCombatWin in server.js).
    'HEIMSE DIE LORBEEREN EIN': (player, room) => (
      room.lastCombatWinnerId && room.lastCombatWinnerId !== player.id
        ? { type: 'levelUp', amount: 1 } : null),

    // --- Bewusst manuell: hängt von Karten/Zustand ab, den dieser Server
    // nicht separat verfolgt (Mietling "im Spiel" ist keine eigene Zone;
    // "nach einem beliebigen Kampf" ist keine geprüfte Zeitbedingung; die
    // Mehrfach-Effekt-Kette betrifft mehrere Spieler in fester Reihenfolge). ---
    'ENTE DER VIELEN SACHEN': () => null,

    // --- Sonstige Einzelfälle ---
    // "Ziehe sofort 3 weitere Schatzkarten."
    'SCHATZHORT!': () => ({ type: 'drawTreasureN', n: 3 }),
    // "Durchsuche die abgelegten Karten, um eine Karte zu finden, die du
    // willst. Nimm die neue Karte und lege diese ab." (Original-Karte wird
    // beim Ausspielen ohnehin abgelegt.)
    'WÜNSCHELSTAB': () => ({ type: 'chooseDiscardedCard' }),
    'GEDENKTAFEL': (player, room) => (room.combat ? null : { type: 'chooseDiscardedCard' }),

    // "Zu einem beliebigen Zeitpunkt waehrend des Kampfes spielen. Durchsuche
    // den Schatzabwurfstapel ... und tausche diese Karte gegen den ersten
    // tragbaren Gegenstand, den du findest."
    // ponytail: die Kartenwahl (openCardCardChoice) zeigt beide Ablagestapel
    // und filtert nicht auf "tragbar" - wer die Regel streng nimmt, nimmt den
    // obersten Gegenstand des Schatzstapels. Ein eigener gefilterter Waehler
    // waere der Aufruestweg.
    'EINHEITSGRÖSSE': (player, room) => (room.combat ? { type: 'chooseDiscardedCard' } : null),
    // "Du kannst ihn auch als Wunschring einsetzen (z.B. um einen Fluch zu
    // beenden) und hinterher abwerfen." Die Flucht-Seite der Karte laeuft
    // ueber GUARANTEED_FLEE_CARDS weiter unten.
    'DER ANDERE RING': (player) => {
      const flueche = player.activeCurses || [];
      if (!flueche.length) return null;
      if (flueche.length === 1) return { type: 'clearCurse', index: 0 };
      return {
        type: 'choice',
        options: flueche.map((f, i) => ({
          id: `fluch-${i}`, label: `"${f.name}" beenden`, action: { type: 'clearCurse', index: i },
        })),
      };
    },
    // "Jederzeit spielbar, ausser im Kampf. Nur einmal einsetzbar. Wirf
    // Gegenstaende im Wert von mindestens 500 Goldstuecken ab und wirf einen
    // Wuerfel." (Die Wuerfeltabelle steht bei 'dungeonCasino' in server.js.)
    'DAS DUNGEON-CASINO': (player, room) => {
      if (room.combat) return null;
      const wert = equippedItemIds(player).concat(player.hand)
        .reduce((sum, id) => sum + ((card(id) || {}).gold || 0), 0);
      return wert >= 500 ? { type: 'dungeonCasino' } : null;
    },
    // "Jederzeit spielbar. Der Gegner, auf den du diese Karte spielst, kann
    // fuer den Rest des Zugs keine Karten gegen dich spielen und muss alle
    // bereits gespielten Karten auf seine Hand zuruecknehmen."
    // ponytail: umgesetzt ist die Sperre. Das Zuruecknehmen bereits gespielter
    // Karten bleibt manuell - dafuer muesste der Server pro Kampf
    // mitschreiben, wer welche Karte gespielt hat (heute landen sie direkt im
    // Ablagestapel bzw. in monsterModifier).
    'EINSTWEILIGE VERFÜGUNG': () => ({
      type: 'targetPlayer',
      prompt: 'Wer darf für den Rest des Zugs keine Karten mehr gegen dich spielen?',
      action: { type: 'kartenSperre' },
    }),
    // "Beendet jeden Fluch. Jederzeit spielbar. Nur einmal einsetzbar." - mit
    // genau einem aktiven Fluch braucht es keinen Wahldialog dafür.
    'WUNSCHRING': (player) => {
      const flueche = player.activeCurses || [];
      if (!flueche.length) return null; // nichts zu beenden
      if (flueche.length === 1) return { type: 'clearCurse', index: 0 };
      return {
        type: 'choice',
        options: flueche.map((f, i) => ({
          id: `fluch-${i}`, label: `"${f.name}" beenden`, action: { type: 'clearCurse', index: i },
        })),
      };
    },
  };

  const COMBAT_POTION_OVERRIDES = {
    // --- Clerical Errors ---------------------------------------------------
    // "+5 fuer beide Seiten. Nur einmal einsetzbar." Der Text nennt keinen
    // Spielzeitpunkt ("im Kampf"), deshalb greift COMBAT_PLAYABLE_RE nicht
    // und die Karte braucht diesen kuratierten Eintrag.
    'MONSTERFUTTER': () => ({ type: 'modifier', side: 'both', amount: 5 }),
    // "Waehrend beliebigem Kampf spielen. +2 fuer beide Seiten oder +4 wenn
    // von einem Ork geworfen. Aber ein Halbling kann ihn ESSEN und eine Stufe
    // aufsteigen!" parseCombatPotion findet nur die +2 - der Ork-Zusatz und
    // die Halbling-Wahl brauchen diesen Eintrag.
    'LECKERER KUCHEN': (player) => {
      const werfen = { type: 'modifier', side: 'both', amount: hasRace(player, 'ORK') ? 4 : 2 };
      if (!hasRace(player, 'HALBLING')) return werfen;
      return {
        type: 'choice',
        options: [
          { id: 'werfen', label: `Kuchen werfen (+${werfen.amount} fuer beide Seiten)`, action: werfen },
          { id: 'essen', label: 'Kuchen essen -> 1 Stufe aufsteigen', action: { type: 'levelUp', amount: 1 } },
        ],
      };
    },
    // "Dieses feurige Gebraeu gewaehrt beiden Seiten +3, oder +6, wenn es zur
    // Hilfe von Halblingen eingesetzt wird." Die Zahl steht hinter der Seite,
    // parseCombatPotion findet sie deshalb nicht.
    'SCHARFE PFEFFERSOSSE': (player, room) => ({
      type: 'modifier', side: 'both',
      amount: combatParticipants(room).some((p) => hasRace(p, 'HALBLING')) ? 6 : 3,
    }),
    // "Du hast die Goetter erfreut und sie zeigen dir ihre Anerkennung, indem
    // sie alle Monster auf unschoene Weise toeten. Die Goetter nehmen sich
    // allerdings auch den Schatz und die Stufen. Du kannst den Raum nicht
    // pluendern." -> kein Schatz, keine Stufe, kein Pluendern.
    'DEUS EX MASCHINENGEWEHR': () => ({ type: 'endCombatNoLevel' }),
    // "Waehrend einem beliebigen Kampf spielen, nachdem jemand entschieden
    // hat, im Kampf zu helfen. Dieser Munchkin wandert davon und kann nicht
    // teilnehmen." Gleiche Wirkung wie der CYTILLESH-TRANK.
    'TRANK DER APATHIE': (player, room) => (room.combat.helperId ? { type: 'removeHelper' } : null),
    // "Wenn ein Spieler befugt ist, im Kampf um Hilfe zu bitten, spiele diese
    // Karte, um ihn dazu zu zwingen, deine Hilfe zu akzeptieren. Du kannst
    // keine Belohnung einfordern."
    // ponytail: "befugt, um Hilfe zu bitten" heisst hier schlicht "es laeuft
    // ein Kampf, in dem noch niemand hilft" - eine eigene Befugnis-Pruefung
    // gibt es in diesem Server nicht. Der zweite Satz der Karte (eine frueher
    // freiwillige Person bekommt ihre einmaligen Karten zurueck) bleibt
    // manuell, dafuer muesste der Server pro Kampf mitschreiben, wer was
    // gespielt hat.
    'NIMM MICH! NIMM MICH!': (player, room) => (
      !room.combat.helperId && room.combat.actorId !== player.id
        ? { type: 'forceSelfAsHelper' } : null),
    // "Waehle einen Gegenstand, den du verwendest, der nicht 'nur einmal
    // einsetzbar' ist. Erhalte fuer einen einzigen Kampf 3-Mal den normalen
    // Bonus dieses Gegenstands."
    'HALBFINAL-SCHLAG': (player) => {
      const ids = equippedItemIds(player).filter((id) => {
        const c = card(id);
        return c && (c.bonus || 0) > 0 && !/nur\s+einmal\s+einsetzbar/i.test(c.text || '');
      });
      if (!ids.length) return null;
      return {
        type: 'choice',
        options: ids.map((id) => ({
          id: `item-${id}`,
          label: `"${card(id).name}" dreifach zaehlen lassen (+${(card(id).bonus || 0) * 3})`,
          action: { type: 'tripleItemBonus', itemId: id },
        })),
      };
    },
    // "Lege alle Monster des Kampfes ab. Du erhältst keinen Schatz, aber du
    // darfst den Raum durchsuchen."
    'FREUNDSCHAFTSTRANK': () => ({ type: 'endCombatNoLevel', thenLoot: true }),
    // "Verwandelt ein Monster in einen Papagei, der wegfliegt und seinen
    // Schatz zurücklässt." -> Schatz gehört der kämpfenden Person.
    'POLLYVERWANDLUNGSTRANK': () => ({ type: 'endCombatNoLevel', leavesTreasure: true }),
    // "Bringt ein Monster dazu, verwirrt wegzulaufen und seinen Schatz
    // zurückzulassen." -> ebenfalls Schatz, aber keine Stufe.
    'TRANK DER IRRELEVANZ': () => ({ type: 'endCombatNoLevel', leavesTreasure: true }),
    // "Lege das Monster nach unten in den Türstapel zurück. Wenn es das
    // einzige Monster im Kampf war, ist der Kampf vorbei und der aktuelle
    // Spieler plündert den Raum." (kein Schatz - das Monster nimmt ihn mit)
    'ENTLASSUNGSGLOCKE': () => ({ type: 'endCombatNoLevel', returnToDoorDeckBottom: true, thenLoot: true }),
    // "Der Helfer vergisst, dass er kämpft, geht und lässt den Hauptkämpfer
    // allein im Kampf zurück." (nur spielbar, wenn ein Helfer im Kampf ist)
    'CYTILLESH-TRANK': (player, room) => (room.combat.helperId ? { type: 'removeHelper' } : null),
    // "+2 egal für welche Seite, oder tötet sofort die Laufende Nase."
    'TRANK DES MUNDGERUCHS': (player, room) => {
      const hasLaufendeNase = room.combat.monsterIds.some((id) => { const m = card(id); return m && m.name === 'LAUFENDE NASE'; });
      const options = [
        { id: 'munchkins', label: '+2 für die Munchkins', action: { type: 'modifier', side: 'actor', amount: 2 } },
        { id: 'monster', label: '+2 für das Monster', action: { type: 'modifier', side: 'monster', amount: 2 } },
      ];
      if (hasLaufendeNase) options.push({ id: 'kill', label: 'Laufende Nase sofort töten (kein Schatz)', action: { type: 'killMonsterInCombat', name: 'LAUFENDE NASE' } });
      return { type: 'choice', options };
    },
    // "Nur einmal einsetzbar und nur, um Elfen zu helfen. +2 für jeden Elf im
    // Kampf." (Angreifer:in + Helfer:in gezählt; ohne Elf nicht einsetzbar.)
    'YUPPIE-WASSER': (player, room) => {
      const c = room.combat;
      const participants = [c.actorId, c.helperId].filter(Boolean).map((id) => findPlayer(room, id)).filter(Boolean);
      const elfCount = participants.filter((p) => hasRace(p, 'ELF')).length;
      return elfCount ? { type: 'modifier', side: 'actor', amount: 2 * elfCount } : null;
    },
    // "... aber nur, wenn du mindestens eine freie Hand hast. +4 für die
    // Munchkin-Seite."
    // "Beschwoere deine exakte Kopie. Verdopple deine Kampfstaerke. Der
    // Doppelgaenger darf nur eingesetzt werden, wenn du der einzige Spieler im
    // Kampf bist."
    'DOPPELGÄNGER': (player, room) => (room.combat.actorId === player.id && !room.combat.helperId
      ? { type: 'doubleStrength' } : null),
    'FLÜSSIGKLINGE': (player) => (player.equipped.hands.includes(null) ? { type: 'modifier', side: 'actor', amount: 4 } : null),
    // "Einmal pro Zug kannst du in deinem Zug ein Monster aus dem Kampf
    // entfernen, indem du 3 Karten ablegst und seinen Schatz zurücklässt.
    // Verzauberte Monster gewähren keine Stufen! Nachdem du ein Monster
    // verzaubert hast, würfelst du. Bei einer 1 legst du das Verzauberarmband
    // ab." -> "seinen Schatz zurücklässt" + "keine Stufen" ist genau
    // endCombatNoLevel/leavesTreasure. Nur im eigenen Zug und nur bei genau
    // EINEM Monster im Kampf einsetzbar: endCombatNoLevel legt immer alle
    // Monster ab und würde bei mehreren auch den Schatz der nicht verzauberten
    // ausschütten - ein einzelnes Monster samt seinem Schatz herauszulösen
    // bräuchte eine Monster-Auswahl, die es hier nicht gibt (dann bewusst
    // manuell abwickeln). Die 3 abzulegenden Karten bleiben ebenfalls manuell
    // (es gibt keinen Mehrfach-Kartenwähler; 'discardFromHand' macht das von
    // Hand) - geprüft wird nur, dass sie überhaupt auf der Hand liegen. Der
    // Würfelwurf danach entfällt, weil die Karte hier wie jeder Kampf-Trank
    // immer verbraucht wird: strenger als die Regel, dafür braucht "einmal pro
    // Zug" keinen eigenen Zähler.
    'VERZAUBERARMBAND': (player, room) => {
      const onTurn = currentPlayer(room);
      return onTurn && onTurn.id === player.id && room.combat.monsterIds.length === 1 && player.hand.length >= 4
        ? { type: 'endCombatNoLevel', leavesTreasure: true }
        : null;
    },
  };

  // Tuerkarten mit eigener Kampfwirkung, die keine Monster-Verstaerker sind
  // (die laufen ueber isMonsterEnhancerCard). Jede:r am Tisch darf sie spielen.
  const DOOR_COMBAT_CARDS = {
    // "Das Monster in diesem Raum hat Mittagspause. ... Der kaempfende Spieler
    // legt alle ihn angreifenden Monster ab und zieht sofort 2 Schaetze."
    // Feste 2 Schaetze - nicht der treasureCount der Monster.
    'MAHLZEIT!': () => ({ type: 'endCombatNoLevel', leavesTreasure: true, fixedTreasures: 2 }),
    // "Waehrend beliebigem Kampf spielen. Ein Monster hat einen Tippfehler in
    // seiner Beschreibung; daher wird es fuer alle Zwecke als Stufe 1
    // behandelt. Seine Kraefte und sein Schatz bleiben unveraendert."
    'TYPOGRAFISCHER FEHLER': () => ({ type: 'treatMonsterAsLevel1' }),
    // "Waehrend beliebigem Kampf spielen. Die Monster sind mit ihrem eigenen
    // Spiel beschaeftigt; sie werden nicht kaempfen und werden sie
    // angegriffen, schmeissen sie die Tuer zu."
    // ponytail: der zweite Absatz (das unterlegene Monster tauscht seine
    // Schaetze gegen "Steige eine Stufe auf"-Karten, jede davon bringt zwei
    // Schaetze) ist ein Handel ueber den ganzen Tisch und bleibt manuell -
    // dafuer braeuchte es eine eigene Angebotsrunde.
    'MONSTER SIND BESCHÄFTIGT': () => ({ type: 'endCombatNoLevel' }),
    // "Fuer ein Monster im Kampf spielen. Wird der Schatz erbeutet, koennen
    // die Spieler, die ihn erhalten, jede Schatzkarte ablegen, nachdem sie
    // sich diese angesehen haben, und einmalig eine Ersatzkarte ziehen."
    'UNFASSBAR REICH': () => ({ type: 'schatzUmtauschAnmelden' }),
  };

  // "Ablegen, wenn der Weglaufen-Wurf misslingt. Du entkommst automatisch."
  // (Die GUARANTEED_FLEE_CARDS wirken dagegen VOR dem Wurf.)
  const POST_FLEE_ESCAPE_CARDS = new Set(['UNSICHTSBARKEITSTRANK']); // Name wie auf der Karte (mit S)

  // Garantierte Flucht-Karten: statt eines Weglaufen-Würfelwurfs sofort und
  // sicher aus dem Kampf entkommen. Nur nutzbar, während tatsächlich geflohen
  // werden muss (mustFlee) und nur für die kämpfende Person selbst (Hilfe für
  // eine zweite Person ist in diesem Server ohnehin nicht separat vom
  // Kampf-Ausgang der Hauptperson abhängig, siehe handleAttemptFlee).
  const GUARANTEED_FLEE_CARDS = new Set(['FERTIGMAUER', 'BABY-ÖL', 'DER ANDERE RING', 'RATTE AM SPIESS']);
  // RATTE AM SPIESS: "Du kannst diesen Gegenstand ablegen, um automatisch einem
  // beliebigen Monster der Stufe 8 oder niedriger zu entkommen - sogar dann,
  // wenn du die Ratte am Spieß lediglich im Rucksack mit dir trägst."
  // Daher: Stufengrenze, und nutzbar sowohl von der Hand als auch angelegt.
  const GUARANTEED_FLEE_MAX_MONSTER_LEVEL = { 'RATTE AM SPIESS': 8 };

  return {
    TREASURE_POWER_OVERRIDES, COMBAT_POTION_OVERRIDES, DOOR_COMBAT_CARDS,
    POST_FLEE_ESCAPE_CARDS, GUARANTEED_FLEE_CARDS, GUARANTEED_FLEE_MAX_MONSTER_LEVEL,
  };
};
