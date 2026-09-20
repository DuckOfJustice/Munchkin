// Schlimme Dinge mit Fremdbeteiligung (Task 9): HIPPOGREIF, ANWALT,
// LEPRACHAUN, NETZ-TROLL, VERSICHERUNGSVERTRETER, SCHNECKEN AUF SPEED und
// FLUCH! EINKOMMENSSTEUER laufen jetzt automatisch ueber die
// Aktions-Warteschlange (Task 3) statt komplett manuell zu bleiben. Zusaetzlich
// die VERLIERE-1-GROSSEN-GEGENSTAND-Korrektur fuer Zwerge mit mehreren
// Grossen Gegenstaenden (Task 2, nachgetragen).
const assert = require('assert');
const {
  resolveConsequenceSpec, newEquipped, playerQueueFrom, applyPrimitiveAction,
  handleResolveCardCardChoice, resolveBotCardAction, equippedItemIds, ALL_CARDS,
  CARDS_BY_ID, isBigItem, autoApplyLossConsequence,
} = require('../server.js');

function card(id) { return CARDS_BY_ID.get(id) || null; }
function idByName(name) {
  const c = ALL_CARDS.find((x) => x.name === name);
  if (!c) throw new Error(`Testkarte nicht gefunden: ${name}`);
  return c.id;
}

function makePlayer(id, extra) {
  return Object.assign({
    id, name: id.toUpperCase(), level: 5, hand: [], races: [], classes: [],
    powerGroups: [], raceCapCard: null, classCapCard: null, powerGroupCapCard: null,
    equipped: newEquipped(), attachments: { cheatedItemId: null }, activeCurses: [],
    isBot: false, connected: true,
  }, extra || {});
}

function makeRoom(players, turnIndex) {
  return {
    code: 'T', players, turnIndex: turnIndex || 0, doorDiscard: [],
    treasureDiscard: [], logs: [], combat: null, pendingCardAction: null,
    lastActivity: Date.now(), cleanupTimer: null, botTimer: null,
  };
}

function done(room) {
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  if (room.botTimer) clearTimeout(room.botTimer);
}

const ZWERG = idByName('ZWERG');
const KETTENSAEGE = idByName('KETTENSÄGE DER BLUTIGEN ZERSTÜCKELUNG'); // Grosser Gegenstand, hand, 600 GS
const MITHRIL = idByName('MITHRIL-RÜSTUNG'); // Grosser Gegenstand, armor, 600 GS
const TUCH = idByName('COOLES TUCH FÜR HARTE KERLE'); // kein Grosser Gegenstand, head, 400 GS
const STIEFEL = idByName('ARSCHTRITT-STIEFEL'); // kein Grosser Gegenstand, feet, 400 GS
const CARD_A = idByName('PLUTONIUMDRACHE');
const CARD_B = idByName('MR. BONES');
const CARD_C = idByName('KLASSE WECHSELN');

// 1) Reihenfolgen/Modi stimmen mit dem jeweiligen Kartentext ueberein
{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const room = makeRoom(ps, 0);

  const hippogreif = resolveConsequenceSpec('HIPPOGREIF', 'x', ps[0], room);
  assert.strictEqual(hippogreif.type, 'queuedTakeFromHand');
  assert.strictEqual(hippogreif.mode, 'before', 'HIPPOGREIF: "beginnend mit dem Spieler VOR dir"');
  assert.ok(!hippogreif.discardRest);

  const anwalt = resolveConsequenceSpec('ANWALT', 'x', ps[0], room);
  assert.strictEqual(anwalt.type, 'queuedTakeFromHand');
  assert.strictEqual(anwalt.mode, 'after', 'ANWALT: "beginnend mit dem Spieler NACH dir"');
  assert.strictEqual(anwalt.discardRest, true, 'ANWALT: "Lege alle uebrigen Karten ab."');

  const leprachaun = resolveConsequenceSpec('LEPRACHAUN', 'x', ps[0], room);
  assert.strictEqual(leprachaun.type, 'queuedTakeItem');
  assert.strictEqual(leprachaun.mode, 'neighbours', 'LEPRACHAUN: "die Spieler vor und nach dir"');

  const netztroll = resolveConsequenceSpec('NETZ-TROLL', 'x', ps[0], room);
  assert.strictEqual(netztroll.type, 'queuedTakeItem');
  assert.strictEqual(netztroll.mode, 'topLevel', 'NETZ-TROLL: "der (die) Spieler mit der hoechsten Stufe"');

  const versicherung = resolveConsequenceSpec('VERSICHERUNGSVERTRETER', 'x', ps[0], room);
  assert.deepStrictEqual(versicherung, { type: 'discardItemsWorthGold', gold: 1000 });

  const einkommenssteuer = resolveConsequenceSpec('FLUCH! EINKOMMENSSTEUER', 'x', ps[0], room);
  assert.strictEqual(einkommenssteuer.type, 'curseIncomeTax');
  assert.strictEqual(einkommenssteuer.mode, 'allOthers', 'EINKOMMENSSTEUER: "jeder andere Spieler"');

  done(room);
}

