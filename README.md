# Dreams & Machines — Rolls

An Owlbear Rodeo extension: shared 2d20 rolls, a roll log that survives refreshes and
rejoins, and shared Momentum and Threat counters.

There is no build step. No Node, no npm, no terminal. Five static files pushed to a
GitHub repo with Pages turned on.

---

## Setup

### 1. Make the repo

On GitHub, create a new public repository called `dnm-rolls`. Public matters: Pages on
a private repo needs a paid plan, and players' browsers have to be able to reach the
files anyway.

Upload all five files to the root of it:

```
manifest.json
index.html
roller.js
style.css
icon.svg
```

You can drag them into the GitHub web uploader. Nothing needs installing locally.

### 2. Turn on Pages

Repo → Settings → Pages. Under "Build and deployment", set Source to **Deploy from a
branch**, branch **main**, folder **/ (root)**. Save.

Wait a minute or two, then check that this loads in a browser tab:

```
https://YOURNAME.github.io/dnm-rolls/index.html
```

You should see the roller with a "Standalone preview" note at the bottom. It rolls dice
locally so you can check the layout and the maths before touching Owlbear.

### 3. Fix the two URLs in the manifest

Open `manifest.json` on GitHub, click the pencil icon, and replace `REPLACE_ME` with your
GitHub username in both places. It should end up looking like:

```json
"icon": "https://gusexample.github.io/dnm-rolls/icon.svg",
"popover": "https://gusexample.github.io/dnm-rolls/index.html"
```

Case matters. Commit the change.

These are absolute URLs on purpose. Owlbear resolves a leading-slash path against the
site root, which on a GitHub project page is `yourname.github.io`, not your repo folder.
Absolute URLs sidestep that entirely.

### 4. Install it in Owlbear

In your Owlbear Rodeo profile, click **Add Extension** and paste:

```
https://YOURNAME.github.io/dnm-rolls/manifest.json
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

## Not settled yet

The roll engine is parameterised rather than hard-coded to Dreams & Machines, because the
rulebook specifics still need checking against the roller already built into
`dnm-character-creator.html` v1.10.

Currently assumed:

- Target number is Attribute + Skill, capped at 20
- A die at or under the TN is one success
- A die at or under the critical threshold (default 1) is two successes
- A die at or above the complication threshold (default 20) generates a complication
- Successes beyond the difficulty become Momentum

The critical and complication thresholds are editable in the panel under "Thresholds", so
the extension is usable while these are confirmed. If D&M drives the critical range off a
focus value, that becomes an automatic calculation instead of a manual field.

The colour palette in `style.css` is a placeholder. The variables at the top of that file
are the only thing that needs changing to match the character creator.
