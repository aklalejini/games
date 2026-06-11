# 🏰 Stonebrook

A tiny 3D city builder in a cozy medieval pixel-art style — terracotta hip
roofs, stone walls, flower boxes, and sandy cobblestone streets, rendered as
a rotating 3D diorama. All textures are generated procedurally on `<canvas>`
at boot, the models are built from Three.js primitives, and the music is
synthesized live with WebAudio; there are no binary assets.

## Play

Open `index.html` in a browser (or serve the folder:
`npx http-server citybuilder`). A classic 2D version is kept at `2d.html`
as a fallback for devices without WebGL.

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
- **Time controls**: pause, ½×, 1×, 2×, and 4× speed, with a full day/night
  cycle (the sun sweeps across the sky and shadows move with it).
- **Music**: a gentle generative medieval-folk loop; toggle it with 🎵.
- Your town autosaves to `localStorage`.

## Controls

| Input | Action |
| --- | --- |
| Click shop card, then click map | Place a building (drag to paint paths) |
| Mouse wheel / `+` `-` | Zoom in and out |
| Right-drag | Rotate / tilt the camera |
| Middle-drag | Pan |
| Right-click / `Esc` | Cancel selection |
| `X` | Toggle demolish tool (60% refund) |
| `Space` | Pause / resume |
| `1` / `2` / `3` / `4` | 1×, 2×, 4×, ½× speed |
