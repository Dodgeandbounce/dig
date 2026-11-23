# Do I Go? — how the game plays

The design doc is the source of truth. This is how each part of it is built, and where to tune it (almost every number lives in `shared/sim/data.js`).

## The loop

Every level (12 from the surface to the core):

1. **"Sea Level: −N km"**, then the **enemy mix** for the level (little portraits with percentages, e.g. *Rabbers 10% · Burlys 50% · Ques 40%*), then **DIG!**
2. **The descent.** The pilot steers from the helm in a first-person brown tunnel toward the tiny bright light at the core. Rocks and boulders hit the hull (and sometimes knock holes in it), creatures can burrow inside, gem veins and fuel pockets pay out if you fly through them. *Shift* boosts (burns fuel twice as fast). Run out of fuel and you're **stranded**: call a fuel drop for 60, and every ship nearby hears it.
   Meanwhile the **auto-feeders** rain gems, ore and food into the ship (mostly the Feeder Hall), and dirt filters in through the roof.
   Ships can **ambush** you mid-descent; when that's dealt with you go back to piloting.
3. **The fork.** The pilot picks the next stop: enemy dig-ship, port, fuel depot, discovery, creature nest, deep city, repair dock. A port is always offered if you haven't seen one in two levels.
4. **The stop** — a fight, a shop, or one of Joe's notes — then the next level.

The host can pause any time (Esc). Story beats pause the world.

## The ship

- Built from **rooms** on a grid (up to 11×6). Rooms share walls; every shared wall gets a **door**. Doors open and close **slowly**.
- You start with a used two-person digger: Engine Room, D-Weapons Bay, Feeder Hall, Bridge, Bubble Generator.
- **It keeps growing**: every crew member who joins brings their room (Kennel, Galley, Vault, Lab...), and ports sell more: extra engines, storage, crew quarters, feeder halls, corridors. You choose where each one goes.
- Every room has a **system** at its station. Systems take damage and go **offline** at 0 (no helm = drifting, no D-weapons = no ship fire, no bubble generator = no shield, no lab = no research...).
- **Fully destroyable**: doors, interior walls and the hull have HP. Enemy bombers and drillers carve new paths; missiles and rocks blow **breaches** in the hull. Breaches leak dirt (messes, and soil for the farmer) and slowly drain the hull.
- **Fully repairable**: hold **E** next to anything broken (scrap makes it faster). Engineers fix best — and they fix engines by **hitting them with the wrench**. Patching structure also shores up the hull. Repair docks fix everything.
- **Fully upgradeable**: ship upgrades at ports (plating, bubble layers, D-gun, D-missile, drill bits, feeders, fuel tank), research in the lab, personal class upgrades any time (Tab).

## Dockings

- An enemy dig-ship docks above you, blows a hole in your hull, and runs a tunnel in. **Every door seals.** Crew with **clearance** (Pilot, Engineer, Guard, Scientist, Vaelift, Agent) can unseal doors with E; everyone else waits — or the enemy smashes through.
- Boarders come in waves from their crew quarters. Enemies have roles: **brutes** hunt crew, **thieves** go for the vault and run back with your gems, **saboteurs** wreck systems, **carvers** dig through walls.
- **Ship vs ship**: both sides fire **D-guns** and **D-missiles** on visible timers. Bubbles block D-gun shots, not missiles. The Missile Technician picks exactly which enemy room to hit (bridge, engine, bubble, guns, quarters).
- **You can board them.** Their doors don't open for you — smash through. Wreck their systems at their stations.
- **Victory**: destroy their hull (it breaks apart), wreck their bridge + engine or bridge + guns (they surrender and you strip it for crates), or kill their whole crew. Out of boarders and losing? They flee.
- Fog of war: you only see inside rooms where someone from the crew is.

## The story

- **Joe's notes** turn up at discoveries and pinned up at ports. Each one gives something (scrap, an upgrade, a free engine room blueprint, money) and they get more chaotic as you go.
- Somewhere between 1/3 and 2/3 of the way down, a message pod hits the hull: the crew is changing, Joe escaped, and here's a **transponder ID**. The pilot types it into the targeting computer at the next fork to reveal Joe's derelict ship.
- Joe's ship: skeletons, loot crates, and the journal on the bridge. Read it... and the Changed wake up.
- **Do I go?** Follow Joe (much harder: deeper enemies, more of them, crazier notes) or take the easier main shaft.
- Brother path: near the end there's Joe's pod, with creatures scratching at the door. Reach him and he follows you home; get him aboard and he joins as an NPC who throws bombs and fixes doors like a legend.
- **The core**: the Leviathan's Hive docks with you. Kill the Leviathan to reach the island paradise at the center of the world. Save Joe and your score gets the **💪🤝💪**.
- High scores (by ship name) are kept in the browser.

