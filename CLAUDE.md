# Arachnid Origins: notes for contributors and agents

## Every code change bumps the version

Any change to the game (`src/`, `index.html`, or the built `dist/`) must ship with a version bump and a changelog entry. Run:

    node tools/bump.js <major|minor|patch> "what changed" ["another change" ...]

- **major**: breaking or save-incompatible changes
- **minor**: new features or content
- **patch**: bug fixes and small tweaks

It updates `package.json`, `package-lock.json`, `VERSION` and `CHANGELOG` in `src/core.js` and rebuilds `dist/arachnid-origins.html`.
Write the notes for players: they appear in Settings > Changelog. Don't edit those files by hand.

`node tools/check_version.js origin/main` verifies this (CI runs it on every PR and fails when code changed without a bump). Docs-only or
test-only changes don't need a bump. Run it before pushing.

## Other conventions

- After changing anything in `src/`, rebuild with `node tools/build.js` (`dist/` is committed).
- Each feature or fix gets a `tools/test_*.js` script (headless, via `tools/harness.js`).
