# MSL Independent League and Broadcast Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make MSL independent of fixed universities and refresh the existing OBS package into the same MSL Arena system.
**Architecture:** Continue using the current React/Vite data model and OBS browser-source routes. Derive participants from DB data, extend the application union, and skin existing OBS scenes rather than building a second broadcast system.
**Tech Stack:** React 18, TypeScript, Vite, CSS, PHP API, Node tests.
**Spec:** docs/superpowers/specs/2026-11-17-msl-independent-broadcast-design.md

## Tasks
- [ ] Replace the fixed-university homepage test with independent-league and dynamic-participant assertions; confirm it fails.
- [ ] Refactor `Home.tsx` and `arena.css` to use neutral league copy, dynamic organizations and three participation cards; make tests pass.
- [ ] Add failing registration tests for team, organization and free-agent modes.
- [ ] Extend `Register.tsx` and `types.ts` with an organization application shape while retaining old payloads; make tests pass.
- [ ] Add failing OBS tests for MSL palette, neutral branding and stinger primitives.
- [ ] Rebrand OBS components/styles and improve stinger timing/geometry; make tests pass.
- [ ] Run all tests and production build; commit website and broadcast work separately.
- [ ] Deploy atomically, run smoke/browser checks, fast-forward main, and sync GitHub only after successful production verification.