// 2) HIPPOGREIF (mode 'before') Ende-zu-Ende: Warteschlange nimmt Handkarten,
// bricht ab, sobald die Hand leer ist (kein discardRest).
{
  const ps = ['a', 'b', 'c', 'd'].map((x) => makePlayer(x));
  const opfer = ps[1]; // b
  opfer.hand = [CARD_A, CARD_B];
  const room = makeRoom(ps, 0);

  assert.deepStrictEqual(playerQueueFrom(room, opfer, 'before'), ['a', 'd', 'c']);
  const desc = applyPrimitiveAction(room, opfer, { type: 'queuedTakeFromHand', mode: 'before' });
  assert.ok(/3 Mitspieler/.test(desc));

  assert.strictEqual(room.pendingCardAction.playerId, 'a', 'erste Person in der before-Reihenfolge');
  assert.strictEqual(room.pendingCardAction.kind, 'chooseCard');
  assert.deepStrictEqual(room.pendingCardAction.candidateIds.slice().sort(), [CARD_A, CARD_B].slice().sort());
  handleResolveCardCardChoice(room, 'a', CARD_A);
  assert.ok(ps[0].hand.includes(CARD_A), 'A hat die Karte von B erhalten');
  assert.ok(!opfer.hand.includes(CARD_A));

  assert.strictEqual(room.pendingCardAction.playerId, 'd', 'dann D (naechster in before-Reihenfolge)');
  handleResolveCardCardChoice(room, 'd', CARD_B);
  assert.ok(ps[3].hand.includes(CARD_B), 'D hat die letzte Karte von B erhalten');

  // C waere als Naechstes dran, aber B hat keine Karten mehr -> ueberspringen,
  // Warteschlange raeumt sich selbst ab.
  assert.strictEqual(room.pendingCardAction, null, 'nach leerer Opfer-Hand direkt abgeraeumt');
  assert.strictEqual(opfer.hand.length, 0);

  done(room);
}

// 3) ANWALT (mode 'after', discardRest): uebrige Handkarten gehen nach Ende
// der Warteschlange automatisch auf den Ablagestapel.
{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const opfer = ps[0]; // a
  opfer.hand = [CARD_A, CARD_B, CARD_C];
  const room = makeRoom(ps, 0);

  assert.deepStrictEqual(playerQueueFrom(room, opfer, 'after'), ['b', 'c']);
  applyPrimitiveAction(room, opfer, { type: 'queuedTakeFromHand', mode: 'after', discardRest: true });

  assert.strictEqual(room.pendingCardAction.playerId, 'b');
  handleResolveCardCardChoice(room, 'b', CARD_A);
  assert.strictEqual(room.pendingCardAction.playerId, 'c');
  handleResolveCardCardChoice(room, 'c', CARD_B);

  // Warteschlange ist durch (nur 2 Personen), 1 Karte blieb uebrig -> muss
  // jetzt automatisch abgelegt sein.
  assert.strictEqual(room.pendingCardAction, null);
  assert.strictEqual(opfer.hand.length, 0, 'ANWALT: "Lege alle uebrigen Karten ab."');
  assert.ok(room.doorDiscard.includes(CARD_C), 'die dritte, nicht genommene Karte landet im Ablagestapel');

  done(room);
}

