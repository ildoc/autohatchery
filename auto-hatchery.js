// ==UserScript==
// @name        Auto-Hatchery - pokeclicker.com
// @namespace   Pokeclicker Scripts
// @author      ildoc
// @description Auto-hatch Pokemons based on max attack and other various small QoL improvements
// @copyright   https://github.com/ildoc
// @license     GNU GPLv3
// @version     1.4.1

// @homepageURL https://github.com/ildoc/autohatchery/
// @supportURL  https://github.com/ildoc/autohatchery/issues

// @match       https://www.pokeclicker.com/
// @icon        https://www.google.com/s2/favicons?domain=pokeclicker.com
// @grant       none
// @run-at      document-idle
// @downloadURL https://update.greasyfork.org/scripts/523661/Auto-Hatchery%20-%20pokeclickercom.user.js
// @updateURL https://update.greasyfork.org/scripts/523661/Auto-Hatchery%20-%20pokeclickercom.meta.js
// ==/UserScript==

const MINUTES = 2;
const QUEUESLOTS = 1500;
const INITIAL_MONEY = 1000000000;
const INITIAL_QUEST_POINTS = 1000000000;
const INITIAL_DUNGEON_TOKENS = 1000000000;
const INITIAL_DIAMONDS = 1000000000;
const INITIAL_FARM_POINTS = 1000000000;
const INITIAL_BATTLE_POINTS = 1000000000;
const INITIAL_CONTEST_TOKENS = 1000000000;

let hatchState = loadSetting('ah_autoHatch', true);
let eggState = loadSetting('ah_autoEgg', false);
let pkrsState = loadSetting('ah_pokerusMode', false);
let pkrsHatcherySearchTime = 0;
let numMonsWithPkrsCached;

(async function waitGameReadyAndSetup() {
  while (App.game == undefined || !document.querySelector('#breedingDisplay > .card-header > span'))
    await new Promise(r => setTimeout(r, 1000));

  try {
    addControls();
    setQueueDimension();
    boostInitialCurrencies();
    bindAutoHatcher();
    setInterval(() => enqueuePokemons(), MINUTES * 60 * 1000);
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

function toggleButtonClass(element, enabled) {
  element.classList.replace(...(enabled ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
}

function addControls() {
  const maxAttackDefault = loadSetting('ah_maxAttack', App.game.party.pokemonAttackObservable());

  document.querySelector('#breedingDisplay > .card-header > span').insertAdjacentHTML('beforebegin',
    `<div onclick="event.stopPropagation()">
      Auto <input type="checkbox" id="autohatch" ${hatchState ? 'checked' : ''} />
      Max DMG <input type="text" id="maxattack" size="8" value="${maxAttackDefault}">
    </div>`);

  const fireAll = document.getElementById('breeding-fireall');
  if (fireAll) {
    fireAll.insertAdjacentHTML('beforebegin',
      `<button id="pkrs-mode" class="btn btn-${pkrsState ? 'success' : 'danger'}" style="margin-left:8px;">
        PKRS [${pkrsState ? 'ON' : 'OFF'}]
      </button>
      <button id="auto-egg" class="btn btn-${eggState ? 'success' : 'danger'}" style="margin-left:8px;">
        Auto Egg [${eggState ? 'ON' : 'OFF'}]
      </button>`);
  }

  document.getElementById('autohatch').addEventListener('click', event => {
    event.stopPropagation();
    hatchState = event.target.checked;
    localStorage.setItem('ah_autoHatch', JSON.stringify(hatchState));
  });

  document.getElementById('maxattack').addEventListener('click', event => {
    event.stopPropagation();
  });

  document.getElementById('maxattack').addEventListener('change', event => {
    const value = Number(event.target.value) || 0;
    localStorage.setItem('ah_maxAttack', JSON.stringify(value));
  });

  const autoEggBtn = document.getElementById('auto-egg');
  if (autoEggBtn) {
    autoEggBtn.addEventListener('click', event => {
      eggState = !eggState;
      toggleButtonClass(event.target, eggState);
      event.target.textContent = `Auto Egg [${eggState ? 'ON' : 'OFF'}]`;
      localStorage.setItem('ah_autoEgg', JSON.stringify(eggState));
    });
  }

  const pkrsBtn = document.getElementById('pkrs-mode');
  if (pkrsBtn) {
    pkrsBtn.addEventListener('click', event => {
      pkrsState = !pkrsState;
      toggleButtonClass(event.target, pkrsState);
      event.target.textContent = `PKRS [${pkrsState ? 'ON' : 'OFF'}]`;
      localStorage.setItem('ah_pokerusMode', JSON.stringify(pkrsState));
    });
  }
}

function setQueueDimension() {
  // Ensure the queue size setting does not cap usable slots below QUEUESLOTS
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
  const input = document.getElementById('maxattack');
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
    // Need two free egg slots to pair for Pokerus spread
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

function enqueuePokemons() {
  if (!hatchState || App.game == undefined)
    return;

  try {
    fillEggSlots();

    const maxAttack = getMaxAttack();
    const list = getEfficiencySortedList();
    let i = 0;
    // addPokemonToHatchery fills egg slots first, then the queue (public API since 0.10.24)
    while (
      App.game.party.pokemonAttackObservable() >= maxAttack
      && App.game.breeding.hasFreeQueueSlot()
      && i < list.length
    ) {
      if (!App.game.breeding.addPokemonToHatchery(list[i]))
        break;
      i++;
    }
    if (i > 0)
      console.log('added ' + i + ' pokemon(s) to hatchery queue');
  } catch (e) {
    console.error('Auto-Hatchery enqueue error:', e);
  }
}
