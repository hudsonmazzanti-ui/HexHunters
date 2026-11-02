/**
 * Bot tuning. Every number the bot uses to score an option lives here.
 *
 * An option is "move to a hex, then do an action (or nothing)". Its score is the
 * value of the action plus how much better the new hex is than the current one.
 * The bot takes the best option over all its models, repeats, and ends its turn
 * when nothing scores above `minGain`.
 *
 * Unit value (used to weigh damage and kills) is the unit's point cost, with a
 * floor of `minUnitValue` (squad members and alternate forms cost 0 in the data).
 */
export const WEIGHTS = {
  // ---- Fighting ----
  /** Per point of damage, times (target value / target max HP). */
  damage: 1.0,
  /** Bonus for killing a model, times its value. */
  kill: 1.6,
  /** Damage or kills on its own models count this many times as bad. */
  friendlyFire: 1.4,
  /** Setting an enemy burning (worth ~1 damage later). */
  burn: 0.5,
  /** Each point of HP restored (Heal, Eat), times (ally value / ally max HP). */
  heal: 0.8,

  // ---- Position ----
  /** Standing on the control point. */
  onPoint: 3.0,
  /** Extra for standing on the point when the enemy is on it too (contesting). */
  contestPoint: 1.5,
  /** Late in the round (second turn) holding the point matters more. */
  pointLateBonus: 1.0,
  /** Per hex closer to where it wants to be (enemy in range, or the point). */
  approach: 0.35,
  /** Expected damage an enemy could deal here next turn, times (own value / own max HP). */
  danger: 0.45,
  /** Danger from enemies that can't see the hex right now counts this much. */
  dangerUnseen: 0.5,

  // ---- Capture the Flag ----
  /** Per hex closer to a loose flag (only the two own models nearest to it chase it). */
  flagApproach: 0.45,
  /** Standing on the loose flag (ready to pick it up). */
  onFlag: 1.5,
  /** Picking up the flag. */
  pickUp: 5.0,
  /** Carrier: per hex closer to its own deployment zone. */
  carryHome: 1.4,
  /** Carrier: standing in its own zone at the end of the turn wins the game. */
  captureWin: 60.0,
  /** Carrier: the flag counts as this much extra value at stake when judging danger. */
  flagStake: 4.0,
  /** Per hex farther than 2 from its own carrier (escort). */
  escort: 0.25,
  /** Damage to the enemy carrier counts this many times as much (chase and kill it)... */
  carrierTarget: 1.6,
  /** ...plus this much more per hex it is within 5 of its own zone (it's about to win). */
  carrierUrgency: 0.8,
  /** Making the enemy carrier drop the flag (Hack, Hook), plus the same urgency. */
  knockFlag: 4.0,
  /** Making its own carrier drop the flag (Dash, Vault, Pounce, Swap, hooking it). */
  dropOwnFlag: 6.0,

  // ---- Specials without direct damage ----
  brace: 0.25, // per point of expected incoming damage it would block
  prep: 0.6, // when the model has nothing better to do
  spot: 0.35, // times target value, when an ally that hasn't acted can hit it
  dash: 0.3, // per extra hex, when no enemy is in range
  vault: 0.6, // when it gets closer to an enemy
  load: 2.0, // Artillery loading when it can't fire
  overwatch: 1.0, // base, plus per enemy that could walk into the watched area
  overwatchPerEnemy: 0.6,
  hack: 0.25, // times target value
  smash: 0.3, // only when an enemy is near (opens lines)
  pounce: 1.2, // when an enemy is just out of reach
  swap: 1.0, // times the positional gain of both twins
  premiumShotCost: 1.0, // a limited shot is worth saving for a good target
  hookPull: 0.3, // per hex an enemy is pulled toward its own side

  // ---- Choice ----
  /** Ignore options that gain less than this. */
  minGain: 0.05,
  /** Random noise added to each option (fraction of a point), so games differ. */
  jitter: 0.15,
  /** Values below this are bumped up (squad members, forms). */
  minUnitValue: 4,
} as const;

export type Weights = typeof WEIGHTS;
