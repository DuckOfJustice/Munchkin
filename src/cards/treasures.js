// Kuratierte Schatzkarten-Tabellen: Sofort-Kräfte (TREASURE_POWER_OVERRIDES),
// Kampf-Tränke (COMBAT_POTION_OVERRIDES, DOOR_COMBAT_CARDS) und
// Weglaufen-Sonderfälle (POST_FLEE_ESCAPE_CARDS, GUARANTEED_FLEE_CARDS,
// GUARANTEED_FLEE_MAX_MONSTER_LEVEL). Kuratiert statt per Regex - siehe die
// Erklärung bei den anderen Kartentabellen.
module.exports = (ctx) => {
  const { card, hasRace, findPlayer, currentPlayer, isTopLevel, combatParticipants, equippedItemIds, hatSchatzSperre } = ctx;

  // "Beendet jeden Fluch." - gemeinsame Vorlage fuer WUNSCHRING und DER
  // ANDERE RING (gleicher Kartentext, gleiche Mechanik).
  // Gewaehlt wird NICHT nach Position in activeCurses: zwischen dem Oeffnen
  // des Wahldialogs und der Antwort kann die Liste sich verschieben
  // (clearNextCombatCurses raeumt alle 'naechsterKampf'-Eintraege ab, sobald
  // ein Kampf endet) - ein gespeicherter Index zeigte dann auf den falschen
  // Fluch. Beendet wird genau der gewaehlte Eintrag - ueber eine Id, die hier beim
  // Anbieten vergeben wird (die Eintraege entstehen an mehreren Stellen in
  // server.js, die Id braucht aber nur der Ring). Sonst endeten zwei Fluechen
  // derselben Wirkungsart gemeinsam (GESCHLECHTSUMWANDLUNG + ZWERGENBIER,
  // beide combatMalus).
  let fluchIdZaehler = 0;
  const fluchBeendenSpec = (player) => {
    const flueche = player.activeCurses || [];
    if (!flueche.length) return null; // nichts zu beenden
    // itemId nur noch fuer die Anzeige (VERFLUCHTER GEGENSTAND).
    const beenden = (f) => {
      if (!f.id) f.id = `fluch-${++fluchIdZaehler}`;
      return { type: 'clearCurse', id: f.id, kind: f.kind, name: f.name, itemId: f.itemId || null };
    };
    if (flueche.length === 1) return beenden(flueche[0]);
    return {
      type: 'choice',
      options: flueche.map((f, i) => ({
        id: `fluch-${i}`,
        label: f.itemId && card(f.itemId)
          ? `"${f.name}" auf "${card(f.itemId).name}" beenden`
          : `"${f.name}" beenden`,
        action: beenden(f),
      })),
    };
  };

  const TREASURE_POWER_OVERRIDES = {
    // --- Unnatural Axe ---
    'FLOHMARKT': (player, room) => {
      // Holt Schaetze aus dem Ablagestapel - nicht auf der Stoererliste.
      if (hatSchatzSperre(player)) return null;
      const items = [...player.hand, ...equippedItemIds(player)]
        .filter(id => card(id) && typeof card(id).gold === 'number');
      if (items.length === 0) return null; // Needs an item
      return {
        type: 'choice',
        options: items.map(id => ({
          id,
          label: `"${card(id).name}" (${card(id).gold} Gold) abwerfen`,
          action: { type: 'flohmarktSelectTarget1', discardedId: id }
        }))
      };
    },
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
    // Stoererliste: der Gegenstand waere eine Schatzkarte - dann nur die Stufe.
    'SINNLOSER AKT DER FREUNDLICHKEIT': (player) => ({
      type: 'choice',
      options: [
        { id: 'self', label: 'Selbst 1 Stufe aufsteigen', action: { type: 'levelUp', amount: 1 } },
        { id: 'target', label: 'Auf einen Mitspieler anwenden', action: { type: 'targetPlayer', prompt: 'Wen dazu zwingen, seinen besten Gegenstand herzugeben?', action: { type: 'stealBestItemGiveLevel' } } },
      ].filter((o) => o.id !== 'target' || !hatSchatzSperre(player)),
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

    // "Tue folgendes, in dieser Reihenfolge: Nimm zufaellig eine Karte aus der
    // Hand des naechsten Spielers ... Gib dem naechsten Spieler eine Karte
    // deiner Wahl. Nimm die oberste Karte vom Ablagestapel eines der Decks.
    // Singe ein Staendchen. Steige eine Stufe auf. Lege zwei Karten ab. Lege
    // diese Karte ab." Die Kette laeuft als Warteschlange auf dieselbe Person,
    // damit die Reihenfolge auch ueber die Dialoge hinweg steht - siehe
    // 'enteDerVielenSachen' in server.js.
    'ENTE DER VIELEN SACHEN': () => ({ type: 'enteDerVielenSachen' }),

    // --- Sonstige Einzelfälle ---
    // "Ziehe sofort 3 weitere Schatzkarten."
    'SCHATZHORT!': () => ({ type: 'drawTreasureN', n: 3 }),
    // "Durchsuche die abgelegten Karten, um eine Karte zu finden, die du
    // willst. Nimm die neue Karte und lege diese ab." (Original-Karte wird
    // beim Ausspielen ohnehin abgelegt.)
    // Stoererliste: nur Tuerkarten waehlbar (openCardCardChoice filtert) -
    // ohne Tuerkarte im Ablagestapel nicht einsetzbar.
    'WÜNSCHELSTAB': (player, room) => (hatSchatzSperre(player) && !room.doorDiscard.length
      ? null : { type: 'chooseDiscardedCard' }),

    // "Zu einem beliebigen Zeitpunkt waehrend des Kampfes spielen. Durchsuche
    // den Schatzabwurfstapel ... und tausche diese Karte gegen den ersten
    // tragbaren Gegenstand, den du findest."
    // ponytail: die Kartenwahl (openCardCardChoice) zeigt beide Ablagestapel
    // und filtert nicht auf "tragbar" - wer die Regel streng nimmt, nimmt den
    // obersten Gegenstand des Schatzstapels. Ein eigener gefilterter Waehler
    // waere der Aufruestweg.
    'EINHEITSGRÖSSE': (player, room) => (room.combat && !hatSchatzSperre(player)
      ? { type: 'takeFirstWearableFromTreasureDiscard' } : null),
    // "Du kannst ihn auch als Wunschring einsetzen (z.B. um einen Fluch zu
    // beenden) und hinterher abwerfen." Die Flucht-Seite der Karte laeuft
    // ueber GUARANTEED_FLEE_CARDS weiter unten.
    'DER ANDERE RING': fluchBeendenSpec,
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
    'WUNSCHRING': fluchBeendenSpec,
  };

  const COMBAT_POTION_OVERRIDES = {
    // --- Unnatural Axe -----------------------------------------------------
    'FEIGHEITSTRANK': () => ({ type: 'forceFlee' }),
    'UNGLÄUBIGKEITSTRANK': (player, room) => ({
      type: 'removeOneMonster',
      leavesTreasure: room.combat.monsterIds.length === 1,
      keepTreasureForWin: room.combat.monsterIds.length > 1,
    }),
    'JUCKPULVER': (player, room) => {
      const c = room.combat;
      if (!c) return null;
      const targets = [c.actorId, c.helperId].filter(Boolean).map(id => room.players.find(p => p.id === id));
      const options = [];
      targets.forEach(t => {
        const e = t.equipped;
        [e.head, e.armor, e.feet].filter(Boolean).forEach(itemId => {
          options.push({
            id: itemId,
            label: `${t.name}: "${card(itemId).name}" ablegen`,
            action: { type: 'juckpulverDiscard', playerId: t.id, itemId }
          });
        });
      });
      if (options.length === 0) return { type: 'modifier', side: 'both', amount: 0 };
      return { type: 'choice', options };
    },

    // --- Clerical Errors ---------------------------------------------------
    // "+5 fuer eine der beiden Seiten. Nur einmal einsetzbar." Der Text nennt
    // keinen Spielzeitpunkt ("im Kampf"), deshalb greift COMBAT_PLAYABLE_RE
    // nicht und die Karte braucht diesen kuratierten Eintrag.
    'MONSTERFUTTER': () => ({ type: 'modifier', side: 'either', amount: 5 }),
    // "Hebe einen Zwerg hoch, der sich nicht im Kampf befindet. Wirf ihn in
    // die Schlacht. +6 fuer eine der beiden Seiten. Dich selbst kannst du
    // nicht werfen." Ohne werfbaren Zwerg nicht einsetzbar.
    // ponytail: welcher Zwerg fliegt, wird nicht abgefragt - der Wurf hat fuer
    // ihn keine Folgen, die Wahl aendert also nichts.
    'ZWERGENWURF': (player, room) => {
      const imKampf = combatParticipants(room).map((p) => p.id);
      const werfbar = room.players.some((p) => p.id !== player.id && !imKampf.includes(p.id) && hasRace(p, 'ZWERG'));
      return werfbar ? { type: 'modifier', side: 'either', amount: 6 } : null;
    },
    // "Waehrend beliebigem Kampf spielen. +2 fuer eine der beiden Seiten oder
    // +4 wenn von einem Ork geworfen. Aber ein Halbling kann ihn ESSEN und eine
    // Stufe aufsteigen!" parseCombatPotion findet nur die +2 - der Ork-Zusatz
    // und die Halbling-Wahl brauchen diesen Eintrag.
    'LECKERER KUCHEN': (player) => {
      const amount = hasRace(player, 'ORK') ? 4 : 2;
      if (!hasRace(player, 'HALBLING')) return { type: 'modifier', side: 'either', amount };
      // Werfen braucht hier die Seite gleich mit - die Seitenwahl in
      // handlePlayCombatCard greift nur fuer ein nacktes 'either'.
      return {
        type: 'choice',
        options: [
          { id: 'munchkins', label: `Kuchen werfen: +${amount} für die Munchkins`, action: { type: 'modifier', side: 'actor', amount } },
          { id: 'monster', label: `Kuchen werfen: +${amount} für das Monster`, action: { type: 'modifier', side: 'monster', amount } },
          { id: 'essen', label: 'Kuchen essen -> 1 Stufe aufsteigen', action: { type: 'levelUp', amount: 1 } },
        ],
      };
    },
    // "Dieses feurige Gebraeu gewaehrt +3 fuer eine der beiden Seiten, oder +6,
    // wenn es zur Hilfe von Halblingen eingesetzt wird." Die +6 gibt es nur
    // auf der Munchkin-Seite; die Zahl steht hinter der Seite, parseCombatPotion
    // findet sie deshalb nicht.
    'SCHARFE PFEFFERSOSSE': (player, room) => ({
      type: 'modifier', side: 'either', amount: 3,
      actorAmount: combatParticipants(room).some((p) => hasRace(p, 'HALBLING')) ? 6 : 3,
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
    'POLLYVERWANDLUNGSTRANK': () => ({ type: 'removeOneMonster', leavesTreasure: true }),
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
  };

  // Tuerkarten mit eigener Kampfwirkung, die keine Monster-Verstaerker sind
  // (die laufen ueber isMonsterEnhancerCard). Jede:r am Tisch darf sie spielen.
  const DOOR_COMBAT_CARDS = {
    'TOD': () => ({ type: 'removeOneMonster', leavesTreasure: true }),
    'ABGEBRANNT': () => ({ type: 'zeroMonsterTreasure' }),
    'FREUNDLICH': () => ({ type: 'freundlichChoice' }),
    'MAMI': (player, room) => {
      const enhancers = room.combat.enhancers || [];
      const validMonsterIds = room.combat.monsterIds.filter((m) => {
        const lv = card(m).level || 0;
        // Nur BABY auf GENAU diesem Monster erlaubt MAMI auch jenseits von
        // Stufe 5 - BABY auf einem anderen Monster im selben Kampf zaehlt
        // fuer dieses Monster nicht mit.
        const hasBaby = enhancers.some((e) => e.monsterId === m && (card(e.cardId) || {}).name === 'BABY');
        return lv <= 5 || hasBaby;
      });
      if (validMonsterIds.length === 0) return null;
      return { type: 'duplicateMonsterMommy', validMonsterIds };
    },
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
