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

All unit stats, point costs and game settings live in **`src/data/config.ts`**. No logic changes are needed to rebalance.

| Unit      | Cost | Size       | Speed | Def | HP | Range     | Dmg | Special |
|-----------|------|------------|-------|-----|----|-----------|-----|---------|
| Scout     | 2    | small (1)  | 4     | 7   | 3  | 3         | 2   | **Dash**: move ⌊die/3⌋ extra hexes (can move after acting) |
| Assassin  | 2    | small (1)  | 4     | 5   | 3  | 1 (melee) | 4   | **Vault**: leap an adjacent wall, then keep moving |
| Infantry  | 3    | medium (2) | 3     | 6   | 6  | 5         | 2   | **Prep**: +2 on this model's die roll next turn |
| Medic     | 3    | small (1)  | 3     | 5   | 4  | 3         | 1   | **Heal**: adjacent damaged ally heals ⌊die/2⌋ (up to max) |
| Sniper    | 4    | small (1)  | 2     | 5   | 4  | 10        | 4   | **Spot**: mark a visible enemy; your next attack on it gets +2 |
| Grenadier | 3    | medium (2) | 3     | 6   | 5  | 4         | 2   | **Grenade** (die 10+): 2 damage on impact, 1 to each neighbor |
| Heavy     | 4    | large (3)  | 2     | 6   | 12 | 3         | 4   | **Brace**: +2 defense until your next turn |
| Flamer    | 4    | medium (2) | 2     | 6   | 9  | 3         | 3   | **Torch**: die vs each model in a 2-hex line, ignores Brace |
| Monster   | 5    | large (3)  | 3     | 3   | 18 | 1 (melee) | 5   | **Sweep**: one die vs every adjacent enemy. Basic attack +1 to hit |
| Artillery | 3    | medium (2) | 1     | 4   | 8  | 10        | 4   | **Load**: needed before each Fire. Fire is indirect (ignores line of sight) |
| Sentinel  | 3    | medium (2) | 2     | 6   | 8  | 3         | 2   | **Overwatch**: lock the die, shoot an enemy ending its turn in view |
| Grappler  | 5    | large (3)  | 2     | 7   | 12 | 1 (melee) | 3   | **Hook** (die 7+): 1 damage to any model within 3 and pull it in |

**Heroes** (max one per army, optional; no special, their die is only for attacking):

| Hero          | Cost | Size       | Speed | Def | HP | Range        | Dmg | Passive (whole army, all game) |
|---------------|------|------------|-------|-----|----|--------------|-----|--------------------------------|
| Field Marshal | 7    | medium (2) | 3     | 6   | 9  | 4            | 3   | Your Infantry get +2 on their roll every turn (stacks with Prep) |
| Siege Master  | 8    | medium (2) | 2     | 5   | 8  | 4 (indirect) | 2   | Your Artillery never needs to Load |
| Warlord       | 6    | large (3)  | 3     | 6   | 12 | 1 (melee)    | 4   | All your large models, including the Warlord, get +1 movement |
| Warden        | 6    | medium (2) | 3     | 6   | 10 | 4            | 3   | Medics +1 defense and +1 damage; Sentinels +1 defense and +2 max health (from the start) |
| Master Ninja  | 7    | small (1)  | 4     | 5   | 7  | 1 (melee)    | 4   | Assassins and Scouts may use their special AND attack in one turn (special first; attacking ends their turn) |

Speeds: crawl 1, slow 2, normal 3, fast 4 (`SPEED` in the config). Assassin, Grenadier, Flamer, Artillery and Sentinel
defense values are placeholders.

Optional unit fields: `hitBonus` (added to basic attacks), `attackName` (e.g. "Fire"), `needsLoading` (attack only
while loaded; firing unloads), `indirectFire` (attack ignores line of sight).

Game settings: army point limit 16, board radius 7 (15 hexes across), 3 mirrored terrain pairs of length 2–4,
2 deployment rows, d12, first to 5 points, first player flips every 2 rounds (`firstPlayerSwapEvery`). Special-action
numbers (Brace/Prep/Spot bonus, Heal/Dash divisors, Grenade threshold and damage, Torch length, Sweep damage, Hook threshold/range/damage)
are under `specials`. Hit chance on a plain roll: defense 5 → 67%, 6 → 58%, 7 → 50%.

