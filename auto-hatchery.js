// ==UserScript==
// @name        Auto-Hatchery - pokeclicker.com
// @namespace   Pokeclicker Scripts
// @author      ildoc
// @description Auto-hatch Pokemons based on max attack and other various small QoL improvements
// @copyright   https://github.com/ildoc
// @license     GNU GPLv3
// @version     1.4.0

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
let fossilState = loadSetting('ah_autoFossil', false);
let shinyFossilState = loadSetting('ah_shinyFossil', false);
let pkrsState = loadSetting('ah_pokerusMode', false);
let pkrsHatcherySearchTime = 0;
let numMonsWithPkrsCached;

(async function waitGameReadyAndSetup() {
  while (App.game == undefined)
    await new Promise(r => setTimeout(r, 1000));
  addControls();
  setQueueDimension();
  boostInitialCurrencies();
  bindAutoHatcher();
})();

function loadSetting(key, defaultVal) {
  let val;
  try {
    val = JSON.parse(localStorage.getItem(key));
    if (val == null || typeof val !== typeof defaultVal)
      throw new Error();
  } catch {
    val = defaultVal;
    localStorage.setItem(key, defaultVal);
  }
  return val;
}

function toggleButtonClass(element, enabled) {
  element.classList.replace(...(enabled ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
}

function addControls() {
  const breedingDisplay = document.getElementById('breedingDisplay');
  const breedingModal = document.getElementById('breedingModal');
  const maxAttackDefault = loadSetting('ah_maxAttack', App.game.party.pokemonAttackObservable());

  breedingDisplay.querySelector('.card-header').insertAdjacentHTML('afterbegin',
    `<div style="position:absolute;left:0;top:0;z-index:1;display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:10px;" onclick="event.stopPropagation()">
      <button id="auto-hatch-start" class="btn btn-sm btn-${hatchState ? 'success' : 'danger'}" style="font-size:7pt;height:28px;">
        Auto [${hatchState ? 'ON' : 'OFF'}]
      </button>
      Max DMG <input type="text" id="maxattack" size="8" value="${maxAttackDefault}">
    </div>`);

  breedingModal.querySelector('.modal-header').querySelectorAll('button')[1].insertAdjacentHTML('afterend',
    `<button id="pkrs-mode" class="btn btn-${pkrsState ? 'success' : 'danger'}" style="margin-left:20px;">
      PKRS [${pkrsState ? 'ON' : 'OFF'}]
    </button>
    <button id="auto-egg" class="btn btn-${eggState ? 'success' : 'danger'}" style="margin-left:20px;">
      Auto Egg [${eggState ? 'ON' : 'OFF'}]
    </button>
    <button id="auto-fossil" class="btn btn-${fossilState ? 'success' : 'danger'}" style="margin-left:20px;">
      Auto Fossil [${fossilState ? 'ON' : 'OFF'}]
    </button>
    <button id="shiny-fossils" class="btn btn-${shinyFossilState ? 'success' : 'danger'}" style="margin-left:20px;">
      Shiny Fossils [${shinyFossilState ? 'ON' : 'OFF'}]
    </button>`);

  document.getElementById('auto-hatch-start').addEventListener('click', event => {
    event.stopPropagation();
    hatchState = !hatchState;
    toggleButtonClass(event.target, hatchState);
    event.target.textContent = `Auto [${hatchState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('ah_autoHatch', hatchState);
  });

  document.getElementById('auto-egg').addEventListener('click', event => {
    eggState = !eggState;
    toggleButtonClass(event.target, eggState);
    event.target.textContent = `Auto Egg [${eggState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('ah_autoEgg', eggState);
  });

  document.getElementById('auto-fossil').addEventListener('click', event => {
    fossilState = !fossilState;
    toggleButtonClass(event.target, fossilState);
    event.target.textContent = `Auto Fossil [${fossilState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('ah_autoFossil', fossilState);
  });

  document.getElementById('shiny-fossils').addEventListener('click', event => {
    shinyFossilState = !shinyFossilState;
    toggleButtonClass(event.target, shinyFossilState);
    event.target.textContent = `Shiny Fossils [${shinyFossilState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('ah_shinyFossil', shinyFossilState);
  });

  document.getElementById('pkrs-mode').addEventListener('click', event => {
    pkrsState = !pkrsState;
    toggleButtonClass(event.target, pkrsState);
    event.target.textContent = `PKRS [${pkrsState ? 'ON' : 'OFF'}]`;
    localStorage.setItem('ah_pokerusMode', pkrsState);
  });

  document.getElementById('maxattack').addEventListener('change', event => {
    const value = Number(event.target.value) || 0;
    localStorage.setItem('ah_maxAttack', value);
  });
}

function setQueueDimension() {
  if (App.game.breeding.queueSlots() < QUEUESLOTS) {
    App.game.breeding.gainQueueSlot(QUEUESLOTS);
    console.log('Queue slots set to ' + QUEUESLOTS);
  }
}

function boostInitialCurrencies() {
  const currentMoney = App.game.wallet.currencies[0]();
  const currentQuestPoints = App.game.wallet.currencies[1]();
  const currentDungeonTokens = App.game.wallet.currencies[2]();
  const currentDiamonds = App.game.wallet.currencies[3]();
  const currentFarmPoints = App.game.wallet.currencies[4]();
  const currentBattlePoints = App.game.wallet.currencies[5]();
  const currentContestTokens = App.game.wallet.currencies[6]();

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
    if (hatchState && App.game.breeding.canAccess())
      fillEggSlots();
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
    success ||= fossilState && autoHatchFossil();
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
    const success = App.game.breeding.addPokemonToHatchery(foundPair.uninfected)
      && App.game.breeding.addPokemonToHatchery(foundPair.contagious);
    numMonsWithPkrsCached += success;
    return success;
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

function autoHatchFossil() {
  let fossilList = UndergroundItems.list.filter(it =>
    it.valueType === UndergroundItemValueType.Fossil && player.itemList[it.itemName]() > 0);
  if (fossilList.length == 0)
    return false;

  const priorityList = fossilList.filter(f => {
    const caughtStatus = PartyController.getCaughtStatusByName(GameConstants.FossilToPokemon[f.name]);
    return caughtStatus == CaughtStatus.NotCaught
      || (shinyFossilState && caughtStatus == CaughtStatus.Caught);
  });
  if (priorityList.length)
    fossilList = priorityList;

  const fossilToUse = fossilList[Math.floor(Math.random() * fossilList.length)];
  const before = player.amountOfItem(fossilToUse.itemName);
  UndergroundController.sellMineItem(fossilToUse);
  return before > player.amountOfItem(fossilToUse.itemName);
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
  if (!hatchState)
    return;

  fillEggSlots();

  const maxAttack = getMaxAttack();
  try {
    const list = getEfficiencySortedList();
    let i = 0;
    while (
      App.game.party.pokemonAttackObservable() >= maxAttack
      && App.game.breeding.hasFreeQueueSlot()
      && i < list.length
    ) {
      App.game.breeding.addToQueue(list[i]);
      i++;
    }
    if (i > 0)
      console.log('added ' + i + ' pokemon(s) to queue');
  } catch (e) {
    console.log(e);
  }
}

setInterval(() => enqueuePokemons(), MINUTES * 60 * 1000);

console.log('---Auto-Hatchery script loaded!---');
