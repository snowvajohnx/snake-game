(() => {
  "use strict";

  const COLS = 21;
  const ROWS = 21;
  const BASE_MS = 180;
  const MIN_MS = 70;
  const STEP_MS = 3.5;
  const MAX_SCORE = COLS * ROWS - 3;
  const STORAGE_KEY = "snake-high-score";
  const SOUND_KEY = "snake-sound";

  const DIRS = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };

  const KEYS = {
    ArrowUp: DIRS.up,
    ArrowDown: DIRS.down,
    ArrowLeft: DIRS.left,
    ArrowRight: DIRS.right,
    w: DIRS.up,
    W: DIRS.up,
    a: DIRS.left,
    A: DIRS.left,
    s: DIRS.down,
    S: DIRS.down,
    d: DIRS.right,
    D: DIRS.right,
  };

  const board = document.getElementById("board");
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  const overlay = document.getElementById("overlay");
  const overlayKicker = document.getElementById("overlay-kicker");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const toggleBtn = document.getElementById("toggle");
  const restartBtn = document.getElementById("restart");
  const soundBtn = document.getElementById("sound");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const bestStat = document.getElementById("best-stat");
  const tempoBar = document.getElementById("tempo-bar");
  const pad = document.getElementById("pad");
  const live = document.getElementById("live");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    snake: [],
    prev: [],
    grew: false,
    dir: { x: 1, y: 0 },
    queue: [],
    food: null,
    score: 0,
    best: loadBest(),
    mode: "ready",
    reason: "",
    acc: 0,
    last: 0,
    crash: null,
    record: false,
    holdOverlay: false,
    deathAt: 0,
  };

  const camera = { shake: 0, kick: 0, flash: 0, gold: true };
  let particles = [];
  let popups = [];
  let waves = [];
  let trail = [];

  let cssSize = 0;
  let drag = null;
  let wantSound = loadSound();
  let audioCtx = null;
  let master = null;
  let droneNodes = null;

  function tickMs(score) {
    return Math.max(MIN_MS, BASE_MS - score * STEP_MS);
  }

  function loadBest() {
    try {
      const n = Number(localStorage.getItem(STORAGE_KEY));
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.min(MAX_SCORE, Math.floor(n));
    } catch (err) {
      return 0;
    }
  }

  function saveBest(n) {
    try {
      localStorage.setItem(STORAGE_KEY, String(n));
    } catch (err) {
      /* Storage can be blocked in private mode. The run still plays. */
    }
  }

  function loadSound() {
    try {
      return localStorage.getItem(SOUND_KEY) === "on";
    } catch (err) {
      return false;
    }
  }

  function saveSound() {
    try {
      localStorage.setItem(SOUND_KEY, wantSound ? "on" : "off");
    } catch (err) {
      /* Ignore. The toggle still works for this visit. */
    }
  }

  function announce(message) {
    live.textContent = "";
    live.textContent = message;
  }

  function paintSound() {
    soundBtn.classList.toggle("is-on", wantSound);
    soundBtn.setAttribute("aria-pressed", wantSound ? "true" : "false");
    soundBtn.setAttribute("aria-label", wantSound ? "Sound on" : "Sound off");
  }

  function ensureAudio() {
    if (!wantSound) return null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      if (!audioCtx) {
        audioCtx = new AC();
        master = audioCtx.createGain();
        master.gain.value = 0.8;
        master.connect(audioCtx.destination);
      }
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    } catch (err) {
      return null;
    }
  }

  function tone(freq, dur, type, gain, delay, slide) {
    if (!wantSound || !audioCtx || !master) return;
    const t0 = audioCtx.currentTime + (delay || 0);
    const osc = audioCtx.createOscillator();
    const amp = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, freq), t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t0 + dur);
    amp.gain.setValueAtTime(0.0001, t0);
    amp.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(amp);
    amp.connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  function noiseHit() {
    if (!wantSound || !audioCtx || !master) return;
    const seconds = 0.28;
    const len = Math.floor(audioCtx.sampleRate * seconds);
    const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 780;
    const amp = audioCtx.createGain();
    amp.gain.value = 0.22;
    src.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    src.start();
  }

  function stopDrone() {
    if (!droneNodes || !audioCtx) {
      droneNodes = null;
      return;
    }
    const t0 = audioCtx.currentTime;
    droneNodes.gain.gain.cancelScheduledValues(t0);
    droneNodes.gain.gain.setTargetAtTime(0.0001, t0, 0.06);
    droneNodes.oscs.forEach((osc) => osc.stop(t0 + 0.35));
    droneNodes = null;
  }

  function syncDrone() {
    const on = wantSound && state.mode === "running";
    if (!on) {
      stopDrone();
      return;
    }
    if (droneNodes || !audioCtx || !master) return;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.02;
    const filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    gain.connect(filter);
    filter.connect(master);
    const oscs = [82.41, 123.47, 164.81].map((freq, i) => {
      const osc = audioCtx.createOscillator();
      osc.type = i === 2 ? "triangle" : "sine";
      osc.frequency.value = freq;
      osc.detune.value = (i - 1) * 7;
      osc.connect(gain);
      osc.start();
      return osc;
    });
    droneNodes = { gain, oscs };
  }

  function cueStart() {
    tone(196, 0.22, "sine", 0.035, 0, 392);
  }

  function chime() {
    tone(523.25, 0.14, "triangle", 0.05);
    tone(783.99, 0.2, "sine", 0.032, 0.04);
  }

  function blip() {
    const gain = Math.max(0.007, 0.02 - state.score * 0.00035);
    tone(88 + Math.min(state.score, 70) * 2, 0.035, "sine", gain);
  }

  function sting() {
    tone(174, 0.45, "triangle", 0.05, 0, 49);
    tone(92, 0.5, "sine", 0.04, 0.02, 40);
    noiseHit();
  }

  function fanfare() {
    tone(392, 0.18, "triangle", 0.045);
    tone(523.25, 0.2, "sine", 0.04, 0.1);
    tone(659.25, 0.28, "sine", 0.045, 0.2);
  }

  function paintScore(bump) {
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(state.best);
    bestStat.classList.toggle("is-record", state.best > 0);
    const span = BASE_MS - MIN_MS;
    const pace = span <= 0 ? 0 : (BASE_MS - tickMs(state.score)) / span;
    tempoBar.style.transform = "scaleX(" + (0.08 + pace * 0.92).toFixed(4) + ")";
    document.title = state.score > 0 ? "Snake · " + state.score : "Snake";
    if (!bump) return;
    scoreEl.classList.remove("bump");
    void scoreEl.offsetWidth;
    scoreEl.classList.add("bump");
  }

  function setScore(n) {
    state.score = n;
    if (n > state.best) {
      const first = !state.record;
      state.best = n;
      state.record = true;
      saveBest(n);
      if (first) {
        announce("New best, " + n + ".");
        bestEl.classList.remove("bump");
        void bestEl.offsetWidth;
        bestEl.classList.add("bump");
      }
    }
    paintScore(n > 0);
  }

  function occupied() {
    const taken = new Set();
    for (const part of state.snake) taken.add(part.x + "," + part.y);
    return taken;
  }

  function placeFood(minDist) {
    const taken = occupied();
    const spots = [];
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
        if (!taken.has(x + "," + y)) spots.push({ x, y });
      }
    }
    if (spots.length === 0) {
      state.food = null;
      state.mode = "won";
      state.queue = [];
      celebrate();
      updateChrome();
      announce("You filled the board. Score " + state.score + ".");
      return;
    }
    let pool = spots;
    if (minDist > 0) {
      const head = state.snake[0];
      const far = spots.filter((spot) => Math.abs(spot.x - head.x) + Math.abs(spot.y - head.y) >= minDist);
      if (far.length) pool = far;
    }
    state.food = pool[Math.floor(Math.random() * pool.length)];
  }

  function clearScene() {
    particles = [];
    popups = [];
    waves = [];
    trail = [];
    camera.shake = 0;
    camera.kick = 0;
    camera.flash = 0;
    board.classList.remove("is-over", "is-won", "is-cinematic");
  }

  function fresh() {
    const x = Math.floor(COLS / 2);
    const y = Math.floor(ROWS / 2);
    state.snake = [
      { x, y },
      { x: x - 1, y },
      { x: x - 2, y },
    ];
    state.prev = state.snake.map((part) => ({ x: part.x, y: part.y }));
    state.grew = false;
    state.dir = { x: 1, y: 0 };
    state.queue = [];
    state.score = 0;
    state.crash = null;
    state.record = false;
    state.reason = "";
    state.acc = 0;
    state.last = 0;
    state.holdOverlay = false;
    state.deathAt = 0;
    clearScene();
    placeFood(6);
  }

  function updateChrome() {
    const holding = state.holdOverlay && (state.mode === "over" || state.mode === "won");
    board.dataset.mode = state.mode;
    overlayKicker.textContent = "Night run";
    if (state.mode === "running") {
      overlay.hidden = true;
      toggleBtn.textContent = "Pause";
    } else if (state.mode === "paused") {
      overlay.hidden = false;
      overlayTitle.textContent = "Paused";
      overlayText.textContent = "Space or Resume continues the run.";
      toggleBtn.textContent = "Resume";
    } else if (state.mode === "over") {
      overlay.hidden = false;
      overlayTitle.textContent = "Game over";
      const why = state.reason === "wall" ? "You hit the wall." : "You ran into yourself.";
      const extra = state.record ? " New best." : "";
      overlayText.textContent = why + " Score " + state.score + " · Best " + state.best + "." + extra;
      toggleBtn.textContent = "Play again";
    } else if (state.mode === "won") {
      overlay.hidden = false;
      overlayTitle.textContent = "Board clear";
      overlayText.textContent = "You filled every cell. Score " + state.score + " · Best " + state.best + ".";
      toggleBtn.textContent = "Play again";
    } else {
      overlay.hidden = false;
      overlayTitle.textContent = "Ready";
      overlayText.textContent = "Eat the dot. Avoid the walls and your tail.";
      toggleBtn.textContent = "Start";
    }
    overlay.classList.toggle("is-holding", holding);
    paintScore(false);
    syncDrone();
  }

  function armAudio() {
    if (wantSound) ensureAudio();
  }

  function start() {
    if (state.mode !== "ready") return;
    armAudio();
    state.mode = "running";
    state.acc = 0;
    state.last = 0;
    updateChrome();
    cueStart();
  }

  function pause() {
    if (state.mode !== "running") return;
    state.mode = "paused";
    state.last = 0;
    updateChrome();
    announce("Paused");
  }

  function resume() {
    if (state.mode !== "paused") return;
    armAudio();
    state.mode = "running";
    state.last = 0;
    updateChrome();
  }

  function restart() {
    armAudio();
    fresh();
    state.mode = "running";
    updateChrome();
    announce("New game");
    cueStart();
  }

  function toggle() {
    if (state.mode === "ready") start();
    else if (state.mode === "running") pause();
    else if (state.mode === "paused") resume();
    else restart();
  }

  function toggleSound() {
    wantSound = !wantSound;
    saveSound();
    paintSound();
    if (wantSound) ensureAudio();
    else stopDrone();
    syncDrone();
  }

  function flashPad(x, y) {
    const name = y === -1 ? "up" : y === 1 ? "down" : x === -1 ? "left" : x === 1 ? "right" : "";
    const btn = name && pad.querySelector('[data-dir="' + name + '"]');
    if (!btn) return;
    btn.classList.add("is-on");
    window.setTimeout(() => btn.classList.remove("is-on"), 120);
  }

  function input(x, y) {
    armAudio();
    if (state.mode === "paused") resume();
    if (state.mode === "over" || state.mode === "won") restart();
    const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
    if (last.x === x && last.y === y) {
      if (state.mode === "ready") start();
      flashPad(x, y);
      return true;
    }
    if (last.x + x === 0 && last.y + y === 0) return false;
    if (state.queue.length >= 2) return false;
    state.queue.push({ x, y });
    if (state.mode === "ready") start();
    flashPad(x, y);
    return true;
  }

  function burst(cell, kind) {
    if (reduceMotion || !cell) return;
    const death = kind === "death";
    const count = death ? 26 : 14;
    for (let i = 0; i < count; i += 1) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = (death ? 0.1 : 0.045) + Math.random() * (death ? 0.26 : 0.13);
      particles.push({
        x: cell.x,
        y: cell.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        decay: death ? 0.012 + Math.random() * 0.012 : 0.02 + Math.random() * 0.018,
        size: (death ? 0.14 : 0.08) + Math.random() * 0.14,
        gold: death ? Math.random() > 0.8 : true,
      });
    }
    if (particles.length > 110) particles.splice(0, particles.length - 110);
  }

  function ring(cell, gold) {
    if (reduceMotion || !cell) return;
    waves.push({ x: cell.x, y: cell.y, life: 1, gold });
    if (waves.length > 12) waves.shift();
  }

  function floatScore(cell) {
    if (reduceMotion || !cell) return;
    popups.push({ x: cell.x, y: cell.y, life: 1, text: "+1" });
    if (popups.length > 8) popups.shift();
  }

  function celebrate() {
    state.holdOverlay = !reduceMotion;
    state.deathAt = performance.now();
    board.classList.add("is-cinematic", "is-won");
    camera.kick = 0.05;
    camera.flash = 0.85;
    camera.gold = true;
    camera.shake = Math.max(camera.shake, 4);
    const head = state.snake[0];
    burst(head, "eat");
    ring(head, true);
    if (!reduceMotion) {
      for (let i = 0; i < 4; i += 1) {
        const part = state.snake[Math.floor(Math.random() * state.snake.length)];
        burst(part, "eat");
      }
    }
    fanfare();
  }

  function endGame(reason, cell) {
    state.mode = "over";
    state.reason = reason;
    state.queue = [];
    state.crash = { x: cell.x, y: cell.y };
    const impact = {
      x: Math.max(0, Math.min(COLS - 1, cell.x)),
      y: Math.max(0, Math.min(ROWS - 1, cell.y)),
    };
    state.holdOverlay = !reduceMotion;
    state.deathAt = performance.now();
    board.classList.add("is-over", "is-cinematic");
    camera.shake = 13;
    camera.kick = 0.035;
    camera.flash = 1;
    camera.gold = false;
    burst(impact, "death");
    ring(impact, false);
    sting();
    updateChrome();
    const why = reason === "wall" ? "Hit a wall" : "Hit yourself";
    announce(why + ". Score " + state.score + ".");
  }

  function step() {
    if (state.queue.length) state.dir = state.queue.shift();
    const next = {
      x: state.snake[0].x + state.dir.x,
      y: state.snake[0].y + state.dir.y,
    };
    if (next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS) {
      endGame("wall", next);
      return;
    }
    const willEat = state.food && next.x === state.food.x && next.y === state.food.y;
    const limit = willEat ? state.snake.length : state.snake.length - 1;
    for (let i = 0; i < limit; i += 1) {
      const part = state.snake[i];
      if (part.x === next.x && part.y === next.y) {
        endGame("self", next);
        return;
      }
    }
    state.prev = state.snake.map((part) => ({ x: part.x, y: part.y }));
    state.grew = willEat;
    state.snake.unshift(next);
    if (willEat) {
      const meal = state.food;
      burst(meal, "eat");
      ring(meal, true);
      floatScore(meal);
      if (camera.shake < 2) camera.shake = 2;
      camera.kick = Math.min(0.06, camera.kick + 0.04);
      camera.flash = Math.max(camera.flash, 0.34);
      camera.gold = true;
      setScore(state.score + 1);
      chime();
      if (state.mode !== "running") return;
      placeFood(0);
    } else {
      state.snake.pop();
      blip();
    }
  }

  function resize() {
    const size = board.clientWidth;
    if (!size) return;
    cssSize = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const px = Math.max(1, Math.round(size * dpr));
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
  }

  function geom() {
    const inset = Math.max(8, cssSize * 0.025);
    const cell = (cssSize - inset * 2) / COLS;
    const grid = cell * COLS;
    return {
      cell,
      originX: (cssSize - grid) / 2,
      originY: (cssSize - grid) / 2,
    };
  }

  function center(point, g) {
    return {
      x: g.originX + (point.x + 0.5) * g.cell,
      y: g.originY + (point.y + 0.5) * g.cell,
    };
  }

  function clampToGrid(point, g) {
    const minX = g.originX;
    const maxX = g.originX + g.cell * COLS;
    const minY = g.originY;
    const maxY = g.originY + g.cell * ROWS;
    return {
      x: Math.min(maxX, Math.max(minX, point.x)),
      y: Math.min(maxY, Math.max(minY, point.y)),
    };
  }

  function glide() {
    if (reduceMotion || state.mode === "over" || state.mode === "won" || state.mode === "ready") return 1;
    const ms = tickMs(state.score);
    if (ms <= 0) return 1;
    return Math.max(0, Math.min(1, state.acc / ms));
  }

  function segment(i, t) {
    const curr = state.snake[i];
    const prevList = state.prev;
    let prev = curr;
    if (prevList && prevList.length && t < 1) {
      if (state.grew) prev = i === 0 ? prevList[0] : (prevList[i - 1] || curr);
      else prev = prevList[i] || curr;
    }
    return {
      x: prev.x + (curr.x - prev.x) * t,
      y: prev.y + (curr.y - prev.y) * t,
    };
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function fillCells(g, x0, y0, x1, y1) {
    const gap = Math.max(1.25, g.cell * 0.12);
    const tile = g.cell - gap;
    const radius = Math.min(4, tile * 0.24);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        roundRect(
          g.originX + x * g.cell + gap / 2,
          g.originY + y * g.cell + gap / 2,
          tile,
          tile,
          radius
        );
        ctx.fill();
      }
    }
  }

  function trace(points) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  }

  function buildPoints(g, t, now) {
    const points = [];
    for (let i = state.snake.length - 1; i >= 0; i -= 1) points.push(center(segment(i, t), g));
    if (state.mode === "over" && state.crash && !reduceMotion && points.length) {
      const age = Math.max(0, now - state.deathAt);
      const out = Math.min(1, age / 220);
      const back = age > 220 ? Math.min(1, (age - 220) / 380) : 0;
      const head = points[points.length - 1];
      const target = clampToGrid(center(state.crash, g), g);
      let dx = target.x - head.x;
      let dy = target.y - head.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.001) {
        const mag = Math.min(dist, (out - back * 0.45) * g.cell * 0.62);
        points[points.length - 1] = { x: head.x + (dx / dist) * mag, y: head.y + (dy / dist) * mag };
      }
    }
    return points;
  }

  function heading(points) {
    const head = points[points.length - 1];
    const neck = points[points.length - 2] || {
      x: head.x - state.dir.x * 8,
      y: head.y - state.dir.y * 8,
    };
    let x = head.x - neck.x;
    let y = head.y - neck.y;
    const mag = Math.hypot(x, y);
    if (mag < 0.001) return { x: state.dir.x, y: state.dir.y };
    return { x: x / mag, y: y / mag };
  }

  function drawLamp(head, aim, g) {
    const pool = ctx.createRadialGradient(head.x, head.y, g.cell * 0.2, head.x, head.y, g.cell * 4.6);
    pool.addColorStop(0, "rgba(186, 230, 150, 0.16)");
    pool.addColorStop(1, "rgba(186, 230, 150, 0)");
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(head.x, head.y, g.cell * 4.6, 0, Math.PI * 2);
    ctx.fill();

    const reach = g.cell * 7.2;
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(Math.atan2(aim.y, aim.x));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, reach, -0.62, 0.62);
    ctx.closePath();
    const cone = ctx.createRadialGradient(0, 0, g.cell * 0.15, 0, 0, reach);
    cone.addColorStop(0, "rgba(210, 245, 170, 0.22)");
    cone.addColorStop(0.4, "rgba(140, 190, 100, 0.08)");
    cone.addColorStop(1, "rgba(140, 190, 100, 0)");
    ctx.fillStyle = cone;
    ctx.fill();
    ctx.restore();
  }

  function drawSnake(points, g, now) {
    if (points.length < 2) return;
    const head = points[points.length - 1];
    const tail = points[0];
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.translate(0, Math.max(1, g.cell * 0.07));
    trace(points);
    ctx.lineWidth = g.cell * 0.78;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    trace(points);
    ctx.lineWidth = g.cell * 1.05;
    ctx.strokeStyle = "rgba(143, 224, 106, 0.16)";
    ctx.stroke();

    let color = "#8fe06a";
    if (head.x !== tail.x || head.y !== tail.y) {
      const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      gradient.addColorStop(0, "#145c38");
      gradient.addColorStop(0.62, "#7ed15f");
      gradient.addColorStop(1, "#e7ffb0");
      color = gradient;
    }
    ctx.lineWidth = g.cell * 0.66;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.lineWidth = Math.max(1, g.cell * 0.12);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.26)";
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = "#e7ffb0";
    ctx.beginPath();
    ctx.arc(head.x, head.y, g.cell * 0.36, 0, Math.PI * 2);
    ctx.fill();

    if (g.cell < 12) return;
    const aim = heading(points);
    const sideX = -aim.y;
    const sideY = aim.x;
    const fx = aim.x * g.cell * 0.1;
    const fy = aim.y * g.cell * 0.1;
    const spread = g.cell * 0.14;
    const blinking = !reduceMotion && (now % 4200) > 4000;
    for (const sign of [-1, 1]) {
      const ex = head.x + fx + sideX * spread * sign;
      const ey = head.y + fy + sideY * spread * sign;
      if (blinking) {
        ctx.strokeStyle = "#102117";
        ctx.lineWidth = Math.max(1, g.cell * 0.06);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(ex - g.cell * 0.07, ey);
        ctx.lineTo(ex + g.cell * 0.07, ey);
        ctx.stroke();
        continue;
      }
      ctx.fillStyle = "#102117";
      ctx.beginPath();
      ctx.arc(ex, ey, g.cell * 0.065, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(ex - g.cell * 0.02, ey - g.cell * 0.02, g.cell * 0.02, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawFood(g, now) {
    const food = center(state.food, g);
    const pulse = reduceMotion ? 0 : Math.sin(now / 260);
    const radius = g.cell * (0.24 + pulse * 0.03);
    const halo = ctx.createRadialGradient(food.x, food.y, radius * 0.2, food.x, food.y, g.cell * 3);
    halo.addColorStop(0, "rgba(255, 206, 110, 0.85)");
    halo.addColorStop(0.35, "rgba(255, 176, 70, 0.32)");
    halo.addColorStop(1, "rgba(255, 176, 70, 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(food.x, food.y, g.cell * 3, 0, Math.PI * 2);
    ctx.fill();

    const spin = reduceMotion ? 0.4 : now / 700;
    ctx.lineWidth = Math.max(1, g.cell * 0.045);
    ctx.strokeStyle = "rgba(255, 214, 140, " + (0.35 + pulse * 0.15) + ")";
    ctx.beginPath();
    ctx.arc(food.x, food.y, radius + g.cell * 0.34, spin, spin + 1.7);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 244, 210, 0.45)";
    ctx.beginPath();
    ctx.arc(food.x, food.y, radius + g.cell * 0.56, -spin * 0.8, -spin * 0.8 + 1.15);
    ctx.stroke();

    ctx.fillStyle = "#ffc14d";
    ctx.beginPath();
    ctx.arc(food.x, food.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.beginPath();
    ctx.arc(food.x - radius * 0.28, food.y - radius * 0.32, radius * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFx(g) {
    for (const w of waves) {
      const p = center(w, g);
      const radius = (1 - w.life) * g.cell * 2.6 + g.cell * 0.15;
      ctx.lineWidth = Math.max(1, g.cell * 0.06);
      ctx.strokeStyle = w.gold
        ? "rgba(255, 210, 130, " + (w.life * 0.55) + ")"
        : "rgba(255, 110, 90, " + (w.life * 0.6) + ")";
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const p of particles) {
      const at = center(p, g);
      ctx.fillStyle = p.gold
        ? "rgba(255, 214, 140, " + (p.life * 0.9) + ")"
        : "rgba(255, 120, 96, " + (p.life * 0.85) + ")";
      ctx.beginPath();
      ctx.arc(at.x, at.y, g.cell * p.size * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    if (!popups.length) return;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "650 " + Math.max(13, g.cell * 0.72) + "px \"Avenir Next\", \"Segoe UI\", sans-serif";
    for (const p of popups) {
      const at = center(p, g);
      ctx.fillStyle = "rgba(231, 255, 176, " + p.life + ")";
      ctx.fillText(p.text, at.x, at.y - (1 - p.life) * g.cell * 1.6);
    }
  }

  function drawImpact(g, now) {
    if (!state.crash) return;
    const p = clampToGrid(center(state.crash, g), g);
    const age = Math.max(0, now - state.deathAt);
    const u = reduceMotion ? 1 : Math.min(1, age / 520);
    ctx.fillStyle = "rgba(255, 90, 72, " + (0.4 * (1 - u * 0.75)) + ")";
    ctx.beginPath();
    ctx.arc(p.x, p.y, g.cell * (0.35 + u * 1.05), 0, Math.PI * 2);
    ctx.fill();
  }

  function applyCamera(now, focus) {
    let zoom = 1 + camera.kick;
    let ox = 0;
    let oy = 0;
    if (!reduceMotion && (state.mode === "over" || state.mode === "won")) {
      const u = Math.min(1, Math.max(0, (now - state.deathAt) / 900));
      const ease = 1 - Math.pow(1 - u, 3);
      zoom += 0.055 * ease;
      if (focus) {
        ox = (cssSize / 2 - focus.x) * 0.22 * ease;
        oy = (cssSize / 2 - focus.y) * 0.22 * ease;
      }
    } else if (!reduceMotion && state.mode === "ready") {
      zoom += 0.012 * (0.5 + 0.5 * Math.sin(now / 1200));
    }
    const jx = camera.shake ? (Math.random() - 0.5) * 2 * camera.shake : 0;
    const jy = camera.shake ? (Math.random() - 0.5) * 2 * camera.shake : 0;
    ctx.translate(cssSize / 2 + jx + ox, cssSize / 2 + jy + oy);
    ctx.scale(zoom, zoom);
    ctx.translate(-cssSize / 2, -cssSize / 2);
  }

  function drawVignette() {
    const shade = ctx.createRadialGradient(
      cssSize / 2,
      cssSize / 2,
      cssSize * 0.4,
      cssSize / 2,
      cssSize / 2,
      cssSize * 0.72
    );
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.4)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, cssSize, cssSize);
  }

  function drawFlash() {
    if (camera.flash < 0.02) return;
    const alpha = camera.flash * (camera.gold ? 0.2 : 0.34);
    ctx.fillStyle = camera.gold
      ? "rgba(255, 214, 150, " + alpha + ")"
      : "rgba(255, 86, 68, " + alpha + ")";
    ctx.fillRect(0, 0, cssSize, cssSize);
  }

  function draw(now) {
    if (!cssSize || !state.snake.length) return;
    const dpr = canvas.width / cssSize;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#080c0a";
    ctx.fillRect(0, 0, cssSize, cssSize);

    const t = glide();
    const g = geom();
    const points = buildPoints(g, t, now);
    const head = points[points.length - 1];
    const aim = heading(points);
    const headCellX = (head.x - g.originX) / g.cell - 0.5;
    const headCellY = (head.y - g.originY) / g.cell - 0.5;

    ctx.save();
    applyCamera(now, head);

    ctx.fillStyle = "#080c0a";
    ctx.fillRect(-cssSize, -cssSize, cssSize * 3, cssSize * 3);
    ctx.fillStyle = "rgba(214, 232, 214, 0.055)";
    fillCells(g, 0, 0, COLS - 1, ROWS - 1);

    const reach = 5;
    const x0 = Math.max(0, Math.floor(headCellX - reach));
    const x1 = Math.min(COLS - 1, Math.ceil(headCellX + reach));
    const y0 = Math.max(0, Math.floor(headCellY - reach));
    const y1 = Math.min(ROWS - 1, Math.ceil(headCellY + reach));
    ctx.save();
    ctx.beginPath();
    ctx.arc(head.x, head.y, g.cell * 5.5, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = "rgba(214, 232, 214, 0.075)";
    fillCells(g, x0, y0, x1, y1);
    ctx.restore();

    drawLamp(head, aim, g);
    if (!reduceMotion) {
      for (const bit of trail) {
        const at = center(bit, g);
        ctx.fillStyle = "rgba(190, 235, 150, " + (bit.life * 0.2) + ")";
        ctx.beginPath();
        ctx.arc(at.x, at.y, g.cell * 0.22 * bit.life, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (state.food) drawFood(g, now);
    drawSnake(points, g, now);
    drawFx(g);
    if (state.mode === "over") drawImpact(g, now);
    ctx.restore();

    drawVignette();
    drawFlash();
  }

  function decayCamera() {
    camera.shake *= 0.93;
    if (camera.shake < 0.2) camera.shake = 0;
    camera.kick *= 0.9;
    if (camera.kick < 0.001) camera.kick = 0;
    camera.flash *= 0.9;
    if (camera.flash < 0.02) camera.flash = 0;
  }

  function updateFx(dt) {
    const scale = dt / 16.7;
    for (const p of particles) {
      p.x += p.vx * scale;
      p.y += p.vy * scale;
      p.vy += 0.0025 * scale;
      p.life -= p.decay * scale;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const w of waves) w.life -= dt / 520;
    waves = waves.filter((w) => w.life > 0);
    for (const p of popups) p.life -= dt / 720;
    popups = popups.filter((p) => p.life > 0);

    if (reduceMotion) {
      trail = [];
      return;
    }
    for (const bit of trail) bit.life -= dt / 380;
    trail = trail.filter((bit) => bit.life > 0);
    if (state.mode !== "running" || !state.snake.length) return;
    const head = segment(0, glide());
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(last.x - head.x, last.y - head.y) > 0.06) {
      trail.push({ x: head.x, y: head.y, life: 1 });
    }
    if (trail.length > 18) trail.splice(0, trail.length - 18);
  }

  let clock = 0;

  function frame(now) {
    if (!clock) clock = now;
    const dt = Math.min(34, Math.max(0, now - clock));
    clock = now;

    if (state.mode === "running") {
      if (!state.last) {
        state.last = now;
      } else {
        const stepDt = now - state.last;
        state.last = now;
        if (stepDt > 0 && stepDt < 250) state.acc += stepDt;
        const ms = tickMs(state.score);
        let guard = 0;
        while (state.acc >= ms && state.mode === "running" && guard < 4) {
          state.acc -= ms;
          step();
          guard += 1;
        }
      }
    }

    if (state.holdOverlay && now - state.deathAt > 760) {
      state.holdOverlay = false;
      updateChrome();
    }

    decayCamera();
    updateFx(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  function onPadPointer(event) {
    const btn = event.target.closest("button");
    if (!btn || (event.button !== undefined && event.button !== 0)) return;
    event.preventDefault();
    const dir = DIRS[btn.dataset.dir];
    if (dir) input(dir[0], dir[1]);
  }

  pad.addEventListener("pointerdown", onPadPointer);
  pad.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    const dir = DIRS[btn.dataset.dir];
    if (dir) input(dir[0], dir[1]);
  });
  pad.addEventListener("contextmenu", (event) => event.preventDefault());

  board.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    if (board.setPointerCapture) board.setPointerCapture(event.pointerId);
  });

  function swipe(dx, dy) {
    if (Math.hypot(dx, dy) < 28) return;
    if (Math.abs(dx) > Math.abs(dy)) input(Math.sign(dx), 0);
    else input(0, Math.sign(dy));
  }

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag = null;
    swipe(dx, dy);
  }

  board.addEventListener("pointerup", endDrag);
  board.addEventListener("pointercancel", () => {
    drag = null;
  });

  let touchStart = null;
  board.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1) return;
    const t = event.touches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  board.addEventListener("touchmove", (event) => {
    if (touchStart) event.preventDefault();
  }, { passive: false });
  board.addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const t = event.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    swipe(dx, dy);
  }, { passive: true });
  board.addEventListener("touchcancel", () => {
    touchStart = null;
  });

  window.addEventListener("keydown", (event) => {
    const dir = KEYS[event.key];
    if (dir) {
      event.preventDefault();
      if (event.repeat) return;
      input(dir[0], dir[1]);
      return;
    }
    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      if (event.repeat) return;
      toggleSound();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      if (event.repeat) return;
      toggle();
    }
  });

  toggleBtn.addEventListener("click", toggle);
  restartBtn.addEventListener("click", restart);
  soundBtn.addEventListener("click", toggleSound);
  scoreEl.addEventListener("animationend", () => scoreEl.classList.remove("bump"));
  bestEl.addEventListener("animationend", () => bestEl.classList.remove("bump"));

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => resize());
    observer.observe(board);
  }
  window.addEventListener("resize", resize);

  fresh();
  state.mode = "ready";
  paintSound();
  updateChrome();
  resize();
  requestAnimationFrame(frame);
})();
