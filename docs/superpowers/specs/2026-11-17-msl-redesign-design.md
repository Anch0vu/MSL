# Moscow Student's League Redesign

## Intent
Rebrand the existing cup.rut-miit.su tournament platform as Moscow Student's League while preserving every working tournament, account, admin, OBS, FAQ, application, match, and API feature.

## Visual direction
A hybrid of broadcast esports and disciplined university editorial design. The supplied current logo is the primary art reference: near-black canvas, graphite panels, red/white/grey accents, oversized condensed type, print grain, restrained PS2/PS3-era dithering and chromatic offset. Effects are decorative and never reduce legibility.

## Content
The league brings together РУТ МИИТ, НИУ МГСУ, Финансовый университет при Правительстве РФ, and МГТУ им. Н. Э. Баумана. The existing square poster is used as hero/brand artwork; the header uses a compact MSL wordmark.

## Motion
Use CSS first and Motion for React only where layout/entry animation materially benefits. Include scramble/reveal, restrained hover jitter, live indicators, and bracket transitions. Respect prefers-reduced-motion and keep mobile effects lighter.

## Cookies and privacy
The PHP cupsid session cookie is strictly necessary. Theme and internal UI preferences are functional storage. Third-party Twitch embeds are blocked until functional/external-media consent. Consent is stored in a real first-party SameSite=Lax cookie and can be changed from the footer. Add editable Privacy and Cookies pages; rules remain replaceable later.

## Constraints
Deploy on host web from /opt/cup-src to /var/www/cup. Preserve /var/www/cup-data, MariaDB, API config, OBS endpoints, routes, and PWA behavior. Take a complete timestamped backup and database dump before deployment.