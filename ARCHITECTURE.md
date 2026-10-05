# Arachnid Origins — Architecture & Module Contract

Browser game, plain JavaScript (no build step, no external libs), HTML5 Canvas 2D. All art is **procedural** (drawn with canvas code) and all audio is **procedural** (Web Audio). Read `GDD.md` for the design. Read `src/core.js` for the engine (do not edit it; if you need a change, describe it in your final report).

Files load in this order (`index.html`): `core.js`, `world.js`, `webs.js`, `player.js`, `creatures.js`, `boss.js`, `edu.js`, `audio.js`, `ui.js`, `main.js`.
Each module is one file that ends by calling `Game.register(name, moduleObject)`. After registering, the object is available as `Game.<name>` (e.g. `Game.player.x`). **The module object itself is the public state + API.**

| file | module name | priority | owner agent |
|---|---|---|---|
| world.js | `world` | 10 | A: World & atmosphere (+ `audio.js`) |
| audio.js | `audio` | 60 | A |
| webs.js | `webs` | 20 | B: Silk & webs |
| player.js | `player` | 30 | C: Spider, growth, molting, survival |
| creatures.js | `creatures` | 40 | D: Ecosystem AI |
| boss.js | `boss` | 45 | F: The Widow Matriarch boss fight (unlocks the Black Widow) |
| edu.js | `edu` | 50 | E: Education, objectives, bestiary data |
| ui.js | `ui` | 100 | E: HUD, menus, title, screens |

Update order = ascending priority. Modules may define: `init()` (once, at boot), `reset()` (new game / title; rebuild ALL state here — must be idempotent and fast), `update(dt)` (seconds, only while scene==='playing' unless `alwaysUpdate:true`), `lateUpdate(dt)`. Drawing is done by registering drawers in `init()`:
`Game.addDrawer(Game.LAYER.X, ctx => {...})` (world space, camera transform already applied, use `Game.camera.view` / `Game.camera.inView(x,y,pad)` to cull) and `Game.addScreenDrawer(layer, ctx => {...})` (screen space 1280x720).
Never call `ctx.save/restore` imbalance: core wraps each drawer in save/restore for you.

**Robustness rules (important):**
1. Other modules may be missing/broken. Guard every cross-module call: `if (Game.creatures && Game.creatures.list) ...`. Never throw at load time.
2. Use only the APIs documented below for cross-module access. If you need to *add* a field to your own module, that is fine and encouraged.
3. Use `Game.time.t` for simulation timers (pauses with the game) and `Game.time.real` for purely visual animation (always advances).
4. Never allocate in hot loops when avoidable (reuse arrays); keep 60 fps with ~150 creatures on screen-culled drawing. Cull offscreen work.
5. No `alert`, no network, no external assets. Text fonts: use `'Georgia, serif'` for titles and `'system-ui, sans-serif'` for UI.
6. Coordinates: world is `Game.C.WORLD_W x WORLD_H` = 6400 x 3600, top-down view. Angles are radians (0 = +x/right, +y is down). Player starts at `Game.C.SPAWN`.

## Shared constants — `Game.C` (see core.js)
`STAGES[0..4]`, `WEB_TYPES`, `UPGRADES`, `ZONES`, `SFX`, `KEYMAP`, `DAY_LENGTH`, `MODES`, `SPECIES`. Zones are vertical bands: litter x 0–2400, bark 2400–4200, garden 4200–6400. Stage 0 hatchling … 4 adult.

## Playable spiders — `Game.C.SPECIES`, `Game.unlocks`
`Game.C.SPECIES` is data: the starter (`garden`, Garden Spider) first, then spiders unlocked by beating a boss (`widow`, Black Widow, unlocked by the Widow Matriarch). Each entry: `{id, name, latin, tag, blurb, perks[], mods, leg, unlock?, boss?}`. `mods` multiplies stats in `player.applyUpgrades` (`speed`, `bite`, `silk`, `hp`), `venom` is the share of a bite's damage that keeps poisoning prey, `nightStealth` multiplies how easily hunters notice you after dusk; `leg` stretches the legs. To add a spider: add an entry, a palette (and markings) in player.js (`PAL_*` / `PALS`, `ABD_SHAPE`), and a way to call `Game.unlocks.unlock(id)`.
```
Game.unlocks.has(id) / .list() / .unlock(id) -> bool (true if new; emits species:unlocked) / .reload()   // saved in the store ('unlocks'); the starter is never locked
Game.speciesInfo(id) -> entry (unknown id = the starter)      Game.pickSpecies(id?) -> the id a new game would use (locked/unknown -> saved choice -> starter)
Game.newGame(mode?, species?)  // species: an unlocked id; omitted/locked/unknown = Game.settings.species, else the starter. Sets Game.state.species
Game.settings.species          // the spider chosen last (saved); the title's New Game opens a "Choose your spider" step after the mode card once 2+ are unlocked
```