// 4) LEPRACHAUN (mode 'neighbours'): nur die beiden Sitz-Nachbarn nehmen je
// einen Gegenstand.
{
  const ps = ['a', 'b', 'c', 'd'].map((x) => makePlayer(x));
  const opfer = ps[1]; // b, Nachbarn a und c
  opfer.equipped.head = TUCH;
  opfer.equipped.feet = STIEFEL;
  const room = makeRoom(ps, 0);

  assert.deepStrictEqual(playerQueueFrom(room, opfer, 'neighbours'), ['a', 'c']);
  applyPrimitiveAction(room, opfer, { type: 'queuedTakeItem', mode: 'neighbours' });

  assert.strictEqual(room.pendingCardAction.playerId, 'a');
  assert.deepStrictEqual(room.pendingCardAction.candidateIds.slice().sort(), [TUCH, STIEFEL].slice().sort());
  handleResolveCardCardChoice(room, 'a', TUCH);
  assert.ok(ps[0].hand.includes(TUCH));
  assert.strictEqual(opfer.equipped.head, null);

  assert.strictEqual(room.pendingCardAction.playerId, 'c');
  handleResolveCardCardChoice(room, 'c', STIEFEL);
  assert.ok(ps[2].hand.includes(STIEFEL));
  assert.strictEqual(opfer.equipped.feet, null);

  assert.strictEqual(room.pendingCardAction, null);
  assert.strictEqual(ps[3].hand.length, 0, 'D ist kein Nachbar und bekommt nichts');

  done(room);
}

// 5) NETZ-TROLL (mode 'topLevel'): nur die hoechststufigen Spieler, egal wo
// sie sitzen - bei Gleichstand alle davon.
{
  const ps = [makePlayer('a', { level: 9 }), makePlayer('b', { level: 3 }), makePlayer('c', { level: 9 })];
  const opfer = ps[1]; // b, Stufe 3 (nicht selbst betroffen)
  opfer.equipped.head = TUCH;
  const room = makeRoom(ps, 0);

  assert.deepStrictEqual(playerQueueFrom(room, opfer, 'topLevel').slice().sort(), ['a', 'c']);
  applyPrimitiveAction(room, opfer, { type: 'queuedTakeItem', mode: 'topLevel' });

  // Nur EIN Gegenstand vorhanden - wer zuerst dran ist, nimmt ihn, der/die
  // andere hoechststufige Person geht leer aus (kein zweiter Gegenstand mehr).
  const erste = room.pendingCardAction.playerId;
  assert.ok(['a', 'c'].includes(erste));
  handleResolveCardCardChoice(room, erste, TUCH);
  assert.strictEqual(room.pendingCardAction, null, 'B hatte nur 1 Gegenstand, die zweite Person wird uebersprungen');
  assert.strictEqual(opfer.equipped.head, null);

  done(room);
}

// 6) VERSICHERUNGSVERTRETER: direkter Goldwert-Verlust, keine Warteschlange.
{
  const ps = ['a', 'b'].map((x) => makePlayer(x));
  const player = ps[0];
  player.equipped.armor = MITHRIL; // 600 GS
  player.equipped.hands[0] = KETTENSAEGE; // 600 GS
  const room = makeRoom(ps, 0);

  const desc = applyPrimitiveAction(room, player, { type: 'discardItemsWorthGold', gold: 1000 });
  assert.ok(/1200 GS/.test(desc));
  assert.strictEqual(player.equipped.armor, null);
  assert.strictEqual(player.equipped.hands[0], null);
  assert.ok(room.treasureDiscard.includes(MITHRIL));
  assert.ok(room.treasureDiscard.includes(KETTENSAEGE));

  // Nicht genug getragen -> alles geht weg (kein Rest-Verbleib).
  const ps2 = ['a', 'b'].map((x) => makePlayer(x));
  const arm = ps2[0];
  arm.equipped.head = TUCH; // nur 400 GS, Schranke waere 1000
  const room2 = makeRoom(ps2, 0);
  applyPrimitiveAction(room2, arm, { type: 'discardItemsWorthGold', gold: 1000 });
  assert.strictEqual(arm.equipped.head, null, 'hat nicht genug - verliert alles, was er hat');

  done(room);
  done(room2);
}

