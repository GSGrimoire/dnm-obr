# BETA — test build, not the live extension

Built by `dnm-cc/tools/stage-beta.mjs` from a feature branch. Everything here is a copy
with its namespaces suffixed `-beta`, so it cannot touch the live extension's rooms,
tokens or log. Do not edit by hand; rebuild it.

Install: add `https://gsgrimoire.github.io/dnm-obr/beta/manifest.json` to Owlbear as an extension. Test in a
room of its own. Characters attached with the live extension are not visible to it: copy a
code from a live sheet and use "Attach D&M character (BETA)".

When the build is released, the live files are updated the normal way and this folder can
be deleted or left for the next test.
