# Masked Spire: how the game works

The full tables (every card, hero, relic, enemy and intent) live in the spreadsheet. Run `npm run sheets` and open `docs/spreadsheet/masked-spire.xml` in Excel or Google Sheets. This page explains the rules.

## The run
- Pick a hero (Duelist, Bulwark, Brute, Elementalist). You start with 99 gold, a 10-card starter deck and the hero's starting relic.
- Each act has a 9-row, 4-lane map. Row 1 is a fight, row 5 a treasure, row 9 a rest site; the act boss follows. Other rows are fights, shops, rests and elites.
- Three acts: The Hollow Wood (Weeping Bellwarden), The Rust Bazaar (King Cog), The Faceless Crown (The Faceless Spire).
- Solo: beating the Spire wins. Co-op: both players then duel.

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
- **Elementalist:** each Attack gives 1 Block (ignores Frail). Quadrant Mask gives 5 Block on the first turn. The last Attack's element is tracked but has no effect yet.

## Rewards and economy
- After fights: gold, a choice of 3 cards (elites also drop a relic). Bosses give a boss relic, a 40% heal of missing HP, gold and 3 cards (the first is Rare).
- Shops: 4 cards (Common 45-55, Uncommon 68-82, Rare 130-150, +8 per act) and card removal for 60 gold.
- Rest: heal 25% of max HP, or remove a card (deck must stay above 5).
- After each fight everyone heals 2 HP (Ember Ring +5).

## Co-op and the duel
- Both players vote on the same map node. Each enemy targets a random living hero. A downed hero returns after the fight at 25% HP; if both fall, the run ends.
- The duel uses each player's current deck and relics, alternating turns. After round 8, sudden death deals 2 x (round-8) damage at the start of a turn.
- Co-op games live in server memory; reloading rejoins automatically.
