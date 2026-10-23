# Masked Spire: how the game works

The full tables (every card, hero, relic, enemy and intent) live in the spreadsheet. Run `npm run sheets` and open `docs/spreadsheet/masked-spire.xml` in Excel or Google Sheets. This page explains the rules.

## The run
- Pick a hero (Duelist, Bulwark, Brute, Elementalist). You start with 99 gold, a 10-card starter deck and the hero's starting relic.
- Each act has a 9-row, 4-lane map. Row 1 is a fight, row 5 a treasure, row 9 a rest site; the act boss follows. Other rows are fights, shops, rests and elites.
- Three acts: The Hollow Wood (Weeping Bellwarden), The Rust Bazaar (King Cog), The Faceless Crown (The Faceless Spire).
- Each act's boss is rolled per run (50% chance each, fixed by the map seed). Alternates: The Briar Regent (Act I, Thorns and self-heal, enrages at 50% HP), The Gilded Auctioneer (Act II, steals gold, Sold! hits twice if you played 7+ cards, Fire Sale at 50% HP), The Veiled Oracle (Act III, permanent Fate curses and hidden Hush, Unwrite and Void Gaze at 40% HP). In co-op both players face the same boss.
- Solo: beating the Spire wins. Co-op: both players then duel.

## New normal enemies
Three per act, using existing intent rules (the art is borrowed for now).
- **Act I:** Marsh Wisp (Glow gives Ritual +1, then Zap forever), Thistle Boar (+2 Strength, Gore 9, Snort 4 with Weak), Veil Spinner (Snare 3 with Vulnerable, Fang 3x3).
- **Act II:** Spark Welder (Arc 5 with Weak, 1 Burn to discard, Weld 9), Brass Hornet (Needle Storm 2x4, Hover 7 Block), Scrap Golem (Harden 10 Block, Slam 14 with Frail, Grind +2 Strength).
- **Act III:** Hollow Wailer (Keen 5x2 with Weak, erase a draw-pile card + 8 Block, Dirge 17), Porcelain Stalker (Veil 6 Block, Rend 8x2 with Vulnerable, Rend 8x2), Void Tithe (steals 10 gold, Rebuke 12 with Weak, Condemn 18).

## A turn
1. You get 3 Energy and draw 5 cards (hand cap 10). Block resets to 0 (Bulwark keeps half).
2. Play cards by spending Energy. Attacks hit enemies, Skills are mostly Block or utility, Powers last the whole fight. Exhaust cards are removed until the fight ends.
3. End your turn. When all living heroes have ended theirs, end-of-turn effects fire, then each enemy performs the intent it was showing.

## Damage
- Your hit: base + Strength + Rage + Whetstone + Rhythm x Flow, then Weak x0.75, Fury x1.5, Iron x0.75. Then the target: Vulnerable x1.5, Rooted /2, Fragile x1.25, Intangible caps at 1. Block absorbs first.
- Enemy hit: round(base x 1.725 x difficulty) + Strength, then Weak x0.75, then your Vulnerable x1.5 and Fury x1.25.
- Frail cuts Block gained from cards by 25%.
- Difficulty: Easy x0.8, Normal x1, Hard x1.2. Co-op multiplies enemy HP by 1.6.

## Statuses
Strength, Weak, Vulnerable, Frail, Thorns, Artifact, Rooted, Intangible, Reflect, Parry, Ritual, Shackle, Hush; hero resources Flow, Rage and Stance. See the Statuses sheet.

## Heroes
- **Duelist:** Attacks give Flow; at end of turn each Flow becomes 2 Block. Many cards scale with Flow.
- **Bulwark:** keeps half its Block each turn and turns Block into damage.
- **Brute:** three stances (Fury, Iron, Calm). Every switch draws a card; leaving Calm gives 2 Energy. Rage adds damage to every hit.
  - **Bulwark cards:** Shoulder Check (1, C, Attack): 5 dmg, 1 Vulnerable. Hold the Line (1, C, Skill): 8 Block, +4 if you already had 10+ Block. Siege Slam (2, U, Attack): 8 dmg + 1 per 4 Block. Spiked Bulwark (1, U, Skill): 6 Block, 3 Thorns.
  - **Brute cards:** Rage Jab (0, C, Attack): 4 dmg, 1 Rage. Battle Roar (1, C, Skill): 2 Rage, 4 Block. Crushing Blow (2, U, Attack): 8 dmg + 2 per Rage. Shifting Guard (1, U, Skill): 4 Block + 3 per stance switch this turn.
