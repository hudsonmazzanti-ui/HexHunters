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
| Sniper    | 4    | small (1)  | 2     | 5   | 4  | 7         | 4   | **Spot**: mark a visible enemy within 7; your next attack on it gets +2 |
| Grenadier | 3    | medium (2) | 3     | 6   | 5  | 4         | 2   | **Grenade** (die 10+): 2 damage on impact, 1 to each neighbor |
| Heavy     | 4    | large (3)  | 2     | 6   | 12 | 3         | 3   | **Brace**: +2 defense until your next turn |
| Flamer    | 4    | medium (2) | 2     | 6   | 9  | 3         | 3   | **Torch**: die vs each model in a 2-hex line, ignores Brace |
| Monster   | 5    | large (3)  | 2     | 3   | 14 | 1 (melee) | 5   | **Sweep**: one die vs every adjacent enemy |
| Artillery | 3    | medium (2) | 1     | 4   | 8  | 7         | 4   | **Load**: needed before each Fire. Fire is indirect (ignores line of sight) |
| Sentinel  | 3    | medium (2) | 2     | 6   | 8  | 3         | 2   | **Overwatch**: lock the die, shoot an enemy ending its turn in view |
| Grappler  | 5    | large (3)  | 2     | 7   | 12 | 1 (melee) | 3   | **Hook** (die 7+): 1 damage to any model within 3 and pull it in |
| Zombie    | 2    | medium (2) | 3     | 0   | 9  | 1 (melee) | 3   | **Eat** (die 8+): adjacent enemy, normal hit roll; 2 damage and the Zombie heals 2. Crawls once hurt |
| Skeleton  | 1    | medium (2) | 3     | 2   | 1  | 1 (melee) | 2   | No special. Rests on the second of back-to-back turns |
| Hill Giant | 5   | large (3)  | 2     | 5   | 13 | 1 (melee) | 4   | **Hurl**: rip out adjacent terrain and throw it (2 + height damage) |
| Werewolf  | 5    | medium (2) | 3     | 5   | 7  | 3         | 2   | No special. On its owner's 3rd turn becomes a beast: large, move 3, def 6, HP 12, melee 5, **Pounce** |
| Hacker    | 3    | small (1)  | 3     | 5   | 6  | 4         | 2   | **Hack**: enemy within 4 in sight gets -2 on its next die (min 1). No roll |
| Dual Gunner | 4  | medium (2) | 3     | 6   | 7  | 4         | 2   | **Second Shot**: after its attack, attack again with the same die |
| Dragon    | 6    | large (3)  | 3     | 6   | 12 | 3         | 3   | **Breath**: like Torch, and everything hit burns. Flying |

**Heroes** (max one per army, optional; no special, their die is only for attacking):

| Hero          | Cost | Size       | Speed | Def | HP | Range        | Dmg | Passive (whole army, all game) |
|---------------|------|------------|-------|-----|----|--------------|-----|--------------------------------|
| Field Marshal | 7    | medium (2) | 3     | 6   | 9  | 4            | 3   | Your Infantry within 3 hexes of it at the start of your turn get +2 on their roll (stacks with Prep); needs the Field Marshal alive |
| Siege Master  | 8    | medium (2) | 2     | 5   | 8  | 4 (indirect) | 2   | Your Artillery never needs to Load |
| Warlord       | 6    | large (3)  | 2     | 6   | 12 | 1 (melee)    | 4   | All your large models, including the Warlord, get +1 movement and −2 max health (from the start; a Werewolf when it turns into its beast) |
| Warden        | 6    | medium (2) | 3     | 6   | 10 | 4            | 3   | Medics +1 defense and +1 damage; Sentinels +1 defense and +2 max health (from the start) |
| Master Ninja  | 7    | small (1)  | 4     | 5   | 7  | 1 (melee)    | 4   | Assassins and Scouts may use their special AND attack in one turn (special first; attacking ends their turn) |
| Standard Bearer | 6  | medium (2) | 3     | 6   | 10 | 3            | 3   | Models on the control point get +2 on their die when they act; holding the point scores 2 instead of 1. Capture the Flag: the carrier isn't slowed and gets +2 |
| Pyromancer    | 6    | medium (2) | 3     | 7   | 10 | 3            | 2   | Burn: its attacks, Flamer Torch and Grenadier Grenade set every model they hit burning |
| Gambler       | 6    | medium (2) | 3     | 6   | 9  | 3            | 3   | Dice aren't rolled at turn start: each rolls d12+2 (max 14) when its action is confirmed |
| Necromancer   | 7    | medium (2) | 3     | 5   | 8  | 3            | 2   | Skeletons +1 def, never rest; Zombies crawl only at half health; Raise Dead |

