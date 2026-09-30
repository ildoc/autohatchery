# Changelog

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
