# Dreams & Machines — Rolls

An Owlbear Rodeo extension for Dreams & Machines: shared Skill Tests, a Rolls and Actions
log that survives refreshes and rejoins, shared Momentum and Threat counters, GM table
controls, a GM party panel, and full character sheets imported from the character creator.

There is no build step. No Node, no npm, no terminal. Static files pushed to a GitHub repo
with Pages turned on.

---

## Setup

### 1. Make the repo

The repo is `GSGrimoire/dnm-obr` and it is already public with Pages deployed. The name
does not matter to Owlbear at all, it only has to match the URLs in the manifest, which
it now does.

Upload all files to the root of it:

```
manifest.json      background.html    icon.svg
index.html         background.js      icon-attach.svg
roller.js          dnm.js             icon-sheet.svg
style.css          sdk.js
```

`sdk.js` is the vendored Owlbear SDK, added in 0.9.1. It is committed rather than
built — see **Third-party code** below for why it is not fetched at runtime.

`sheet.html`, `sheet.js`, `sheet.css`, `rules.js` and `build-rules.mjs` were the
duplicate-sheet approach and were **deleted at 0.7.0**, when the modal switched to
opening the published character creator instead. This list was stale until 0.9.0.
Nothing should reintroduce a local sheet page.

You can drag them into the GitHub web uploader. Nothing needs installing locally.

### 2. Pages

Already on. Check this loads in a browser tab:

```
https://gsgrimoire.github.io/dnm-obr/index.html
```

You should see the roller with a "Standalone preview" note at the bottom. It rolls dice
locally so you can check the layout and the maths before touching Owlbear.

### 3. The manifest URLs

Already filled in for `gsgrimoire.github.io/dnm-obr`. Nothing to edit.

They are absolute URLs on purpose. Owlbear resolves a leading-slash path against the site
root, which on a GitHub project page is `gsgrimoire.github.io`, not the repo folder.
Absolute URLs sidestep that. If the repo is ever renamed, these two lines are the only
thing that has to change.

### 4. Install it in Owlbear

In your Owlbear Rodeo profile, click **Add Extension** and paste:

```
https://gsgrimoire.github.io/dnm-obr/manifest.json
```

Then create a room, or open an existing one, and enable the extension. A d20 icon appears
top-left. Click it.

---

## The edit loop

Change a file in the GitHub web editor, commit, wait about thirty seconds for Pages to
rebuild, then reload the Owlbear tab. If a change does not appear, it is almost always
browser cache: hard-reload with Ctrl+Shift+R, or Cmd+Shift+R on a Mac.

---

## How it works

Rolls and pools live in Owlbear's **room metadata**, which Owlbear syncs to everyone and
keeps between sessions. That is why the log survives a refresh and why someone joining
late still sees it. It also means we never write networking code.

Room metadata is capped at 16 kB across every extension installed in the room, so the log
trims itself to the most recent 40 entries and then trims further by size if needed.

**Hidden rolls** are never written to room metadata at all. They exist only in the GM's
open panel for that session, so a player cannot dig them out of devtools. The tradeoff is
that closing the panel discards them.

**Permissions**: only the GM sees the Hidden toggle, the Clear button and the table
controls, and only the GM can change Threat. Anyone can change Momentum — it is the
group's pool.

Until 0.9.1 all of that was enforced only in the panel. This paragraph used to say that
made it "a convenience rather than a security boundary", which was fair when the
privileged actions were Hidden, Clear and Threat, and stopped being fair in 0.8.0 when
table controls arrived. A panel check runs in the sender's own tab, and `OBR.broadcast`
is open to every client in the room by design, so a player never had to defeat the
check — they could call `OBR.broadcast.sendMessage` directly and skip the function
holding it. A forged rest reaches every attached character, including players who are
offline, and cannot be undone.

Since **0.9.1** the GM's background page — the only writer of room metadata — checks
the sender's connection id against the room's GMs before applying an `epoch`, a
`clear`, or a Threat change. The panel checks remain, because they stop accidents, but
they are no longer the only thing standing there.

