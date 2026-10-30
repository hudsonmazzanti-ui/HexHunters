# HexHunters

A pass-and-play tactical miniatures game on a hex grid, played in a phone browser (desktop works too).

## Running

```bash
npm install
npm run dev        # local dev server (open the printed URL; use your LAN IP to try it on a phone)
npm test           # unit tests
npm run build      # static site in dist/ — host it anywhere
```

Add `?seed=123` to the URL to replay a specific map and dice sequence. The ☰ menu shows the current seed.

**Deploying:** `.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`.
Enable it once under *Settings → Pages → Source: GitHub Actions*. Any other static host works with the `dist/` folder.

## Tuning

All unit stats, the army list and game settings live in **`src/data/config.ts`**. No logic changes are needed to rebalance.

| Unit     | Size       | Speed | Def | HP | Range | Dmg | Special |
|----------|------------|-------|-----|----|-------|-----|---------|
| Infantry | medium (2) | 3     | 6   | 6  | 5     | 2   | **Prep**: +2 on this model's die roll next turn |
| Medic    | small (1)  | 3     | 5   | 4  | 3     | 1   | **Heal**: adjacent damaged ally heals ⌊die/2⌋ (up to max) |
| Sniper   | small (1)  | 2     | 5   | 4  | 10    | 4   | **Spot**: mark a visible enemy; your next attack on it gets +2 |
| Scout    | small (1)  | 4     | 7   | 3  | 3     | 2   | **Dash**: move ⌊die/3⌋ extra hexes (can move after acting) |
| Heavy    | large (3)  | 2     | 6   | 12 | 3     | 4   | **Brace**: +2 defense until your next turn |

Army (both players): 2 Infantry, Medic, Sniper, Scout, Heavy.

Game settings: board radius 7 (15 hexes across), 3 mirrored terrain pairs of length 2–4, 2 deployment rows,
d12, first to 5 points. Hit chance on a plain roll: defense 6 → 58%, 7 → 50%, 8 → 42%, 9 → 33%.

## Rules as implemented

**Setup.** The map is a hexagon with a 7-hex control point in the center. Terrain walls (straight or curved,
height 1 or 2) are generated in pairs mirrored through the center, kept out of the deployment rows (plus a
one-row buffer) and off the control point and the ring around it, and never touch each other, so every open hex is reachable.
Player 1 deploys anywhere in the bottom two rows, then Player 2 in the top two rows.

**Rounds.** Each round both players take one turn. The first player alternates: Player 1 goes first in odd
rounds, Player 2 in even rounds (so the player going second in one round also goes first in the next).

**A turn.**
1. Every one of your models rolls a d12. Dice stay with their model.
2. Each model may move up to its speed (split across several moves if you like), then use its die for one
   action: attack *or* its special. Moving is always allowed whatever the roll. Once a model acts it can't move
   any more (except via Dash). A move can be undone until that model acts.
3. Tap **End turn**. If models still have unused dice, you need to tap it twice.

**Movement.** Terrain and enemy models block movement. You can move through friendly models but not stop on them.

**Attacks.** Need range (hex distance) and line of sight. Hit if die + modifiers ≥ target defense. A hit deals the
attacker's fixed damage; a model at 0 health is removed. The only modifiers are Brace (+2 defense), Spot (+2 to hit) and Prep (+2 to the die itself, so it also boosts the next turn's action whatever it is).
Because dice are rolled up front, the panel shows whether an attack will hit before you confirm it.

**Specials.** Brace, Prep and Spot always succeed; Heal and Dash scale with the die. A special that would do nothing
(Heal on a full-health ally, Dash or Heal for 0) isn't allowed, so dice aren't wasted by accident.
Brace lasts until the start of your next turn. Prep adds +2 to that model's die roll at the start of your next turn
(the die can then show 13 or 14; a green die badge means it includes a Prep bonus). A Spot mark lasts until it is used by an attack (hit or miss) or the
start of your next turn. Spot has no range limit, only line of sight.

**Scoring.** At the end of each round, whoever has more models on the control point scores 1 point (ties score nothing).
First to 5 points wins, or eliminate every enemy model to win immediately.

## Line of sight

Draw a line between hex centers. Only the hexes strictly between viewer and target matter. A hex blocks the line if it has:

- **terrain** with height ≥ the target's size, or
- **a model** with size ≥ the target's size. Exception: a model friendly to the viewer and smaller than the viewer
  doesn't block, so bigger models shoot over their own smaller troops.

So small models hide behind height-1 or height-2 terrain, medium models only behind height-2 terrain, and large models
only behind other large models. The attacker's size doesn't matter for terrain.

**Edge rule.** When the line runs exactly along the edge between two hexes, it's traced twice, nudged a tiny amount to
each side. The target is visible if **either** trace is clear, so ties go to the shooter: one blocker beside
the edge isn't enough, but blockers on both sides are. Lines that don't touch an edge are unaffected.

**On screen.** Selecting a model (yours or the enemy's) shades the board: yellow = in range and visible; darker
shading = hexes where a model of that size would be hidden from it (light: small models hidden, medium: medium and smaller
hidden, dark: even large models hidden). Red dashed rings show enemies you can attack now.

## Code layout

```
src/core/        pure game logic, no DOM (ready for AI / online play later)
  hex.ts         axial hex math, lines, mirroring, pixel conversion
  rng.ts         seeded PRNG (state lives in GameState)
  mapgen.ts      mirrored terrain generation
  los.ts         line-of-sight rule + edge rule
  pathfinding.ts BFS movement range / paths
  queries.ts     read-only questions about a state (who's where, can X see Y, move range)
  combat.ts      attack preview + resolution
  specials.ts    Brace / Prep / Heal / Spot / Dash / Shove (Shove is unused for now, kept for future factions)
  game.ts        newGame + applyAction(state, action) -> { state, events }
src/data/config.ts   unit stats, army, game settings
src/ui/          SVG board, pan/zoom camera, HUD, overlays, controller
tests/           Vitest unit tests
```

Every player input is an `Action` (`place`, `move`, `attack`, `special`, `endTurn`, ...) passed to the pure
`applyAction`, which returns a new state and a list of events the UI animates. An AI or network layer can drive the game by
producing the same actions.
