# Upgrade notes — v1.16

Append this section to `UPGRADE_NOTES.md`.

---

## v1.16 — The SDK comes in-house

### What changed

`APP_VERSION` and the header comment moved to `1.16`. The Owlbear SDK is bundled into
the file. There is no longer any network request on load, in either context.

### Why

Embedded mode was silently dead. The symptom was misleading: the modal opened, the
creator rendered, the import screen offered the local library, and edits persisted across
a close and reopen — so it looked like a working sheet that had merely forgotten which
character it was on. The persistence was `localStorage`, not the token. Nothing in the
module block was running at all.

The cause was the SDK import. v1.13 used a static `import` from esm.sh and worked. v1.14
made it a lazy `import()` behind a frame check to avoid fetching a CDN module for tab
users who would never need it. Either way the file depends, at runtime, on a third-party
script fetched from inside somebody else's iframe on somebody else's network. A Content
Security Policy, a corporate proxy, a CDN outage or being offline each take embedded mode
down, and each does it silently.

Bundling removes the dependency rather than working around it. From npm
`@owlbear-rodeo/sdk@3.1.0`, bundled with esbuild as minified ESM, with the trailing
`export{Zo as default}` replaced by `const OBR = Zo;` — an inline module cannot import
from itself, so the default export becomes a plain binding in the block's scope. That one
substitution is the only edit to published code.

This also restores what the lazy import was for. There is now no request at all, so a tab
user pays nothing, and the file works offline and from a downloaded copy — which the
static import had broken and the lazy import only partly fixed.

**To update the SDK:** `npm install @owlbear-rodeo/sdk@<version>`, bundle with esbuild
`--format=esm --minify`, swap the trailing export for `const OBR = Zo;`, and paste it over
the block. Verified there are no identifier collisions between the minified bundle and the
embedded block's own names.

Cost: the file grows from about 485 kB to 529 kB. One cached request, against a dependency
that could not be relied on.

### Also fixed: rolls were losing their Difficulty

The roll bridge was sending `diff: 0`, `pass: successes > 0` and `gain: 0` on every roll,
so a shared log entry from the sheet never matched one made in the roller popover.

This was a regression I introduced. The fix existed at v1.14, applied directly to the
derived file. When the build changed so that the beta is generated from a shared embed
block, the edit was not in the block and was overwritten on the next rebuild. The fix is
now in `embed-block.html`, which is the only place it can survive a rebuild.

Worth generalising: **anything patched into a generated file is lost.** Every edit belongs
in the source the generator reads.

### Verified

Tab, offline, with the real bundled SDK rather than a stub: zero network calls,
`OBR.isAvailable` false, no `obr-embedded` class, no header bar, import screen up, sheet
renders 15 sections, Difficulty control and click-to-roll present, Threat toasts without a
pool, Momentum still a plain field.

Embedded: character loaded from the token, header rendered, import screen hidden, Momentum
read from the room, Threat counter showing the room's value, a Momentum spend and an
Adrenaline Rush broadcast as `-2` and `+3`, a roll broadcast carrying its real Difficulty,
and the token written. The emitted code reparses with only `CP` changed.

### Still open

The two-player test is still not done. Everything so far has been one browser. Whether a
non-GM can write item metadata to their own token is the question that gates deleting
`sheet.js`, `sheet.css`, `sheet.html`, `rules.js` and `build-rules.mjs`.
