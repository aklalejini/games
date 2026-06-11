# 🏰 Stonebrook

A tiny pixel-art city builder in a cozy medieval village style — terracotta
roofs, stone walls, flower boxes, and sandy cobblestone streets. All artwork is
generated procedurally on `<canvas>` at boot; there are no image assets.

## Play

Just open `index.html` in a browser — no build step, no dependencies.
(Or serve the folder: `npx http-server citybuilder`.)

## How it works

- **Buy buildings** from the shop bar and click the map to place them.
  Cottages and manors house villagers who pay taxes; farms grow food;
  bakeries and markets turn food into gold.
- **Natural resources**: lumber camps must be built next to trees, quarries
  next to rocks. You can also chop trees (+5 wood) or clear rocks (+5 stone)
  with the demolish tool.
- **Workers**: production buildings need workers. If jobs outnumber
  villagers, those buildings run slower — build more housing!
- **Food**: every villager eats 1 food per day. Run out and your gold income
  is halved until you feed them.
- **Boosters**: wells (+25%) and gardens (+10%) speed up nearby buildings.
- **Time controls**: pause, ½×, 1×, 2×, and 4× speed, with a day/night cycle.
- Your town autosaves to `localStorage`.

## Controls

| Input | Action |
| --- | --- |
| Click shop card, then click map | Place a building (drag to paint paths) |
| Right-click / `Esc` | Cancel selection |
| `X` | Toggle demolish tool (60% refund) |
| `Space` | Pause / resume |
| `1` / `2` / `3` / `4` | 1×, 2×, 4×, ½× speed |
