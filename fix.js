const fs = require('fs');
let code = fs.readFileSync('tests/card-unnatural-doors.test.js', 'utf8');
code = code.replace(
  'raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });\nconsole.log(\'card-unnatural-doors: ok\');',
  `// --- WELLE C SCHÄTZE: JUCKPULVER ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const p2 = makePlayer({ id: 'P2', name: 'P2' });
  const room = makeRoom([p1, p2]);
  
  const armor = findCard('FLAMMENDE RÜSTUNG');
  p1.hand.push(armor.id);
  handleEquipItem(room, p1.id, armor.id);
  
  const monster = findCard('LAHMER GOBLIN');
  startCombat(room, p1.id, [monster.id], { fromHand: false });
  
  const juck = findCard('JUCKPULVER');
  p2.hand.push(juck.id);
  
  handlePlayCombatCard(room, p2.id, juck.id);
  assert.ok(room.pendingCardAction, 'Juckpulver öffnet Dialog');
  
  handleResolveCardChoice(room, p2.id, room.pendingCardAction.options[0].id);
  
  assert.ok(!p1.equipped.armor, 'Rüstung abgelegt');
}

// --- WELLE C SCHÄTZE: FLOHMARKT ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const room = makeRoom([p1]);
  
  const floh = findCard('FLOHMARKT');
  const d1 = findCard('KLEBERFLÄSCHCHEN'); // 100 G
  const d2 = findCard('WUNSCHRING');       // 500 G
  const d3 = findCard('FLAMMENDE RÜSTUNG'); // 400 G (zum Abwerfen)
  
  p1.hand.push(floh.id, d3.id);
  room.treasureDiscard.push(d1.id, d2.id); // Liegen im Ablagestapel
  
  handleUseCardPower(room, p1.id, floh.id);
  assert.ok(room.pendingCardAction, 'Flohmarkt öffnet Auswahl 1 (Abwerfen)');
  
  handleResolveCardChoice(room, p1.id, room.pendingCardAction.options.find(o => o.id === d3.id).id);
  assert.ok(room.pendingCardAction, 'Flohmarkt öffnet Auswahl 2 (Erster Schatz)');
  
  const opt1 = room.pendingCardAction.options.find(o => o.id === d1.id);
  assert.ok(opt1, 'Kleberfläschchen zur Auswahl');
  handleResolveCardChoice(room, p1.id, opt1.id);
  
  assert.ok(room.pendingCardAction, 'Flohmarkt öffnet Auswahl 3 (Zweiter Schatz)');
  
  handleResolveCardChoice(room, p1.id, 'none');
  
  assert.ok(!room.pendingCardAction, 'Flohmarkt beendet');
  assert.ok(p1.hand.includes(d1.id), 'Kleberfläschchen auf der Hand');
  assert.ok(!p1.hand.includes(d3.id), 'Rüstung abgeworfen');
}

// --- WELLE C SCHÄTZE: BUMERANGDOLCH ---
{
  const p1 = makePlayer({ id: 'P1', name: 'P1' });
  const p2 = makePlayer({ id: 'P2', name: 'P2' });
  const room = makeRoom([p1, p2]);
  
  const bumerang = findCard('BUMERANGDOLCH');
  p1.hand.push(bumerang.id);
  
  room.turnIndex = 0;
  room.turnPhase = 'tuer';
  handleSellItems(room, p1.id, [bumerang.id]);
  assert.ok(!p1.hand.includes(bumerang.id), 'Bumerang verkauft');
  
  endTurn(room); 
  assert.strictEqual(currentPlayer(room).id, p2.id, 'P2 ist am Zug');
  assert.ok(room.treasureDiscard.includes(bumerang.id), 'Bumerang noch im Ablagestapel');
  
  endTurn(room);
  assert.strictEqual(currentPlayer(room).id, p1.id, 'P1 ist wieder am Zug');
  assert.ok(!room.treasureDiscard.includes(bumerang.id), 'Bumerangdolch nicht mehr im Ablagestapel');
  assert.ok(p1.hand.includes(bumerang.id), 'Bumerangdolch magisch zurück auf die Hand gekehrt');
}

raeume.forEach((r) => { if (r.cleanupTimer) clearTimeout(r.cleanupTimer); if (r.botTimer) clearTimeout(r.botTimer); });
console.log('card-unnatural-doors: ok');`
);
fs.writeFileSync('tests/card-unnatural-doors.test.js', code);
console.log('Tests restored.');
