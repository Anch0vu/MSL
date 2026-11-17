# Moscow Student's League Production Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Rebrand the live tournament platform as Moscow Student's League with red/black PS2-era art direction, real cookie consent, four-university content, and no loss of existing functionality.

**Architecture:** Keep the React/Vite + PHP/MariaDB architecture. Add isolated presentation and consent components rather than rewriting tournament logic. Build to a staging directory, smoke-test it, then atomically sync static assets while preserving production API/data directories.

**Tech Stack:** React 18, TypeScript, Vite 5, CSS, PHP 8.3, MariaDB, Caddy.

**Spec:** docs/superpowers/specs/2026-11-17-msl-redesign-design.md

## Global Constraints
- Preserve all existing routes, API behavior, account/admin/OBS functions, and production data.
- Black/graphite canvas; red, white, and cool-grey accents; no purple primary palette.
- Respect prefers-reduced-motion and reduce expensive mobile effects.
- Do not load Twitch iframe before functional/external-media consent.
- The cupsid session remains strictly necessary.
- Backup source, live build, cup-data, Caddy config, and MariaDB before deployment.

## Review Focus
- Returning users without a consent cookie see the banner and no Twitch iframe.
- Users choosing necessary-only can still sign in and use tournament functions.
- Users can reopen settings and change their choice.
- Mobile navigation, bracket overflow, and forms remain usable at 360px width.
- Existing API, admin, OBS, and service worker routes survive the static deployment.

---

### Task 1: Backup and deployment guardrails

**Files:**
- Create: /var/backups/msl-<timestamp>/
- Create: scripts/deploy-msl.sh
- Test: scripts/smoke-msl.sh

- [ ] Capture source, public build, data, Caddy config, and database dump.
- [ ] Verify every archive and SQL dump is non-empty.
- [ ] Add a deployment script that preserves api/, data/, and operational config.
- [ ] Add HTTP smoke checks for index, assets, API db, manifest, and OBS.
- [ ] Run baseline smoke checks before changing code.

### Task 2: Brand system and responsive shell

**Files:**
- Modify: src/config.ts
- Modify: src/components/Layout.tsx
- Modify: src/styles/theme.css
- Create: src/styles/msl.css
- Create: public/brand/msl-current.jpg
- Modify: index.html
- Test: npm run build

- [ ] Add assertions for brand copy and required CSS tokens.
- [ ] Change the shell to MSL branding and add compact MSL wordmark.
- [ ] Implement black/red/white/grey tokens, print grain, pixel accents, focus states, and reduced-motion fallbacks.
- [ ] Integrate the current logo art in the hero while keeping text accessible.
- [ ] Build and verify TypeScript/Vite succeeds.

### Task 3: Homepage and four-university story

**Files:**
- Modify: src/pages/Home.tsx
- Modify: src/lib/types.ts only if needed
- Modify: public/data/db.json only through a validated migration
- Test: scripts/smoke-msl.sh and npm run build

- [ ] Add content assertions for all four universities and Moscow Student's League.
- [ ] Recompose hero, live match, statistics, university cards, schedule, results, and news without changing data interfaces.
- [ ] Seed four organizations and a new league tournament idempotently in production data without deleting existing tournaments.
- [ ] Build and confirm no old KИБЕРЛИГА/РУТ-only primary branding remains.

### Task 4: Real cookie consent and legal pages

**Files:**
- Create: src/lib/consent.ts
- Create: src/components/CookieConsent.tsx
- Modify: src/components/Twitch.tsx
- Modify: src/components/Layout.tsx
- Create: src/pages/Privacy.tsx
- Create: src/pages/Cookies.tsx
- Modify: src/main.tsx
- Test: tests/consent.cjs

- [ ] Write failing consent parsing/storage tests for missing, necessary-only, functional, malformed, and expired values.
- [ ] Implement versioned first-party consent cookie with SameSite=Lax and one-year lifetime.
- [ ] Gate Twitch iframes behind functional/external-media consent and show an enable action.
- [ ] Add Privacy and Cookies routes and a footer link that reopens settings.
- [ ] Run consent tests and build.

### Task 5: FAQ polish, production deploy, and rollback proof

**Files:**
- Modify: src/lib/faq.ts
- Modify: src/pages/Faq.tsx
- Modify: docs/production-msl.md
- Test: scripts/smoke-msl.sh

- [ ] Improve FAQ information hierarchy while keeping organizer Q&A and ask form.
- [ ] Build to staging and inspect generated assets/index references.
- [ ] Deploy static files while preserving api/data ownership and permissions.
- [ ] Reload Caddy only if configuration validation succeeds.
- [ ] Run public/local smoke checks and verify API write routes were not altered.
- [ ] Document and dry-run the exact rollback command without executing rollback.