// 7) SCHNECKEN AUF SPEED: Wuerfelwurf bestimmt die Anzahl der Runden, jede
// Runde waehlt die betroffene Person selbst aus ihren eigenen Karten/
// Gegenstaenden (discardOwn).
{
  const ps = ['a', 'b'].map((x) => makePlayer(x));
  const player = ps[0];
  player.equipped.head = TUCH;
  player.hand = [CARD_A];
  const room = makeRoom(ps, 0);

  const origRandom = Math.random;
  Math.random = () => 0; // rollDie() -> 1
  let desc;
  try {
    desc = applyPrimitiveAction(room, player, { type: 'diceItemOrHandLoss' });
  } finally {
    Math.random = origRandom;
  }
  assert.ok(/Wuerfelwurf 1/.test(desc));
  assert.strictEqual(room.pendingCardAction.playerId, 'a', 'die eigene Person waehlt selbst');
  assert.strictEqual(room.pendingCardAction.kind, 'chooseCard');
  assert.deepStrictEqual(room.pendingCardAction.candidateIds.slice().sort(), [TUCH, CARD_A].slice().sort());

  handleResolveCardCardChoice(room, 'a', TUCH);
  assert.strictEqual(player.equipped.head, null);
  assert.ok(room.treasureDiscard.includes(TUCH), 'discardOwn legt direkt ab statt es jemandem zu geben');
  assert.strictEqual(room.pendingCardAction, null, 'Wurf war 1 - nach einer Runde fertig');
  assert.ok(player.hand.includes(CARD_A), 'die Handkarte blieb unberuehrt (nicht gewaehlt)');

  done(room);
}

// 8) FLUCH! EINKOMMENSSTEUER: die ziehende Person legt ihren wertvollsten
// Gegenstand ab, jede andere Person muss mindestens denselben Goldwert
// ablegen - reicht es nicht, geht alles weg plus 1 Stufe.
{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const zieher = ps[0]; // a
  zieher.equipped.head = TUCH; // 400 GS - einziger Gegenstand, also automatisch "gewaehlt"
  const matcher = ps[1]; // b: hat genau 400 GS zum Ausgleich
  matcher.equipped.feet = STIEFEL; // 400 GS
  const knapp = ps[2]; // c: hat gar nichts von Wert
  const room = makeRoom(ps, 0);

  const desc1 = applyPrimitiveAction(room, zieher, { type: 'curseIncomeTax', mode: 'allOthers' });
  assert.strictEqual(room.pendingCardAction.kind, 'choice');
  const action = room._pendingCardActionResolvers[room.pendingCardAction.options[0].id];
  const desc = applyPrimitiveAction(room, zieher, action);
  assert.strictEqual(zieher.equipped.head, null, 'die ziehende Person legt ihren Gegenstand ab');
  assert.ok(room.treasureDiscard.includes(TUCH));

  assert.strictEqual(matcher.equipped.feet, null, 'B kann genau ausgleichen');
  assert.ok(room.treasureDiscard.includes(STIEFEL));
  assert.strictEqual(matcher.level, 5, 'B hatte genug - keine Stufe verloren');

  assert.strictEqual(knapp.level, 4, 'C hatte nichts zum Ausgleich - verliert 1 Stufe');
  assert.ok(/alles abgelegt \+ 1 Stufe verloren/.test(desc));

  done(room);
}

// 9) VERLIERE 1 GROSSEN GEGENSTAND: bei hoechstens einem Grossen Gegenstand
// unveraendert discardBigItem, bei einem Zwerg mit mehreren eine echte Wahl.
{
  const ps = ['a', 'b'].map((x) => makePlayer(x));
  const zwerg = ps[0];
  zwerg.races = [ZWERG];
  zwerg.equipped.armor = MITHRIL;
  zwerg.equipped.hands[0] = KETTENSAEGE;
  const room = makeRoom(ps, 0);

  const spec = resolveConsequenceSpec('VERLIERE 1 GROSSEN GEGENSTAND', 'x', zwerg, room);
  assert.strictEqual(spec.type, 'choice');
  assert.strictEqual(spec.options.length, 2, 'zwei Grosse Gegenstaende -> zwei Optionen');

  const gewaehlt = spec.options[0];
  applyPrimitiveAction(room, zwerg, gewaehlt.action);
  const uebrigeGrossen = equippedItemIds(zwerg).filter((id) => isBigItem(card(id)));
  assert.strictEqual(uebrigeGrossen.length, 1, 'nur der gewaehlte Gegenstand ist weg, der andere bleibt');

  const einfach = makePlayer('x');
  einfach.equipped.armor = MITHRIL;
  const specEinfach = resolveConsequenceSpec('VERLIERE 1 GROSSEN GEGENSTAND', 'x', einfach, room);
  assert.deepStrictEqual(specEinfach, { type: 'discardBigItem' }, 'nur 1 Grosser Gegenstand -> keine echte Wahl noetig');

  done(room);
}