## The 17 classes

Everyone starts as Zap (Pilot) and Angie (Engineer), or as the Urchid. New classes join as the story goes (at ports, or freed prisoners after you beat a ship). At any port you can switch to any crew member.

| Class (default name) | Primary | Abilities | Their game |
|---|---|---|---|
| **Pilot** (Zap) | Blaster | Q evasive maneuvers (at the helm during a docking: enemy D-fire misses for 4s), F rally | Steer the descent, pick the route, type the transponder, dodge fire |
| **Engineer** (Angie) | Wrench (repairs what it hits) | Q gun turret (scrap), F shock trap (scrap) | Keep the engines alive; territory safety |
| **Urchid** (Reeser) | Heckle | Q insult (better ones deeper), F ghost mode (watch through a crewmate's eyes) | Contributes nothing, can't die, lounge chair, coconut juice. Solo = story mode |
| **Guard** (Keen) | Dual pistols | Q sword lunge, F lockdown (reinforce vault + doors) | Fastest patrol, sees every enemy through walls, protects and grows the vault (bigger payouts) |
| **Chef** (Preeda) | Cleaver (RMB fish slap) | Q knife volley, F frozen fish slap | Cook from pantry food + farm crops, teleport meals: buffs with small side effects, to everyone or one class |
| **MrClean** (Buffy) | Axe (bonus vs melee-weak enemies) | Q whirlwind, F deep clean (room spotless, crew speed buff) | Chop things, sweep dirt and gore (E). A clean ship is a fast ship |
| **Missile Technician** (Bree) | Rockets (RMB chainsaw) | Q rocket barrage | Build D-missiles, pick the target room, fire |
| **Commando** (Sargent Stin) | Assault rifle | Q grenade, F TNT | Explosives; mash scrap into makeshift guns for the crew |
| **Farmer** (Dood) | Shotgun (RMB pitchfork) | Q pitchfork sweep, F eat a crop | Scoop dirt that leaks in, plant, harvest, supply the chef / sell crops |
| **Scientist** (York) | Jars: poison / acid / explosive | Q swap jar, F overclock (route power to engines / shield / weapons / feeders) | Research upgrades in the lab, says big words |
| **Dog** (Ruff) | Bite (heals on kills) | Q pounce, F howl (enemies flee) | Incredibly fast, eats food off the floor, dog sense shows footsteps in the dark, heals in its bed |
| **Chameleon** (Needle) | Dagger (huge backstab) | Q cloak (move slowly to stay hidden), F smoke bomb | Vents in every room (E to crawl), assassinate their pilot |
| **Monster Trainer** (Dyke) | Whip | Q capture cube (weakened enemies, one per type), F summon / recall | Knocked-out monsters revive in the pen; each has its own stats |
| **Jorbal** (Miney) | Blow bubbles | Q big bubble, F burst, Space hop on a bubble and ride the air currents | Trap enemies, pop them into food, chain the pops. Wiggle too hard while riding and it all pops |
| **Vaelift** (Bendin) | Vurfenstaff (F: staff / blade / rifle / shotgun) | Q phase into the empty dimension, RMB ice cube (blocks bullets) | Premium guard |
| **Agent** (013) | Walther PPK | Q place mine, F mine type (proximity / timed / remote / C4), RMB detonate | Marked targets with bounties; meet contacts at ports for more |
| **Slot Machine** (Slots) | Fire coins (costs money) | Q roll (crush enemies into coins), F spin (5): wins double your pickups | Literally a slot machine. Jackpot = coin explosion |

## Enemies

A roster is generated at the start of every run: random names, races (mole, rat, beetle, worm, golem, ghoul, crab, bat, magmite), builds and heights, weapons (claws, clubs, pistols, shotguns, rifles, flamers, bombs, drills, sacks for stealing). 4 types per depth tier, getting stronger toward the core. Plus wild creatures (gem mites, tunnel wyrms, shriekers, magmaws, the Changed) and the Core Leviathan.

## Tuning cheatsheet

- Pace of the descent: `pilot.js` (`progress += dt * spd / 48`), feeder rate in `feeders()`.
- Enemy ships: `enemyLayout()` in `game.js` (hull, guns, missiles, boarders, waves).
- Our D-weapons: `encounterTick()` in `game.js`.
- Classes, weapons, abilities, upgrades, recipes, research, story text: `data.js`.
- Bots: `ai.js` (`chooseGoal`, `useCombatAbilities`, `stationWork`).
