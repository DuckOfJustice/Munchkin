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

  return { ROLL_REACTION_CARDS, ESCAPE_REACTION_CARDS };
};
