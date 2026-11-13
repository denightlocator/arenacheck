# arenacheck — Dead Hollow

A top-down zombie survival game that runs in any modern browser. No build step, no dependencies, and no external assets: every sprite, shadow, light, and sound is generated in code.

## Run it

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Any static file server works, since the game is plain `index.html` + `style.css` + `game.js`.

## Survive

- **Scavenge** trees, rocks, and bushes for wood, stone, and cloth. Break open ruined houses for chests.
- **Drink** from the lakes (`E` while facing water) or carry water bottles.
- **Eat** canned food (`G`), use bandages (`K`), and medkits (`J`) to heal.
- **Craft** ammo, medkits, bandages, and the Fire Axe (`C`).
- **Build** barricades (`B`, then click) to keep zombies out. Zombies bang on them until they break. Zombies can't hit you through walls or trees.
- **Light a campfire** (`B`, then `X` to pick campfire, then click). It burns for a minute per wood you feed it (`E` next to it), warms you back up, and lights the dark. It goes out when the wood runs out.
- **Night** brings the dead. Zombies get tougher each day: runners appear on day 2, brutes on day 3. Every 5th day is a **Blood Moon** with double spawns.
- Your flashlight cuts through the dark. Rain, sunsets, screen shake, blood decals, and a damage vignette add atmosphere.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| `Shift` | Sprint (uses stamina) |
| Mouse | Aim |
| Left click | Attack / shoot / place (in build mode) |
| `1` `2` `3` `4` / wheel | Switch weapon (knife, pistol, shotgun, axe once crafted) |
| `R` | Reload |
| `E` | Chop, mine, forage, loot, drink, feed a campfire |
| `C` | Craft |
| `B` | Toggle build mode |
| `X` | In build mode: switch barricade / campfire |
| `G` / `H` / `J` / `K` | Eat / drink / medkit / bandage |
| `M` | Mute |
| `Esc` | Pause |

Your best run (in days survived) is saved in `localStorage`.

## Files

- `index.html`: markup and menu panels
- `style.css`: UI styling
- `game.js`: world generation, sprites, AI, combat, lighting, HUD, and audio
