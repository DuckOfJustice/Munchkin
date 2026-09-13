// Browser-Abnahme (Task 13, Step 3) mit Playwright gegen das ECHTE Frontend:
// Raum anlegen, drei Bots, Spiel starten, dann N Zugwechsel lang genau das
// klicken, was der Client anbietet. Im Gegensatz zu tools/smoke-run.js geht
// hier jede Aktion durch public/client.js - Renderfehler, fehlende Knöpfe und
// JS-Ausnahmen fallen auf.
//
// Playwright ist bewusst KEINE Projekt-Abhaengigkeit (der Server braucht es
// nicht, und der Browser-Download ist gross). Woher es kommt:
//
//   npx --yes playwright@1.63.0 --version     # legt das Paket in den npx-Cache
//   PW_PATH=<pfad zum playwright-Modul> node tools/browser-run.js
//
// Gerendert wird im INSTALLIERTEN Chrome (channel: 'chrome') - damit entfaellt
// der Chromium-Download von Playwright komplett.
//
//   NUR_BASIS=1 RUNDEN=50 URL=http://localhost:3000/ node tools/browser-run.js
function ladePlaywright() {
  const kandidaten = [process.env.PW_PATH, 'playwright'].filter(Boolean);
  for (const k of kandidaten) {
    try { return require(k); } catch (e) { /* naechster Kandidat */ }
  }
  console.error('Playwright nicht gefunden. Siehe Kopf dieser Datei (npx playwright, dann PW_PATH setzen).');
  process.exit(2);
  return null;
}
const { chromium } = ladePlaywright();

const URL = process.env.URL || 'http://localhost:3000/';
const ZIEL = Number(process.env.RUNDEN || 20);
const MAX_KLICKS = Number(process.env.MAX_KLICKS || 1500);