## Input — `Game.input`
`down(action)`, `pressed(action)`, `released(action)`, `axis()` -> `{x,y}`, `mouse` (`x,y` screen; `wx,wy` world; `down,pressed,released`), `anyPressed()`.
Actions: up/down/left/right (WASD/arrows; with `Game.settings.mouseAim` (default on) W/S move toward/away from the cursor, A/D strafe, and the spider always faces the mouse), `guide` (H, toggles the HUD key guide), `sprint` (Shift), `spin` (Space), `bite` (J or left mouse), `interact` (E), `rest` (R), `web1..web4` (1-4), `map` (M), `codex` (B), `science` (F), `zoomOut` (Z, handled by core), `pause` (Esc/P), menu nav actions `menuUp/menuDown/menuLeft/menuRight/confirm/back/tabNext/tabPrev`.
Test injection: `Game.input.inject.keyDown('KeyW')`, `.keyUp`, `.click(x,y)`.

## Camera — `Game.camera`
`x,y,zoom,targetZoom` (player sets `targetZoom = STAGES[stage].zoom`), `target` (defaults to Game.player), `shake(amount)`, `worldToScreen`, `screenToWorld`, `inView`, `view {x0,y0,x1,y1}`.

## Events — `Game.on(evt, fn)`, `Game.emit(evt, data)`
| event | data | emitted by |
|---|---|---|
| `game:new` | – | core |
| `scene:change` | `{from,to}` | core |
| `sfx` | `{name, x?, y?, vol?}` (names in `Game.C.SFX`) | anyone |
| `stage:change` | `{stage, prev}` | player |
| `molt:start` | `{stage}` | player |
| `molt:choose` | `{id, level}` | player |
| `molt:end` | `{stage}` | player |
| `growth:gain` | `{amount, total, needed}` | player |
| `player:damaged` | `{amount, source}` | player |
| `player:died` | `{cause}` (cause: `starved|dehydrated|eaten|exhausted|drowned|exposure|fell|widow`; `widow` = killed by the Widow Matriarch, its own game over note) | player |
| `player:downed` | `{cause, left}` a fatal blow landed but a sibling is giving its life instead of the spider dying (`left` = siblings still available after this one) | player |
| `species:unlocked` | `{id}` a playable spider was unlocked for good (saved); ui shows the unlock card | core (`Game.unlocks.unlock`) |
| `boss:notice` | `{small:true}` the player is near the Matriarch's lair but too small to fight her (once per approach) | boss |
| `boss:start` | `{phase:1}` she woke: intro, then the fight | boss |
| `boss:phase` | `{phase}` she entered phase 2 or 3 | boss |
| `boss:retreat` | – the player fled her arena; she went home to heal | boss |
| `boss:defeated` | `{species}` the player beat her (the species it unlocked) | boss |
| `player:revived` | `{cause, left, total}` the sibling's gift landed and the spider is back up (`total` = revives this run) | player |
| `kin:sacrifice` | `{creature, x, y, left}` a sibling has given its life (player.js listens) | creatures |
| `player:ate` | `{kind, value, x, y}` | player |
| `player:drank` | `{amount}` | player |
| `player:rest` | `{on}` | player |
| `creature:spawned` | `{creature}` | creatures |
| `creature:seen` | `{kind}` first time the player sees a kind | creatures |
| `creature:killed` | `{creature, by}` (by: `'player'|'web'|'predator'|'other'`) | creatures |
| `creature:attack` | `{creature, damage}` predator hit the player | creatures |
| `web:spun` | `{web, type}` | webs |
| `web:trapped` | `{web, creature}` | webs |
| `web:destroyed` | `{web, cause}` | webs |
| `zone:enter` | `{zone}` (zone id) | world |
| `day:phase` | `{phase}` (`dawn|day|dusk|night`) | world |
| `weather:change` | `{weather, prev}` | world |
| `fact:unlock` | `{id, title}` | edu |
| `objective:complete` | `{id}` | edu |
| `objective:new` | `{id}` | edu |
| `mate:found` | – | creatures |
| `courtship:done` | – | player |
| `game:victory` | – | player |

## Module APIs

