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

  return { ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS, DOOR_POWER_CARDS };
};
