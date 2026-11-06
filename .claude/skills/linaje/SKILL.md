---
name: linaje
description: Add an Indigenous leader to the LINAJE // RESISTENCIA ticker on 3eascortex.com. Use whenever a name or leader is added to the ticker.
---

# Add a name to LINAJE // RESISTENCIA

Add an object to the `LINAJE` array in `index.html` (just above `const TICKER_RAW=[`). Never add a loose string to `TICKER_RAW`; `LINAJE_TICKER` renders these automatically in their pigment with a constant glitch (`tk-perma tk-lin`).

```js
{ ind: "OWN-LANGUAGE NAME", col: "COLONIZED NAME", name: "NAME", ink: "pigment",
  nation: "NATION", yr: "YEAR", line: "SHORT LINE", url: "https://en.wikipedia.org/wiki/..." },
```

## Fields
- **Placement:** under its region comment (NORTH AMERICA, BLACKFOOT CONFEDERACY, MESOAMERICA, CARIBBEAN, SOUTH AMERICA). Add a new block if none fits.
- **ind / col:** only when the person has both a documented own-language name and a colonized/baptismal/settler name. If sources disagree on spelling, omit both and tell the user. Never invent a name.
- **ink:** one of the `--ink-*` pigments in `:root`, matched to the person's people:

| Pigment | People / region |
|---|---|
| red-ochre | Lakota |
| sacred-yellow | Blackfoot |
| dine-turquoise | Apache / Diné |
| wampum-purple | Great Lakes / Eastern Woodlands |
| blue-corn | Pueblo / Plateau |
| shell-white | Coastal California |
| xiuhuitl, jade, cempasuchil, maya-blue, grana, anil, obsidian | Mesoamerica |
| urucum, caona-gold, huito | Caribbean / Amazon |
| andean-crimson, qolle-yellow, andean-magenta, chillca-green | Andes |
| mapuche-blue | Mapuche |

- **url:** Wikipedia. If none exists: Dictionary of Canadian Biography, Canadian Encyclopedia, or NPS.

## Done when
1. Inline scripts pass a syntax check.
2. The name renders at `/?ticker=<name>` on the local server.
3. You've told the user which pigment you picked.