// 10) Bots loesen eine an sie gerichtete Fremdbeteiligungs-Wahl generisch
// ueber resolveBotCardAction auf (bereits existierender Mechanismus, hier
// nur als Regressionscheck fuer die neuen takeFrom/discardOwn-Felder).
{
  const ps = [makePlayer('a'), makePlayer('bot', { isBot: true })];
  const opfer = ps[0];
  opfer.hand = [CARD_A];
  const room = makeRoom(ps, 0);
  applyPrimitiveAction(room, opfer, { type: 'queuedTakeFromHand', mode: 'after' });
  assert.strictEqual(room.pendingCardAction.playerId, 'bot');
  resolveBotCardAction(room);
  assert.ok(ps[1].hand.includes(CARD_A), 'Bot hat sich die Karte generisch genommen');
  assert.strictEqual(room.pendingCardAction, null);

  done(room);
}

// 11) REGRESSIONSTEST (Fix Round 1): eine verlorene Kampfrunde mit ZWEI
// Schlimme-Dinge-Monstern, die beide eine Warteschlange oeffnen (HIPPOGREIF +
// ANWALT - realistisch z.B. durch WANDERNDES MONSTER, Task 8, oder zwei
// aufgedeckte Monster in einem Kampf). autoApplyLossConsequence ruft
// applyPrimitiveAction synchron fuer BEIDE Quellen auf, bevor irgendwer
// antworten konnte - ohne Backlog wuerde ANWALTs openQueuedCardAction-Aufruf
// HIPPOGREIFs bereits laufende Warteschlange klammheimlich ueberschreiben
// (samt dessen pendingCardAction), und ANWALTs discardRest wuerde als loses
// Raum-Feld am Ende von HIPPOGREIFs (nicht ANWALTs) Warteschlange feuern.
{
  const ps = ['a', 'b', 'c'].map((x) => makePlayer(x));
  const opfer = ps[0]; // a
  opfer.hand = [CARD_A, CARD_B, CARD_C];
  const room = makeRoom(ps, 0);
  room.pendingConsequence = {
    playerId: opfer.id, kind: 'loss', cardId: null, text: '', autoApplied: null, choice: null,
  };

  assert.deepStrictEqual(playerQueueFrom(room, opfer, 'before'), ['c', 'b'], 'HIPPOGREIF-Reihenfolge');
  assert.deepStrictEqual(playerQueueFrom(room, opfer, 'after'), ['b', 'c'], 'ANWALT-Reihenfolge');

  autoApplyLossConsequence(room, opfer, [
    { name: 'HIPPOGREIF', text: 'x' },
    { name: 'ANWALT', text: 'x' },
  ]);

  // Ohne den Fix waere hier 'b' (ANWALTs erste Person) dran, weil ANWALT
  // HIPPOGREIFs Warteschlange synchron ueberschrieben haette.
  assert.strictEqual(room.pendingCardAction.playerId, 'c', 'HIPPOGREIFs Warteschlange laeuft zuerst durch, unangetastet von ANWALT');
  assert.ok(/HIPPOGREIF/.test(room.pendingConsequence.autoApplied) && /ANWALT/.test(room.pendingConsequence.autoApplied),
    'beide Monster wurden tatsaechlich aufgeloest, keins wurde stillschweigend verschluckt');

  handleResolveCardCardChoice(room, 'c', CARD_A);
  assert.ok(ps[2].hand.includes(CARD_A), 'C (HIPPOGREIF, vor-Reihenfolge) hat seine Karte erhalten');
  assert.strictEqual(room.pendingCardAction.playerId, 'b', 'HIPPOGREIFs zweite Person');
  handleResolveCardCardChoice(room, 'b', CARD_B);
  assert.ok(ps[1].hand.includes(CARD_B), 'B (HIPPOGREIF) hat seine Karte erhalten');

  // HIPPOGREIFs Warteschlange ist jetzt durch (kein discardRest bei ihr) -
  // ANWALTs eigene Warteschlange startet jetzt erst, mit ihrer EIGENEN
  // Reihenfolge (b, c) und ihrem EIGENEN discardRest, nicht vermischt mit
  // HIPPOGREIFs bereits erledigter Runde.
  assert.strictEqual(room.pendingCardAction.playerId, 'b', 'ANWALTs Warteschlange startet erst danach, wieder bei B');
  assert.deepStrictEqual(room.pendingCardAction.candidateIds, [CARD_C], 'nur noch 1 Karte in Opfers Hand uebrig');
  handleResolveCardCardChoice(room, 'b', CARD_C);
  assert.ok(ps[1].hand.includes(CARD_C), 'B hat jetzt 2 Karten von A (je eine aus jeder Warteschlange)');

  // C waere ANWALTs zweite Person, aber Opfers Hand ist jetzt leer ->
  // ueberspringen, Warteschlange raeumt sich ab. discardRest greift ins
  // Leere (nichts mehr da), OHNE HIPPOGREIFs laengst abgeschlossene Runde
  // erneut zu beruehren.
  assert.strictEqual(room.pendingCardAction, null, 'beide Warteschlangen sauber nacheinander abgearbeitet');
  assert.strictEqual(opfer.hand.length, 0);

  done(room);
}

