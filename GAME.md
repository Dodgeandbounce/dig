# Do I Go? — how the game plays

The design doc is the source of truth. This is how each part of it is built, and where to tune it (almost every number lives in `shared/sim/data.js`).

## The loop

Every level (30 from the surface to the core; a full run is well over an hour):

1. **"-1548km below Sea Level"**, then the **enemy mix** for the level (little portraits with percentages: more kinds the deeper you go, sometimes a **rare** one from further down at 1-3%), then **DIG!** Once a run the mix is a single enemy at **100%**: the Hoarder (see Dockings).
2. **The descent** (about a minute and a half). The pilot steers from the helm in a first-person tunnel toward the tiny bright light at the core; the tunnel bends now and then and the view banks with it, and its walls get rockier (and, near the core, veined with magma). Outside the ship the dirt streams past diagonally, down and to the right, and swings when the tunnel turns. Rocks and boulders hit the hull (and sometimes knock holes in it), creatures dig in (more often the deeper you are), gem veins and fuel pockets pay out if you fly through them. *Shift* boosts (burns fuel twice as fast). Run out of fuel and you're **stranded**: call a fuel drop for 60, and every ship nearby hears it.
   Meanwhile the **auto-feeders** rain gems, ore and food all over the ship (a bit more in the Feeder Hall), and dirt filters in through the roof. There's a limit to what each layer gives before the seam is mined out.
   Ships can **ambush** you mid-descent; when that's dealt with you go back to piloting.