**Mercenary** (hero, 5 pts; no passive rule, its ability is its special): medium (2), speed 3, def 6, HP 8, the
Infantry's basic attack (range 5, 2 damage). **Premium Shot**: an enemy within 7 in line of sight, no roll, always hits
for 4. Uses per game = the points your army leaves unspent (limit minus army cost, Mercenary included), max 3; at 0 it's
greyed out. The builder shows "Premium Shots: X" live as you change the army, and the model carries a gold "★X" tag.

**Range cap.** No attack or special reaches farther than 7 (`maxRange` in the config). `validateConfig` checks every
unit range and special range setting when a game starts, so a unit with range 8 fails loudly. Sniper and Artillery
went from 10 to 7, and Spot (previously any range) is now 7. Swap is exempt: it targets nothing.

**Behemoth** (hero, 12 pts; no passive rule, its ability is its special): large (3), speed 3, def 10, HP 15, melee 6.
**Smash**: destroy one adjacent terrain hex (either height) for good. No roll. **Cracking Armor**: -1 defense for good
each time it's hit for damage (min 4). **No die**: its melee always hits for 6.

**The Twins** (hero, 10 pts, bought as one entry that adds both models; no passive rule; both have **Swap**):

| Model          | Size      | Speed | Def | HP | Range     | Dmg |
|----------------|-----------|-------|-----|----|-----------|-----|
| Twin (Tank)    | large (3) | 2     | 7   | 12 | 1 (melee) | 3   |
| Twin (Shooter) | small (1) | 3     | 5   | 5  | Infantry's (5) | Infantry's (2) |

Speeds: crawl 1, slow 2, normal 3, fast 4 (`SPEED` in the config). Assassin, Grenadier, Flamer, Artillery and Sentinel
defense values are placeholders.

Optional unit fields: `hitBonus` (added to basic attacks), `attackName` (e.g. "Fire"), `needsLoading` (attack only
while loaded; firing unloads), `indirectFire` (attack ignores line of sight), `woundedForm` (size and speed it
switches to for good the first time it takes damage: Zombie), `restsOnDoubleTurn` (sits out the second of
back-to-back turns: Skeleton), `flying` (moves over terrain and models: Dragon).

Game settings: army point limit 16, board radius 7 (15 hexes across), 3 mirrored terrain pairs of length 2–4,
2 deployment rows, d12, first to 5 points, first player flips every 2 rounds (`firstPlayerSwapEvery`). Special-action
numbers (Brace/Prep/Spot bonus, Heal/Dash divisors, Grenade threshold and damage, Torch length, Sweep damage, Hook threshold/range/damage)
are under `specials`. Hit chance on a plain roll: defense 5 → 67%, 6 → 58%, 7 → 50%.

**Adding a unit:** add an entry to `UNITS` (stats, `cost`, `special`). Costs can be any positive integer.
**Adding a squad** (several models bought together): add its members to `UNITS` with `squadOnly: '<squad id>'` and an
entry to `SQUADS` (name, cost, `hero`, `members`); two-member squads are linked as partners.
**Adding a hero:** add a unit with `hero: { aura: '<id>' }` and no `special`, write the aura in `src/core/auras/`
(which units it affects and its effects: roll, speed, defense, damage or health bonus, action-roll bonus, no-loading,
double action, or extra points for holding the control point), add the id to `AuraId` in
`src/core/types.ts` and list it in `src/core/auras/index.ts`. The hero limit is `maxHeroesPerArmy`; aura numbers
(`marshalRollBonus`, `warlordSpeedBonus`, `warden*`, `standard*`) are under `specials`.
**Adding a special:** write a module in `src/core/specials/` (see `types.ts` for the `SpecialDef` interface), add its
id to `SpecialId` in `src/core/types.ts`, and list it in `src/core/specials/index.ts`. Targeting, validation, area
previews and the UI flow are handled generically.

## Rules as implemented

**Map.** The map is a hexagon with a 7-hex control point in the center. Terrain walls (straight or curved,
height 1 or 2) are generated in pairs mirrored through the center, kept out of the deployment rows (plus a
one-row buffer) and off the control point and the ring around it, and never touch each other, so every open hex is reachable.

