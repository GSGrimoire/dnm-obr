# Dreams & Machines — Rolls

An Owlbear Rodeo extension: shared 2d20 rolls, a roll log that survives refreshes and
rejoins, and shared Momentum and Threat counters.

There is no build step. No Node, no npm, no terminal. Five static files pushed to a
GitHub repo with Pages turned on.

---

## Setup

### 1. Make the repo

The repo is `GSGrimoire/dnm-obr` and it is already public with Pages deployed. The name
does not matter to Owlbear at all, it only has to match the URLs in the manifest, which
it now does.

Upload all five files to the root of it:

```
manifest.json
index.html
roller.js
style.css
icon.svg
```

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

**Permissions**: only the GM sees the Hidden toggle and the Clear button, and only the GM
can change Threat. Anyone can change Momentum. This is enforced in the panel, not on a
server, so it is a convenience rather than a security boundary. That is the right call
here because nothing in a roll log is worth cheating over, but do not extend the same
assumption to anything you actually want hidden.

**Concurrency**: two people rolling at the exact same instant can have one overwrite the
other. At a five-person table this is rare enough to ignore.

---

## The rules it implements

Taken directly from `classifyDie()` in `dnm-character-creator.html` v1.10, so the
extension and the character creator can never disagree:

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

Exhaustion is not modelled. The creator blocks rolls against a shut-down Attribute, which
needs the character sheet to know about; that arrives with character import.