### A. `Game.world` (world.js) — priority 10
Owns terrain, backgrounds, zones, environment features, time of day, weather, resources, shelters, obstacles.
```
world.width, world.height
world.zoneAt(x, y) -> zone object {id,name,...}   // ids: 'litter'|'bark'|'garden'
world.time01            // 0..1 through the day. 0=sunrise, .25=noon, .5=sunset, .75=midnight
world.dayCount          // integer days elapsed
world.light             // 0.08..1 brightness (never fully black; nights are readable)
world.phase             // 'dawn'|'day'|'dusk'|'night'
world.isNight() -> bool
world.weather = { type:'clear'|'drizzle'|'rain'|'wind'|'fog', intensity:0..1, windX, windY }
world.exposure(x, y) -> 0..1   // 1 = open/exposed, 0 = fully covered (under leaf/bark/petal). Rain hurts exposed small spiders.
world.obstacles         // array of circles {x,y,r,type}: rocks, twigs, stems, bark ridges (solid)
world.resolve(x, y, r) -> {x, y}   // pushes a circle out of obstacles & clamps to world bounds; used by player and creatures
world.resources         // array {id,type:'dew'|'nectar', x,y,r, amount,max, regen}   (dew -> hydration, nectar -> small hunger)
world.consumeResource(res, amount) -> amountActuallyTaken
world.nearestResource(x, y, type?, maxDist?) -> res|null
world.shelters          // array {id,type:'crevice'|'leaf'|'bark'|'petal'|'hollow', x,y,r, safety:0..1, eggSite:bool}
world.shelterAt(x, y) -> shelter|null    // point inside a shelter (spider counts as hidden when inside)
world.anchors           // array {x,y,type} natural web anchor points (twig tips, stems, grass blades, petals) — webs.js snaps to these when close
world.nearestAnchor(x, y, maxDist) -> anchor|null
world.spawnPoints(zoneId, kind?) -> array of {x,y}   // for creatures; world provides ecological hints (e.g. 'flying' over flowers). Optional helper; creatures may also choose randomly with world.resolve()
world.explored         // 2D Uint8Array grid for minimap fog: world.exploredCell = 64 (px per cell); world.markExplored(x,y,radius)
world.drawMinimapTerrain(ctx, x, y, w, h)  // draws a cheap terrain overview into the given screen rect (pre-render to offscreen canvas once in reset())
```
Drawers: BACKGROUND (ground textures per zone: leaf litter with detailed leaves/twigs/soil grain; oak bark with deep ridges/lichen/moss; flower garden with soil, grass blades, petals, stems), GROUND decor, RESOURCES (dew drops, nectar), SHELTER (shelter art), CANOPY (big leaves/petals the spider walks under; fade when player under them), WEATHER (rain streaks, fog, wind particles), DARKNESS (screen-space night tint + vignette; keep it readable). Pre-render static terrain into offscreen canvases (chunked) in `reset()`/`init()` for speed. Use `Game.util.makeCanvas`.
Day/night: advance `time01` in `update(dt)` by `dt/Game.C.DAY_LENGTH`. Weather: random slow transitions, biased clear; rain only after the first day; emit events.

### A2. `Game.audio` (audio.js) — priority 60, `alwaysUpdate: true`
Procedural Web Audio. `audio.unlock()` (called by core on first user input; creates the AudioContext), `audio.setMuted(b)`. Listen to `sfx` events (all names in `Game.C.SFX`; unknown names get a soft generic blip). Adaptive layers: ambient bed varies by zone (`Game.world.zoneAt(player)`), time of day (crickets at night, birds at dawn), weather (rain noise), and danger (`Game.state.danger` 0..1 -> low pulse/tension); a gentle generative ambient music (pentatonic-ish pads, slow) whose brightness follows stage. Respect `Game.settings.master/music/sfx/muted`. Must never throw if `AudioContext` is missing (headless tests). Positional sfx: pan/volume from `x,y` relative to `Game.camera`.

