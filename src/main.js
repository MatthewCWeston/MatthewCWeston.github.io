import { Game } from './game.js';

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------
 * UI state machine
 *   STATES: loading | ready | playing | paused | match-over
 *
 *   Top control bar is always visible.  The overlay swaps between
 *   loading / paused / status (= ready or match-over) based on
 *   body[data-state].
 * ----------------------------------------------------------------- */

const game = new Game({
  canvas: $('#game'),
  hudP1:  $('#hudP1'),
  hudP2:  $('#hudP2'),
  listeners: { onStateChange },
});

function setOverlayState(s) {
  document.body.dataset.state = s;
}

function onStateChange(s, payload) {
  setOverlayState(s);
  const msg = $('#resultMsg');
  const sub = $('#resultSub');
  if (s === 'match-over') {
    msg.textContent = payload.outcome;
    sub.textContent = payload.sub;
  } else if (s === 'ready') {
    msg.textContent = 'READY';
    sub.textContent = '';
  }
}

/* ---------- Mode segmented control ---------- */

const segButtons = Array.from(document.querySelectorAll('#modeSeg .seg-btn'));

function applyMode(mode) {
  game.setMode(mode);
  for (const b of segButtons) b.classList.toggle('active', b.dataset.mode === mode);

  const hint = $('#keyHint');
  if (mode === 'cvc') {
    hint.classList.add('hidden');
    hint.innerHTML = '';
  } else if (mode === 'hvc') {
    hint.classList.remove('hidden');
    hint.innerHTML =
      '<span class="kh-p1">P1</span> ' +
      '<kbd>↑</kbd> thrust &nbsp; <kbd>← →</kbd> turn &nbsp; ' +
      '<kbd>↓</kbd> shoot &nbsp; <kbd>Space</kbd> warp';
  } else {  // hotseat
    hint.classList.remove('hidden');
    hint.innerHTML =
      '<span class="kh-p1">P1</span> <kbd>↑↓ ← →</kbd> <kbd>Space</kbd>' +
      ' &nbsp;·&nbsp; ' +
      '<span class="kh-p2">P2</span> <kbd>WASD</kbd> <kbd>Q</kbd>';
  }
}
applyMode('cvc');

for (const btn of segButtons) {
  btn.addEventListener('click', () => {
    if (btn.dataset.mode === game.mode) { btn.blur(); return; }
    if (game.running) game.stop();
    applyMode(btn.dataset.mode);
    btn.blur();
  });
}

/* ---------- Sliders ---------- */

const speedSlider  = $('#speedSlider');
const speedReadout = $('#speedReadout');
speedSlider.addEventListener('input', () => {
  const n = parseInt(speedSlider.value, 10);
  speedReadout.textContent = n;
  game.setSpeed(n);
});
speedSlider.addEventListener('change', () => speedSlider.blur());
game.setSpeed(parseInt(speedSlider.value, 10));

const fpsSlider  = $('#fpsSlider');
const fpsReadout = $('#fpsReadout');
fpsSlider.addEventListener('input', () => {
  const n = parseInt(fpsSlider.value, 10);
  fpsReadout.textContent = n;
  game.setFps(n);
});
fpsSlider.addEventListener('change', () => fpsSlider.blur());
game.setFps(parseInt(fpsSlider.value, 10));

/* ---------- Start button ---------- */

const startBtn = $('#startBtn');
startBtn.addEventListener('click', () => {
  game.start();
  startBtn.blur();
});

/* ---------- Boot ---------- */

setOverlayState('loading');
game.initialDraw();

(async () => {
  try {
    await game.ai.load();
    setOverlayState('ready');
    $('#resultMsg').textContent = 'READY';
    $('#resultSub').textContent = '';
    startBtn.disabled = false;
  } catch (err) {
    console.error(err);
    $('#loadingMsg').textContent = 'LOAD FAILED';
    $('#loadingSub').textContent = err.message || String(err);
  }
})();
