# MSL Arena Homepage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved C / MSL Arena mobile-first homepage and navigation without changing tournament, account, admin or consent behavior.

**Architecture:** Recompose the existing Home page from the same DB provider into an arena hero, primary match center, compact metrics and content rails. Add a focused arena stylesheet after the existing theme so the change is isolated and reversible.

**Tech Stack:** React 18, TypeScript, React Router, Vite, CSS, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-17-msl-arena-design.md`

## Global Constraints
- Preserve all existing routes and API data.
- Preserve real cookie consent and reduced-motion behavior.
- Primary responsive target is 360–430 px.
- Use no new runtime dependency.
- Keep deployment atomic and rollback-capable.

## Review Focus
- Empty upcoming-match data must show a useful fallback.
- Empty tournament/result collections must not leave broken panels.
- Long university/team names must not cause page overflow.
- Mobile navigation must not obscure content.
- Reduced-motion users must receive the same information without animation.

---

### Task 1: Arena contract and mobile layout

**Files:**
- Create: `tests/arena-layout.test.mjs`
- Modify: `package.json`
- Modify: `src/pages/Home.tsx`
- Create: `src/styles/arena.css`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: `useDB()`, `allMatches(db)`, existing tournament and match links.
- Produces: arena hero, match center, compact stats and content rails.

- [ ] Write the arena structure/mobile contract test.
- [ ] Run it and verify failure because arena structure and stylesheet do not exist.
- [ ] Recompose Home and add responsive arena CSS.
- [ ] Import the stylesheet and add the test to the default suite.
- [ ] Run the arena test and full suite.

### Task 2: Compact application shell

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/styles/arena.css`

**Interfaces:**
- Consumes: existing router paths and menu state.
- Produces: compact mobile header, bottom navigation and reduced footer.

- [ ] Extend the failing test with mobile shell expectations.
- [ ] Verify the new assertions fail.
- [ ] Implement bottom navigation and compact mobile footer rules.
- [ ] Run the arena test and full suite.

### Task 3: Build, visual verification and production release

**Files:**
- Modify: `public/sw.js` only if cache key must change.
- Use: `scripts/deploy-msl.sh`, `scripts/smoke-msl.sh`

**Interfaces:**
- Consumes: successful build in `dist/`.
- Produces: atomic live deployment with rollback path.

- [ ] Run tests and production build.
- [ ] Inspect desktop and 360–430 px layouts.
- [ ] Deploy atomically.
- [ ] Run smoke checks and verify public cache headers/assets.
- [ ] Commit release and synchronize the curated source to GitHub.
