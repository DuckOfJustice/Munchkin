// Bedingtes Reaktionsfenster (Task 4): GEZINKTER WÜRFEL reagiert auf einen
// Wurf, KLEBERFLÄSCHCHEN auf eine gelungene Flucht - beide brauchen ein
// Zeitfenster, das es sonst nirgends gibt. MAGISCHE LAMPE braucht KEIN neues
// Fenster, sie haengt am bestehenden Fluchtentscheidungsfenster.
//
// Der zentrale Kern, den dieser Test am haertesten prueft: haelt NIEMAND
// eine passende Karte, muss rollWithWindow synchron und bitgleich zum
// bisherigen Verhalten aufloesen - genau das schuetzt die bestehenden
// Wuerfel- und Fluchtpfade (card-passives.test.js) vor Verhaltensaenderung.
const assert = require('assert');
const {
  ALL_CARDS, reactionHolders, rollWithWindow, ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS,
  newEquipped, handleAttemptFlee, handlePlayReactionCard, handlePassReaction, handleUseLamp,
  handlePlayCombatCard, handleFleeReroll, botFleeRerollCard, applyPrimitiveAction,
} = require('../server.js');

function findCard(name, category) {
  const c = ALL_CARDS.find((x) => x.name === name && (!category || x.category === category));
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c;
}

function makePlayer(overrides) {
  return Object.assign({
    id: 'p1', name: 'A', level: 5, hand: [], races: [], classes: [], powerGroups: [],
    raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), isBot: false, connected: true,
  }, overrides || {});
}

const treasureFiller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 20).map((c) => c.id);

function makeRoom(extra) {
  return Object.assign({
    code: 'TEST',
    players: [makePlayer({ id: 'p1', name: 'A' }), makePlayer({ id: 'p2', name: 'B' })],
    turnIndex: 0, turnPhase: 'kampf', combatHappenedThisTurn: true,
    doorDeck: [], doorDiscard: [], treasureDeck: treasureFiller.slice(), treasureDiscard: [],
    revealedDoorCard: null, doorReveal: null, dieRoll: null,
    combat: null, pendingConsequence: null, pendingCardAction: null, pendingRoll: null,
    winner: null, logs: [], lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
    settings: { sets: {} },
  }, extra || {});
}

function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
  return room;
}

// Kampf-Raum, in dem p1 fliehen muss.
function fleeRoom(monsterNames, actorOverrides, combatOverrides) {
  const ids = monsterNames.map((n) => findCard(n, 'monster').id);
  const room = makeRoom({
    combat: Object.assign({
      actorId: 'p1', helperId: null, helperPending: null, monsterIds: ids,
      actorModifier: 0, monsterModifier: 0, mustFlee: true, fromHand: false,
    }, combatOverrides || {}),
  });
  Object.assign(room.players[0], actorOverrides || {});
  return room;
}