**Army building.** Player 1 builds an army from the full unit roster, then (after a handoff screen) Player 2 does the
same without seeing Player 1's choices. Duplicates are allowed; the total cost must be at most the point limit (16). The
builder has Units and Heroes tabs (each remembers its scroll position). Entries you can still add are listed first,
cheapest first; the ones that don't fit your remaining points (or a second hero) sink to the bottom, dimmed, with the
reason ("Needs 2 more pts"), and their + is disabled.

**Deployment.** Players alternate placing one model at a time, starting with Player 1, with a handoff screen between
placements. Tapping a hex places the model. If one player runs out of models, the other places the rest.

Each game uses a random **deployment shape**, picked from the seed when the map is generated and revealed (name, short
description and a mini map of both zones) after both armies are built, on the briefing screen (see **Briefing** below). Player 2's zone is always Player 1's mirrored
through the center, terrain stays out of both zones plus a one-hex buffer, and every zone is at least 3 hexes from the
center (clear of the control point and its ring). During placement your zone is highlighted and the enemy's is shown
faintly.

| Shape | Player 1's zone (Player 2's is the mirror) | Hexes each |
|-------|--------------------------------------------|------------|
| Standard | the 2 rows nearest your edge | 17 |
| Close Quarters | like Standard, 2 rows closer to the center | 21 |
| Corners | within 4 of the bottom-left corner, at least 5 from the center | 21 |
| Flanks | a strip along the left edge | 21 |
| Spearhead | a wedge from your edge (8, 5, 4, 1 hexes per row) pointing at the center | 18 |
| Split | two 10-hex pockets in the back 3 rows, left and right, with a 3-hex gap | 20 |

