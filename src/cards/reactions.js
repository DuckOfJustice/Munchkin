// Karten, die auf ein Ereignis REAGIEREN statt aktiv ausgespielt zu werden.
// Sie brauchen ein Zeitfenster, das der Server sonst nirgends hat.
module.exports = () => {
  // "Spiel ihn, nachdem du aus einem beliebigen Grund wuerfeln musstest.
  // Aendere das Wuerfelergebnis so wie du willst. Nur einmal einsetzbar."
  const ROLL_REACTION_CARDS = new Set(['GEZINKTER WÜRFEL']);

  // "Einsetzbar, wenn jemand erfolgreich (egal warum) einem Kampf entkommt.
  // Er muss seine Flucht noch einmal wuerfeln, sogar wenn sie das erste Mal
  // automatisch gelungen war. Nur einmal einsetzbar."
  const ESCAPE_REACTION_CARDS = new Set(['KLEBERFLÄSCHCHEN']);

  // Tuerkarten mit aktiver Sonderkraft. handleUseCardPower kennt bisher nur
  // Schatzkarten - diese Tabelle oeffnet denselben Weg fuer Tuerkarten.
  const DOOR_POWER_CARDS = {
    // "Alle Priester steigen sofort 1 Stufe auf. Dies darf die Siegesstufe
    // sein." Kartenname in den Rohdaten ohne Umlaut.
    'GOTTLICHE INTERVENTION': () => ({ type: 'levelUpAllPriests' }),
  };

  // Flueche, die NACH dem Ziehen weiterwirken (statt sofort und einmalig).
  // CONSEQUENCE_OVERRIDES behandelt sie weiterhin als "bewusst manuell" (kein
  // Sofort-Effekt) - dieser Tracker kommt zusaetzlich obendrauf, siehe
  // addActiveCurse/curseCombatModifier/curseSuppressesItemBonuses in server.js.
  const LINGERING_CURSES = {
    // "(Nur) In deinem naechsten Kampf erhaeltst du keine Boni durch
    // Gegenstaende, die einzige Ausnahme sind Ruestungsboni."
    'MIESER SPIEGEL': { kind: 'noItemBonusExceptArmor', dauer: 'naechsterKampf' },
    // "-5 auf deinen naechsten Kampf, weil du abgelenkt bist."
    'GESCHLECHTSUMWANDLUNG': { kind: 'combatMalus', amount: -5, dauer: 'naechsterKampf' },
    // "-1 auf alle Wuerfe. Jeder Fluch oder alle Schlimmen Dinge, die deine
    // Kopfbedeckung entfernen, nehmen das Huhn mit."
    // ponytail: der zweite Satz (Huhn faellt weg, wenn die Kopfbedeckung
    // verloren geht) ist nicht verdrahtet - dafuer muesste 'discardSlot'
    // slot:'head' in applyPrimitiveAction dieses activeCurses-Eintrag mit
    // entfernen. Bis dahin bleibt das Huhn auch nach Kopfbedeckungsverlust
    // aktiv (seltener Fall, nur per WUNSCHRING beendbar).
    'HUHN AUF DEINEM KOPF': { kind: 'rollMalus', amount: -1, dauer: 'dauerhaft' },
    // "Du kannst keine Gegenstaende tragen, die mehr als eine Hand benoetigen."
    'WINZIGE HÄNDE': { kind: 'noTwoHandedItems', dauer: 'dauerhaft' },
  };

  return {
    ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS, DOOR_POWER_CARDS, LINGERING_CURSES,
  };
};
