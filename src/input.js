/**
 * Captures keyboard input for the two human players (when active).  Per-player
 * action vectors come out of read(playerIdx).  R/P shortcuts are exposed via
 * onRestart / onPause callbacks set externally.
 */
export class Input {
  constructor() {
    this.keys = new Set();

    // Keys we always swallow so the browser doesn't scroll / type into focused
    // controls during play.
    const swallow = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ',
      'w', 'a', 's', 'd', 'q',
      'W', 'A', 'S', 'D', 'Q',
    ]);

    this.onRestart = null;
    this.onPause   = null;

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        if (this.onRestart) this.onRestart();
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (this.onPause) this.onPause();
        return;
      }

      if (swallow.has(e.key)) e.preventDefault();
      this.keys.add(e.key);
    }, { passive: false });

    window.addEventListener('keyup',  (e) => { this.keys.delete(e.key); });
    window.addEventListener('blur',   ()  => { this.keys.clear(); });
  }

  /** Returns [thrust, turn, shoot, hspace] for the given human player. */
  read(playerIdx) {
    const a = [0, 0, 0, 0];
    if (playerIdx === 0) {
      if (this.keys.has('ArrowUp'))         a[0] = 1;
      if (this.keys.has('ArrowLeft'))       a[1] = 1;
      else if (this.keys.has('ArrowRight')) a[1] = 2;
      if (this.keys.has('ArrowDown'))       a[2] = 1;
      if (this.keys.has(' '))               a[3] = 1;
    } else {
      const has = k => this.keys.has(k) || this.keys.has(k.toUpperCase());
      if (has('w'))      a[0] = 1;
      if (has('a'))      a[1] = 1;
      else if (has('d')) a[1] = 2;
      if (has('s'))      a[2] = 1;
      if (has('q'))      a[3] = 1;
    }
    return a;
  }
}