Shapes live in `src/data/deployShapes.ts` (one entry each, describing Player 1's zone); the random pool is
`deployShapes` in the config. Every shape must fit the largest legal army (16 models); the army check uses the smallest.

**Rounds.** Each round both players take one turn. A coin flip at the end of deployment (seeded, so `?seed=` replays
it) decides who goes first in round 1; after that, who goes first flips every two rounds: the winner in rounds 1–2,
the other player in rounds 3–4, the winner in 5–6, and so on. Where the order flips (between rounds 2–3, 4–5, ...) the same player
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
passive rule applies to its own army for the **whole game**, even after the hero dies (except the Field Marshal's,
which needs it alive and close). Field Marshal: your Infantry within 3 hexes of it when your turn starts get +2 on
every roll that turn, on top of any Prep (+4 with both). Selecting the Field Marshal shades the 3-hex area green and
rings the Infantry inside it. Siege Master: your Artillery can Fire without loading (Load
is greyed out as not needed, and firing doesn't use a shell). Warlord: your large models move 1 extra hex and have 2 less max health (applied at game start, permanent; the army builder shows the effective HP, e.g. "HP 12 (14 −2 Warlord)"). Warden:
Medics +1 defense and +1 attack damage; Sentinels +1 defense and +2 max health, starting the game at 10 (Heal can
restore them to 10). Master Ninja: your Assassins and Scouts can use their special and then attack in the same turn,
with the same die; they can move before, between and (after Dash/Vault) after the special, but attacking ends their
turn, so the attack must come last. The panel shows which of the two actions has been used. Standard Bearer: any of
your models standing on the control point gets +2 on its die when it attacks or uses a special, checked at the moment
it acts (move on, then act, counts). This applies to every die check: hit rolls, Grenade 10+ and Hook 7+, Heal and
Dash amounts, Sweep and Torch rolls, and the die a Sentinel locks for overwatch. The die badge shows e.g. "8+2" and
those models glow gold while on the point. Winning the control point at the end of a round scores 2 points instead
of 1 (shown as "Player 1 holds the point: +2 (Standard Bearer)"). Heroes wear
a gold crown, and units under a hero's aura glow gold, for both players to see.

**Zombie.** The first time a Zombie takes damage from any source (attacks, specials, overwatch, Burn) and survives,
it permanently becomes a crawler: small (so it hides behind height-1 walls and blocks sight like a small model) and
speed 1. If that happens during its own turn, its remaining movement is capped at 1. Healing never reverses it.
Crawlers are drawn smaller with a dashed outline. **Eat** (die 8+, adjacent enemy) is a normal hit roll: Spot, the
Standard Bearer's +2 and the target's Brace all count; on a hit it deals 2 and heals the Zombie 2 (up to max health).

**Skeleton.** When the turn order flips and a player takes two turns in a row, their Skeletons get no die and no
movement on the second of those turns (greyed out with "Zz"). Otherwise they act normally.

**Burn (Pyromancer).** In an army with a Pyromancer, the Pyromancer's attacks, the Flamer's Torch (each model hit) and
the Grenadier's Grenade (impact and splash) set every model they hit and don't kill burning, allies included. The
Flamer's and Grenadier's basic attacks don't burn. At the start of the burning model's owner's next turn it takes 1
damage (this can kill, end the game, and make a Zombie crawl), then stops burning. Burn doesn't stack. Burning models
show a flame icon, and the handoff screen logs the damage.

**The Twins.** One builder entry (`SQUADS` in the config) adds both models for 10 points and counts as the army's one
hero; the twins can't be bought separately. When you place a twin during deployment, you place both in the same step:
first one, then the other on a free hex of your zone next to it (refused if there is none), then the handoff. **Swap**
uses the activating twin's die (and ends its movement): the twins trade places from anywhere on the map, no range or
line of sight needed. The other twin keeps its die and, if it hasn't acted, can still move and act; it can't undo the
swap. Once either twin dies, Swap is greyed out for the rest of the game. Both twins carry a purple link badge, and
selecting one outlines the other.

**Gambler.** Your dice aren't rolled at the start of your turn: models show "?" and can move freely. Confirming an
attack or special first checks it would be legal with the best possible roll, then rolls d12+2 (Prep/Field Marshal
bonuses included, capped at 14) and resolves with that. If the roll misses a special's threshold (Grenade 10+, Hook 7+,
Eat 8+, Heal/Dash for 0), the die is spent and nothing happens. Overwatch rolls when it's chosen. Previews show the odds.

**Necromancer.** Your Skeletons get +1 defense and never rest; your Zombies only crawl at half health or less. **Raise
Dead**: when an enemy model dies within 2 hexes of one of your living Zombies or your living Necromancer, a free
Skeleton rises in that hex (or the nearest empty open hex) once the action is over. It counts for the control point
at once but can't move or act until your next turn. After the Necromancer dies, only Zombies raise.

**Hill Giant: Hurl.** Pick an adjacent terrain hex (either height), then an enemy within 4 in line of sight (checked
with the chunk lifted). Normal hit roll. The terrain is removed from the map either way; a hit deals 2 + its height; a
kill drops a height-1 boulder on the target's hex. Greyed out with no adjacent terrain.

**Werewolf.** A moon badge counts down its owner's turns. At the start of its owner's 3rd turn it permanently becomes
the beast form (large, speed 3, def 6, max HP 12, melee 5) and heals 5. **Pounce** gives +2 hexes of movement, then it may
still make its melee attack with the same die.

**Hacker: Hack.** Target an enemy within 4 the Hacker can see; no roll, the die is just spent. At the start of that
model's owner's next turn its die is reduced by 2 (minimum 1), for attacks and specials alike, then the hack is gone.
The die shows "7 (-2)" and hacked models carry a green "</>" chip. It doesn't stack: an already-hacked model isn't a
valid target. With the Gambler, the -2 is applied to the delayed roll after the cap of 14 (so 1–12). A Sentinel
already on overwatch keeps its locked die.

**Dual Gunner: Second Shot.** The one exception to "attacking ends the turn": after the basic attack (hit or miss), the
Dual Gunner may fire another basic attack with the same die, at the same or another enemy (range 4, 2 damage, normal
hit roll; Spot, Standard Bearer, Brace and Pyromancer burn all count). It can't move between shots, and its move can't
be undone after the first. If no enemy is left to shoot, the turn ends right away. Second Shot is greyed out before
the attack.

**Dragon.** Flying: when moving it passes over terrain and any models, friend or foe, but must end on an empty hex with
no terrain. **Breath** works like Torch (2-hex line in one of 6 directions, die vs each model's base defense, friendly
fire, stopped by terrain, the Dragon's 3 damage), and every model it hits and doesn't kill starts burning, with or
without a Pyromancer.

**Behemoth: Smash.** Pick an adjacent terrain hex of either height: it's removed from the map for good. No roll (the
die is spent). Greyed out with no adjacent terrain.

**Behemoth: Cracking Armor.** Defense starts at 10. Each attack or special that deals it damage permanently lowers it
by 1, down to a minimum of 4. That includes always-hit damage (Grenade impact and splash, Hook) and overwatch shots;
misses and Burn don't count. One action cracks it at most once, however many hits it lands (e.g. two overwatch shots
at the end of a turn). The lower defense is its real defense from then on: Torch and Breath roll against it, and
Brace still adds +2 on top. Each crack is logged.

