# MSL Arena Mobile-First Design

**Approved direction:** C — MSL Arena.

## Goal
Turn the existing red recolor into a serious mobile-first esports product: brand identity first, match utility immediately after it, and dense but readable tournament information.

## Homepage hierarchy
1. Compact MSL header with one clear menu action.
2. Editorial season hero: "Университеты выходят на арену".
3. Four participating universities in a horizontal rail.
4. Next/live match center using real tournament data.
5. Compact three-value league statistics.
6. Tournament rail and recent-result rail.
7. Stream, news, highlights, partners and application CTA below the primary sports content.

## Visual system
- Background #070707, panel #111217, border #30323a, accent #e31b23, white #f4f4f2.
- Square/angled geometry instead of rounded dashboard cards.
- PS2/PS3 texture and glitch motion only in hero artwork, transitions and campaign surfaces.
- Data surfaces stay clean and legible.
- Mobile bottom navigation for Home, Matches, Tournaments and Menu.

## Responsive behavior
- 360–430 px is the primary layout.
- No clipped tabs or horizontal page overflow.
- Stats always stay in three equal columns with labels below values.
- Cards collapse to one column; secondary content uses horizontal rails when useful.
- Footer becomes a compact disclosure/link layout rather than a long two-column wall.

## Accessibility and performance
- Preserve reduced-motion behavior.
- Keep every action keyboard reachable and labelled.
- No new runtime animation dependency.
- Reuse live API/data model and existing cookie consent behavior.
