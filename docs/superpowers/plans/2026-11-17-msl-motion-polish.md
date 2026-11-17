# MSL Motion Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a coherent, performant motion layer to the deployed MSL site and release it safely to production.

**Architecture:** Create focused React motion primitives and compose them only into public-facing layout/home components. Keep all animation styling in a dedicated stylesheet loaded after the brand stylesheet.

**Tech Stack:** React 18, TypeScript, CSS transforms/animations, IntersectionObserver, requestAnimationFrame.

**Spec:** docs/superpowers/specs/2026-11-17-msl-motion-polish-design.md

## Global Constraints

- No new runtime dependency.
- Do not change API, database, consent, OBS, bracket, admin or auth behavior.
- Respect prefers-reduced-motion and precise-pointer capability.
- Content must remain visible if browser APIs are unavailable.

## Review Focus

- IntersectionObserver unavailable: content is immediately visible.
- StrictMode effect re-runs: observers and animation frames clean up correctly.
- Reduced motion: no parallax, counting or reveal delay.
- Mobile/touch: no pointer tracking and no overflow caused by transforms.
- Route changes: public page content receives a fresh subtle entrance without trapping focus.

---

### Task 1: Motion primitives

**Files:**
- Create: src/components/Motion.tsx
- Test: tests/motion.test.mjs

**Interfaces:**
- Produces: MotionReveal, AnimatedNumber, HeroMotion and MotionRouteFrame.

- [ ] Write a failing structural test for the primitives, IntersectionObserver fallback, reduced-motion check and cleanup.
- [ ] Run npm test and verify failure.
- [ ] Implement the primitives with accessible unchanged text.
- [ ] Run npm test and verify pass.

### Task 2: Public composition and visual language

**Files:**
- Modify: src/pages/Home.tsx
- Modify: src/components/Layout.tsx
- Modify: src/main.tsx
- Create: src/styles/motion.css
- Test: tests/motion.test.mjs

**Interfaces:**
- Consumes: MotionReveal, AnimatedNumber, HeroMotion and MotionRouteFrame.

- [ ] Add failing assertions for hero choreography, motion classes, reduced-motion and pointer-capability fallbacks.
- [ ] Run npm test and verify failure.
- [ ] Compose motion primitives into the hero, tiles, stats, public sections and route frame.
- [ ] Add CSS for reveal, poster parallax, word roll, magnetic actions, active tab pill, ambient grain/glitch and mobile fallbacks.
- [ ] Run npm test and npm run build.

### Task 3: Release and production proof

**Files:**
- Modify: docs/production-msl.md only if release instructions change.

- [ ] Commit the motion release on feat/msl-redesign.
- [ ] Run complete test, build, PHP syntax, OBS and smoke suites.
- [ ] Deploy atomically with scripts/deploy-msl.sh and keep the generated rollback directory.
- [ ] Visually verify desktop and mobile-sized layouts, initial motion, reduced-motion CSS and cookie/Twitch gating.
- [ ] Fast-forward main after production verification and report the commit and rollback path.