// 11) VERLIERE 1 KLEINEN GEGENSTAND: das Gegenstueck zu 9). "Klein" ist seit
// den Grossen Gegenstaenden (Task 2) definierbar - vorher musste die Karte
// manuell bleiben. Bei genau einem kleinen Gegenstand keine Wahl noetig, bei
// mehreren eine echte Wahl, ohne kleinen Gegenstand passiert nichts (die
// Karte nennt keinen Ersatz-Malus).
{
  const ps = [makePlayer('a')];
  const p1 = ps[0];
  const room = makeRoom(ps, 0);

  p1.equipped.armor = MITHRIL; // nur ein GROSSER Gegenstand
  assert.deepStrictEqual(resolveConsequenceSpec('VERLIERE 1 KLEINEN GEGENSTAND', 'x', p1, room),
    { type: 'noEffect' }, 'ohne kleinen Gegenstand passiert nichts');

  p1.equipped.head = TUCH;
  assert.deepStrictEqual(resolveConsequenceSpec('VERLIERE 1 KLEINEN GEGENSTAND', 'x', p1, room),
    { type: 'discardSpecificItem', itemId: TUCH }, 'genau ein kleiner Gegenstand -> keine Wahl noetig');

  p1.equipped.feet = STIEFEL;
  const spec = resolveConsequenceSpec('VERLIERE 1 KLEINEN GEGENSTAND', 'x', p1, room);
  assert.strictEqual(spec.type, 'choice');
  assert.deepStrictEqual(spec.options.map((o) => o.action.itemId).sort(), [TUCH, STIEFEL].sort(),
    'zur Wahl stehen genau die kleinen Gegenstaende, nicht die Mithril-Ruestung');

  applyPrimitiveAction(room, p1, spec.options[0].action);
  assert.ok(room.treasureDiscard.includes(spec.options[0].action.itemId), 'der gewaehlte liegt im Ablagestapel');
  assert.ok(equippedItemIds(p1).includes(MITHRIL), 'der Grosse Gegenstand bleibt');
  assert.strictEqual(equippedItemIds(p1).filter((id) => !isBigItem(card(id))).length, 1,
    'nur EIN kleiner Gegenstand ist weg');

  done(room);
}