**Adding a unit:** add an entry to `UNITS` (stats, `cost`, `special`). Costs can be any positive integer.
**Adding a hero:** add a unit with `hero: { aura: '<id>' }` and no `special`, write the aura in `src/core/auras/`
(which units it affects and its effects: roll, speed, defense, damage or health bonus, no-loading, or double action), add the id to `AuraId` in
`src/core/types.ts` and list it in `src/core/auras/index.ts`. The hero limit is `maxHeroesPerArmy`; aura numbers
(`marshalRollBonus`, `warlordSpeedBonus`, `warden*`) are under `specials`.
**Adding a special:** write a module in `src/core/specials/` (see `types.ts` for the `SpecialDef` interface), add its
id to `SpecialId` in `src/core/types.ts`, and list it in `src/core/specials/index.ts`. Targeting, validation, area
previews and the UI flow are handled generically.

## Rules as implemented

**Map.** The map is a hexagon with a 7-hex control point in the center. Terrain walls (straight or curved,
height 1 or 2) are generated in pairs mirrored through the center, kept out of the deployment rows (plus a
one-row buffer) and off the control point and the ring around it, and never touch each other, so every open hex is reachable.

**Army building.** Player 1 builds an army from the full unit roster, then (after a handoff screen) Player 2 does the
same without seeing Player 1's choices. Duplicates are allowed; the total cost must be at most the point limit (16).

**Deployment.** Players alternate placing one model at a time, starting with Player 1, with a handoff screen between
placements. Player 1 places in the bottom two rows, Player 2 in the top two. Tapping a hex places the model. If one player
runs out of models, the other places the rest.

**Rounds.** Each round both players take one turn. Who goes first flips every two rounds: Player 1 in rounds 1–2,
Player 2 in rounds 3–4, Player 1 in 5–6, and so on. Where the order flips (between rounds 2–3, 4–5, ...) the same player
takes two turns in a row; the handoff screen says so. The top bar shows who goes first this round and next.

**A turn.**
1. Every one of your models rolls a d12. Dice stay with their model.
2. Each model may move up to its speed (split across several moves if you like), then use its die for one
   action: attack *or* its special. Moving is always allowed whatever the roll. Once a model acts it can't move
   any more (except after Dash or Vault). A move can be undone until that model acts.
3. Tap **End turn**. If models still have unused dice, you need to tap it twice.

**Movement.** Terrain and enemy models block movement. You can move through friendly models but not stop on them.

**Attacks.** Need range (hex distance) and line of sight. Hit if die + modifiers ≥ target defense. A hit deals the
attacker's fixed damage; a model at 0 health is removed. The only modifiers are Brace (+2 defense), Spot (+2 to hit) and Prep (+2 to the die itself, so it also boosts the next turn's action whatever it is).
Because dice are rolled up front, the panel shows whether an attack will hit before you confirm it.

**Specials.** Brace, Prep, Spot and Vault always succeed; Heal and Dash scale with the die; Grenade needs a 10+;
Torch rolls against each model. A special that would do nothing (Heal on a full-health ally, Dash or Heal for 0,
Torch at a line with no models, Sweep with no adjacent enemy) isn't allowed, so dice aren't wasted by accident. Specials
with an area preview it before you confirm (blast radius, flame line, Sweep hits, vault landing, overwatch area).
Brace lasts until the start of your next turn. Prep adds +2 to that model's die roll at the start of your next turn
(the die can then show 13 or 14; a green die badge means it includes a Prep bonus). A Spot mark lasts until it is used by an attack (hit or miss) or the
start of your next turn. Spot has no range limit, only line of sight.

