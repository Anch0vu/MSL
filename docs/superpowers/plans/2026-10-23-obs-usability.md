# OBS reliability and usability implementation plan

Goal: make the existing cup.rut-miit.su broadcast console predictable and responsive.
Architecture: retain React, existing API/authorization and blue/white broadcast graphics. Optimize snapshot delivery, fix scene defaults, and reorganize existing controls. Work directly in the existing non-Git source directory with an archived source backup; publish assets before index.html.

Reference lock: existing RUT blue (#0054b8), white surfaces, thin blue borders, existing sans/mono fonts. Refero online research unavailable (NO_SUBSCRIPTION); bundled motion/craft guides supply explicit feedback, 120ms control transitions, transform/opacity motion, visible keyboard focus. No new decorative assets or dependencies in production.

Decision ledger: Russian scene names and setup steps follow the user's clarity request; preview moves beside controls for simultaneous feedback; native details contain credentials/catalog to reduce density; demo/performance are explicit and never silently copied into broadcast URLs.

- [x] Reproduce lost Studio input after a server revision, timer/caster overrides in generated links, narrow preview clipping, unchanged DB renders and stale poll rollback. Add browser regressions using mocked API on localhost only; verify failures before edits.
- [x] Stabilize DataProvider reload (deduplicate pending requests and preserve identical snapshots); reject stale OBS poll responses after a local write and refresh on visibility return.
- [x] Share scene names/catalog; remove hard-coded timer/caster/tournament overrides; improve setup steps, scene cards, collapsible key management and live save feedback; keep role restrictions.
- [x] Preserve dirty editor input across unrelated updates; fix preview sizing using a viewport-sized iframe and Stage scaling; expose demo and FPS options with copy feedback and no debug data in normal OBS URLs.
- [x] Add aggregate frame pacing diagnostics (rolling display, total slow frames, worst frame) and inspect animated properties without disabling intended broadcast motion.
- [x] Run TypeScript/build, browser regressions, 1920x1080 scenes and narrow console QA. Compare headless frame timing under identical conditions; record limits (software browser measurements do not prove OBS capture/encoder FPS).
- [x] Publish only generated frontend assets/index/SW to primary web host; retain old assets and backup; confirm public HTTP assets and access restrictions. Secondary MaksPolo is an older replica; do not mix its different backend with primary source.

Review focus: unchanged revisions, stale in-flight requests, missing/revoked credentials, mobile preview fitting, unsaved forms during saves from another operator.

Completed: primary production frontend published; public page references index-Cx6mRiZY.js and index-BKbhoKmz.css. Thirteen production UI checks passed against the public site with local API fixtures; sixteen full development regressions passed. Invalid key returns actual HTTP 403. Group stage support added following user report, verified for four groups, empty stages and knockout demo.