**Behemoth: no die.** The Behemoth never rolls: no die at the start of its turn, its melee basic attack always hits
for 6, and Smash needs no roll. Where other models show their die, it shows a shield with its current armor ("DEF 8",
red once cracked), on the board and on its roster chip, so both players can track the countdown. Die modifiers don't
affect it: Hack can't target it, the Gambler doesn't turn its die into "?", and the Standard Bearer's +2 and Spot don't
apply to its attacks (Spot isn't used up by them). Enemies can still Spot it as a target.

**Missions.** After both armies are built, each game's mission is picked at random (a third each, seeded) and shown with
a one-line rule on the briefing screen before deployment. The full rules are one tap away from the briefing during
play. Missions are data
(`src/core/missions/`, one module each; the pool is `missions` in `config.ts`). In every mission, eliminating every
enemy model wins immediately. If one action (Grenade or Torch) wipes out the last models on both sides at once, the
game is a draw.

- **King of the Hill.** At the end of each round, whoever has more models on the control point scores 1 point, or 2
  with the Standard Bearer (ties score nothing). First to 5 points wins.
- **Capture the Flag.** No control point and no points (the top bar shows no score): one neutral flag (a magenta
  pennant) starts on the center hex.
  - *Pick up:* a model standing on the flag spends its action to pick it up (the **Pick up flag** button; no roll, so
    the Behemoth can too). Movement ends, like a special; with the Master Ninja it may still attack after.
  - *Carrier:* ignores every speed bonus (e.g. the Warlord's +1) and moves 1 slower than its own speed (minimum 1;
    a Monster carrying the flag with the Warlord moves 1). It can still attack and use its
    special. It carries a pennant on the board, and your deployment zone is outlined (dashed) as the scoring zone.
  - *Walking only:* if the carrier moves any way other than its own normal move, the flag drops on the hex it stood
    on just before: Vault, Swap (either twin), a Hook pull (by friend or foe; a hook that doesn't move it doesn't
    count), or any other forced move. Dash and Pounce add movement, so the flag drops where the carrier is standing
    when it uses them. A Dragon carrying the flag walks instead of flying.
  - *Hack:* hacking the carrier makes it drop the flag on its hex. The carrier can be hacked for this even if it's
    already hacked or has no die (Behemoth); the die penalty only applies where it normally would.
  - *Death:* the flag drops where the carrier died. If a Hurl boulder lands there, it rolls to the nearest open hex.
    A dropped flag stays until someone picks it up.
  - *Capture wins:* if your carrier ends your turn inside your own deployment zone (checked after the enemy's
    overwatch, which can still stop it), you win the game. The other way to win is eliminating the enemy.
  - *Standard Bearer:* your carrier isn't slowed by the flag (it moves at its own speed, still without bonuses) and gets +2 on its rolls (instead of models on the
    control point).
  - Every pickup, drop and capture gets a log line.