- **Vault** (Assassin): pick a landing hex directly beyond an adjacent wall (either height). The landing hex must be on
  the board, open and empty, so walls two hexes thick can't be vaulted. The Assassin keeps its remaining movement and
  can move on after landing (but can't attack, since vaulting used its die).
- **Grenade** (Grenadier): only with a die of 10+. Target any non-terrain hex within the Grenadier's range (4). Always
  hits: 2 damage to a model on that hex and 1 to every model on the 6 neighbors, friend or foe (including the Grenadier
  itself). The arc ignores normal line of sight but is blocked by any hex in between with height-2 terrain or a model of
  size 2+ (friendly or not), using the same edge rule as line of sight. Walls don't block splash.
- **Torch** (Flamer): pick a direction. Hits every model in the next 2 hexes. The Flamer's die is compared to each
  model's **base** defense separately: defense bonuses (Brace, Warden) are ignored and Spot doesn't apply. Friendly fire applies.
  A wall stops the flame (nothing on or beyond it is hit); models don't.
- **Sweep** (Monster): no target needed. This turn's die is compared to the defense of every adjacent enemy separately
  (Brace counts; Spot and the Monster's +1 to hit don't apply). Each one it beats takes 3 damage. Allies are never hit.
- **Load / Fire** (Artillery): Load puts a shell in; it stays loaded through moves and turns until fired. Fire is the
  Artillery's basic attack: only while loaded, range 10, no line of sight needed (arcs over all terrain and models),
  normal hit roll (Brace and Spot apply), 4 damage, no splash. Firing unloads. Since each takes a turn's action, the
  Artillery fires at most every other turn. A shell icon on the model shows it's loaded.
- **Overwatch** (Sentinel): locks in this turn's die and fixes the watched area: every hex within range 3 where even a
  small model would be visible. Both players see the area and the locked die (eye badge). At the end of the opponent's
  next turn, if any enemy is standing in the area, the Sentinel fires once at the one with the lowest defense (ties:
  lowest health; the rule is `chooseOverwatchTarget` in `src/core/overwatch.ts`): locked die + modifiers (Spot) vs
  defense (Brace counts), 2 damage on a hit. Enemies that passed through but left aren't shot. Overwatch then ends,
  fired or not. It also ends if the Sentinel dies, moves or uses its die. If the turn order flips right after you set
  it, it survives your back-to-back turn and still gets the opponent's next turn. Overwatch shots resolve before
  round scoring.

- **Hook** (Grappler): only with a die of 7+. Target any other model, **ally or enemy**, within 3 hexes that the
  Grappler can see (normal line of sight). Always hits for 1 damage (allies too), then pulls the target along the
  straight line toward the Grappler, stopping in the last empty hex before terrain or a model; with a clear path it
  lands next to the Grappler. An adjacent or immediately blocked target takes the damage but doesn't move. On a line
  that runs exactly along hex edges, the path that pulls it farther is used. The pulled model keeps its die, movement
  and acted status (a hooked ally can still move and act); its "undo move" point becomes where it landed, and a pulled
  Sentinel loses its overwatch. Any size can be hooked. Selecting Hook rings valid targets and marks where each would
  land.

**Heroes.** At most one per army (the builder blocks confirming two). A hero has no special action; instead its
passive rule applies to its own army for the **whole game**, even after the hero dies. Field Marshal: your Infantry
get +2 on every roll, on top of any Prep (+4 with both). Siege Master: your Artillery can Fire without loading (Load
is greyed out as not needed, and firing doesn't use a shell). Warlord: your large models move 1 extra hex. Warden:
Medics +1 defense and +1 attack damage; Sentinels +1 defense and +2 max health, starting the game at 10 (Heal can
restore them to 10). Master Ninja: your Assassins and Scouts can use their special and then attack in the same turn,
with the same die; they can move before, between and (after Dash/Vault) after the special, but attacking ends their
turn, so the attack must come last. The panel shows which of the two actions has been used. Heroes wear
a gold crown, and units under a hero's aura glow gold, for both players to see.

**Scoring.** At the end of each round, whoever has more models on the control point scores 1 point (ties score nothing).
First to 5 points wins, or eliminate every enemy model to win immediately. If one action (Grenade or Torch) wipes out
the last models on both sides at once, the game is a draw.

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
  combat.ts      attack preview + resolution, shared damage
  army.ts        army cost + validation
  overwatch.ts   overwatch area, target choice and end-of-turn shots
  auras/         hero aura rules, one module each + registry
  specials/      one module per special (Shove is unused for now, kept for future factions) + registry
  game.ts        newGame + applyAction(state, action) -> { state, events }
src/data/config.ts   unit stats, costs, game settings
src/ui/          SVG board, pan/zoom camera, HUD, army builder, overlays, controller
tests/           Vitest unit tests
```

Every player input is an `Action` (`chooseArmy`, `place`, `move`, `attack`, `special`, `endTurn`, ...) passed to the pure
`applyAction`, which returns a new state and a list of events the UI animates. An AI or network layer can drive the game by
producing the same actions.
