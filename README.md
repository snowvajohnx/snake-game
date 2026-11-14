# Snake

A classic Snake game in plain HTML, CSS, and JavaScript. Open `index.html` in a browser — there is no build step. The same files sit at the repository root, so GitHub Pages can serve them from the `main` branch.

The snake glides across a dark grid and grows each time it eats a dot. The run ends if it hits a wall or its own body. The pace starts calm and picks up a little with every point. Your best score is saved in this browser.

## How to play

- **Start** with the Start button, Space, or any direction.
- **Move** with the arrow keys or WASD. On a phone, swipe the board or use the on-screen pad.
- **Pause** with the Pause button or Space. Resume the same way.
- **Restart** with the Restart button. After a game over, Play again, Restart, or a direction key starts a new run.
- **Sound** with the speaker button or the M key. It stays off until you turn it on, and this browser remembers the choice.
- Eat the gold dot to grow. Avoid the walls and your tail. The snake glides between cells, and a crash holds for a short beat before the title card.

## GitHub Pages

Static files live at the repository root (`index.html`, `styles.css`, `game.js`), with a `.nojekyll` file so Pages serves them as-is. To publish: **Settings → Pages → Deploy from a branch → `main` → `/ (root)`**. The game is then available at `https://<owner>.github.io/<repo>/`.