- **Elementalist:** each Attack gives 1 Block (ignores Frail). Quadrant Mask gives 5 Block on the first turn. The last Attack's element (fire, frost, storm or stone) is tracked. Echo: repeating the element gives 2 raw Block; shift: switching element draws 1 card. Many cards read this ("repeated" / "switched").
  - **Element cards (all Attacks):** Flame Wheel (1, C, fire): 3 dmg x2, 1 Burn, x3 hits if repeated. Cold Snap (0, C, frost): 3 dmg, 2 Chill, +4 Block if switched. Superconduct (1, U, storm): 6 dmg, 2 Shock, 5 Shock if last was Frost. Overload (1, U, storm): 4 dmg, 2 Shock, 5 Shock if repeated. Glacial Crush (2, U, frost): 10 dmg, 2 Chill, 18 dmg if last was Fire. Wildfire (2, U, fire): 5 dmg + 2 Burn to ALL, 5 Burn if repeated. Blizzard (2, R, frost): 6 dmg + 2 Chill to ALL, draw 2 if switched. Convergence (1, R, stone): 4 dmg + 3 per different element attacked with this combat.

## Rewards and economy
- After fights: gold, a choice of 3 cards (elites also drop a relic). Bosses give a boss relic, a 40% heal of missing HP, gold and 3 cards (the first is Rare).
- Shops: 4 cards (Common 45-55, Uncommon 68-82, Rare 130-150, +8 per act) and card removal for 60 gold.
- Rest: heal 25% of max HP, or Smith: upgrade one card (max +3 per card; curses and unplayable cards cannot be upgraded). Lv1: +2 damage on attacks, +2 block on skills, powers draw 1. Lv2: refunds 1 energy on cards that cost 1 or more. Lv3: Link bonus when the previous card played this turn was a different type. Cards that cost 0 get the Lv1 bonus again at Lv2 instead of a refund. Some cards have their own upgrade in place of the generic one at that level (CARD_UP in engine.js): Flurry and Frenzy hit one more time, Crescendo +6 per Flow, Grand Finale (Lv2) gives back half the Flow, Shield Bash uses 3/4 of Block, Reinforce and Hollow Reserve stop exhausting, Bastion and Eruption cost 1 less, Feast heals 12, Ember Lash applies 5 Burn, Tempest hits 3 times, Convergence +5 per element. Card text, cost and damage previews show the upgraded card; Smith shows each card as it will become.
- After each fight everyone heals 2 HP (Ember Ring +5).
- Shops also sell one non-boss relic you do not own (150-180 gold, +8 per act).

## New relics
- **Tallow Candle:** heal 3 HP at the start of each combat.
- **Brass Compass:** first turn of a combat, draw 1 extra card and gain 3 Block.
- **Vigil Bell:** gain 4 Block at the start of every turn after the first.
- **Raven Feather:** gain 1 Strength on your first turn against an Elite or Boss.
- **Obsidian Eye (boss relic):** enemies start each combat with 2 Vulnerable and 1 Weak.
- **Phoenix Ash (boss relic):** heal 3 HP at the start of every turn.
- Normal relics drop from elites, treasure rooms and Blood Pact; boss relics only from act bosses.

## Co-op and the duel
- Both players vote on the same map node. Each enemy targets a random living hero. A downed hero returns after the fight at 25% HP; if both fall, the run ends.
- The duel uses each player's current deck and relics, alternating turns. After round 8, sudden death deals 2 x (round-8) damage at the start of a turn.
- Co-op games live in server memory; reloading rejoins automatically.
