// ==UserScript==
// @name        Auto-Hatchery - pokeclicker.com
// @namespace   Pokeclicker Scripts
// @author      ildoc
// @description Auto-hatch Pokemons based on max attack and other various small QoL improvements
// @copyright   https://github.com/ildoc
// @license     GNU GPLv3
// @version     1.6.0

// @homepageURL https://github.com/ildoc/autohatchery/
// @supportURL  https://github.com/ildoc/autohatchery/issues

// @match       https://www.pokeclicker.com/
// @icon        https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant       none
// @run-at      document-idle
// @downloadURL https://update.greasyfork.org/scripts/523661/Auto-Hatchery%20-%20pokeclickercom.user.js
// @updateURL https://update.greasyfork.org/scripts/523661/Auto-Hatchery%20-%20pokeclickercom.meta.js
// ==/UserScript==

const QUEUESLOTS = 1500;
const INITIAL_MONEY = 1000000000;
const INITIAL_QUEST_POINTS = 1000000000;
const INITIAL_DUNGEON_TOKENS = 1000000000;
const INITIAL_DIAMONDS = 1000000000;
const INITIAL_FARM_POINTS = 1000000000;
const INITIAL_BATTLE_POINTS = 1000000000;
const INITIAL_CONTEST_TOKENS = 1000000000;
const DEFAULT_QUEUE_INTERVAL_MINUTES = 2;

let hatchState = loadSetting('ah_autoHatch', true);
let eggState = loadSetting('ah_autoEgg', false);
let pkrsState = loadSetting('ah_pokerusMode', false);
let queueIntervalMinutes = loadSetting('ah_queueIntervalMinutes', DEFAULT_QUEUE_INTERVAL_MINUTES);
let pkrsHatcherySearchTime = 0;
let numMonsWithPkrsCached;
let queueIntervalId = null;

(async function waitGameReadyAndSetup() {
  while (App.game == undefined || !document.getElementById('breedingDisplay'))
    await new Promise(r => setTimeout(r, 1000));

  try {
    addSettingsCard();
    addCheatsCard();
    setQueueDimension();
    boostInitialCurrencies();
    bindAutoHatcher();
    startQueueInterval();
    console.log('---Auto-Hatchery script loaded!---');
  } catch (e) {
    console.error('Auto-Hatchery setup failed:', e);
  }
})();

function loadSetting(key, defaultVal) {
  let val;
  try {
    val = JSON.parse(localStorage.getItem(key));
    if (val == null || typeof val !== typeof defaultVal)
      throw new Error();
  } catch {
    val = defaultVal;
    localStorage.setItem(key, JSON.stringify(defaultVal));
  }
  return val;
}