### B. `Game.webs` (webs.js) — priority 20
Owns silk mechanics. `webs.list` = array of web objects:
```
{ id, type:'line'|'sheet'|'orb'|'retreat', x1,y1,x2,y2 (line endpoints), x,y,r (center/radius for sheet/orb/retreat),
  integrity:0..1, age, trapped:[creature], anchorA, anchorB, owner:'player' }
```
API:
```
webs.selected                       // currently selected type id (or null before any unlocked)
webs.select(type) -> bool           // checks Game.player.stage unlock (Game.C.WEB_TYPES[type].stage)
webs.canSpin(type) -> bool          // unlocked + enough silk + not molting/dead
webs.spin(type?) -> web|null        // spends silk via Game.player.useSilk(cost); places web at the player (facing direction / anchors via world.nearestAnchor)
webs.isSheltered(x, y) -> bool      // inside a 'retreat' web (counts as hidden/safe for rest)
webs.speedBonusAt(x, y) -> multiplier>=1   // moving along one's own dragline/sheet is faster (used by player)
webs.nearestWeb(x, y, maxDist, filterFn?) -> web|null
webs.checkCreature(c) -> web|null   // creatures.js may call this for a creature to test contact with a web (webs.js itself also scans Game.creatures.list each update)
webs.vibration(web) -> intensity    // for effects
```
Behavior: Space (`spin`) = spin selected web at the player's position; Digit1–4 select. Line: anchors between the player and the nearest anchor/direction, ~200-320 px, stronger when anchored. Sheet: flat ellipse patch ~250 px wide that entangles ground-walking prey. Orb: radial+spiral orb (drawn beautifully, dew sparkle at dawn) catches flying prey. Retreat: silk tent that hides the player (`isSheltered`). Prey contact -> call `Game.creatures.trap(creature, web)` (creatures.js implements: creature becomes stuck & struggles; struggling shakes the web and emits vibration). Player biting a trapped creature gets a bonus (player.js handles). Rain/wind damages webs (`Game.world.weather`); big prey may break webs (`web:destroyed`). Webs decay slowly (age); dew adds sparkle. Max ~40 live webs (oldest fade out). Silk regen lives in player.js. Web drawing must look great: use thin bright strands with subtle glow, radial + spiral structure for orb, wind sway.
Also draws a small "silk ghost preview" of where the selected web would go when Space is held or `web` key pressed (world-space drawer, WEBS layer).

