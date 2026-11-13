(() => {
  "use strict";

  const COLS = 21;
  const ROWS = 21;
  const BASE_MS = 180;
  const MIN_MS = 70;
  const STEP_MS = 3.5;
  const MAX_SCORE = COLS * ROWS - 3;
  const STORAGE_KEY = "snake-high-score";

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
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const toggleBtn = document.getElementById("toggle");
  const restartBtn = document.getElementById("restart");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const bestStat = document.getElementById("best-stat");
  const pad = document.getElementById("pad");
  const live = document.getElementById("live");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = {
    snake: [],
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
  };

  let cssSize = 0;
  let drag = null;

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

  function announce(message) {
    live.textContent = "";
    live.textContent = message;
  }

  function paintScore(bump) {
    scoreEl.textContent = String(state.score);
    bestEl.textContent = String(state.best);
    bestStat.classList.toggle("is-record", state.best > 0);
    document.title = state.score > 0 ? `Snake · ${state.score}` : "Snake";
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
      if (first) announce(`New best, ${n}.`);
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
      updateChrome();
      announce(`You filled the board. Score ${state.score}.`);
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

  function fresh() {
    const x = Math.floor(COLS / 2);
    const y = Math.floor(ROWS / 2);
    state.snake = [
      { x, y },
      { x: x - 1, y },
      { x: x - 2, y },
    ];
    state.dir = { x: 1, y: 0 };
    state.queue = [];
    state.score = 0;
    state.crash = null;
    state.record = false;
    state.reason = "";
    state.acc = 0;
    state.last = 0;
    board.classList.remove("is-over");
    placeFood(6);
  }

  function updateChrome() {
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
      overlayText.textContent = `${why} Score ${state.score} · Best ${state.best}.${extra}`;
      toggleBtn.textContent = "Play again";
    } else if (state.mode === "won") {
      overlay.hidden = false;
      overlayTitle.textContent = "Board clear";
      overlayText.textContent = `You filled every cell. Score ${state.score} · Best ${state.best}.`;
      toggleBtn.textContent = "Play again";
    } else {
      overlay.hidden = false;
      overlayTitle.textContent = "Ready";
      overlayText.textContent = "Eat the dot. Avoid the walls and your tail.";
      toggleBtn.textContent = "Start";
    }
    paintScore(false);
  }

  function start() {
    if (state.mode !== "ready") return;
    state.mode = "running";
    state.acc = 0;
    state.last = 0;
    updateChrome();
  }

  function pause() {
    if (state.mode !== "running") return;
    state.mode = "paused";
    updateChrome();
    announce("Paused");
  }

  function resume() {
    if (state.mode !== "paused") return;
    state.mode = "running";
    state.acc = 0;
    state.last = 0;
    updateChrome();
  }

  function restart() {
    fresh();
    state.mode = "running";
    updateChrome();
    announce("New game");
  }

  function toggle() {
    if (state.mode === "ready") start();
    else if (state.mode === "running") pause();
    else if (state.mode === "paused") resume();
    else restart();
  }

  function flashPad(x, y) {
    const name = y === -1 ? "up" : y === 1 ? "down" : x === -1 ? "left" : x === 1 ? "right" : "";
    const btn = name && pad.querySelector(`[data-dir="${name}"]`);
    if (!btn) return;
    btn.classList.add("is-on");
    window.setTimeout(() => btn.classList.remove("is-on"), 120);
  }

  function input(x, y) {
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

  function endGame(reason, cell) {
    state.mode = "over";
    state.reason = reason;
    state.queue = [];
    const inside = cell && cell.x >= 0 && cell.y >= 0 && cell.x < COLS && cell.y < ROWS;
    state.crash = inside ? cell : null;
    board.classList.add("is-over");
    updateChrome();
    const why = reason === "wall" ? "Hit a wall" : "Hit yourself";
    announce(`${why}. Score ${state.score}.`);
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
    state.snake.unshift(next);
    if (willEat) {
      setScore(state.score + 1);
      if (state.mode !== "running") return;
      placeFood(0);
    } else {
      state.snake.pop();
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

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  function draw(now) {
    if (!cssSize) return;
    const dpr = canvas.width / cssSize;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = geom();

    ctx.fillStyle = "#0c1210";
    ctx.fillRect(0, 0, cssSize, cssSize);

    const gap = Math.max(1.5, g.cell * 0.1);
    const tile = g.cell - gap;
    const radius = Math.min(5, tile * 0.28);
    ctx.fillStyle = "rgba(214, 232, 214, 0.045)";
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) {
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

    const shade = ctx.createRadialGradient(
      cssSize / 2,
      cssSize / 2,
      cssSize * 0.2,
      cssSize / 2,
      cssSize / 2,
      cssSize * 0.72
    );
    shade.addColorStop(0, "rgba(0, 0, 0, 0)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0.28)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, cssSize, cssSize);

    if (state.snake.length) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 3;
      const tail = center(state.snake[state.snake.length - 1], g);
      const head = center(state.snake[0], g);
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      for (let i = state.snake.length - 2; i >= 0; i -= 1) {
        const point = center(state.snake[i], g);
        ctx.lineTo(point.x, point.y);
      }
      ctx.lineWidth = g.cell * 0.8;
      ctx.strokeStyle = "rgba(0, 0, 0, 0.28)";
      ctx.stroke();
      let color = "#8fe06a";
      if (head.x !== tail.x || head.y !== tail.y) {
        const gradient = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
        gradient.addColorStop(0, "#1d7a46");
        gradient.addColorStop(0.72, "#8fe06a");
        gradient.addColorStop(1, "#d7f58a");
        color = gradient;
      }
      ctx.shadowColor = "transparent";
      ctx.lineWidth = g.cell * 0.68;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "#d7f58a";
      ctx.beginPath();
      ctx.arc(head.x, head.y, g.cell * 0.36, 0, Math.PI * 2);
      ctx.fill();

      if (g.cell >= 12) {
        const sideX = -state.dir.y;
        const sideY = state.dir.x;
        const fx = state.dir.x * g.cell * 0.1;
        const fy = state.dir.y * g.cell * 0.1;
        const spread = g.cell * 0.13;
        for (const sign of [-1, 1]) {
          const ex = head.x + fx + sideX * spread * sign;
          const ey = head.y + fy + sideY * spread * sign;
          ctx.fillStyle = "#102117";
          ctx.beginPath();
          ctx.arc(ex, ey, g.cell * 0.065, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
          ctx.beginPath();
          ctx.arc(ex - g.cell * 0.02, ey - g.cell * 0.02, g.cell * 0.02, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    if (state.food) {
      const food = center(state.food, g);
      const pulse = reduceMotion ? 0 : Math.sin(now / 260);
      const radiusFood = g.cell * (0.2 + pulse * 0.03);
      ctx.save();
      ctx.shadowColor = "rgba(255, 193, 77, 0.9)";
      ctx.shadowBlur = g.cell * 0.55;
      ctx.fillStyle = "#ffc14d";
      ctx.beginPath();
      ctx.arc(food.x, food.y, radiusFood, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
      ctx.beginPath();
      ctx.arc(food.x - radiusFood * 0.32, food.y - radiusFood * 0.32, radiusFood * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.crash) {
      const crash = center(state.crash, g);
      ctx.fillStyle = "rgba(255, 107, 90, 0.38)";
      ctx.beginPath();
      ctx.arc(crash.x, crash.y, g.cell * 0.46, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function frame(now) {
    if (state.mode === "running") {
      if (!state.last) {
        state.last = now;
      } else {
        const dt = now - state.last;
        state.last = now;
        if (dt > 0 && dt < 250) state.acc += dt;
        else state.acc = 0;
        const ms = tickMs(state.score);
        let guard = 0;
        while (state.acc >= ms && state.mode === "running" && guard < 4) {
          state.acc -= ms;
          step();
          guard += 1;
        }
      }
    }
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
    if (event.code === "Space") {
      event.preventDefault();
      if (event.repeat) return;
      toggle();
    }
  });

  toggleBtn.addEventListener("click", toggle);
  restartBtn.addEventListener("click", restart);
  scoreEl.addEventListener("animationend", () => scoreEl.classList.remove("bump"));

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(() => resize());
    observer.observe(board);
  }
  window.addEventListener("resize", resize);

  fresh();
  state.mode = "ready";
  updateChrome();
  resize();
  requestAnimationFrame(frame);
})();
