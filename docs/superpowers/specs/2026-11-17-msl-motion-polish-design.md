# MSL Motion Polish Design

## Intent

Turn the current Moscow Student's League redesign into a coherent motion-led esports site without changing tournament data, API behavior, admin workflows, bracket logic, or consent semantics.

## Direction

Use the black/red/white PS2/PS3 poster language already deployed. Borrow interaction patterns from DesignBookmark Motion: scramble text, word roll, stat-card counting, magnetic buttons, tab-pill movement, and expand/reveal cards. Implement them in native React and CSS so no new runtime dependency is added.

## Goals

- Give the first screen a deliberate broadcast-style entrance.
- Animate content as it enters the viewport without hiding it from assistive technology.
- Add lightweight pointer parallax to the hero poster on precise-pointer devices.
- Count league statistics once when visible.
- Add roll/glitch/magnetic micro-interactions to navigation, brand and primary actions.
- Keep motion smooth on mobile and disable it under prefers-reduced-motion.
- Keep Twitch blocked until explicit functional consent.

## Non-goals

- No three.js, canvas, WebGL or animation library.
- No animation inside OBS scenes, bracket editing, admin forms or authentication.
- No fabricated tournament dates, games, teams or results.
- No redesign of the underlying information architecture in this release.

## Constraints

- React 18, TypeScript, existing Vite build.
- CSS transforms and opacity are preferred over layout-affecting properties.
- All content remains readable when JavaScript or IntersectionObserver is unavailable.
- Motion durations stay under 900ms except ambient poster drift.
- Small screens get simplified transforms; reduced-motion gets effectively static UI.

## Selected approach

Native motion primitives. A small MotionReveal component owns IntersectionObserver behavior, AnimatedNumber owns count-up behavior, and HeroMotion owns pointer parallax. CSS owns entrance choreography, roll links, magnetic hover, glitch accents, tab-pill movement and reduced-motion fallbacks.

The alternative was adding Motion for React, which would be convenient but unjustified for a handful of effects and would increase bundle size. A CSS-only approach was also considered but cannot reliably count statistics or start reveal effects only when visible.