### C. `Game.player` (player.js) — priority 30
Owns the spider entity: movement, rendering (procedural 8-leg animated spider with IK-ish gait, body scales with stage, unique color patterns, eyes, subtle hairs; molting animation, hatch-in animation from egg sac), meters, stage progression, molt system, upgrades, death, ending.
```
player.x, y, vx, vy, angle, radius (world px, from STAGES[stage].radius scaled smoothly)
player.stage (0-4), player.stageInfo
player.hp, maxHp;  hunger, hydration, energy (each 0..100; 100 = full, 0 = starving/empty)
player.silk, maxSilk;  player.useSilk(n) -> bool (spends if available);  player.addSilk(n)
player.growth, growthNeeded;  player.addGrowth(n)   // n>0; triggers molt when growth >= growthNeeded (except adult)
player.upgrades = { speed:0, silk:0, ... }          // levels
player.offerUpgrades() -> array of 3 upgrade ids (not maxed); player.chooseUpgrade(id)
player.speedMul, biteMul, stealth (predator detection multiplier 0.3..1), damageTaken (multiplier), senseRadius (px), drainMul
player.hidden -> bool   // in shelter / retreat web / under cover & still => predators can't see you beyond ~radius*2
player.resting -> bool, player.moltTimer (>0 while soft & vulnerable after molting; damage taken x2, speed x0.5), player.molting -> bool
player.dead, player.deathCause
player.reviving -> bool   // downed: a sibling is giving its life; hp 0 but not dead, can't be hurt, move, bite or spin until it lands
player.revives            // revives used this run
player.damage(amount, source) -> actual damage dealt (0 while invulnerable e.g. first 2 s after spawn/molt-start); emits player:damaged; kills -> player:died
player.heal(n), player.feed(hunger, growth, kind), player.drink(n)
player.bite() ; biting: hold J/left click; hits nearest edible creature in reach via Game.creatures.attackAt(x,y,r,dmg,by) (see creatures)
player.stateLabel  // 'walking'|'sprinting'|'resting'|'spinning'|'molting'|'courting'
player.mate = { found:false, courted:false, laid:false }   // ending progress (adult only)
player.species          // the Game.C.SPECIES entry this spider is (stats, palette, perks follow from it)
player.stealthBase, player.venomPower   // stealth before the species' night bonus; share of a bite's damage that poisons prey (0 for the garden spider)
player.slow(t, mul)     // stuck in sticky silk: move at mul x normal speed for t s (the stronger slow wins, the timer only extends); player.tangleT / tangleMul hold the state
player.drawPortrait(ctx, speciesId, cx, cy, size, {stage=4, angle, silhouette, silColor, belly, alpha, t})   // that spider as it looks in play, fitted in a size x size box (silhouette = a locked one)
```
Rules: move with WASD (sprint drains energy), obstacles via `Game.world.resolve`. Meters: hunger/hydration drain per STAGES rates × `drainMul`; energy drains while sprinting, regens while resting (R, in shelter/retreat is 3x). Siblings huddled around a resting player (`creatures.huddle`, max 3) add +15% energy regen, +20% healing and -12% hunger/thirst drain each. Starving/dehydrated -> hp loss; hp regens when meters are healthy and resting. Rain damages small exposed spiders (`world.exposure`), being on the ground at night is riskier only through predators. Interact (E): drink near dew (`Game.world.nearestResource(x,y,'dew',radius+18)`) / nectar, enter/exit shelters, mate interactions. Eating: bite creature -> `Game.creatures.attackAt`; when a creature dies by player bite, creatures.js calls `Game.player.feed(hunger, growth, kind)` (value from KINDS). Growth from eating + `edu` objectives (`addGrowth`). Molt: at `growth >= growthNeeded` (and stage<4): `Game.setScene('molting')`, emit `molt:start`, ui shows the choice screen and calls `Game.player.chooseUpgrade(id)` -> then player plays a molt animation (~6 s, `moltTimer`, vulnerable), `stage+1`, `stage:change`, `molt:end`, `Game.camera.targetZoom = STAGES[stage].zoom`, silk/hp refill partially. Web spin availability is by `Game.C.STAGES[stage].webs`.
Ending (stage 4): `Game.creatures.spawnMate()` is called by player.js on reaching adult; find the mate (glowing pheromone trail hint via `player.mateHint` vector shown by ui), press E near the mate with hunger>35 -> courtship mini-sequence (short dance, `courtship:done`), then go to an egg site (`world.shelters` with `eggSite`), press E to lay the egg sac -> `player.mate.laid=true`, emit `game:victory` and `Game.setScene('victory')`.
Death: `Game.setScene('gameover')` after a brief death animation; ui offers retry.
Species (`Game.C.SPECIES`): `Game.state.species` picks the spider in `reset()`. The Black Widow is glossy black when grown (pale and striped as a hatchling, with orange-red spots that fade as she molts), has a round abdomen and longer legs, bites 35% harder, has 25% more silk, hides 20% better at night, and her bite poisons prey (`venomPower`); she is 6% slower with 10% less health. Her red hourglass is on her underside, so it only shows while she hangs belly-up to spin or rest (`bellyK`).
Game modes (`Game.C.MODES`, chosen on the title screen: New Game opens a "Choose your journey" picker; the last choice is saved in `Game.settings.mode` and highlighted next time; `Game.newGame(mode)` sets `Game.state.mode`, omitted = the saved one): **Brood** (default) has the sibling revive below; **Survival** is one life, and siblings still warn and huddle but never revive you. Survival hides the HUD Siblings row.
Sibling revive (Brood mode only): a fatal blow (`die()`) first asks `Game.creatures.claimSibling(x, y)` for a sibling. If one answers, the spider is *downed* instead (`player.reviving`, `player:downed`; no `player:died`). The sibling runs in, settles on the spider and gives its life (`kin:sacrifice`); the spider then gets up with 50% health, hunger/hydration/energy lifted to at least 35 (so a death by starvation doesn't repeat) and 4 s of invulnerability (`player:revived`), and hunters next to it are startled off. 1 sibling = 1 revive; with none left the next fatal blow is a real death. Tuning: `REVIVE_*` at the top of player.js, `SAC_*` in creatures.js. Siblings are a finite pool (5 at hatching, `updateKinCount` lets them drift away as you grow: 4/3/1/0), so revives run out on their own.
Camera: set `Game.camera.targetZoom` per stage; camera target = player.

### D. `Game.creatures` (creatures.js) — priority 40
Owns ecosystem entities & AI. `creatures.list` = array of creature objects:
```
{ id, kind, x, y, vx, vy, angle, radius, hp, maxHp, state:'idle'|'wander'|'flee'|'hunt'|'stuck'|'dead'|..., role:'prey'|'predator'|'spider'|'neutral', flying:bool, zone, ...ai fields }
```
`creatures.KINDS` = dictionary `kindId -> { id, name, latin, role, radius, hp, speed, flying, nocturnal, diet:[...], habitat:[zone ids], value:{hunger, growth}, danger (damage/s to player), fact, description, color }` — **must contain rich, scientifically-grounded entries** (used directly by the bestiary in ui.js).
Required species (at least 16 kinds): prey — springtail, mite, aphid, midge/gnat, fruit fly, ant (workers; defend nest, bite back), pillbug, moth, cricket, caterpillar, grasshopper, beetle (armored); predators/dangers — centipede, wasp (flying hunter), bird (shadow swoops across exposed ground: telegraphed danger zone), praying mantis (garden ambusher), ground beetle / rove beetle; spiders — wolf spider (rival/larger predator), jumping spider (competitor, hunts small spiders), kin spiderlings (cooperative: e.g. alarm each other, share prey scent, follow dragline), mate spider (unique, adult-stage goal). Food-chain relationships between creatures too (ants eat aphids/springtails, wasps hunt caterpillars/flies, mantis eats flies/moths, birds eat many) so the ecosystem looks alive even off-screen (simulate simply when far, cheaply, or only near the player: active radius ~1500 px). Day/night: nocturnal/diurnal activity via `Game.world.isNight()`. Weather: insects shelter in rain.
API:
```
creatures.list, creatures.KINDS
creatures.spawn(kind, x, y, opts) -> creature
creatures.attackAt(x, y, r, dmg, by) -> {killed:[creature], hit:[creature]}   // used by player bite; kills feed the player through Game.player.feed
creatures.canEat(playerRadius, creature) -> bool   // size rule: eatable if creature.role is prey/neutral and creature.radius <= player.radius*1.35 (webs let you take bigger prey: trapped creatures are eatable up to 2.2x)
creatures.trap(creature, web)                      // called by webs.js when prey touches a web
creatures.nearest(x, y, filterFn, maxDist) -> creature|null
creatures.inRadius(x, y, r, filterFn?) -> array (reuse a scratch array is ok; document)
creatures.spawnMate() -> creature ; creatures.mate -> creature|null
creatures.visibleKinds -> Set of kinds the player has seen (also emit creature:seen)
creatures.alarms -> [{id, kind, x, y, life}]        // sibling lookouts: a hunter that would go for the player was spotted (up to 260 px from a sibling, ~4 s memory). ui.js draws an edge-of-screen arrow for off-screen ones; each live alarm also floors Game.state.danger at 0.4. Emits `kin:alarm {kind,x,y}` when a new one is raised
creatures.siblings -> int                         // siblings still with the player (alive, not drifting away, not already giving their life) = revives left; creatures.siblingsMax = how many hatch with you (5)
creatures.claimSibling(x, y) -> creature|null     // player.js: the nearest such sibling is claimed to give its life (null = none left). A claimed sibling is hidden from hunters and can't be hurt, so the revive always completes
creatures.startle(x, y, r) -> n                   // hunters within r flee for a few seconds and won't re-engage straight away (used when a sibling's gift lands)
creatures.KINDS.widow                             // the Widow Matriarch (`boss: true`, `ai: 'boss'`): a creature like any other, but boss.js is her brain (creatures calls `Game.boss.think(c, dt)`, routes damage through `Game.boss.onHurt(c, dmg, by)` and asks `Game.boss.threat(c)` for the danger meter); `creatures.pickSpawnPos` keeps wanderers out of `Game.boss.inArena`
creatures.huddle -> 0..3                            // siblings tucked in around the resting player. player.js (HUDDLE_* constants) turns that into faster energy/health recovery and slower hunger/thirst drain; `player.huddled` mirrors it
```
AI: prey wander/graze/flee (flee from player if `dist < detection * player.stealth` and player not hidden), predators patrol/hunt the player when within `detection * player.stealth` (hidden players are found only when within ~radius*2 or via `player.senseRadius` for the player only), attack deals damage via `Game.player.damage()` and sets `Game.state.danger`. Predators dislike webs (they may break them) but small predators get stuck. Birds: telegraphed shadow that drifts over exposed ground (`world.exposure>0.6`) then strikes; being covered saves you. Population: maintain target counts per zone/time-of-day by despawning far-offscreen creatures and respawning at world.spawnPoints out of view. Balanced difficulty: hatchling zone has springtails/mites/midges plentiful and only slow, distant threats; danger ramps by stage and zone (bark = ants/centipedes, garden = wasps/mantis/birds). Creatures use `Game.world.resolve` for obstacle avoidance.
Drawing: rich procedural sprites per kind (legs, antennae, wings that flutter, carapace shine, colored patterns) at CREATURES_LOW/HIGH (flyers high), with health/state cues (stuck creatures wiggle; alerted creatures show a small "!" mark). Draw small unobtrusive detection rings only when `Game.settings.science` is on.

Poison (Black Widow only): `strike()` sets `c.venomT` (4 s) and `c.venomDps` on prey the player bites while `player.venomPower > 0`; `updateCreature` ticks it (damage over time, slowed) and a poisoned kill still counts as the player's, so it feeds them. Up to 3 bites stack.

### F. `Game.boss` (boss.js) — priority 45
The Widow Matriarch: a boss fight in her lair in the Old Oak Bark. Beating her unlocks the Black Widow.
```
boss.state         'dormant' | 'intro' | 'fight' | 'defeated' | 'gone' (already beaten in an earlier journey: only her empty lair remains)
boss.lair {x,y,r}  picked at reset from the generated world: open bark, away from the hatch point and shelters, no canopy over it (deterministic)
boss.c, boss.phase (1..3), boss.hpFrac(), boss.active() (intro or fight), boss.tooSmall, boss.discovered
boss.inArena(x,y,pad), boss.threat(c), boss.start() (wake her at once), boss.TUNING {LUNGE,SPIT,SLAM}, boss.MIN_STAGE/WAKE_R/NOTICE_R/ARENA_R
```
Flow: she sleeps on her lair (visible tangle of silk, egg sacs, prey husks; a pale tripwire ring at `WAKE_R` is drawn for a spider big enough to answer it). A sub-adult (stage 3) or bigger crossing the ring wakes her (`boss:start`): a 2.6 s intro (she rears, the red hourglass shows, nothing can hurt her), then the fight. A smaller spider is warned off once (`boss:notice`) and ignored; it cannot hurt her. An adult faces a Matriarch with 40% more health (340 -> 476).
Attacks (each shows first; her opening is the player's chance): **lunge** (0.6 s windup with the lane drawn on the ground, then a locked 0.22 s dash for 16; sidestep the lane; she is winded for ~1 s), **silk spit** (fan of 3 globs, 5 in phase 3: 5 damage + slow, or a sticky patch where they land; used when you keep your distance), **slam** (phase 2+: 0.95 s windup with the ring drawn, 24 to everyone inside it, then stunned for 1.7 s). Phases at 60% and 30% health: faster, shorter cooldowns, a roar between. Bites do +35% while she is winded or stunned; her armour takes 12% off.
Arena: she keeps within `ARENA_R` of the lair; flee beyond it (and away from her) for 4 s and she gives up, goes home and heals ~12%/s (`boss:retreat`); the wake ring works again. Nothing else spawns in the arena. Killing her by the player (bite, venom) fires `boss:defeated`, heals the player 40%, completes the optional sub-adult objective (+60 growth) and calls `Game.unlocks.unlock('widow')` at once (saved, so dying a moment later keeps it). Anything else removing her only makes her `gone`: no unlock.
Balance reference (tools/test_boss.js, scripted players): a sub-adult who sidesteps her telegraphs and bites when she is winded wins in ~55 s taking 15-35 of 120 health; one who just stands and bites loses. Tune in `boss.js` (`LUNGE`, `SPIT`, `SLAM`, `PHASE_AT`, `ADULT_HP`) and `KINDS.widow` (hp 340, armor 0.12).

### E. `Game.edu` (edu.js) — priority 50
Owns objectives and educational content data (UI displays them).
```
edu.FACTS = array {id, category:'anatomy'|'behavior'|'ecosystem'|'lifecycle'|'silk'|'adaptation', title, text (2-4 sentences, accurate), unlockOn:{event, match?}}   // 40+ entries
edu.unlocked -> Set of fact ids (persisted via Game.store);  edu.unlock(id)
edu.STAGE_LORE[stage] = {title, text, scienceText}  // shown on stage change
edu.objectives -> current active objective list [{id, text, progress, goal, done, reward:{growth}}]   (max 3 active)
edu.ANATOMY -> data for an interactive "anatomy" panel: parts [{id, name, x,y (0..1 in a 300x300 spider diagram), text}]
edu.tip() -> string   // contextual hint (used by ui HUD for the first minutes; consults player state)
edu.scienceInfo(entity) -> string[]  // detailed lines for Science Mode (creature, web, player, resource)
edu.foodWeb() -> {nodes, edges}  // for a food-web diagram derived from Game.creatures.KINDS.diet
```
Objectives are generated per stage (e.g. hatchling: "Drink from dew", "Eat 3 springtails", "Reach a shelter", "Survive your first night"; spiderling: "Spin a dragline", "Catch prey in a web"; juvenile: "Build a sheet web / retreat", "Escape a predator", "Explore the bark zone"; sub-adult: "Build an orb web", "Catch a flying insect", "Survive a rainstorm", "Visit the flower garden"; adult: "Find a mate", "Lay your egg sac"). Progress driven by events (`player:ate`, `web:spun`, `web:trapped`, `zone:enter`, `weather:change`, `day:phase`...). Completing an objective calls `Game.player.addGrowth(reward)` and emits `objective:complete`. An objective def may have `skip: () => bool` (left out when it no longer applies): the sub-adult list has the optional "Defeat the Widow Matriarch" (`ev: 'boss:defeated'`) until the Black Widow is unlocked.
Facts unlock on events (first bite, first molt, first web, seeing a kind via `creature:seen`, zones, weather, night...). Every unlock emits `fact:unlock` and a `sfx` `unlock`.

### E2. `Game.ui` (ui.js) — priority 100, `alwaysUpdate: true`
Owns all screens. Scenes: `title` (animated: slow camera drift over the world, glowing title "Arachnid Origins — The Spider's Journey", buttons New Game / Continue-hint / Settings / How to Play / Bestiary / Credits), `playing` HUD, `paused` (Resume, Settings [master/music/sfx sliders, mute, screen shake, science mode, hints], Bestiary, Quit to Title), `molting` (skill-tree/upgrade choice: 3 cards from `Game.player.offerUpgrades()` + current upgrade tree overview; keyboard 1-3/arrows+enter and mouse; shows stage lore from `edu.STAGE_LORE`), `codex` (tabs: Bestiary [grid of `Game.creatures.KINDS`, silhouettes for unseen kinds, details for seen], Encyclopedia [facts by category, unlocked/locked counts], Anatomy [spider diagram], Food Web), `gameover` (cause-of-death flavor text + science note, stats, Retry/Title), `victory` (life-cycle recap, stats, egg sac scene, Play Again/Title). The codex has a fifth tab, **Spiders**: the roster of playable spiders (locked ones are silhouettes with how to unlock them), perks and life stages. Title: New Game -> mode cards -> (with 2+ spiders unlocked) "Choose your spider" cards. In play: the Matriarch's health bar (top centre) with an "Exposed - bite her!" cue, boss banners that jump the banner queue, a lair marker on the minimap once you are a sub-adult, the species name in the HUD/pause/end screens when it is not the starter, and an "unlocked" card after she falls (end screens mention a spider unlocked that run, and tease the locked one after a win).
HUD: minimal — health/hunger/hydration/energy bars (with icons drawn in code), silk meter, growth bar with stage name, hotbar for webs (locked/unlocked, cost, key), objectives (top-right, max 3), minimap (bottom-right, fog of war via `Game.world.explored`, markers: player, mate hint, shelters when explored, `M` toggles size), day/night clock + weather icon, zone-name banner on `zone:enter`, fact-unlock toast (bottom-left) on `fact:unlock`, damage vignette on `player:damaged`, low-meter pulse warnings, contextual prompts near interactables ("E — Drink"), hint text from `edu.tip()` for the first few minutes when `Game.settings.hints`. Science Mode (F): overlays with `edu.scienceInfo()` on creatures/webs near cursor plus numeric meters. Pause when `Game.pause()`; ui handles the `pause` action (Esc/P) and `codex` action (B). Use crisp, elegant styling (dark translucent panels, warm amber accent, subtle animation).

### main.js (lead-owned)
```
window.addEventListener('load', () => { Game.boot(document.getElementById('game')); Game.start(); });
```

## Cross-module quick contracts
* `Game.state.danger` (0..1): written by creatures every frame; read by audio & ui.
* Player hidden state: `Game.player.hidden` computed by player.js as: `world.shelterAt(x,y) || webs.isSheltered(x,y) || (still && world.exposure(x,y) < 0.35)`.
* Feeding: creatures.js calls `Game.player.feed(hungerAmount, growthAmount, kindId)` when the player kills prey; player emits `player:ate`.
* Silk: only player.js changes `player.silk` (through `useSilk`/`addSilk`, regen in update). webs.js calls `useSilk`.
* Damage: only via `Game.player.damage(amount, sourceLabel)`; source label examples `'wasp'`, `'rain'`, `'starvation'`.
* Stage unlock rules use `Game.C.STAGES[stage].webs`.
* Sound: emit `Game.emit('sfx', {name:'bite', x, y})`; never touch Web Audio outside audio.js.

## Testing
Tests: `tools/test_species.js` (species data, unlocks, the Black Widow's stats/art/poison, the New Game flow, the Spiders tab), `tools/test_boss.js` (the lair, waking, every attack and phase, the leash, defeat and unlock, plus scripted fairness fights; `--quick` skips those).
`node tools/harness.js` loads all `src/*.js` in a Node `vm` context with a real headless canvas (`@napi-rs/canvas`), boots the game, runs N simulated seconds with scripted input, asserts `Game.errors.length === 0`, and can write PNG screenshots (`tools/shots/*.png`). Useful helpers exposed by the harness: see the header of `tools/harness.js`. Use it constantly; view PNGs with the Read tool to check your art. Run `node --check src/yourfile.js` for syntax.