- **Domination.** No control point or flag: three sites, each a hex plus its six neighbors (tinted and outlined in
  the owner's color, gold while nobody holds them).
  - *Sites:* one in the center, and two flank sites mirrored through the center on the axis across the line between
    the deployment zones (so they turn with the shape: left and right for Standard, top and bottom for Flanks), about
    radius − 2 hexes out (5 normally, 3 on Small Map, 7 on Big Map). A flank site is as close to one army as to the
    other; where the axis falls between hexes (Flanks, Corners) it is 1 hex closer to one army and its mirror 1 hex
    closer to the other. Sites never touch a zone, terrain stays off them, and every zone must reach every site.
  - *Claim:* a model inside a site spends its action to claim it (the **Claim site** button; no roll, movement
    ends, like picking up the flag), but not while an enemy model is inside that site. It stays yours until the
    enemy claims it.
  - *Scoring:* at the end of each round, 1 point per site you own. First to 8 wins; if both reach 8 in the same
    round the higher score wins, and an exact tie plays on. Or eliminate the enemy.
  - *Standard Bearer:* your models inside any site get +2 on their rolls, and a round in which you score site points
    scores 1 extra.
  - Never paired with the Hot Drop Condition (rerolled). Every claim gets a log line, and each round's site points
    show on the next handoff screen.

**Battlefield Conditions.** Each game also gets one Condition, picked at random after the armies are built (seeded,
like the mission and deployment shape). Clear comes up half the time; the other nine share the other half equally.
The weights are `conditions` in `config.ts` (set one to 0 to remove it), and each Condition is a small data entry in
`src/core/conditions/`.

| Condition | Effect |
|---|---|
| Clear | No effect. |
| Fog | Nothing can target or affect a model more than 4 hexes away: attacks (indirect fire too), specials, Grenade splash and the overwatch area. Army-wide auras still work, and the Twins still Swap at any distance. |
| Mud | Every model's speed is 1 lower (minimum 1), after every other modifier. |
| Tailwind | Every model's speed is 1 higher, after every other modifier (the flag carrier too). |
| Blood Moon | +1 on every die result (Gambler included, within its cap). Models without a die (Behemoth) are unaffected. |
| Sandstorm | −1 on every die result (minimum 1). Models without a die are unaffected. |
| Bonus Bones | Each army gets 2 free Skeletons, placed after the rest of the army. They aren't in the army list, so they don't count toward points or the Mercenary's unspent points, but they are Skeletons for every rule (e.g. the Necromancer). Zones grow to fit 18 models. |
| Hot Drop | Replaces the deployment shape: both armies deploy back to back in the middle. Player 1 gets the two rows just below the center line plus the left part of the center row, Player 2 the mirror image; the zones touch, and stay 3+ hexes from the center (off the control point and its ring). Never paired with Capture the Flag or Domination (rerolled). |
| Small Map | The board is 2 rings smaller (radius 5). Terrain scales with the board's area; Close Quarters is left out (too cramped). |
| Big Map | The board is 2 rings larger (radius 9), with terrain scaled up the same way. |

Deployment shapes are drawn relative to the board edge, keep every hex at least 3 from the center, and grow one row
or step deeper whenever a zone is too small for the largest army (16 Skeletons, or 18 with Bonus Bones). Maps stay
mirrored and pass the same connectivity checks on every board size.

**Briefing.** After both armies are built, one screen shows three cards, side by side (stacked on a phone): the
**Mission** (big icon, name, a few words), the **Deployment** (a mini-map of the actual board with both zones and the
control point or flag) and the **Condition** (big icon, name, one line). During the game, the mission and Condition
icons sit in the board's top-left corner; tapping either reopens the briefing (with the mission's full rules one
more tap away).

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

## Balance simulator

Bots play thousands of games with the real rules and report what's winning. Nothing in the app changes.

```bash
npm run sim -- --games 2000                     # ~30 s on 4 cores; writes sim-results/
npm run sim -- --per-matchup 50 --random 2000 --seed 7
npm run sim -- --replay 123456 --a "Big Guys" --b "Gun Line"   # replay one game, printing every action
```

- `sim/runGame.ts` plays a full game headless (army building, deployment, turns, scoring) from a seed, so any
  game in `games.csv` can be replayed exactly. Games still going after 30 rounds are draws.
- `sim/bot.ts` is a simple heuristic bot: each step it scores every reachable hex and every action (attack,
  special or nothing) for every model, plays the best, and repeats. Weights are in `sim/weights.ts`.
- `sim/armies.ts` holds the editable preset armies and the random army generator. A random army with a hero whose
  rule needs specific units gets at least 2 of them first (Field Marshal: Infantry; Siege Master: Artillery;
  Necromancer: Zombies/Skeletons; Master Ninja: Assassins/Scouts; Warden: Medics/Sentinels; Pyromancer:
  Flamers/Grenadiers; Warlord: large models), and a Mercenary army leaves 1–3 points unspent for Premium Shots; the
  rest is filled at random. The rules live in `sim/synergies.ts` (simulator only; the game's army rules don't change). Every preset plays every other
  (seats alternating), plus random-vs-random games.
- Output in `sim-results/`: `report.html` (preset win rates, matchup grid, unit/hero win rates in random armies,
  first-mover, deployment shape and win-type stats, game length, ability use, and flags for anything outside
  40–60%), `games.csv` (one row per game, with its seed) and `units.csv`.
