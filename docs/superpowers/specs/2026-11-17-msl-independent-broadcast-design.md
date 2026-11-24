# MSL Independent League + Broadcast Refresh Design

## Intent
Keep Moscow Student's League as an independent esports league. Universities, clubs, teams and players are participants in a season or tournament, never permanent owners of the MSL identity.

## Website
- Hero copy describes MSL as an independent student esports league.
- No university names are hard-coded into the permanent brand area.
- The participant rail is populated from `db.orgs` and gracefully falls back to a neutral league message.
- Participation has three clear routes: team application, organization partnership, and free-agent application.
- Current match, tournaments, results, news, partners and cookie behavior stay data-driven.
- Mobile keeps the compact bottom navigation and no horizontal page overflow.

## Registration
- Extend application kind with `organization`.
- The organization form collects name, short name, kind, site, contact and description.
- Existing team and player flows remain compatible.
- API submissions still use the existing `apply` endpoint; unsupported server behavior must fail visibly rather than fake success.

## Broadcast package
- Rebrand existing 1920x1080 OBS browser-source scenes from legacy blue to MSL black/red/white.
- Keep scenes discipline-neutral unless a scene is inherently game-specific (CS2 veto, Dota draft).
- Preserve live data, director controls, transparency and reduced-motion support.
- Refresh the stinger as an MSL-owned interpretation of CCT's fast geometric broadcast language: diagonal wipes, logo lockup, red scan sweep and a safe cut point.
- Do not copy CCT logos, typography or proprietary assets.

## Validation
- Source tests reject hard-coded university identity.
- Tests require all three participation routes.
- OBS tests require MSL palette and transition primitives.
- Full tests, TypeScript build, production smoke and browser QA must pass.