3. **The fork.** The pilot picks the next stop: enemy dig-ships, port, fuel depot, creature nest, deep city, repair dock. A port is always offered if you haven't seen one in two levels. There is no "read a note" stop: **Joe's notes turn up wherever you go** (in a dead boarder's pocket, pinned up at the dock, scratched into a nest wall...).
4. **The stop** — a fight or a shop — then the next level.

Early on, **warnings scratched into the tunnel walls** tell you it only gets worse ("It was easy at first, but we are barely able to hold together. BE YE WARNED!"): build the hull and defenses while it's easy.

The host can pause any time (Esc). Story beats pause the world.

## The ship

- Built from **rooms** on a grid (up to 11×6 slots), one slot = 10×7 tiles. Some rooms are bigger: the **Dirt Farm is 2×2 slots** and **Crew Quarters 2×1**. The **bridge is smaller** (the pilot only needs the helm): a short hallway takes the rest of its slot. Every shared stretch of wall gets a **door** (big rooms get several). Doors open and close **slowly**. Consoles sit in the back corner of each room, clear of the doors.
- A **walkway runs around the whole ship** (inside the outer hull), and every room on the edge has a door out to it. Four heavy **blast doors** cut the walkway into sections: they're open until someone shuts them, and each one shuts as a whole (all its tiles at once).
- **Doors toggle**: press E to shut a door (boarders have to smash through) or prop it open (anyone can walk through, them too).
- You start with a used two-person digger: Engine Room, D-Weapons Bay, Feeder Hall, Bridge, Bubble Generator.
- **It keeps growing**: every crew member who joins brings their room (Kennel, Galley, Vault, Lab...), and ports sell more: extra engines, storage, crew quarters, feeder halls, Power Cores, corridors. You choose where each one goes.
- Every room has a **system** at its station. Systems take damage and go **offline** at 0 (no helm = drifting, no D-weapons = no ship fire, no bubble generator = no shield, no lab = no research...).
- **Power**: the ship has a bank of **power cells** (5, plus 3 per working Power Core). The scientist routes them at the lab between **engines** (speed, and an 8% chance per cell to dodge enemy fire), the **bubble** (recharge speed), **weapons** (every gun needs its power to fire), **internal systems** (feeders, research) and the **galley** (better meals; the fancy recipes need it). Allocated power never runs out, but anything without cells can't run its extras. Without a scientist (or with a bot one) the cells spread themselves where they're needed.
- **Guns**: the D-gun comes with the ship. Flak batteries, burst cannons, ion lances and rail drivers turn up in wrecks and crates or are sold at ports; they wait in storage until the **missile technician installs them** at the weapons bay (3 rack slots, more with extra weapons bays). The first guns in the rack get power first.
- **Fully destroyable**: doors, interior walls and the hull have HP. Boarders and drillers carve new paths; missiles and rocks blow **breaches** in the hull. Breaches leak dirt (messes, and soil for the farmer), slowly drain the hull, and **bugs crawl in through them** (more often the deeper you go, more during fights). **Bugs attack everyone**, boarders included, and the boarders fight back. A smashed doorway sometimes **caves in** and blocks the way until someone clears the wreckage; other times it's just a gaping hole. A wrecked system can bring wreckage down in front of the room's door. Anything that needs fixing glows softly, even in the dark.
- **Fire**: a burning tile hurts whoever stands in it, damages the room's system, and spreads to the next tile (closed doors stop it). You can hear fires crackling, from where they are. Lose an engine and fires break out all over the ship; enemy missiles hitting an already-broken room usually start one. Everyone carries an extinguisher (hold E next to a fire); MrClean puts fires out about four times faster.
- **Fully repairable**: hold **E** next to anything broken (scrap makes it faster); it whirrs like a ratchet while you work. Engineers fix best — and they fix engines by **hitting them with the wrench**. Patching structure also shores up the hull. Repair docks fix everything. Bots fix the consoles they stand at. Nobody gets stuck inside a wall that's rebuilt on top of them.
- **Fully upgradeable**: ship upgrades at ports (plating, bubble layers, D-gun, D-missile, drill bits, feeders, fuel tank), guns, Power Cores, research in the lab, and personal stars (Tab).
- **Air currents** you can see: one runs all the way round the outer walkway and a couple more wind from room to room through the doors. They shift with every docking. Bubbles ride them (and the Jorbal rides the bubbles).

## Dockings

- **You see them coming**: enemy dig-ships drill toward you, above or below, for a few seconds before they latch on, each with a big drill on its nose. They come in **all shapes**: crooked L and T hulls, snakes, blobs, big double holds and long **thin crawlways** between rooms. Then each one blows a hole in your outer hull and runs a tunnel in. Shallow, it's one ship (sometimes two); deeper, two or three at once, and near the core up to **four**, arriving one after another. More ships = more holes = more ways in.
- **Sealing is your call**: press **L** to seal every door (boarders have to beat their way through; so does anyone without **clearance**: Pilot, Engineer, Guard, Scientist, Vaelift, Agent), or prop the doors to the fight open so the fighters can get at them. (An all-bot crew seals automatically.)
- **Lots of enemies, from the very first docking**: boarders pour in from each ship's crew quarters (up to ~70 alive at once). Shallow ones are pushovers; deep ones are brutal, and every type rolls its own stats. When nobody is close by, boarders head for the **nearest room and wreck its system**; about a third of them **smash straight through the walls** to get there. **Thieves** go for the vault and run home with your gems. They **shout insults** at the foxes (and have special contempt for the Urchid).
- **The Hoarder**: once a run, the enemy mix says **100%** and a single huge thing comes aboard alone. It smashes a straight line through your walls to the nearest system, rips out a big pile of scrap and heads home. Kill it before it gets back to its ship, or the ship cuts loose with your scrap.
- **Ship vs ship** is the weapons bay's fight (or the pilot's, if there's no Missile Technician aboard): they pick which enemy room our guns and **D-missiles** hit. Bubbles block most guns (not missiles, not the rail driver; flak and ion strip them fast). Lose the weapons bay and we can't fire. Lose the bridge and we can't escape or undock. Lose an engine and the ship catches fire.
- **Escape**: the pilot can cut the tunnels and run (14 seconds with one engine, faster with more). When the hull is nearly gone, the pilot can **burn out an engine** instead: we're gone at once, guaranteed, and the engine is wrecked (and on fire).
- **You can board them.** Their doors don't open for you — smash through. Wreck their systems at their stations.
- **Victory**: destroy their hull (it breaks apart), wreck their bridge + engine or bridge + guns (they surrender), or kill their whole crew. Out of boarders and losing? They flee (not without a bridge).
- **Loot**: a ship that surrenders is yours to strip. Go over and press E on the crates (sometimes there's a gun inside). **Only the pilot undocks**; if anyone's still over there, the pilot gets a warning, and on the second signal laughs and yanks them back aboard. A bot pilot gives everyone about 50 seconds. **Staying is a gamble**: after a while something bigger hears the commotion, and the longer you stay the likelier it shows up (a bigger ship, more of them).
- Fog of war: you only see inside rooms where someone from the crew is.

## The story

- **Joe's notes** turn up wherever you stop (every few levels). Each one gives something (scrap, an upgrade, a free engine room blueprint, money) and they get more chaotic as you go.
- Somewhere between 1/3 and 2/3 of the way down, a message pod hits the hull: the crew is changing, Joe escaped, and here's a **transponder ID** (and a note for the pilot: only you need to write it down). The pilot types it into the targeting computer at the next fork to reveal Joe's derelict ship.
- Joe's ship: skeletons, loot crates, and the journal on the bridge. Read it... and the Changed wake up.
- **Do I go?** Follow Joe (much harder: deeper enemies, more of them, crazier notes) or take the easier main shaft.
- Brother path: near the end there's Joe's pod, with creatures scratching at the door. Reach him and he follows you home; get him aboard and he joins as an NPC who throws bombs and fixes doors like a legend.
- **The core**: the Leviathan's Hive docks with you. Kill the Leviathan to reach the island paradise at the center of the world. Save Joe and your score gets the **💪🤝💪**.
- **The leaderboard** (first screen and lobby) lists every finished run, solo and online: click one for who played, how deep they got, kills, gems, the crew and their stars. High scores are also kept in the browser.

## The 17 classes

Everyone starts as Zap (Pilot) and Angie (Engineer), or as the Urchid. New classes join **two at a time** as the story goes (at ports, or freed prisoners after you beat a ship); the whole crew is aboard a bit past halfway down. **Switch to any crew member nobody else is playing, any time** (C, or the pause menu): a bot keeps your old job going, so every station is always crewed. Everyone talks: each class has its own lines for wandering the ship, fighting, kills, getting hurt, dockings, fires, fixing things and winning.

**Experience**: personal upgrades (stars, Tab) cost **XP**, and you earn XP by doing your job: flying, repairing, putting out fires, cooking, sweeping, farming, research, captures, backstabs, kills, looting, and every layer you survive. A blue "+xp" pops up when it counts. A busy crew member has all but a couple of the 24 stars by the core; people who join later come aboard with some XP to catch up. Bots spend theirs as they go.

**Dash**: Shift is a quick dash with a puff of smoke, using stamina (the little bar under your feet). Melee fighters dash further and faster.

**Makeshift guns** (the Commando builds them at the armory): anyone except the Urchid can pick one up. It replaces your left click with a heavy scrap cannon for a handful of shots, then falls apart into 1 scrap.

Everyone is tougher than before (+40% health), and bullets fly slower (same range), so you can see shots coming. Ship upgrades go to level 10 and class upgrades to level 8, to keep up with the deep enemies.

| Class (default name) | Primary | Abilities | Their game |
|---|---|---|---|
| **Pilot** (Zap) | Blaster | Q evasive maneuvers (at the helm during a docking: enemy D-fire misses for 4s), F rally (everyone in the room moves and shoots twice as fast for 6s) | Steer the descent, pick the route, type the transponder, escape (or burn an engine) |
| **Engineer** (Angie) | Wrench (repairs what it hits) | Q gun turret (scrap), F shock trap (scrap) | Keep the engines alive; territory safety |
| **Urchid** (Reeser) | Heckle | Q insult (better ones deeper), F ghost mode (watch through a crewmate's eyes) | Contributes nothing, can't die, lounge chair, coconut juice. Solo = story mode |
| **Guard** (Keen) | Dual pistols | Q sword lunge, F lockdown (reinforce vault + doors) | Fastest patrol, sees every enemy through walls, protects and grows the vault (bigger payouts) |
| **Chef** (Preeda) | Cleaver (RMB fish slap) | Q knife volley, F frozen fish slap | Cook from pantry food + farm crops, teleport meals: every meal heals (better food heals more, a powered galley more again), plus buffs with small side effects |
| **MrClean** (Buffy) | Axe (bonus vs melee-weak enemies) | Q whirlwind, F deep clean (room spotless, crew speed buff) | Chop things, sweep dirt and gore (E; he sees the grime outlined). A clean ship is a fast ship |
| **Missile Technician** (Bree) | Rockets (RMB chainsaw) | Q rocket barrage | Build D-missiles, pick the target room, fire, install new guns |
| **Commando** (Sargent Stin) | Assault rifle | Q grenade, F TNT | Explosives; mash scrap into makeshift guns for the crew |
| **Farmer** (Dood) | Shotgun (hold RMB: pitchfork jabs that shove everything back) | Q scarecrow (launches crows at anything that comes near; more and harder crows with upgrades), F eat a crop | Zone defense. Scoop dirt that leaks in, plant, water, harvest on the big farm |
| **Scientist** (York) | Jars: poison / acid / explosive / buff | Q swap jar, F power routing (at the lab) | Research, route the power cells, says big words |
| **Dog** (Ruff) | Bite (heals on kills) | Q pounce, F howl (enemies flee) | Incredibly fast, eats food off the floor, dog sense shows footsteps in the dark, heals in its bed |
| **Chameleon** (Needle) | Dagger (from behind: **instant kill**; a shiny knife shows over the back of anything you're behind) | Q cloak (move slowly to stay hidden), F smoke bomb | Vents in every room: press E at one (or point at one) and pick any vent on the map to come out of, ours or theirs |
| **Monster Trainer** (Dyke) | Whip (it cracks) | Q capture cube (weakened enemies, one per type), F summon / recall | Captured monsters come out twice as tough and twice as mean; knocked out, they revive in the pen |
| **Jorbal** (Miney) | Blow bubbles | Q big bubble, F burst, Space hop on a bubble and ride the air currents | Trap enemies (they go red and wide-eyed), pop them into food, chain the pops. Wiggle too hard while riding and it all pops |
| **Vaelift** (Bendin) | Vurfenstaff (F: staff / blade / rifle / shotgun) | Q phase into the empty dimension (and move much faster there), RMB ice cube (blocks bullets) | Premium guard |
| **Agent** (013) | Walther PPK | Q place mine, F mine type (proximity / timed / remote / C4), RMB detonate | Marked targets with bounties; meet contacts at ports for more |
| **Slot Machine** (Slots) | Fire coins (costs money; they go right through enemies, double damage) | Q roll (crush enemies into coins), F spin (5): wins double your pickups | Literally a slot machine. Wins set off lights and confetti, bigger wins crazier. Jackpot = coin explosion |

## Gems

Bronze, silver, quartz, gold, amethyst, sapphire and ruby, each worth more than the last (1 to 14 points). Deeper down the rich ones turn up more often. The vault holds a number of gems; ports pay by their total value.

## Enemies

A roster is generated at the start of every run: random names, races, builds and heights, weapons. More types per depth tier, and the weird ones are saved for later: moles, rats, beetles, worms and rival diggers up top; golems, ghouls, crabs and bats next; spiders, slimes and magmites; then squids, crystal things and floating eyeballs; and at the core, the mantle folk and horrors. Builds go from scrawny to **hulking** and **titan**. Weapons: claws, clubs, sacks for stealing, pistols, shotguns, rifles, harpoons, acid spit, lasers, flamers, bombs, drills and mauls. Plus wild creatures (gem mites, tunnel wyrms, shriekers, magmaws, the Changed, gloom spiders, rock lobsters, the Mole Mother), the Hoarder, and the Core Leviathan.

## Sound

Everything is synthesized, aiming for the real thing: guns crack and thump with an echo, explosions roll and rattle, wrenches ring, the whip cracks, repairs whirr like a ratchet, and fires crackle. Sounds come from where they happen (left/right, quieter further away). Menus sound like digging: a scoop of dirt when you hover, a shovel clank when you click.

## Tuning cheatsheet

- Pace of the descent: `pilot.js` (`progress += dt * spd / 86`), feeders and the per-layer drop limit in `feeders()` / `dropLimit()`.
- Enemy ships: `enemyLayout()` in `game.js` (shapes, hull, guns, missiles, boarders, waves).
- Our guns and power: `ourWeapons()` in `game.js`; `SHIP_GUNS`, `POWER_SYS` in `data.js`.
- XP: `xpCost`, `XP_JOIN_PER_LEVEL` in `data.js`; `gainXp(...)` calls where the work happens.
- Classes, weapons, abilities, upgrades, recipes, research, gems, story text, lines: `data.js`.
- Bots: `ai.js` (`chooseGoal`, `useCombatAbilities`, `stationWork`); boarders and the Hoarder: `mobTick`, `hoarderTick`.