- The bot is simple: units that need clever play (Twins, Sentinel, Hacker…) may test weaker than they really are.
- **Balance variants** (`sim/variants.ts`): temporary overrides of unit stats, special-rule numbers or rule/map
  settings (e.g. `terrainPairs`), applied to a copy of the data. `--variant ID`, `--variants A,B` or
  `--experiment NAME` (e.g. `monster`, `terrain`, `warlord`) run them with the same seed and write `compare.html`: one row
  per variant, changes from the baseline marked as real (beyond 2 standard errors) or noise, plus a sample map
  per variant (`sample-map.svg` / `.txt`).
- **Missions:** each sim game's mission is random (a third each), like the app. The report has a **By mission** section
  (game flow, preset scores and unit/hero scores per mission side by side, how each preset wins (wipeout vs objective) per mission, and which unit types made the winning flag captures, overall and per preset), `games.csv` has mission and flag
  columns, and `units.csv` has per-mission scores. `--mission koth|ctf|dom` forces one; `--experiment missions`
  compares random and each mission alone. In Domination the bot claims sites it stands in, heads for sites it
  doesn't own, spreads out across sites, sits in enemy sites to block their claims, and guards its own when enemies
  are near.
- **Conditions:** each sim game's Condition is random with the app's weights (and Hot Drop never with Capture the
  Flag). The report's **By Condition** section shows, per Condition, games, game length, win types and the first-mover
  rate, plus a preset × Condition score grid; `games.csv` has a `condition` column. `--condition fog` (or
  `--variant only-fog`) forces one. In Capture the Flag the bot picks up the flag,
  walks the carrier home (avoiding Dash, Vault, Pounce and Swap) and values reaching its zone as winning the game,
  escorts it, and goes after enemy carriers, more urgently the closer they are to their zone (extra value on
  damaging them, plus Hack and Hook to knock the flag loose).

## Look and feel

- **Theme:** all colors, fonts (Rajdhani for headings, buttons and numbers; Inter for text), spacing and
  radii live in `src/ui/theme.ts`, which sets them as CSS variables at startup. `style.css` contains no raw colors
  (a test enforces this).
- **Movement:** models glide hex by hex along their real path (never through walls), about 130 ms per hex with
  eased start and stop. Hook pulls, Shove and Vault glide too; the Dragon lifts off while flying. Swap is
  instant; Undo slides the model straight back in 180 ms. Input is locked while an animation plays.
- **Haptics:** a short tap when selecting a model or confirming a move or placement, a buzz on a hit, and a
  stronger pattern when a model dies (`navigator.vibrate`; silently does nothing where unsupported, e.g. iOS
  Safari).
- **Settings:** the ☰ menu has Animations and Haptics toggles, remembered in the browser. Animations default to
  off when the device asks for reduced motion.

## Code layout

```
src/core/        pure game logic, no DOM (ready for AI / online play later)
  hex.ts         axial hex math, lines, mirroring, pixel conversion
  rng.ts         seeded PRNG (state lives in GameState)
  mapgen.ts      deployment shape pick + mirrored terrain generation
  los.ts         line-of-sight rule + edge rule
  pathfinding.ts BFS movement range / paths
  queries.ts     read-only questions about a state (who's where, can X see Y, move range)
  combat.ts      attack preview + resolution, shared damage
  army.ts        army cost + validation
  overwatch.ts   overwatch area, target choice and end-of-turn shots
  auras/         hero aura rules, one module each + registry
  missions/      mission rules (King of the Hill, Capture the Flag), one module each + registry and random pick
  flag.ts        Capture the Flag's flag: carrier lookup, drops
  specials/      one module per special (Shove is unused for now, kept for future factions) + registry
  game.ts        newGame + applyAction(state, action) -> { state, events }
src/data/config.ts   unit stats, costs, game settings
src/data/deployShapes.ts   deployment shapes (zone rules)
sim/             balance simulator: headless runner, bot, armies, report (npm run sim)
src/ui/          SVG board, pan/zoom camera, HUD, army builder, overlays, controller
src/ui/theme.ts  every color, font, spacing step and radius (applied as CSS variables)
src/ui/settings.ts, haptics.ts   menu settings (animations, haptics) and vibration
tests/           Vitest unit tests
```

Every player input is an `Action` (`chooseArmy`, `place`, `move`, `attack`, `special`, `pickUp`, `endTurn`, ...) passed to the pure
`applyAction`, which returns a new state and a list of events the UI animates. An AI or network layer can drive the game by
producing the same actions.
