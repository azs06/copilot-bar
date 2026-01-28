# Repository Guidelines

## Project Structure

- `src/main/`: Electron main process (menubar app), IPC handlers, Copilot tool wiring, SQLite persistence (`sql.js`), screenshot capture/upload.
- `src/renderer/index.html`: Renderer UI (vanilla HTML/CSS/JS) that talks to the main process via `ipcRenderer`.
- `assets/`: App/menu bar icons and static assets copied into builds.
- `dist/`: Build output (generated). This is gitignored and produced by `npm run build`.
- `.env.example`: Optional S3-compatible config for screenshot uploads (e.g., Cloudflare R2 / AWS S3).

## Build, Test, and Development Commands

- `npm install`: Install dependencies.
- `npm run build`: Compile TypeScript with `tsc` and copy `src/renderer/index.html` + `assets/` into `dist/`.
- `npm start`: Build, then launch Electron (`electron .`).
- `npm run dev`: Same as `start` today (no watch mode).
- `npm run copy-html`: Re-copy renderer HTML and `assets/` into `dist/` (useful when only UI changes).

## Coding Style & Naming Conventions

- TypeScript: 2-space indentation, semicolons, and ESM (`"type": "module"`).
- Keep `tsconfig.json` `strict: true` clean; treat `npm run build` as the baseline quality gate.
- With `moduleResolution: NodeNext`, keep local import specifiers consistent with the repo (e.g., `./database.js` in TypeScript so runtime ESM resolves correctly).
- Prefer descriptive filenames in `kebab-case` and exported symbols in `PascalCase`/`camelCase` as appropriate.

## Testing Guidelines

- No automated test runner is configured yet.
- For changes, include a short manual smoke-test checklist in your PR (e.g., `npm start` → open menu bar → chat → settings save/load → screenshot capture if relevant).

## Commit & Pull Request Guidelines

- Commit messages in history are short and descriptive (often lowercase, e.g., “added …”). Keep the subject concise and scoped (optionally: `<area>: <summary>`).
- PRs should include: a clear description, any linked issues, and screenshots/GIFs for UI changes.
- If you change configuration, update `.env.example` and document new variables in `README.md`.

## Security & Configuration Notes

- Do not commit `.env` files; use `.env.example` as the template (`cp .env.example .env`).
- Local app state is stored under `~/.copilot-bar/` (including `copilot-bar.db`); mention migrations/changes in PRs when applicable.
