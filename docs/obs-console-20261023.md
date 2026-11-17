# OBS console update — 2026-10-23

Scope: primary cup.rut-miit.su on host web. Frontend changes only; API permissions and official result publishing roles retained. Source has no Git repository. Backup: /var/backups/cup/obs-usability-20261023/source.tgz plus previous production index.html and sw.js. Old hashed assets are retained for rollback.

Changes:
- OBS bracket scene now renders the current group stage (four groups A–D) using the same standings component/calculation as the tournament page. Knockout and demo brackets still render. Missing stages produce an explicit empty state.
- Named scene library, setup steps, collapsible device keys, side-by-side responsive preview. Normal scene links follow console state instead of pinning timer, casters and tournament. Preview-only demo/FPS options never enter normal copied URLs.
- Identical DB snapshots preserve consumers; reload requests are deduplicated. Temporary refresh failures preserve the last good scene. Stale OBS GET responses cannot undo a newer successful save; visibility/online resumes refresh.
- Editable Studio/Break values reconcile server updates per field while retaining local edits. Explicit successful break reset clears local drafts. Shared-write revision protection remains enabled.
- FPS diagnostics show current rAF rate, cumulative >25ms frames, worst frame and elapsed sampling time. This measures browser rendering, not OBS capture/encoding.

Validation:
- TypeScript and Vite production build passed.
- 16 browser regressions passed on localhost with a mocked API, including dirty+remote caster updates, reset, network outage, stale poll, copying links, 390px console, denied sources, groups, empty stages, knockout fitting.
- Production build browser checks passed (13 UI checks; the three source-level harness tests run against Vite development).
- 1920x1080 headless Chromium sampling: intro 60 FPS / 0 slow frames; veto 59 / 6; draft 60 / 0; HUD 60 / 0; stinger 60 / 1; starting 60 / 0, eight seconds each. These are a smoke measurement on a software-rendered server browser, not proof of OBS hardware FPS. Prior snapshot was already mostly 59–60, so no large FPS improvement is claimed.
- Independent review found two P2 issues (whole-object dirty draft overwrites remote fields; reset retains local text); both received failing regressions and fixes, then green suite.
- Refero online reference tools returned NO_SUBSCRIPTION; retained existing RUT blue/white system and used bundled craft/motion guidance. No production dependencies added.

Rollback: restore previous index.html and sw.js together from the backup; old hashed assets remain available. Source archive includes src/docs/public before changes. No DB migration or result changes occurred.

Published successfully. Public-site frontend UI checks: 13/13 passed with intercepted test data; actual invalid OBS key endpoint returns HTTP 403. New primary assets: index-Cx6mRiZY.js, index-BKbhoKmz.css.