Still deliberately open: a client can post a roll or an action entry under any name.
The log is a shared record, not evidence.

**Third-party code**: the Owlbear SDK is vendored as `sdk.js` rather than imported from
esm.sh at runtime. An ES module import cannot carry an integrity hash, so anything that
host served would have run in the room with full access to every character at the
table. The character creator has bundled its own copy since v1.14 for the same reason.

**Concurrency**: two people rolling at the exact same instant can have one overwrite the
other. At a five-person table this is rare enough to ignore.

---

## The rules it implements

Taken directly from `classifyDie()` in the character creator, which is published as
`index.html` at `gsgrimoire.github.io/dnm-cc/`, so the extension and the creator can never
disagree. (This paragraph named `dnm-character-creator.html` until 0.9.0. That file was a
v1.13 spike, was never the deployed sheet, and no longer exists.)

- A natural 20 is a Complication and nothing else
- A die at or under the **Skill** value is a Critical, worth 2 successes
- A die at or under the **Attribute** value is 1 success
- Anything else does nothing
- Successes beyond the Difficulty become Momentum

The target number is the Attribute on its own. The Skill sets the critical range rather
than adding to the target. The order matters: 20 is checked first, so a natural 20 can
never also count as a success.

One quirk inherited from the creator: if a Skill value is ever higher than the Attribute
value, dice between the two count as Criticals. Probably never comes up in play, but the
extension behaves the same way the creator does rather than silently diverging.

Exhaustion **is** modelled, from creator v1.12 onward: the snapshot carries the exhaustion
table, `shutDownAttrs()` in `dnm.js` reads it against the character's `activeExhaustion`,
and the selected-character banner names any shut-down Attributes. This paragraph said the
opposite until 0.9.0.


---

## Character sheets

Select a token and use its context menu. A token with no character attached offers
**Attach D&M character**; paste a code exported from the creator (v1.11 or newer) and it
becomes that character. After that the same menu offers **Open D&M sheet**.

The token's metadata holds the character's DM1 code and nothing else. Everything on the
sheet is derived from it and every edit rewrites it, so the code you copy back at end of
session is always current. Writes are debounced.

Only fields whose shape was verified against the creator's source are edited: the
`current*` resource numbers, injuries, truths, and the equipped and discharged flags on
items. Every other segment of the code is preserved byte for byte, which is what makes
the round trip lossless. `activeExhaustion` is deliberately left alone because it holds
keys into a rules table the snapshot does not carry yet.

### Round trip

Creator → export code → **Attach** to a token → play → **Copy code for creator** →
paste back into the creator. Spirit spent, injuries taken, truths written and gear
discharged all come back with it.

### Rolling from the sheet

Click an attribute and a skill to select them, set dice and difficulty, and roll. The
result lands in the same shared log the roller popover shows. Dice beyond the first two
cost one Spirit each and are deducted automatically; the button disables if the character
cannot pay.

### Momentum

The creator's per-character Momentum is bound to the **room** pool when the sheet runs
inside Owlbear, so there is one shared number rather than two competing ones. In a plain
browser tab it stays private to that character.

---

## Table controls and the party panel (GM only)

**Table Controls** (0.8.0) push a rest or a scene boundary to every attached character by
incrementing a counter in room metadata. Each sheet catches up the next time it is opened,
which is what makes it work for the sheets that are closed — at any moment, nearly all of
them. Buttons arm on the first press and send on the second.

**Party** (0.9.0) answers the question those buttons leave open: you pressed Bed, but who
actually got it? It lists every character on a token in the scene with their Spirit and one
of three states:

- **Caught up** — level with the room.
- **Behind** — has not applied a boundary the table has passed. The row names which one.
- **Not synced** — has never met this room. A newly built or newly attached character reads
  this way and is **not** behind: it has nothing to catch up on, and its first sheet open
  adopts the room's position without applying anything.