function run() {
  // -------------------------------------------------------------------
  // Kartennamen/-mengen stimmen mit den Rohdaten ueberein
  // -------------------------------------------------------------------
  assert.ok(findCard('GEZINKTER WÜRFEL') && ROLL_REACTION_CARDS.has('GEZINKTER WÜRFEL'));
  assert.ok(findCard('KLEBERFLÄSCHCHEN') && ESCAPE_REACTION_CARDS.has('KLEBERFLÄSCHCHEN'));
  assert.ok(findCard('MAGISCHE LAMPE'));

  // -------------------------------------------------------------------
  // rollWithWindow: das zentrale Verhalten, das bestehende Pfade schuetzt
  // -------------------------------------------------------------------
  {
    // Niemand haelt die Karte -> sofort und synchron aufgeloest, kein Fenster.
    const room = makeRoom();
    let gesehen = null;
    rollWithWindow(room, room.players[0], 'test', (roll) => { gesehen = roll; });
    assert.ok(gesehen !== null, 'ohne Reaktionskarte muss sofort aufgeloest werden');
    assert.ok(gesehen >= 1 && gesehen <= 6, 'Wurf muss 1..6 sein');
    assert.ok(!room.pendingRoll, 'es darf kein Fenster offen bleiben');
  }
  {
    // Ein Bot haelt die Karte -> zaehlt nicht, kein Fenster.
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const room = makeRoom({ players: [makePlayer({ id: 'p1' }), makePlayer({ id: 'bot', hand: [wuerfel.id], isBot: true })] });
    let gesehen = null;
    rollWithWindow(room, room.players[0], 'test', (roll) => { gesehen = roll; });
    assert.ok(gesehen !== null, 'Bots spielen keine Reaktionskarten - kein Fenster');
    assert.ok(!room.pendingRoll);
  }
  {
    // Eine getrennte Person haelt die Karte -> zaehlt ebenfalls nicht.
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const room = makeRoom({ players: [makePlayer({ id: 'p1' }), makePlayer({ id: 'weg', hand: [wuerfel.id], connected: false })] });
    let gesehen = null;
    rollWithWindow(room, room.players[0], 'test', (roll) => { gesehen = roll; });
    assert.ok(gesehen !== null, 'Getrennte oeffnen kein Fenster');
  }
  {
    // Eine verbundene, menschliche Person haelt die Karte -> Fenster offen.
    // Die KATZENINTERVENTION gilt fuer JEDEN Wurf ("nachdem irgendjemand
    // gewuerfelt hat"), also auch fuer den fremden von p1.
    const katze = findCard('KATZENINTERVENTION');
    const room = makeRoom({ players: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2', hand: [katze.id] })] });
    let gesehen = null;
    rollWithWindow(room, room.players[0], 'test', (roll) => { gesehen = roll; });
    assert.strictEqual(gesehen, null, 'mit Reaktionskarte darf noch nicht aufgeloest werden');
    assert.ok(room.pendingRoll, 'Fenster muss offen sein');
    assert.deepStrictEqual(reactionHolders(room, ROLL_REACTION_CARDS), ['p2']);
  }
  {
    // GEZINKTER WÜRFEL: "Spiel ihn, nachdem DU ... wuerfeln musstest" - auf
    // einen FREMDEN Wurf gibt es damit gar kein Fenster.
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const room = makeRoom({ players: [makePlayer({ id: 'p1' }), makePlayer({ id: 'p2', hand: [wuerfel.id] })] });
    let gesehen = null;
    rollWithWindow(room, room.players[0], 'test', (roll) => { gesehen = roll; });
    assert.ok(gesehen !== null, 'fremder Wurf: der gezinkte Wuerfel oeffnet kein Fenster');
    assert.ok(!room.pendingRoll);
  }
  {
    // Beim EIGENEN Wurf dagegen schon.
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const room = makeRoom({ players: [makePlayer({ id: 'p1', hand: [wuerfel.id] }), makePlayer({ id: 'p2' })] });
    let gesehen = null;
    rollWithWindow(room, room.players[0], 'test', (roll) => { gesehen = roll; });
    assert.strictEqual(gesehen, null, 'eigener Wurf: Fenster muss offen sein');
    assert.deepStrictEqual(room.pendingRoll.holders, ['p1']);
  }

  // -------------------------------------------------------------------
  // GEZINKTER WÜRFEL am echten Weglaufwurf (handleAttemptFlee)
  // -------------------------------------------------------------------
  {
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const room = fleeRoom(['LAHMER GOBLIN'], null, null);
    // Der Wuerfel liegt bei p1 - nur wer selbst wuerfelt, darf ihn spielen.
    room.players[0].hand = [wuerfel.id];
    handleAttemptFlee(room, 'p1', 0);
    assert.ok(room.pendingRoll, 'mit eigener Karte muss der Wurf erst im Fenster stehen');
    assert.strictEqual(room.combat.actorId, 'p1', 'der Kampf selbst bleibt bis zur Aufloesung unveraendert stehen');
    assert.strictEqual(room.dieRoll, null, 'die Wuerfelanimation darf vor der Aufloesung noch nicht gesetzt sein');

    // Fremde Spielerin darf nicht mitreden.
    handlePlayReactionCard(room, 'p2', wuerfel.id, 6);
    assert.ok(room.pendingRoll, 'nur die Halterin des Fensters darf reagieren');

    // p1 aendert den eigenen Wurf auf 6 -> total 6, damit garantiert Erfolg.
    const handVorher = room.players[0].hand.length;
    handlePlayReactionCard(room, 'p1', wuerfel.id, 6);
    assert.ok(!room.pendingRoll, 'nach dem Spielen loest sich das Fenster auf');
    assert.strictEqual(room.dieRoll.roll, 6, 'der geaenderte Wurf muss uebernommen werden');
    assert.strictEqual(room.dieRoll.success, true, 'Wurf 6 muss gegen den Lahmen Goblin gelingen');
    assert.strictEqual(room.players[0].hand.length, handVorher - 1, 'die Karte wird beim Spielen abgelegt');
    assert.ok(room.treasureDiscard.includes(wuerfel.id), 'und landet auf dem Schatz-Ablagestapel');
    done(room);
  }
  {
    // Alle Halter:innen passen -> der urspruengliche Wurf gilt unveraendert.
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const room = fleeRoom(['FILZLAUSE'], null, null); // FLEE_IMPOSSIBLE: Erfolg ist unmoeglich, Ergebnis bleibt trotzdem eindeutig pruefbar
    room.players[0].hand = [wuerfel.id];
    handleAttemptFlee(room, 'p1', 0);
    assert.ok(room.pendingRoll);
    const urspruenglich = room.pendingRoll.roll;
    handlePassReaction(room, 'p1');
    assert.ok(!room.pendingRoll, 'nachdem alle Halter:innen gepasst haben, loest sich das Fenster auf');
    assert.strictEqual(room.dieRoll.roll, urspruenglich, 'ohne Kartenspiel bleibt der urspruengliche Wurf stehen');
    assert.strictEqual(room.dieRoll.success, false, 'vor Filzlaeusen gibt es kein Entkommen, egal welcher Wurf');
    done(room);
  }

  // -------------------------------------------------------------------
  // Der Wuerfel gilt fuer JEDEN Wurf ("aus einem beliebigen Grund"), nicht
  // nur fuer den Weglaufwurf: Konsequenz-Wuerfe laufen ueber wurfMitFenster.
  // -------------------------------------------------------------------
  {
    // Ohne Karte am Tisch: synchron und sofort angewendet (bitgleich zu
    // frueher - das schuetzt alle bestehenden Wuerfelpfade).
    const p = makePlayer({ id: 'p1', level: 10 });
    const room = makeRoom({ players: [p, makePlayer({ id: 'p2', name: 'B' })] });
    const desc = applyPrimitiveAction(room, p, { type: 'diceLevelLoss' });
    assert.ok(/Würfelwurf \d/.test(desc), desc);
    assert.ok(p.level < 10 && p.level >= 4, 'Stufen sofort verloren');
    assert.ok(!room.pendingRoll);
    done(room);
  }
  {
    // Mit eigenem GEZINKTEN WÜRFEL: erst Fenster, dann wirkt der GEAENDERTE
    // Wurf.
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const p = makePlayer({ id: 'p1', level: 10, hand: [wuerfel.id] });
    const room = makeRoom({ players: [p, makePlayer({ id: 'p2', name: 'B' })] });
    const desc = applyPrimitiveAction(room, p, { type: 'diceLevelLoss' });
    assert.ok(room.pendingRoll, 'auf den Stufenverlust-Wurf darf reagiert werden');
    assert.strictEqual(p.level, 10, 'vor der Aufloesung passiert nichts');
    assert.ok(/reagiert/.test(desc), desc);
    handlePlayReactionCard(room, 'p1', wuerfel.id, 1);
    assert.strictEqual(p.level, 9, 'der geaenderte Wurf (1) kostet genau 1 Stufe');
    assert.ok(!room.pendingRoll);
    done(room);
  }
  {
    // Passen laesst den urspruenglichen Wurf gelten.
    const wuerfel = findCard('GEZINKTER WÜRFEL');
    const p = makePlayer({ id: 'p1', level: 10, hand: [wuerfel.id] });
    const room = makeRoom({ players: [p, makePlayer({ id: 'p2', name: 'B' })] });
    applyPrimitiveAction(room, p, { type: 'diceLevelLoss' });
    const wurf = room.pendingRoll.roll;
    handlePassReaction(room, 'p1');
    assert.strictEqual(p.level, 10 - wurf, 'ohne Kartenspiel gilt der urspruengliche Wurf');
    done(room);
  }

  // -------------------------------------------------------------------
  // KLEBERFLÄSCHCHEN an der gelungenen Flucht (TOPFPFLANZE: automatische
  // Flucht, damit der Erfolg nicht vom Zufallswurf abhaengt)
  // -------------------------------------------------------------------
  {
    const flasche = findCard('KLEBERFLÄSCHCHEN');
    const room = fleeRoom(['TOPFPFLANZE'], null, null);
    room.players[1].hand = [flasche.id];
    handleAttemptFlee(room, 'p1', 0);
    assert.strictEqual(room.dieRoll.success, true, 'Testvoraussetzung: automatische Flucht gelingt');
    assert.ok(room.combat, 'mit Reaktionskarte auf einer fremden Hand darf die Flucht noch nicht fertig sein');
    assert.ok(room.combat.escapeReactionOffer && room.combat.escapeReactionOffer.includes('p2'));

    // p2 spielt die Karte -> zwingt einen zweiten Wurf.
    handlePlayReactionCard(room, 'p2', flasche.id, undefined);
    assert.ok(!room.players[1].hand.includes(flasche.id), 'die Karte wird beim Spielen abgelegt');
    assert.ok(room.treasureDiscard.includes(flasche.id));
    // TOPFPFLANZE ist weiterhin automatisch erfolgreich, aber escapeReactionDone
    // verhindert eine zweite Nachfrage - der Kampf muss jetzt fertig sein.
    assert.strictEqual(room.combat, null, 'nach dem erzwungenen (wieder erfolgreichen) Neuwurf ist der Kampf vorbei');
    done(room);
  }
  {
    // p2 passt -> die Flucht wird ganz normal abgeschlossen.
    const flasche = findCard('KLEBERFLÄSCHCHEN');
    const room = fleeRoom(['TOPFPFLANZE'], null, null);
    room.players[1].hand = [flasche.id];
    handleAttemptFlee(room, 'p1', 0);
    assert.ok(room.combat && room.combat.escapeReactionOffer);
    handlePassReaction(room, 'p2');
    assert.strictEqual(room.combat, null, 'nach dem Passen ist die Flucht abgeschlossen');
    assert.ok(room.players[1].hand.includes(flasche.id), 'wer passt, behaelt die Karte');
    done(room);
  }
  {
    // Ohne Halter:in kein Angebot - bitgleich zum bisherigen Verhalten.
    const room = fleeRoom(['TOPFPFLANZE'], null, null);
    handleAttemptFlee(room, 'p1', 0);
    assert.strictEqual(room.combat, null, 'ohne Kleberflaeschchen im Spiel schliesst die gelungene Flucht sofort ab');
    done(room);
  }

  // -------------------------------------------------------------------
  // MAGISCHE LAMPE - im Kampf auf der eigenen Seite, bei der Flucht
  // oder am Fluchtentscheidungsfenster einsetzbar ("selbst wenn dein
  // Weglaufenwurf verpatzt wurde").
  // -------------------------------------------------------------------
  {
    // Normaler Kampf (vor der Flucht): einziges Monster verschwindet,
    // Schatz ja, Stufe nein.
    const lampe = findCard('MAGISCHE LAMPE');
    const goblin = findCard('LAHMER GOBLIN', 'monster');
    const room = fleeRoom(['LAHMER GOBLIN'], { hand: [lampe.id], level: 5 }, { mustFlee: false });
    const handVorher = room.players[0].hand.length;
    const levelVorher = room.players[0].level;
    handleUseLamp(room, 'p1', lampe.id, goblin.id);
    assert.strictEqual(room.combat, null, 'im normalen Kampf verschwindet das Monster -> Kampf vorbei');
    assert.strictEqual(room.players[0].level, levelVorher, 'keine Stufe fuer die Lampe');
    assert.strictEqual(room.players[0].hand.length, handVorher - 1 + goblin.treasureCount,
      'Lampe abgelegt, Schatz des Monsters auf der Hand');
    assert.ok(room.doorDiscard.includes(goblin.id), 'Monster landet im Tuerablagestapel');
    done(room);
  }
  {
    // Normaler Kampf: direkt als Kampfkarte via handlePlayCombatCard gespielt.
    const lampe = findCard('MAGISCHE LAMPE');
    const goblin = findCard('LAHMER GOBLIN', 'monster');
    const room = fleeRoom(['LAHMER GOBLIN'], { hand: [lampe.id], level: 5 }, { mustFlee: false });
    handlePlayCombatCard(room, 'p1', lampe.id);
    assert.strictEqual(room.combat, null, 'via handlePlayCombatCard gespielt -> Kampf vorbei');
    done(room);
  }
  {
    // Fluchtphase (nach verpatztem Wurf): einziges Monster verschwindet,
    // Schatz ja, Stufe nein.
    const lampe = findCard('MAGISCHE LAMPE');
    const goblin = findCard('LAHMER GOBLIN', 'monster');
    const room = fleeRoom(['LAHMER GOBLIN'], { hand: [lampe.id], level: 5 }, { fleeRerollOffer: true });
    const handVorher = room.players[0].hand.length;
    const levelVorher = room.players[0].level;
    handleUseLamp(room, 'p1', lampe.id, goblin.id);
    assert.strictEqual(room.combat, null, 'einziges Monster verschwunden -> Kampf vorbei');
    assert.strictEqual(room.players[0].level, levelVorher, 'keine Stufe fuer die Lampe');
    assert.strictEqual(room.players[0].hand.length, handVorher - 1 + goblin.treasureCount,
      'Lampe abgelegt, aber der Schatz des einzigen Monsters kommt noch auf die Hand');
    assert.ok(room.doorDiscard.includes(goblin.id), 'das verschwundene Monster landet im Tuerablagestapel');
    done(room);
  }
  {
    // Zwei Monster: das gewaehlte verschwindet ohne Schatz, der Kampf geht
    // gegen das verbleibende weiter.
    const lampe = findCard('MAGISCHE LAMPE');
    const goblin = findCard('LAHMER GOBLIN', 'monster');
    const orks = findCard('3.872 ORKS', 'monster');
    const room = fleeRoom(['LAHMER GOBLIN', '3.872 ORKS'], { hand: [lampe.id], level: 5 }, { fleeRerollOffer: true });
    const handVorher = room.players[0].hand.length;
    const levelVorher = room.players[0].level;
    handleUseLamp(room, 'p1', lampe.id, goblin.id);
    assert.ok(room.combat, 'bei mehreren Monstern geht der Kampf weiter');
    assert.deepStrictEqual(room.combat.monsterIds, [orks.id], 'nur das gewaehlte Monster verschwindet');
    assert.strictEqual(room.combat.fleeRerollOffer, false, 'das Entscheidungsfenster ist beantwortet');
    assert.strictEqual(room.players[0].level, levelVorher, 'kein Level-Effekt bei laufendem Kampf');
    assert.strictEqual(room.players[0].hand.length, handVorher - 1, 'nur die Lampe verschwindet von der Hand, kein Schatz');
    assert.ok(room.doorDiscard.includes(goblin.id));
    done(room);
  }
  {
    // Fremdeingaben duerfen nichts tun: falscher Akteur (nur die kaempfende Person),
    // fremder Zug, kein Kampf.
    const lampe = findCard('MAGISCHE LAMPE');
    const goblin = findCard('LAHMER GOBLIN', 'monster');
    const raumFremd = fleeRoom(['LAHMER GOBLIN'], { hand: [lampe.id] }, { fleeRerollOffer: true });
    handleUseLamp(raumFremd, 'p2', lampe.id, goblin.id);
    assert.ok(raumFremd.combat, 'nur die kaempfende Person darf die Lampe spielen');
    done(raumFremd);

    const raumKeinKampf = makeRoom({ players: [makePlayer({ id: 'p1', hand: [lampe.id] })] });
    handleUseLamp(raumKeinKampf, 'p1', lampe.id, goblin.id);
    assert.strictEqual(raumKeinKampf.combat, null, 'ohne Kampf keine Wirkung');
    done(raumKeinKampf);
  }

  // Der Bot im Fluchtentscheidungsfenster. Regression aus dem Abnahme-
  // Durchlauf (Task 13): das Fenster geht auch ohne Halbling auf, sobald der
  // Bot eine Rettungskarte oder die Magische Lampe haelt. Der Bot gab dann
  // trotzdem seine erste Handkarte mit, handleFleeReroll lehnte das ab, ohne
  // das Fenster zu schliessen - und die ganze Partie drehte sich endlos im
  // Kreis (ca. jeder zehnte Durchlauf).
  {
    const lampe = findCard('MAGISCHE LAMPE');
    const room = fleeRoom(['LAHMER GOBLIN'], { hand: [lampe.id], isBot: true },
      { fleeRerollOffer: true, canReroll: false });
    const actor = room.players[0];
    assert.strictEqual(botFleeRerollCard(room, actor), null,
      'ohne Halbling-Wiederholung gibt der Bot keine Karte mit');
    handleFleeReroll(room, actor.id, botFleeRerollCard(room, actor));
    assert.strictEqual(room.combat, null, 'das Fenster ist beantwortet, der Kampf vorbei');
    done(room);
  }
  {
    // Halbling: derselbe Weg, aber MIT Karte - der Wiederholungswurf ist ihm
    // erlaubt, und die Karte ist sein Preis dafuer.
    const halbling = findCard('HALBLING', 'race');
    const lampe = findCard('MAGISCHE LAMPE');
    const room = fleeRoom(['LAHMER GOBLIN'], { hand: [lampe.id], races: [halbling.id], isBot: true },
      { fleeRerollOffer: true, canReroll: true });
    const actor = room.players[0];
    assert.strictEqual(botFleeRerollCard(room, actor), lampe.id, 'als Halbling legt der Bot eine Karte ab');
    handleFleeReroll(room, actor.id, botFleeRerollCard(room, actor));
    assert.ok(!actor.hand.includes(lampe.id), 'die Karte ist der Preis fuer den zweiten Wurf');
    assert.ok(!room.combat || room.combat.fleeRerollOffer !== true,
      'auch hier bleibt das Fenster nicht offen stehen');
    done(room);
  }

  // Solange das Kleberflaeschchen-Fenster offen ist, darf niemand noch einmal
  // weglaufen. Zweite Regression aus dem Abnahme-Durchlauf (Task 13): der Bot
  // wuerfelte im Sekundentakt weiter, jeder gelungene Wurf oeffnete dasselbe
  // Fenster erneut, und die Partie kam nie an der Antwort vorbei.
  {
    const room = fleeRoom(['LAHMER GOBLIN'], { isBot: true },
      { mustFlee: true, escapeReactionOffer: ['p2'] });
    const logsVorher = room.logs.length;
    handleAttemptFlee(room, 'p1', 0);
    assert.strictEqual(room.logs.length, logsVorher, 'kein neuer Wurf, solange das Fenster offen ist');
    assert.deepStrictEqual(room.combat.escapeReactionOffer, ['p2'], 'das Fenster bleibt unveraendert stehen');
    done(room);
  }

  console.log('OK - Reaktionsfenster: synchron ohne Karte, Fenster mit Karte, Bots/Getrennte aus, ' +
    'Gezinkter Wuerfel/Kleberflaeschchen am echten Fluchtpfad, Magische Lampe am Fluchtfenster.');
}

run();
console.log('1/1 Tests erfolgreich (card-reactions.test.js).');
