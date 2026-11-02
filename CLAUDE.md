# 3EAS CORTEX — notes for Claude

## LINAJE // RESISTENCIA (Indigenous leaders on the ticker)

Whenever a leader / name is added to the ticker, it goes into the `LINAJE`
array in `index.html` (just above `const TICKER_RAW=[`), never as a loose
ticker string. Every entry must follow this format:

```js
{ ind: "OWN-LANGUAGE NAME", col: "COLONIZED NAME", name: "NAME", ink: "pigment",
  nation: "NATION", yr: "YEAR", line: "SHORT LINE", url: "https://en.wikipedia.org/wiki/..." },
```

Rules:
- **Region block:** put the entry under its region comment (NORTH AMERICA,
  BLACKFOOT CONFEDERACY, MESOAMERICA, CARIBBEAN, SOUTH AMERICA); add a new block if needed.
- **ind / col:** include only when the person has a documented name in their own
  language AND a colonized / baptismal / settler name. Shown as `IND / COL`.
  If sources disagree on the spelling, leave both out and tell the user.
  Never invent a name.
- **ink:** always assign one of the LINAJE pigments defined in the `:root`
  block (`--ink-*`). Match it to the person's people / region, following the
  existing assignments:
  - red-ochre: Lakota
  - sacred-yellow: Blackfoot
  - dine-turquoise: Apache / Diné
  - wampum-purple: Great Lakes / Eastern Woodlands
  - blue-corn: Pueblo / Plateau
  - shell-white: coastal California
  - xiuhuitl / jade / cempasuchil / maya-blue / grana / anil / obsidian: Mesoamerica
  - urucum / caona-gold / huito: Caribbean / Amazon
  - andean-crimson / qolle-yellow / andean-magenta / chillca-green: Andes
  - mapuche-blue: Mapuche

  Tell the user which pigment was picked.
- **Rendering:** the name renders in that pigment with a constant glitch
  (`tk-perma tk-lin`). This is automatic from the `LINAJE_TICKER` map; don't
  hand-write ticker strings for these people.
- **url:** use the Wikipedia page. If there isn't one, use a reliable
  reference (Dictionary of Canadian Biography, Canadian Encyclopedia, NPS).
- **Done means:** after editing, syntax-check the scripts and confirm the line
  renders with `/?ticker=<name>`.