// KLASSE WECHSELN / RASSE WECHSELN: "Durchsuche den Ablegestapel, beginnend
// mit der obersten Karte. Die erste Klassenkarte ersetzt deine momentane(n)
// Klasse(n)." Frueher wurde die eigene Karte ZUERST abgelegt - sie lag damit
// obenauf und man wechselte direkt wieder zu sich selbst.
{
  const krieger = idByName('KRIEGER');
  const zauberer = idByName('ZAUBERER');
  const p = makePlayer('a', { classes: [krieger] });
  const room = makeRoom([p], 0);
  room.doorDiscard = [zauberer];

  const desc = applyPrimitiveAction(room, p, resolveConsequenceSpec('KLASSE WECHSELN', 'x', p, room));
  assert.deepStrictEqual(p.classes, [zauberer], `die Klasse aus dem Ablagestapel ersetzt die eigene (${desc})`);
  assert.ok(room.doorDiscard.includes(krieger), 'die alte Klasse liegt jetzt im Ablagestapel');
  assert.ok(!room.doorDiscard.includes(zauberer), 'und die genommene nicht mehr');
  done(room);
}
{
  // Keine passende Karte im Stapel: "Findest du keine Klassenkarte, verlierst
  // du einfach nur deine Klasse(n)."
  const krieger = idByName('KRIEGER');
  const p = makePlayer('a', { classes: [krieger] });
  const room = makeRoom([p], 0);
  applyPrimitiveAction(room, p, resolveConsequenceSpec('KLASSE WECHSELN', 'x', p, room));
  assert.deepStrictEqual(p.classes, [], 'ohne Ersatz ist die Klasse einfach weg');
  assert.ok(room.doorDiscard.includes(krieger));
  done(room);
}
{
  // Dasselbe fuer die Rasse - selbe Aktion, anderes Feld.
  const elf = idByName('ELF');
  const zwerg = idByName('ZWERG');
  const p = makePlayer('a', { races: [elf] });
  const room = makeRoom([p], 0);
  room.doorDiscard = [zwerg];
  applyPrimitiveAction(room, p, resolveConsequenceSpec('RASSE WECHSELN', 'x', p, room));
  assert.deepStrictEqual(p.races, [zwerg], 'die Rasse aus dem Ablagestapel ersetzt die eigene');
  done(room);
}

// MECHA-DIRE-WOLF (aus den Promos ins Basis-Set uebernommen): "Beisst die
// Hand, die ihn fuettert. Lege drei Karten aus deiner Hand ab." Der generische
// Parser erkennt den Satz nicht - ohne Override bliebe ein verlorener Kampf
// gegen den Wolf folgenlos.
{
  const wolf = ALL_CARDS.find((c) => c.name === 'MECHA-DIRE-WOLF');
  assert.ok(wolf, 'MECHA-DIRE-WOLF muss es geben');
  assert.strictEqual(wolf.set, 'base', 'er gehoert jetzt zum Basis-Set');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 5).map((c) => c.id);
  const p = makePlayer('a', { hand: fueller.slice(0, 5) });
  const room = makeRoom([p, makePlayer('b')]);
  const spec = resolveConsequenceSpec(wolf.name, wolf.badstuff, p, room);
  assert.ok(spec, 'die Schlimmen Dinge brauchen eine Automatik');
  applyPrimitiveAction(room, p, spec);
  // Drei Einzelwahlen nacheinander - jede legt genau eine Handkarte ab.
  for (let i = 0; i < 3; i++) {
    assert.ok(room.pendingCardAction, `Wahl ${i + 1} von 3 muss offen sein`);
    handleResolveCardCardChoice(room, 'a', room.pendingCardAction.candidateIds[0]);
  }
  assert.strictEqual(p.hand.length, 2, 'genau drei Karten abgelegt');
  assert.strictEqual(room.pendingCardAction, null, 'danach ist nichts mehr offen');
  done(room);
}
{
  // Weniger als drei Karten: es geht ab, was da ist, und nichts bleibt haengen.
  const wolf = ALL_CARDS.find((c) => c.name === 'MECHA-DIRE-WOLF');
  const fueller = ALL_CARDS.filter((c) => c.type === 'treasure').slice(0, 1).map((c) => c.id);
  const p = makePlayer('a', { hand: fueller });
  const room = makeRoom([p, makePlayer('b')]);
  applyPrimitiveAction(room, p, resolveConsequenceSpec(wolf.name, wolf.badstuff, p, room));
  handleResolveCardCardChoice(room, 'a', room.pendingCardAction.candidateIds[0]);
  assert.strictEqual(p.hand.length, 0, 'die eine Karte ist weg');
  assert.strictEqual(room.pendingCardAction, null, 'kein haengender Dialog bei leerer Hand');
  done(room);
}

console.log('OK - Schlimme Dinge mit Fremdbeteiligung: HIPPOGREIF/ANWALT/LEPRACHAUN/NETZ-TROLL/VERSICHERUNGSVERTRETER/SCHNECKEN AUF SPEED/FLUCH! EINKOMMENSSTEUER ueber die Aktions-Warteschlange, plus VERLIERE-1-GROSSEN-GEGENSTAND-Zwergwahl, plus Backlog-Regression bei mehreren Warteschlangen-Monstern in einem Kampf.');