// Reihenfolge = Vorrang. Der erste Treffer wird geklickt.
const BEREICHE = ['#cardActionArea', '#consequenceArea', '#combatArea', '#revealArea', '#phaseActions'];
const BEVORZUGT = [
  'Passen', 'Fertig', 'Nehmen', 'Miesem Zeug stellen', '✅ Bereit',
  'Kampf auswerten', '🎲 Fliehen', 'Ablehnen',
  '🚪 Tür eintreten', 'Auf die Hand nehmen', 'Kein Monster spielen',
  '📦 Raum plündern', 'Zug beenden',
];

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage();
  const jsFehler = [];
  page.on('pageerror', (e) => jsFehler.push('pageerror: ' + e.message));
  // Fehlende Kartenbilder sind Absicht (siehe README "Warum keine
  // Kartenbilder?") - img.onerror blendet die Kachel um. Die 404 dafuer ist
  // kein Clientfehler und wird hier ausgefiltert.
  const bildFehler = [];
  const fehlendeBilder = [];
  page.on('requestfailed', (r) => { if (!/\/images\//.test(r.url())) bildFehler.push(r.url()); });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    if (/\/images\//.test(r.url())) fehlendeBilder.push(r.url().split('/').pop());
    else bildFehler.push(`${r.status()} ${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return; // siehe oben
    jsFehler.push('console.error: ' + m.text());
  });

  await page.goto(URL);
  await page.fill('#createNameInput', 'Abnahme');
  await page.click('#btnCreate');
  await page.waitForSelector('#screen-lobby:not(.hidden)');
  if (process.env.NUR_BASIS) {
    // Set-Schalter: alles ausser dem Basis-Set abwaehlen.
    // Jeder Klick loest einen Broadcast aus und baut die Liste neu auf -
    // deshalb Locator statt festgehaltener ElementHandles.
    const n = await page.locator('#setToggles label').count();
    for (let i = 0; i < n; i++) {
      const label = page.locator('#setToggles label').nth(i);
      const cb = label.locator('input[type=checkbox]');
      const t = ((await label.textContent()) || '').trim();
      const soll = /Base|Grundspiel/i.test(t);
      if ((await cb.isChecked()) !== soll) { await cb.click(); await page.waitForTimeout(200); }
    }
  }
  for (let i = 0; i < 3; i++) await page.click('#btnAddBot');
  await page.click('#btnStart');
  await page.waitForSelector('#screen-game:not(.hidden)');

  // Der Verlauf wird NEUESTE ZUERST gerendert - ein Blick auf die letzten
  // Zeichen sieht deshalb immer gleich aus, sobald der Anfang steht. Das hat
  // laufende Partien faelschlich als "haengt" gemeldet. Gemessen wird
  // deshalb der Anfang (das Neueste) plus die Gesamtlaenge.
  const logText = () => page.$eval('#logFeed', (e) => `${e.textContent.length}|${e.textContent.slice(0, 400)}`).catch(() => '');
  let zuege = 0, letzterBanner = '', klicks = 0, letzteAenderung = Date.now(), letztesLog = '';
  const versucht = new Set();
  let ergebnis = 'ZEITENDE';

  while (klicks < MAX_KLICKS) {
    const banner = await page.$eval('#turnBanner', (e) => e.textContent.trim()).catch(() => '');
    const wer = (banner.match(/^(.*?) ist am Zug/) || [])[1] || '';
    if (wer && wer !== letzterBanner) { letzterBanner = wer; zuege += 1; }
    const log = await logText();
    if (log !== letztesLog) { letztesLog = log; letzteAenderung = Date.now(); }
    if (/gewinnt das Spiel/.test(log)) { ergebnis = 'SIEG'; break; }
    if (zuege >= ZIEL) { ergebnis = 'ZIEL ERREICHT'; break; }

    // "Ablegen" nur, wenn die Hand wirklich ueber dem Limit ist - sonst wirft
    // der Lauf sich freiwillig die halbe Hand weg.
    const handCount = await page.locator('#myHand .cardtile').count().catch(() => 0);
    const ueberLimit = handCount > 5;
    let geklickt = false;
    for (const bereich of BEREICHE) {
      // Locator statt ElementHandle: der Client baut die Bereiche bei JEDEM
      // Broadcast neu auf, festgehaltene Handles zeigen danach ins Leere und
      // der Klick geht still daneben (der Lauf sah dann aus wie ein Haenger).
      const knoepfe = page.locator(`${bereich} button:not([disabled])`);
      const texte = await knoepfe.allTextContents().catch(() => []);
      if (!texte.length) continue;
      // "Doch noch nicht bereit" nimmt die eigene Bestaetigung ZURUECK - wer den
      // Knopf blind klickt, schaltet den Bereit-Status im Kreis und der Kampf
      // wird nie ausgewertet.
      const erlaubt = texte.map((t) => !/Doch noch nicht bereit/.test(t || ''));
      if (!erlaubt.some(Boolean)) continue;
      let idx = -1;
      for (const wunsch of BEVORZUGT) {
        idx = texte.findIndex((t, k) => erlaubt[k] && (t || '').includes(wunsch));
        if (idx >= 0) break;
      }
      if (idx < 0) idx = erlaubt.findIndex(Boolean);
      await knoepfe.nth(idx).click({ timeout: 3000 }).catch(() => {});
      geklickt = true; klicks += 1;
      break;
    }
    if (!geklickt) {
      // Die Hand: Rasse/Klasse ausspielen, Gegenstaende anlegen, Sonderkraefte
      // nutzen - und in der Milden Gabe ablegen. Jede Karte wird pro Knopf nur
      // EINMAL versucht, sonst klickt der Lauf ewig gegen eine Absage.
      const kacheln = page.locator('#myHand .cardtile');
      const anzahl = await kacheln.count().catch(() => 0);
      for (let t = 0; t < anzahl && !geklickt; t++) {
        const kachel = kacheln.nth(t);
        const name = (await kachel.locator('.ctname').first().textContent().catch(() => '')) || '?';
        const btns = kachel.locator('button:not([disabled])');
        const texte = await btns.allTextContents().catch(() => []);
        for (let b = 0; b < texte.length; b++) {
          const label = (texte[b] || '').trim();
          if (/^(Ablegen|ablegen)$/.test(label) && !ueberLimit) continue;  // nur bei Handlimit
          const key = `${name.trim()}|${label}`;
          if (versucht.has(key)) continue;
          versucht.add(key);
          await btns.nth(b).click({ timeout: 3000 }).catch(() => {});
          geklickt = true; klicks += 1;
          break;
        }
      }
    }
    if (!geklickt) await page.waitForTimeout(400);           // Bots sind dran
    if (Date.now() - letzteAenderung > 20000) {
      ergebnis = 'HAENGT';
      const dump = await page.evaluate(() => {
        const t = (id) => [...document.querySelectorAll(`#${id} button`)].map((b) => `${b.textContent.trim()}${b.disabled ? '(aus)' : ''}`);
        return { banner: document.getElementById('turnBanner').textContent.trim(),
          cardAct: t('cardActionArea'), cons: t('consequenceArea'), kampf: t('combatArea'),
          reveal: t('revealArea'), phase: t('phaseActions'), hand: t('myHand'),
          kampfText: (document.getElementById('combatArea').textContent || '').replace(/\s+/g, ' ').slice(0, 200),
          logZeichen: (document.getElementById('logFeed').textContent || '').length,
          zeit: new Date().toISOString().slice(11, 19) };
      }).catch((e) => ({ err: e.message }));
      console.log('STAND BEIM HAENGER: ' + JSON.stringify(dump));
      break;
    }
    await page.waitForTimeout(120);
  }

  const stufen = await page.$$eval('#playerList .prow', (ls) => ls.map((l) => l.textContent.replace(/\s+/g, ' ').trim()))
    .catch(() => []);
  console.log(`Ergebnis: ${ergebnis}`);
  console.log(`Zugwechsel: ${zuege} (Ziel ${ZIEL}), Klicks: ${klicks}`);
  console.log('Spieler:innen: ' + stufen.join(' | '));
  console.log('letztes Log:\n  ' + (await logText()).replace(/\s+/g, ' ').slice(-300));
  if (jsFehler.length) console.log('\nJS-FEHLER IM CLIENT:\n - ' + [...new Set(jsFehler)].join('\n - '));
  else console.log('\nKeine JS-Fehler im Client.');
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT }).catch(() => {}); // SHOT=pfad.png fuer ein Bild am Ende
  await browser.close();
  process.exit(ergebnis === 'HAENGT' || jsFehler.length || bildFehler.length ? 1 : 0);
})();
