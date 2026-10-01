# Changelog

## [1.9.1] - 01/10/2026

### Changed
- Bulk grind: only started content (kills/clears > 0); awards only the amount needed to reach 10k route kills / 1k gym & dungeon clears (skips already-capped)

## [1.9.0] - 01/10/2026

### Added
- Cheats: Bulk grind current region — oneshot-only async grind (10k route kills, 1k gym/dungeon clears) with money/exp/gems/hatchery steps, progress bar, and hatchery queue refill between chunks

## [1.8.5] - 30/09/2026

### Changed
- Cheats: visually separate Catch all (options + button) from Auto Purify

## [1.8.4] - 30/09/2026

### Added
- Cheats: Auto Purify toggle — when Orre Purify Chamber hits maximum flow, auto-selects a Shadow Pokémon (if needed) and calls `purify()`

## [1.8.3] - 30/09/2026

### Changed
- Entering a dungeon always starts Auto Click (independent of Dungeon Restart)
- "Dungeon Restart" toggle only controls auto-restart after clear (no longer required to farm/navigate a dungeon)
- While Auto Click is on inside a dungeon, map pathfinding still runs; stuck pathfinding no longer disables restart

## [1.8.2] - 30/09/2026

### Changed
- Lazy/deferred startup: core hatchery loads first; queue/currency boost + weather freeze next; Auto Clicker UI, Cheats card, and weather select via `requestIdleCallback` (sooner if clicker/gym/dungeon were left ON)

## [1.8.1] - 30/09/2026

### Changed
- Game-ready wait: prefer official `GameLoadState.onLoadState(running)`, with `Preload.hideSplashScreen` hook and a short poll as fallbacks (replaces the 1s busy loop)

## [1.8.0] - 30/09/2026

### Added
- Weather freeze selector on the Town Map (from Simple Weather Changer): pick a weather for all regions, or Default
- Migrates legacy `weatherChangerWeather` localStorage key to `ah_weather`

### Changed
- Shared `addStyle` / `setElementText` helpers; currency boost uses a compact table
- Weather select positioned for current Town Map header (DayCycle / Weather / Moon buttons)

## [1.7.0] - 30/09/2026

### Added
- Auto Clicker panel (from Enhanced Auto Clicker): multi-click attacks, efficiency/DPS stats
- Auto Gym with gym selector and free auto-restart while enabled
- Auto Dungeon with encounter/chest modes, loot tier filter, finish-before-stop, rare chest option

### Changed
- Adapted clicker for Pokeclicker 0.10.26+: `instanceof Gym`, dungeon `hasUnlockedBoss` check, Battle.clickAttack override (Gym/Dungeon/Temporary inherit via super), safer flash radius / stuck-loop handling
- Clicker settings use `ah_` localStorage keys (no clash with the standalone Ephenia script)

## [1.6.0] - 30/09/2026

### Added
- "Cheats" card: catch all Pokémon from unlocked regions
- Options for shiny, shadow, and gender (random / male / female / genderless)
- Catch notifications are fully suppressed during the mass catch (including shiny/shadow)

## [1.5.0] - 30/09/2026

### Added
- Dedicated "Auto Hatchery" settings card in the game UI (next to Hatchery)
- Configurable queue check interval (minutes), persisted in localStorage
- "Run check now" button for manual hatchery/queue refill
- Last check status line on the settings card

### Changed
- Moved Auto / PKRS / Auto Egg / Max DMG controls into the settings card

## [1.4.1] - 30/09/2026

### Fixed
- Compatibility with Pokeclicker 0.10.24+: replaced removed `addToQueue` with public `addPokemonToHatchery` (queue fill was silently failing)
- Currency boost now uses `GameConstants.Currency` indexes instead of hardcoded array positions
- Queue boost also clears `breedingQueueSizeSetting` cap so gained slots are actually usable
- Setup no longer aborts entirely if modal toggle injection fails

### Removed
- Auto Fossil / Shiny Fossils: fossils can no longer be hatched (revived via regional NPCs since 0.10.24)

## [1.4.0] - 30/09/2026

### Added
- PKRS Mode: spreads Pokerus by pairing uninfected and contagious Pokémon of the same type
- Auto Egg: uses eggs from inventory when hatchery slots are free
- Auto Fossil / Shiny Fossils: consumes underground fossils, prioritizing uncaught (and non-shiny if enabled)
- Toggle buttons with localStorage persistence for Auto, PKRS, Egg, Fossil, Shiny Fossils, and Max DMG
- Hook into breeding progress for reactive egg hatching and slot refill

### Changed
- UI controls split between hatchery card (Auto + Max DMG) and breeding modal (PKRS / Egg / Fossil toggles)

## [1.3.6] - 13/01/2024

### Added
- Added license

### Changed
- Increased initial diamonds
- Increased initial dungeon tokens

## [1.3.4] - 07/01/2024

### Added
- Initial boost for points
- Ensure minimum quota for points

## [1.3.3] - 03/01/2025

_First version under git (better late than never)_

### Added
- Initial variable setup
- Check and bump queue slots to 1500 at startup

### Changed
- Increased ready eggs check interval from 2 minutes to 30 seconds
- Separated ready eggs check from the main loop
- Refactored breeding efficiency sort
- General code refactoring

### Removed
- Removed queue count near "Hatchery" text
