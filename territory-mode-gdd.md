# Arachnid Origins: Territory Mode - Game Design Document

**Status:** Draft v0.1 (2026-10-05). All five milestones are implemented in v1.2.0; section 14 lists what was built and where it departs from this draft.
**Companion documents:** `GDD.md` (overall design), `ARCHITECTURE.md` (module contract). This document only covers what Territory adds or changes. Anything not mentioned here behaves as in the base game.

---

## 1. Mode Overview

### 1.1 Concept
Territory is a persistent, save-anywhere campaign. Brood and Survival are about a single *journey*: one spider, hatching to egg sac, one sitting. Territory is about a *place*. The player founds a home site, and the world remembers it across sessions: the webs they built, the food they stored, the seasons that have passed, and the line of spiders that lived there.

The spider still grows through the same five stages and the story of each life still ends at the egg sac. What changes is that the egg sac is no longer the end of the game. It is the start of the next generation, hatching into the territory the previous one built.

### 1.2 How Territory Differs From the Existing Modes

| | Brood (default) | Survival | **Territory** |
|---|---|---|---|
| Focus | One journey, with a safety net | One journey, no safety net | **A lineage and a place, over many journeys** |
| Saving | None | None | **3 slots, autosave + manual + suspend** |
| On fatal blow | A sibling gives its life to revive you (up to 5) | Game over | **Succession: an heir takes over; the territory survives** |
| Egg sac laid | Victory screen, run ends | Victory screen, run ends | **Legacy scene, then next generation hatches** |
| Calendar | Day/night only (300 s day) | Day/night only | **Day/night plus four seasons and a year** |
| World between sessions | Resets every game | Resets every game | **Persists: webs, stores, rank, calendar** |
| Ends when | Victory or death | Victory or death | **Never, unless the line dies out** |

