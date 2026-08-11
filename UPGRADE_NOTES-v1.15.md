# Upgrade notes — v1.15

Append this section to `UPGRADE_NOTES.md`.

---

## v1.15 — Threat reaches the table

### What changed

`APP_VERSION` and the header comment moved to `1.15`.

New function `addThreat(amount, reason)`. Every Threat change in the app now goes
through it. Standalone it shows a toast, which is all it ever did; embedded, the module
block replaces it to broadcast a `pool` event on the extension channel.

Wired to it:

- `useAdrenalineRush()` — 1/3/6 Threat for 1/2/3 Spirit. The amount was previously
  concatenated into the success toast; it is now a separate call.
- `useLimitedFeature('iKnowAGuy', 'threat')` — 2 Threat, held in `pendingThreat` and
  flushed only after `markLimitedFeatureUsed()` succeeds, so a feature that bails out
  partway does not push Threat for something that did not happen.

New `renderThreatCounter()` in the Resources grid, carrying `.obr-only` so it is present
in the DOM always and visible only when embedded.

### Why a funnel rather than two call sites

Threat appears in this file about thirty times, and nearly all of it is rules prose in
item and ability descriptions rather than a control the app drives: the Communicator's
message, the Tactical Lens signal, Combat Automed's self-revive, Nanobarrier's escalating
cost, several talents. Only two places are interactive.

Wiring those two and stopping would have left the other twenty-eight to be said out loud,
which is the problem this release exists to fix. So there are two mechanisms: the funnel
for the sources the app drives, and a manual +/− counter for everything printed in text.
The counter is the honest answer to a rules surface that is mostly prose.

The funnel also means a Threat source added later is wired in both contexts by calling
one function, rather than being wired standalone and forgotten embedded. That is the
mistake the v1.14 Momentum bridge made in the other direction.

### Not applied locally, unlike Momentum

The Momentum accessor applies the change immediately and then broadcasts, because the
player is spending their own resource and watching the counter respond. Threat waits for
the GM's metadata update. It is announced to the table rather than spent by the player,
the round trip is a few hundred milliseconds, and waiting keeps a single writer.

### Verified

Standalone: `addThreat` present, toast reads "Add 3 Threat — Adrenaline Rush", the Threat
counter is in the DOM but carries `.obr-only`, and no network call is made on load.

Embedded: the counter reads the room's Threat on open; Adrenaline Rush at 2 Spirit
broadcast `delta: 3`; the manual button broadcast `delta: 1`; a GM update setting Threat
to 9 flowed back to the counter; and Momentum was untouched by any of it.

### Still open

- Item `itemActions` carrying `resource: "threat"` are rendered as descriptive notes, not
  controls, so the Communicator and Tactical Lens still need the manual counter. Making
  them buttons is the natural follow-up.
- Nanobarrier's escalating Threat cost is still an unresolved ruling and is not wired.