function saveSetting(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function toggleButtonClass(element, enabled) {
  element.classList.replace(...(enabled ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
}

function addSettingsCard() {
  const maxAttackDefault = loadSetting('ah_maxAttack', App.game.party.pokemonAttackObservable());
  const breedingDisplay = document.getElementById('breedingDisplay');

  breedingDisplay.insertAdjacentHTML('afterend', `
    <div id="autoHatcherySettings" class="card sortable border-secondary mb-3">
      <div class="card-header p-0" data-toggle="collapse" href="#autoHatcherySettingsBody">
        <span>Auto Hatchery</span>
      </div>
      <div id="autoHatcherySettingsBody" class="card-body show p-2">
        <div class="d-flex flex-wrap align-items-center" style="gap:8px;">
          <button id="ah-auto-toggle" class="btn btn-sm btn-${hatchState ? 'success' : 'danger'}">
            Auto [${hatchState ? 'ON' : 'OFF'}]
          </button>
          <button id="ah-pkrs-toggle" class="btn btn-sm btn-${pkrsState ? 'success' : 'danger'}">
            PKRS [${pkrsState ? 'ON' : 'OFF'}]
          </button>
          <button id="ah-egg-toggle" class="btn btn-sm btn-${eggState ? 'success' : 'danger'}">
            Auto Egg [${eggState ? 'ON' : 'OFF'}]
          </button>
        </div>
        <div class="d-flex flex-wrap align-items-center mt-2" style="gap:8px;">
          <label class="mb-0 small" for="ah-maxattack">Max DMG</label>
          <input type="number" id="ah-maxattack" class="form-control form-control-sm" style="width:110px;" value="${maxAttackDefault}">
          <label class="mb-0 small" for="ah-queue-interval">Queue check (min)</label>
          <input type="number" id="ah-queue-interval" class="form-control form-control-sm" style="width:70px;" min="0.1" step="0.1" value="${queueIntervalMinutes}">
        </div>
        <div class="mt-2">
          <button id="ah-run-now" class="btn btn-sm btn-primary btn-block">Run check now</button>
        </div>
        <div id="ah-last-run" class="small text-muted mt-1">Last check: never</div>
      </div>
    </div>
  `);

  document.getElementById('ah-auto-toggle').addEventListener('click', event => {
    hatchState = !hatchState;
    toggleButtonClass(event.target, hatchState);
    event.target.textContent = `Auto [${hatchState ? 'ON' : 'OFF'}]`;
    saveSetting('ah_autoHatch', hatchState);
  });

  document.getElementById('ah-pkrs-toggle').addEventListener('click', event => {
    pkrsState = !pkrsState;
    toggleButtonClass(event.target, pkrsState);
    event.target.textContent = `PKRS [${pkrsState ? 'ON' : 'OFF'}]`;
    saveSetting('ah_pokerusMode', pkrsState);
  });

  document.getElementById('ah-egg-toggle').addEventListener('click', event => {
    eggState = !eggState;
    toggleButtonClass(event.target, eggState);
    event.target.textContent = `Auto Egg [${eggState ? 'ON' : 'OFF'}]`;
    saveSetting('ah_autoEgg', eggState);
  });

  document.getElementById('ah-maxattack').addEventListener('change', event => {
    saveSetting('ah_maxAttack', Number(event.target.value) || 0);
  });

  document.getElementById('ah-queue-interval').addEventListener('change', event => {
    const minutes = Math.max(0.1, Number(event.target.value) || DEFAULT_QUEUE_INTERVAL_MINUTES);
    event.target.value = minutes;
    queueIntervalMinutes = minutes;
    saveSetting('ah_queueIntervalMinutes', minutes);
    startQueueInterval();
  });

  document.getElementById('ah-run-now').addEventListener('click', () => {
    enqueuePokemons(true);
  });
}

function addCheatsCard() {
  const settingsCard = document.getElementById('autoHatcherySettings');
  const insertAfter = settingsCard || document.getElementById('breedingDisplay');

  insertAfter.insertAdjacentHTML('afterend', `
    <div id="autoHatcheryCheats" class="card sortable border-secondary mb-3">
      <div class="card-header p-0" data-toggle="collapse" href="#autoHatcheryCheatsBody">
        <span>Cheats</span>
      </div>
      <div id="autoHatcheryCheatsBody" class="card-body show p-2">
        <div class="d-flex flex-wrap align-items-center" style="gap:8px;">
          <div class="form-check mb-0">
            <input type="checkbox" class="form-check-input" id="ah-cheat-shiny">
            <label class="form-check-label small" for="ah-cheat-shiny">Shiny</label>
          </div>
          <div class="form-check mb-0">
            <input type="checkbox" class="form-check-input" id="ah-cheat-shadow">
            <label class="form-check-label small" for="ah-cheat-shadow">Shadow</label>
          </div>
          <label class="mb-0 small" for="ah-cheat-gender">Gender</label>
          <select id="ah-cheat-gender" class="custom-select custom-select-sm" style="width:auto;">
            <option value="random" selected>Random</option>
            <option value="${GameConstants.BattlePokemonGender.Male}">Male</option>
            <option value="${GameConstants.BattlePokemonGender.Female}">Female</option>
            <option value="${GameConstants.BattlePokemonGender.NoGender}">Genderless</option>
          </select>
        </div>
        <div class="mt-2">
          <button id="ah-catch-all" class="btn btn-sm btn-warning btn-block">
            Catch all Pokémon (unlocked regions)
          </button>
        </div>
        <div id="ah-cheat-status" class="small text-muted mt-1">Ready</div>
      </div>
    </div>
  `);

  document.getElementById('ah-catch-all').addEventListener('click', () => {
    catchAllUnlockedPokemon();
  });
}

function setCheatStatus(message) {
  const el = document.getElementById('ah-cheat-status');
  if (el)
    el.textContent = message;
}

function getCheatOptions() {
  const shiny = document.getElementById('ah-cheat-shiny')?.checked === true;
  const shadow = document.getElementById('ah-cheat-shadow')?.checked === true
    ? GameConstants.ShadowStatus.Shadow
    : GameConstants.ShadowStatus.None;
  const genderValue = document.getElementById('ah-cheat-gender')?.value ?? 'random';
  return { shiny, shadow, genderValue };
}

function resolveCheatGender(pokemonId, genderValue) {
  if (genderValue === 'random')
    return PokemonFactory.generateGenderById(pokemonId);

  const requested = Number(genderValue);
  const data = PokemonHelper.getPokemonById(pokemonId);
  if (!data?.gender || data.gender.type === GameConstants.Genders.Genderless)
    return GameConstants.BattlePokemonGender.NoGender;
  if (requested === GameConstants.BattlePokemonGender.NoGender)
    return GameConstants.BattlePokemonGender.NoGender;
  return requested;
}

function getUnlockedRegionPokemon() {
  const highest = player.highestRegion();
  return pokemonList.filter(p => {
    if (p.id <= 0)
      return false;
    const region = PokemonHelper.calcNativeRegion(p.name);
    return region !== GameConstants.Region.none && region <= highest;
  });
}

function catchAllUnlockedPokemon() {
  const btn = document.getElementById('ah-catch-all');
  const { shiny, shadow, genderValue } = getCheatOptions();
  const list = getUnlockedRegionPokemon();
  const regionName = GameConstants.camelCaseToString(GameConstants.Region[player.highestRegion()]);

  Notifier.confirm({
    title: 'Cheats — Catch all',
    message: `Add ${list.length} Pokémon from regions up to <b>${regionName}</b>?<br/>Shiny: ${shiny ? 'yes' : 'no'} · Shadow: ${shadow === GameConstants.ShadowStatus.Shadow ? 'yes' : 'no'} · Gender: ${genderValue}`,
    type: NotificationConstants.NotificationOption.warning,
    confirm: 'Catch all',
  }).then(confirmed => {
    if (!confirmed)
      return;

    if (btn)
      btn.disabled = true;
    setCheatStatus(`Catching ${list.length} Pokémon…`);

    // suppressNewCatchNotification only covers first-catch; shiny/shadow still notify — mute all
    const originalNotify = Notifier.notify;
    Notifier.notify = () => {};

    let gained = 0;
    let shinyUpgrades = 0;
    let shadowUpgrades = 0;

    try {
      for (const p of list) {
        const alreadyCaught = App.game.party.alreadyCaughtPokemon(p.id);
        const alreadyShiny = App.game.party.alreadyCaughtPokemon(p.id, true);
        const alreadyShadow = App.game.party.alreadyCaughtPokemon(p.id, false, true);
        const gender = resolveCheatGender(p.id, genderValue);

        App.game.party.gainPokemonById(p.id, shiny, true, gender, shadow);

        if (!alreadyCaught)
          gained++;
        if (shiny && !alreadyShiny)
          shinyUpgrades++;
        if (shadow === GameConstants.ShadowStatus.Shadow && !alreadyShadow)
          shadowUpgrades++;
      }
    } catch (e) {
      console.error('Auto-Hatchery catch-all error:', e);
      setCheatStatus('Error — see console');
      return;
    } finally {
      Notifier.notify = originalNotify;
      if (btn)
        btn.disabled = false;
    }

    const summary = `Done: ${gained} new, ${shinyUpgrades} shiny, ${shadowUpgrades} shadow (${list.length} checked)`;
    setCheatStatus(summary);
    console.log('Auto-Hatchery cheat:', summary);
    Notifier.notify({
      title: 'Cheats',
      message: summary,
      type: NotificationConstants.NotificationOption.success,
      timeout: 5 * GameConstants.SECOND,
    });
  });
}

function startQueueInterval() {
  if (queueIntervalId != null)
    clearInterval(queueIntervalId);
  queueIntervalId = setInterval(() => enqueuePokemons(), queueIntervalMinutes * 60 * 1000);
}

function setLastRunStatus(message) {
  const el = document.getElementById('ah-last-run');
  if (el)
    el.textContent = `Last check: ${message}`;
}

function setQueueDimension() {
  const queueSizeSetting = Settings.getSetting('breedingQueueSizeSetting');
  if (queueSizeSetting && +queueSizeSetting.observableValue() > -1)
    queueSizeSetting.observableValue(-1);

  if (App.game.breeding.queueSlots() < QUEUESLOTS) {
    App.game.breeding.gainQueueSlot(QUEUESLOTS - App.game.breeding.queueSlots());
    console.log('Queue slots set to ' + App.game.breeding.queueSlots());
  }
}

function boostInitialCurrencies() {
  const currentMoney = App.game.wallet.currencies[GameConstants.Currency.money]();
  const currentQuestPoints = App.game.wallet.currencies[GameConstants.Currency.questPoint]();
  const currentDungeonTokens = App.game.wallet.currencies[GameConstants.Currency.dungeonToken]();
  const currentDiamonds = App.game.wallet.currencies[GameConstants.Currency.diamond]();
  const currentFarmPoints = App.game.wallet.currencies[GameConstants.Currency.farmPoint]();
  const currentBattlePoints = App.game.wallet.currencies[GameConstants.Currency.battlePoint]();
  const currentContestTokens = App.game.wallet.currencies[GameConstants.Currency.contestToken]();

  if (currentMoney < INITIAL_MONEY)
    App.game.wallet.gainMoney(INITIAL_MONEY - currentMoney, true);
  if (currentQuestPoints < INITIAL_QUEST_POINTS)
    App.game.wallet.gainQuestPoints(INITIAL_QUEST_POINTS - currentQuestPoints, true);
  if (currentDungeonTokens < INITIAL_DUNGEON_TOKENS)
    App.game.wallet.gainDungeonTokens(INITIAL_DUNGEON_TOKENS - currentDungeonTokens, true);
  if (currentDiamonds < INITIAL_DIAMONDS)
    App.game.wallet.gainDiamonds(INITIAL_DIAMONDS - currentDiamonds, true);
  if (currentFarmPoints < INITIAL_FARM_POINTS)
    App.game.wallet.gainFarmPoints(INITIAL_FARM_POINTS - currentFarmPoints, true);
  if (currentBattlePoints < INITIAL_BATTLE_POINTS)
    App.game.wallet.gainBattlePoints(INITIAL_BATTLE_POINTS - currentBattlePoints, true);
  if (currentContestTokens < INITIAL_CONTEST_TOKENS)
    App.game.wallet.gainContestTokens(INITIAL_CONTEST_TOKENS - currentContestTokens, true);
}

function getMaxAttack() {
  const input = document.getElementById('ah-maxattack');
  const value = Number(input?.value);
  return !value ? App.game.party.pokemonAttackObservable() : value;
}

function bindAutoHatcher() {
  const progressEggsOld = Breeding.prototype.progressEggs;
  Breeding.prototype.progressEggs = function progressEggs(...args) {
    const result = progressEggsOld.apply(this, args);
    if (hatchState && App.game.breeding.canAccess()) {
      try {
        fillEggSlots();
      } catch (e) {
        console.error('Auto-Hatchery fillEggSlots error:', e);
      }
    }
    return result;
  };
}

function hatchReadyEggs() {
  for (let i = App.game.breeding.eggSlots - 1; i >= 0; i--)
    App.game.breeding.hatchPokemonEgg(i);
}

function fillEggSlots() {
  hatchReadyEggs();

  while (App.game.breeding.hasFreeEggSlot()) {
    let success = pkrsState && autoHatchPkrs();
    success ||= eggState && autoHatchEgg();
    success ||= autoHatchMon();
    if (!success)
      break;
  }
}

function autoHatchPkrs() {
  const delayAfterFailure = GameConstants.SECOND * 30;
  if (!App.game.keyItems.hasKeyItem(KeyItemType.Pokerus_virus))
    return false;
  if (numMonsWithPkrsCached == App.game.party.caughtPokemon.length)
    return false;
  if (Date.now() - pkrsHatcherySearchTime < delayAfterFailure)
    return false;

  const uninfectedMono = {};
  const uninfectedDual = {};
  const contagious = {};
  let foundPair = false;
  let infectedCount = 0;

  for (const mon of App.game.party.caughtPokemon) {
    infectedCount += mon.pokerus > GameConstants.Pokerus.Uninfected;
    if (mon.breeding || mon.level < 100)
      continue;

    let checkMatch = false;
    const { type: types } = pokemonMap[mon.name];
    if (mon.pokerus == GameConstants.Pokerus.Uninfected) {
      if (types.length == 2) {
        uninfectedDual[types[0]] ??= mon;
        uninfectedDual[types[1]] ??= mon;
        checkMatch = true;
      } else {
        uninfectedMono[types[0]] ??= mon;
      }
    } else if (mon.pokerus >= GameConstants.Pokerus.Contagious) {
      for (const type of types) {
        contagious[type] ??= mon;
        checkMatch = true;
      }
    }

    if (checkMatch) {
      for (const type of types) {
        if (type in uninfectedDual && type in contagious)
          foundPair = { uninfected: uninfectedDual[type], contagious: contagious[type] };
      }
      if (foundPair)
        break;
    }
  }

  if (!foundPair) {
    numMonsWithPkrsCached = infectedCount;
    for (const type of GameHelper.enumNumbers(PokemonType)) {
      if (type in uninfectedMono && type in contagious) {
        foundPair = { uninfected: uninfectedMono[type], contagious: contagious[type] };
        break;
      }
    }
  }

  if (foundPair) {
    if (!App.game.breeding.hasFreeEggSlot())
      return false;
    const first = App.game.breeding.addPokemonToHatchery(foundPair.uninfected);
    if (!first)
      return false;
    if (!App.game.breeding.hasFreeEggSlot())
      return true;
    const second = App.game.breeding.addPokemonToHatchery(foundPair.contagious);
    numMonsWithPkrsCached += second ? 1 : 0;
    return second;
  }

  pkrsHatcherySearchTime = Date.now();
  return false;
}

function autoHatchEgg() {
  const eggList = GameHelper.enumStrings(GameConstants.EggItemType).filter(e => ItemHandler.hasItem(e));
  if (eggList.length == 0)
    return false;
  const eggToUse = eggList[Math.floor(Math.random() * eggList.length)];
  return ItemList[eggToUse].use();
}

function autoHatchMon() {
  const maxAttack = getMaxAttack();
  if (App.game.party.pokemonAttackObservable() < maxAttack)
    return false;

  const list = getEfficiencySortedList();
  if (!list.length)
    return false;
  return App.game.breeding.addPokemonToHatchery(list[0]);
}

function getEfficiencySortedList() {
  return App.game.party.caughtPokemon
    .filter(x => !x.breeding && x.level == 100)
    .sort((a, b) =>
      (b.breedingEfficiency() * BreedingController.calculateRegionalMultiplier(b))
      - (a.breedingEfficiency() * BreedingController.calculateRegionalMultiplier(a)));
}

function enqueuePokemons(manual = false) {
  if (App.game == undefined)
    return;
  if (!manual && !hatchState)
    return;

  try {
    fillEggSlots();

    const maxAttack = getMaxAttack();
    const list = getEfficiencySortedList();
    let i = 0;
    while (
      App.game.party.pokemonAttackObservable() >= maxAttack
      && App.game.breeding.hasFreeQueueSlot()
      && i < list.length
    ) {
      if (!App.game.breeding.addPokemonToHatchery(list[i]))
        break;
      i++;
    }

    const time = new Date().toLocaleTimeString();
    setLastRunStatus(`${time} (${i} queued${manual ? ', manual' : ''})`);
    if (i > 0)
      console.log('added ' + i + ' pokemon(s) to hatchery queue');
  } catch (e) {
    console.error('Auto-Hatchery enqueue error:', e);
    setLastRunStatus('error — see console');
  }
}