Sibling revives (Brood's mechanic) are **disabled** in Territory and replaced by succession (section 3.3). Siblings still raise alarms and huddle while you rest, exactly as in the other modes.

### 1.3 Design Pillars
1. **A place that remembers.** Everything the player builds and every season that passes is still there when they come back.
2. **Time matters.** Seasons change what is possible. Planning for winter is as important as hunting today.
3. **Failure is a setback, not an ending.** Death costs something real but never wipes the save, unless the whole line dies out.
4. **Additive to the engine.** Territory plugs into the existing module and event contract through optional hooks. Brood and Survival must behave exactly as before.

### 1.4 Target Session Shape
- A session is 20 to 60 minutes. Saving is possible at any time, so players never need to finish a stage or season in one sitting.
- One in-game season is about 45 minutes of play; one in-game year is about 3 hours (section 5.1).
- A full generation takes a minimum of about 80 minutes and more typically 2 to 3 hours.

---

## 2. Core Loop

### 2.1 Moment to Moment
Identical to the base game (section 2.1 of `GDD.md`): explore, gather, avoid predators, grow, molt. Webs, shelters and resources are the same objects, so existing play skill carries over.

### 2.2 Per Season
1. **Read the season.** The calendar chip and a season banner tell the player what has changed (prey, weather, danger).
2. **Work the territory.** Maintain heirloom webs, hunt in the claimed area, wrap and store prey in the pantry.
3. **Handle the season event** (a rival invasion in summer, mating season in autumn, frost in winter).

### 2.3 Per Generation
1. Hatch in spring at the home site.
2. Grow through the stages (growth is driven by eating and objectives, not by the calendar).
3. In late summer, reach adulthood, find the mate, court.
4. Choose where to lay the egg sac and which traits to pass on.
5. Legacy scene, calendar fast-forwards through winter, next spring the heirs hatch.

### 2.4 Per Campaign
Raise Territory Rank, build a lineage, fill the Codex, unlock bigger inheritance, and see how many generations the line can hold.

---

## 3. Generations and Lifecycle

### 3.1 The Generation Cycle
One generation is one lifecycle, roughly one calendar year.

| Phase | Calendar | What happens |
|---|---|---|
| Hatch | Spring, day 1 | Heirs hatch from the sac. The player is one of them, at stage 0, at the Home Site. |
| Grow | Spring to summer | Hatchling to sub-adult. Stage growth is by `growthNeeded` as today. |
| Mature | Late summer | Adult stage. The mate is eligible to appear from day 16. |
| Mate and lay | Day 16 to 27 ideal | Courtship, then the player picks an egg site and lays the sac. |
| Legacy and winter | Day 28 to 36 | Mother's story ends. Calendar fast-forwards to the next spring. |

Growth is not gated by the calendar. A slow player who is still a juvenile in autumn has to deal with falling prey and early frost; a fast player simply waits for the mating window to open.

### 3.2 The Home Site
The **Home Site** is the egg site (`world.shelters` entry with `eggSite: true`) that the current generation hatched from.
- **Generation 1:** the game places the founding sac at the egg site nearest `Game.C.SPAWN`, in the Leaf Litter.
- **Later generations:** wherever the previous mother laid the sac. This is a real choice: Leaf Litter is safest, Old Oak Bark has ants and centipedes, the Flower Garden is rich in prey but has wasps, mantises and birds.
- Moving the Home Site resets the Claim radius (the old webs outside it become ordinary webs that decay), so relocating is a strategic risk.

### 3.3 Succession (replaces Brood's sibling revive)
When a fatal blow lands, instead of `player:downed` and a sibling sacrifice, Territory runs **Succession**:

1. The line has a counter of **Heirs**: living siblings in generation 1 (starting at 5, like Brood's siblings), or the clutch size of the previous mother in later generations.
2. If at least one heir remains, one heir is spent. The player takes over as that heir after a short fade, at the nearest owned shelter (the Home Site's retreat web if none nearer).
3. The new body keeps the **same stage** and all molt upgrades chosen so far (they are heritable family traits in this mode), but suffers a **Setback**:
   - 50% of progress toward the next molt is lost.
   - Hunger, hydration and energy restart at 50%; silk is empty.
   - "Shaken" for one in-game day: -15% speed.
   - The pantry is untouched, but heirloom webs within 400 px of the death lose 20% integrity.
4. The cause of death and a short science note are logged in the Lineage (section 6.3), replacing the Game Over screen with a one-screen **Succession** card.

**Line broken:** if a fatal blow lands with 0 heirs, the line has ended. The player sees a Lineage Ended screen (generations lived, rank reached, longest-lived spider, facts unlocked). Options: **Found a New Line** (starts a new save in the same slot; Codex and species unlocks persist because they are global) or **Return to Title**. The finished lineage is kept in the slot's Hall of Lines.

### 3.4 Egg Laying and Legacy
When the player lays the sac (the existing `game:victory` trigger point in `player.js`), Territory instead emits `territory:generation_end` and plays the **Legacy scene**:
- The mother's story is summarized (stage times, prey eaten, webs spun, facts learned).
- **Clutch size** is calculated (see 10, Tuning): base 3, plus condition and pantry bonuses, times a timing multiplier based on the day she laid.
- The player picks **Inherited Traits** (section 6.1).
- The calendar fast-forwards through winter. Offscreen systems are coarse-simulated: heirloom webs decay by the winter factor, perishable stores spoil, resource nodes regrow.
- Spring day 1 begins. The player hatches as one of the new heirs.

---

## 4. Territory and Home Site

### 4.1 The Claim
Around the Home Site is the **Claim**: a circular area where Territory rules apply. It starts at radius 600 px (the world is 6400 x 3600) and grows with Territory Rank. Inside the Claim:
- Heirloom webs persist and are maintained.
- The pantry can be accessed.
- Hunters are slightly less bold (-10% detection) as the local fauna gets used to the spider.

### 4.2 Territory Rank
Earned with **Claim Points (CP)**:

| Source | CP |
|---|---|
| Each heirloom web kept above 50% integrity through a night | +1 |
| Prey caught inside the Claim | +0.2 |
| Rival repelled (section 4.5) | +5 |
| Winter turnover survived (generation completed) | +10 |

| Rank | Name | CP | Claim radius | Heirloom web slots | Pantry capacity | Trait slots | Heir bonus |
|---|---|---|---|---|---|---|---|
| 1 | Claim | 0 | 600 px | 4 | 6 | 1 | +0 |
| 2 | Hold | 25 | 800 px | 6 | 10 | 1 | +0 |
| 3 | Domain | 75 | 1000 px | 8 | 15 | 2 | +1 |
| 4 | Stronghold | 150 | 1200 px | 10 | 20 | 2 | +1 |
| 5 | Dominion | 300 | 1400 px | 12 | 30 | 3 | +2 |

All values are starting points for tuning.

### 4.3 Heirloom Webs
Currently `webs.js` caps live webs at about 40 and fades the oldest. In Territory, a web inside the Claim can be marked **heirloom** (interact with it, E, costs a small amount of silk). Heirloom webs:
- Are exempt from oldest-first culling.
- Persist in the save and across generations, losing integrity over time and with rain and wind.
- Need **maintenance**: standing at the web and pressing E repairs it for silk. Pressing and holding **Recycle** instead consumes the web and returns about half its silk cost, mirroring real orb-weavers that eat old silk and respin it.
- Count toward the slot limit for the current Rank.

### 4.4 Pantry
Prey caught in webs can be **wrapped and stored**: press E on a trapped or freshly killed creature inside the Claim near a retreat web (costs 5 silk). Each bundle is a pantry item with a kind, nutrition value and freshness.
- Stored items restore hunger when the player eats at home (rest, R, in a retreat web).
- Freshness decays faster in summer than winter.
- Pantry contents at egg-laying add to the clutch size.
- Capacity is set by Rank.

### 4.5 Rivals and Seasonal Events
Territory events use the existing creature roster so no new art is required for the first version:
- **Summer invasion:** a wolf spider or jumping spider (existing `KINDS`) moves into the Claim and begins breaking heirloom webs. Driving it off or killing it grants CP.
- **Autumn mating season:** the mate becomes available, drawn in by the pheromone trail already shown by the HUD.
- **Winter cold snap:** a frost event that damages exposed small spiders and webs outside shelter.
- The Widow Matriarch boss (and the Black Widow unlock) works as today. Whether she returns each year is an open question (section 13).

---

## 5. Seasons and Calendar

### 5.1 The Year
`Game.C.DAY_LENGTH` is 300 s. Territory defines a **year of 36 days** (`SEASON_DAYS = 9`), which at 300 s is 10,800 s, about 3 hours of playing time. Only `Game.time.t` advances while in the `playing` scene, so paused and menu time does not count. The calendar reads `Game.world.dayCount`; it does not add a second clock.

### 5.2 Seasons

| Season | Days | Prey | Weather bias | Metabolism | Notes |
|---|---|---|---|---|---|
| Spring | 1 to 9 | x1.0, rising | Rain and drizzle common | Hunger/thirst x0.9 | Hatching; dew is plentiful |
| Summer | 10 to 18 | x1.3 (flyers peak) | Clear, heat | Thirst x1.2 | Wasps and mantises x1.3; rival invasion |
| Autumn | 19 to 27 | x0.8, falling | Fog and heavy dew | Normal | Mating season; birds x1.2 |
| Winter | 28 to 36 | x0.25, no flyers | Frost, cold snaps | Hunger/thirst x0.7 | Exposed spiders take damage; retreat webs heal |

The multipliers are applied through hooks into existing systems (population targets in `creatures.js`, weather weights in `world.js`, drain multipliers in `player.js`).

### 5.3 Mating Window and Laying
- The mate is spawned by `creatures.spawnMate()` as in the base game, but only once the player is an adult **and** the calendar day is at least 16. Before then the HUD shows "Not mating season yet".
- The egg sac clutch multiplier by day laid: days 16 to 27 x1.0; days 28 to 32 x0.7; day 33 and later x0.4. This is a gradient, not a cliff, so a slow player is penalized but not blocked.

### 5.4 Winter for Players Still Alive
A player who has not laid by day 28 plays through winter in real time. Winter is a hostile environment (frost, scarce prey), and retreat webs plus a stocked pantry are what carry a late spider through to laying.

---

## 6. Legacy and Progression

### 6.1 Inherited Traits
The seven molt upgrades in `Game.C.UPGRADES` (speed, silk, camo, venom, carapace, vibration, metabolism; max level 3) are the trait pool. At the Legacy scene the player picks up to the number of **Trait slots** allowed by Rank. Each chosen upgrade is passed on at **one level below** the mother's level, minimum 1 (so a level-3 Swift Legs mother passes level 2). Heirs then pick new upgrades at each molt as usual, stacking on the inherited base up to the normal max of 3.

**Mutation:** each generation has a small chance (default 15%) that one random upgrade the mother did not have appears at level 1, flagged in the Lineage as a mutation.

### 6.2 Species
The lineage keeps the species it was founded with. The Black Widow remains a global unlock (stored via `Game.unlocks`) available when founding any new lineage.

### 6.3 The Lineage
The Lineage is a new tab in the Codex (B). It lists each generation with: species, the year laid, stage reached, cause of death or "laid the sac", clutch size, traits inherited, and a mutation badge where relevant. It also shows heirs remaining.

---

## 7. Save System

### 7.1 Overview
Territory is the first mode that needs saving, and the save system is the main technical work. Brood and Survival stay unsaved; the save system is only used when `Game.state.mode === 'territory'`.

**Three kinds of save:**
- **Autosave:** automatic checkpoint, one per slot, overwritten.
- **Manual save:** player-triggered from the pause menu (Save) or by resting in the home retreat web. Writes the same slot, keeps the previous manual save as a backup.
- **Suspend (Save & Quit):** a one-shot snapshot of the exact moment, used when the player has to leave mid-action. Loading a suspend save deletes it and falls back to the last checkpoint the next time (this avoids using suspend for save-scumming).

**Slots:** 3. Each shows a card with species, Year and Season, Generation, Territory Rank, play time, and last saved time.

### 7.2 When Autosave Fires
- On each season change.
- After `molt:end`.
- After `territory:generation_end` (Legacy scene).
- Every 5 minutes of play, if `Game.state.danger < 0.2`.
- When the game pauses on window blur (core already pauses on blur), as a suspend snapshot.

### 7.3 What Is Saved

**Durable (the lineage and territory):**
- Lineage: generation number, heirs remaining, per-generation records, traits inherited, mutations.
- Territory: Home Site id and position, Claim Points and Rank, heirloom webs, pantry items.
- Calendar: year, `world.dayCount`, `world.time01`, weather.
- Totals: stats, objectives progress, play time.

**Live snapshot (mid-generation):**
- Player: position, angle, stage, hp, hunger, hydration, energy, silk, growth, upgrades, mate progress, moltTimer.
- World dynamic state: resource amounts, explored grid, weather, time.
- Webs: the live list (all webs, heirloom flagged).
- Persistent creatures only: the mate, the boss and its state, active rivals, and the sibling count. All other creatures are **not** saved; the population system respawns them from seed and season on load. This keeps saves small and means the world "keeps living" while you are away.

**Global (not slot-specific, already persisted):** settings, species unlocks, Codex facts (`edu.unlocked`). These stay global so a new lineage keeps them.

### 7.4 Save Format
A single JSON document per slot, versioned.

```json
{
  "schema": 1,
  "gameVersion": "1.2.0",
  "savedAt": "2026-10-05T17:30:00Z",
  "kind": "autosave",
  "meta": { "species": "garden", "year": 1, "season": "summer", "day": 14, "generation": 1, "rank": 2, "playSeconds": 6120 },
  "seed": 482913,
  "calendar": { "dayCount": 13, "time01": 0.31, "weather": { "type": "clear", "intensity": 0 } },
  "lineage": { "heirs": 4, "generations": [ { "n": 1, "species": "garden", "status": "alive" } ] },
  "territory": { "home": { "shelterId": 17, "x": 420, "y": 1750 }, "cp": 31, "heirloomWebs": [], "pantry": [] },
  "player": { "x": 980, "y": 1630, "stage": 2, "hp": 71, "hunger": 64, "hydration": 58, "energy": 77, "silk": 82, "growth": 140, "upgrades": { "speed": 1 } },
  "world": { "resources": [], "explored": "<base64>" },
  "webs": [],
  "creatures": { "persistent": [] },
  "stats": {},
  "checksum": "..."
}
```

### 7.5 Module Hooks (Contract Addition)
`ARCHITECTURE.md` gets two new **optional** module methods, so modules without them are simply skipped and the robustness rule ("other modules may be missing or broken") still holds:

```
serialize()          // returns a plain JSON-safe object for this module's slice of state
deserialize(data)    // restores that slice after reset(); must tolerate missing/old fields
```

A new `Game.save` module orchestrates them:

```
Game.save.slots()                  -> array of slot meta cards
Game.save.write(slot, kind)        -> bool    // kind: 'autosave' | 'manual' | 'suspend'
Game.save.read(slot)               -> object|null
Game.save.delete(slot)
Game.save.exportSlot(slot) / importSlot(file)
Game.save.backend                  // swappable storage adapter (see 7.7)
```

### 7.6 Load Flow
1. `Game.loadGame(slot)` reads and validates the slot (schema, checksum, migration).
2. It runs the same path as `Game.newGame('territory')`, calling every module's `reset()`, with the saved `seed` fed to world generation.
3. It calls each module's `deserialize(data)` in ascending module priority order.
4. It sets the camera (`cam.snap()`), shows a short "Welcome back" card (season, day, what changed while you were away), and sets the scene to `playing`.

### 7.7 Storage and Reliability
- **Backend:** IndexedDB for slot snapshots (they can reach hundreds of KB), `localStorage` (via `Game.store`) for the slot index and settings. If IndexedDB is unavailable, fall back to `localStorage`, then to in-memory (as `Game.store` already does). The backend is an adapter so the Node test harness can inject an in-memory one.
- **Safe writes:** write to a temporary key, verify by reading back, then swap. Keep one previous save as a `.bak`. On read failure, fall back to the `.bak` and tell the player.
- **Failure handling:** a quota or write error shows a "Couldn't save" toast, never throws, and routes through `Game.reportError`.
- **Migration:** each `schema` bump has a migration function chained from the stored version to the current one. Unknown newer schema refuses to load with a clear message.
- **Backup:** Export and Import of a slot as a `.aosave` JSON file. Because the game runs in a browser (Vercel), browser data can be cleared; the pause and slot menus suggest exporting after long sessions.
- **Multiple tabs:** a lease key in storage stops two tabs from writing to the same slot; the second tab opens read-only with a warning.

### 7.8 Determinism
World generation must accept a seed (the engine already ships `Game.util.mulberry32`). `world.reset()` and the terrain pre-render must use it rather than `Math.random()`. This is the main item to verify in `world.js`; see section 13.1.

---

## 8. UI and UX

### 8.1 Title Screen
- **New Game** picker adds **Territory** (tag: "Saves") alongside Brood and Survival.
- A real **Continue** button replaces the hint, showing the most recent save's card. A **Load** screen lists the three slots.
- New Territory game: pick a slot, pick species (existing picker), name the lineage (optional, default "Line of the Garden Spider").

### 8.2 HUD Additions
- **Calendar chip** beside the day/night clock: season icon, "Day 14 of 36, Year 1".
- **Territory chip:** Rank name and a small CP bar, shown when inside the Claim.
- **Pantry counter** when near the Home Site.
- Season banner on `season:change`, in the same style as the zone banner.
- "Saved" toast on any successful save.

### 8.3 New Screens
- **Pause menu:** adds Save, Save and Quit, Territory, Lineage.
- **Territory screen** (new key `T`): Rank, CP, Claim map overlay, heirloom web list with integrity, pantry contents.
- **Succession card** (replaces Game Over in this mode) and **Lineage Ended** screen.
- **Legacy scene** (replaces Victory in this mode): summary, trait picker, clutch size, then winter fast-forward.
- **Welcome back card** on load.

---

## 9. Educational Integration
Territory is a natural fit for the game's learning goals (`GDD.md` section 9).
- **Life cycle and phenology:** why spiders time mating and hatching to the seasons.
- **Overwintering:** egg sacs and juveniles that survive winter (to be fact-checked per species).
- **Silk recycling:** many orb-weavers eat old webs and reuse the silk proteins; this is the basis of the Recycle mechanic.
- **Territory and competition:** why spiders defend webs and how rivals affect each other.
- **Heredity and variation:** simplified inheritance and mutation shown in the Lineage.

About 8 to 10 new Codex facts are planned. As with the rest of the game, they need review by an arachnologist before release.

---

## 10. Tuning Values (Starting Points)

| Parameter | Value |
|---|---|
| Save slots | 3 |
| Day length | 300 s (unchanged) |
| Season length / year | 9 days / 36 days |
| Starting heirs (generation 1) | 5 |
| Clutch size | 3 base, +1 per 5 pantry items (max +3), +1 if all meters above 60 at laying, + Rank heir bonus; times laying-day multiplier |
| Succession setback | -50% molt progress, meters at 50%, silk 0, -15% speed for 1 day |
| Mutation chance | 15% per generation |
| Trait inheritance | Mother's level minus 1, minimum 1 |
| Heirloom web slots | 4 to 12 by Rank |
| Autosave interval | 5 min, if danger < 0.2 |
| Recycle silk return | 50% |

---

## 11. Technical Plan

### 11.1 New Files
| File | Module | Priority | Owns |
|---|---|---|---|
| `territory.js` | `territory` | 12 | Calendar and seasons, lineage, Claim and Rank, heirloom flags, pantry, succession, legacy logic |
| `save.js` | `save` | 5 | Slots, backend adapter, serialize orchestration, migration, import/export |

Load order becomes: `core.js`, `world.js`, `webs.js`, `player.js`, `creatures.js`, `edu.js`, `territory.js`, `save.js`, `audio.js`, `ui.js`, `main.js`.

### 11.2 Changes to Existing Modules
- **`core.js` (lead-owned):** add the `territory` entry to `Game.C.MODES`; add `Game.loadGame(slot)`; add `territory: ['KeyT']` to `KEYMAP`; pass the mode through `newGame`. Bump `VERSION`/`CHANGELOG` with `tools/bump.js` (minor release).
- **`world.js`:** accept a seed; add a `frost` weather type; read season weights for weather; add `serialize`/`deserialize`.
- **`webs.js`:** heirloom flag, culling exemption, maintenance and Recycle interaction; `serialize`/`deserialize`.
- **`player.js`:** Territory branch of `die()` (succession instead of `claimSibling`); Territory branch of the egg-laying end (`territory:generation_end` instead of `game:victory`); calendar-gated `spawnMate`; `serialize`/`deserialize`.
- **`creatures.js`:** season multipliers on population targets; disable sibling revive and sibling drift in Territory (heirs are tracked by `territory`); rival invasion event; persist only the mate, boss, rivals and sibling count.
- **`edu.js`:** Territory objectives layer (for example "Keep 3 heirloom webs through a night", "Fill the pantry", "Survive your first winter") and the new facts.
- **`ui.js`:** all screens in section 8.

### 11.3 New Events
`season:change {season, prev}`, `territory:rank {rank}`, `territory:claimed {x, y}`, `web:heirloom {web}`, `pantry:store {kind}`, `succession {heirs}`, `territory:generation_end {generation}`, `lineage:ended`, `save:written {slot, kind}`, `save:loaded {slot}`.

### 11.4 Testing
Extend `tools/harness.js`:
- **Round trip:** run N seconds, `serialize` everything, `reset()`, `deserialize`, compare key `Game.snapshot()` fields and web counts.
- **Scripted year:** fast-forward through all four seasons and confirm season effects and no errors.
- **Succession test:** force fatal blows with heirs remaining and with none.
- **Corruption test:** truncated JSON, wrong checksum, and an old schema version must fail safe.
- **Backend adapter:** in-memory backend so tests run in Node without browser storage.
- Always assert `Game.errors.length === 0`.

---

## 12. Milestones
1. **M1: Save core.** `Game.save`, backend adapter, serialize hooks for player, world and webs, slot UI, Continue. Territory appears as a mode with no seasons yet. Done when a save/load round trip passes in the harness.
2. **M2: Calendar and seasons.** Season effects, calendar chip, frost, season banners.
3. **M3: Territory persistence.** Home Site, Claim, heirloom webs, pantry, Rank.
4. **M4: Generations.** Egg-laying hook, Legacy scene, succession, Lineage tab, inheritance and mutation.
5. **M5: Events and polish.** Rival invasions, new facts, tuning pass, export/import, Welcome back card.

---

## 13. Risks and Open Questions

### 13.1 Risks
- **World determinism:** if `world.js` uses `Math.random()` in `reset()`, a loaded world will not match the saved one. Verify first.
- **Browser storage:** data can be cleared. Mitigated by export/import; cloud saves would need accounts and are out of scope.
- **Save size and speed:** large web lists and the explored grid could be slow to serialize. Compress the grid and measure.
- **Pacing:** the 3-hour year and the minimum generation length are untested assumptions. Expect to tune `SEASON_DAYS` and the laying-day multipliers after playtests.
- **Rushing:** a skilled player might loop quick generations. The day-16 mating gate sets a floor; scaling difficulty per generation may still be needed.

### 13.2 Open Questions
1. Should the Widow Matriarch return every year, or is defeating her once permanent for that lineage?
2. Should a broken line offer a one-time "wandering founder" reprieve that keeps the territory in ruins, or is Found a New Line enough?
3. Should heirs be able to choose a different species from the Unlocked list for a new generation?
4. Should the Brood-mode sibling revive ever return as an optional Territory difficulty setting?
5. Is a hibernation fast-forward (skip winter from a retreat web) wanted for players who are still alive in winter?

---

## 14. Implementation Notes (v1.2.0)

What was built, by milestone, and where the implementation departs from the draft above. The code is the reference for exact numbers: the tuning constants sit at the top of `src/territory.js` and `src/save.js`. The module contracts are in `ARCHITECTURE.md` (sections G and H).

### 14.1 What was built
- **M1, save core:** `src/save.js`. Three slots, three kinds (`autosave`, `manual`, `suspend`), a safe write (temporary key, read-back, `.bak`, real key), an FNV-1a checksum, a schema number with a migration chain, `.aosave` export/import, one tab per slot, Hall of Lines, Continue / Load Game / Welcome back card. Every module that has state to keep gained optional `serialize()` / `deserialize(data)`.
- **M2, calendar and seasons:** `src/territory.js`. A 36-day year read from `world.dayCount`; season effects on prey and flyers, birds, hunger and thirst, weather odds, a new `frost` weather, winter healing in a retreat, and the day-16 mating gate. Calendar chip and season banners in the HUD.
- **M3, territory persistence:** the Home Site and its Claim, Claim Points and the five Ranks, heirloom webs (mark, repair, recycle, exempt from the web cap), the pantry (wrap, freshness by season, eating by resting in the retreat), the Territory screen (T).
- **M4, generations:** succession with the Setback, the Lineage Ended screen, "Found a New Line", the three-step Legacy scene (her story, inherited traits, winter), clutch size, inheritance one level below the mother's, 15% mutation, the Lineage tab in the Codex.
- **M5, events and polish:** the summer rival, ten new facts and seven Territory goals, the Welcome back card, export/import. The tuning values are the draft's starting points; no playtest pass has been done yet.

### 14.2 Departures from the draft
1. **World determinism (13.1).** The world was already deterministic (a fixed `SEED`), so the save stores the seed and refuses a mismatch instead of re-seeding. Only what changes is saved: the clock, weather, resource amounts and the explored map.
2. **Synchronous save API.** `Game.save` works on an in-memory cache and writes to IndexedDB (localStorage, then memory, as fallbacks) behind it, so the title can draw slot cards immediately and nothing in the game loop waits on storage. `save:written` fires when a snapshot is durably stored.
3. **Heirs are the clutch.** The heirs waiting after a Legacy scene are that clutch's size (3 + pantry + condition + rank bonus, scaled by how late she laid); a brand-new lineage starts with five.
4. **The Widow Matriarch stays gone** once beaten (open question 13.2.1): her defeat is permanent for the player, as in the other modes, and her empty lair remains.
5. **No reprieve and no species swap** (13.2.2, 13.2.3): a broken line goes to the Hall of Lines and "Found a New Line" keeps the same species. No hibernation fast-forward (13.2.5); the winter turnover only happens through the Legacy scene. Brood's revive does not return as a setting (13.2.4).
6. **Territory goals live in `edu.js`**, next to the survival objectives, rather than in territory.js. They pay Claim Points through `territory.addCP`.
7. **The turnover always runs to spring.** `season:change {season: 'spring', prev: 'winter'}` fires when the next generation hatches whatever the day she laid, so "Survive your first winter" completes at the first Legacy scene.
8. **A new lineage clears its slot** (its Hall of Lines stays) as soon as it starts, so an old suspend save can never outrank the new lineage.
9. **Mid-action saves.** A molt or egg-laying in progress is saved and resumed; a boss fight is saved as dormant (she resets, as when the player flees). Nothing is written while the Succession card or the Lineage Ended screen is up.

### 14.3 Tests
`tools/test_save.js`, `tools/test_seasons.js`, `tools/test_territory.js`, `tools/test_generations.js`, `tools/test_territory_ui.js` (see `ARCHITECTURE.md`, Testing). `tools/test_modes.js` and `tools/test_species.js` were updated for the third mode card and the sixth Codex tab.
