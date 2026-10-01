// ==UserScript==
// @name        Auto-Hatchery - pokeclicker.com
// @namespace   Pokeclicker Scripts
// @author      ildoc
// @description Auto-hatch, auto-clicker (gym/dungeon), weather freeze, cheats and QoL for pokeclicker.com
// @copyright   https://github.com/ildoc
// @license     GNU GPLv3
// @version     1.9.1

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
const BULK_ROUTE_KILLS = 10000;
const BULK_GYM_CLEARS = 1000;
const BULK_DUNGEON_CLEARS = 1000;
const BULK_CHUNK_SIZE = 200;
const BULK_EGG_CHUNK = 20;

let hatchState = loadSetting('ah_autoHatch', true);
let eggState = loadSetting('ah_autoEgg', false);
let pkrsState = loadSetting('ah_pokerusMode', false);
let queueIntervalMinutes = loadSetting('ah_queueIntervalMinutes', DEFAULT_QUEUE_INTERVAL_MINUTES);
let autoPurifyEnabled = loadSetting('ah_autoPurify', false);
let pkrsHatcherySearchTime = 0;
let numMonsWithPkrsCached;
let queueIntervalId = null;
let autoPurifyBound = false;
let bulkGrindRunning = false;

function scheduleIdle(fn, timeout = 2000) {
  const run = () => {
    try {
      fn();
    } catch (e) {
      console.error('Auto-Hatchery deferred init error:', e);
    }
  };
  if (typeof requestIdleCallback === 'function')
    requestIdleCallback(run, { timeout });
  else
    setTimeout(run, Math.min(timeout, 100));
}

function setupAutoHatchery() {
  // Critical path: hatchery controls + breeding hook (needed immediately)
  addSettingsCard();
  bindAutoHatcher();
  startQueueInterval();
  console.log('---Auto-Hatchery core ready---');

  // Next task: cheap save mutations (after first paint)
  setTimeout(() => {
    try {
      setQueueDimension();
      boostInitialCurrencies();
      WeatherChanger.initCore();
    } catch (e) {
      console.error('Auto-Hatchery early deferred error:', e);
    }
  }, 0);

  // Idle: heavy DOM (clicker panel, cheats, weather select)
  const clickerNeededSoon = loadSetting('ah_autoClickState', false)
    || loadSetting('ah_autoGymState', false)
    || loadSetting('ah_autoDungeonState', false);

  scheduleIdle(() => {
    addCheatsCard();
    WeatherChanger.initUI();
    AutoClicker.init();
    console.log('---Auto-Hatchery deferred modules ready---');
  }, clickerNeededSoon ? 400 : 2500);
}

/**
 * Wait until the game is fully running, then run setup once.
 * Preference order:
 * 1) GameLoadState.onLoadState(running) — official API (fires immediately if already past)
 * 2) Preload.hideSplashScreen hook
 * 3) Short poll fallback
 */
function whenGameReady(callback) {
  let done = false;
  const runOnce = () => {
    if (done)
      return;
    done = true;
    try {
      callback();
    } catch (e) {
      console.error('Auto-Hatchery setup failed:', e);
    }
  };

  if (typeof GameLoadState !== 'undefined' && GameLoadState.onLoadState) {
    GameLoadState.onLoadState(GameLoadState.states.running, runOnce);
    return;
  }

  if (typeof Preload !== 'undefined' && typeof Preload.hideSplashScreen === 'function') {
    if (App.game && document.getElementById('breedingDisplay')) {
      runOnce();
      return;
    }
    const oldHide = Preload.hideSplashScreen.bind(Preload);
    Preload.hideSplashScreen = function (...args) {
      const result = oldHide(...args);
      if (App.game)
        queueMicrotask(runOnce);
      return result;
    };
    return;
  }

  (async () => {
    while (!App.game || !document.getElementById('breedingDisplay'))
      await new Promise(r => setTimeout(r, 250));
    runOnce();
  })();
}

whenGameReady(setupAutoHatchery);

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

function addStyle(css) {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
}

function toggleButtonClass(element, enabled) {
  element.classList.replace(...(enabled ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
}

function setElementText(id, message) {
  const el = document.getElementById(id);
  if (el)
    el.textContent = message;
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
        <div class="small text-muted mb-1">Catch all</div>
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
        <hr class="my-2">
        <div class="small text-muted mb-1">Orre Purify Chamber</div>
        <button id="ah-auto-purify-toggle" class="btn btn-sm btn-${autoPurifyEnabled ? 'success' : 'danger'}" title="When Orre Purify Chamber reaches maximum flow, automatically purify a Shadow Pokémon">
          Auto Purify [${autoPurifyEnabled ? 'ON' : 'OFF'}]
        </button>
        <hr class="my-2">
        <div class="small text-muted mb-1">Region bulk grind</div>
        <button id="ah-bulk-grind" class="btn btn-sm btn-info btn-block" title="Oneshot-only: fill started routes to ${BULK_ROUTE_KILLS} kills and started gyms/dungeons to ${BULK_GYM_CLEARS}/${BULK_DUNGEON_CLEARS} clears in the current region">
          Bulk grind current region
        </button>
        <div id="ah-bulk-progress-wrap" class="progress mt-2" style="height:10px;display:none;">
          <div id="ah-bulk-progress" class="progress-bar progress-bar-striped progress-bar-animated bg-info" role="progressbar" style="width:0%;"></div>
        </div>
        <div id="ah-bulk-status" class="small text-muted mt-1">Idle</div>
      </div>
    </div>
  `);

  document.getElementById('ah-catch-all').addEventListener('click', () => {
    catchAllUnlockedPokemon();
  });

  const autoPurifyBtn = document.getElementById('ah-auto-purify-toggle');
  autoPurifyBtn.addEventListener('click', () => {
    autoPurifyEnabled = !autoPurifyEnabled;
    saveSetting('ah_autoPurify', autoPurifyEnabled);
    toggleButtonClass(autoPurifyBtn, autoPurifyEnabled);
    autoPurifyBtn.textContent = `Auto Purify [${autoPurifyEnabled ? 'ON' : 'OFF'}]`;
    if (autoPurifyEnabled)
      tryAutoPurify();
  });

  bindAutoPurify();
  if (autoPurifyEnabled)
    tryAutoPurify();

  document.getElementById('ah-bulk-grind').addEventListener('click', () => {
    startBulkGrindCurrentRegion();
  });
}

function setCheatStatus(message) {
  setElementText('ah-cheat-status', message);
}

function bindAutoPurify() {
  if (autoPurifyBound || typeof PurifyChamber === 'undefined')
    return;
  autoPurifyBound = true;

  const oldGainFlow = PurifyChamber.prototype.gainFlow;
  PurifyChamber.prototype.gainFlow = function gainFlow(...args) {
    const result = oldGainFlow.apply(this, args);
    if (autoPurifyEnabled && this.currentFlow() >= this.flowNeeded())
      tryAutoPurify(this);
    return result;
  };
}

function tryAutoPurify(chamber = App.game?.purifyChamber) {
  if (!autoPurifyEnabled || !chamber)
    return false;
  if (!PurifyChamber.requirements.isCompleted())
    return false;
  if (chamber.currentFlow() < chamber.flowNeeded())
    return false;

  let selected = chamber.selectedPokemon();
  if (!selected || selected.shadow !== GameConstants.ShadowStatus.Shadow) {
    selected = App.game.party.caughtPokemon.find(p => p.shadow === GameConstants.ShadowStatus.Shadow);
    if (!selected)
      return false;
    chamber.selectedPokemon(selected);
  }

  if (!chamber.canPurify())
    return false;

  const name = selected.displayName || selected.name;
  chamber.purify();
  setCheatStatus(`Auto purified ${name}`);
  return true;
}

function setBulkStatus(message) {
  setElementText('ah-bulk-status', message);
}

function setBulkProgress(done, total) {
  const wrap = document.getElementById('ah-bulk-progress-wrap');
  const bar = document.getElementById('ah-bulk-progress');
  if (!wrap || !bar)
    return;
  if (total <= 0) {
    wrap.style.display = 'none';
    bar.style.width = '0%';
    return;
  }
  wrap.style.display = '';
  const pct = Math.max(0, Math.min(100, Math.round((done / total) * 100)));
  bar.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(pct));
}

function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function refillHatcheryForBulk() {
  try {
    fillEggSlots();
    enqueuePokemons(true);
  } catch (e) {
    console.error('Auto-Hatchery bulk hatchery refill error:', e);
  }
}

function progressEggsForBattles(stepsPerBattle, battles) {
  let remaining = battles;
  while (remaining > 0) {
    const chunk = Math.min(BULK_EGG_CHUNK, remaining);
    App.game.breeding.progressEggs(stepsPerBattle * chunk);
    refillHatcheryForBulk();
    remaining -= chunk;
  }
}

function addGemsBulk(gemsByType, multiplier = 1) {
  for (const [type, amount] of Object.entries(gemsByType)) {
    const gems = Math.round(amount * multiplier);
    if (gems > 0)
      App.game.gems.gainGems(gems, Number(type));
  }
}

function routeAverageHp(region, route) {
  const poke = [...new Set(
    Object.values(Routes.getRoute(region, route).pokemon).flat().map(p => p.pokemon ?? p).flat()
  )];
  if (!poke.length)
    return 1;
  const total = poke.map(p => pokemonMap[p].base.hitpoints).reduce((s, a) => s + a, 0);
  return total / poke.length;
}

function canOneshotRoute(routeData) {
  const { region, number: route, subRegion = 0 } = routeData;
  if (!routeData.isUnlocked())
    return false;
  const names = RouteHelper.getAvailablePokemonList(route, region);
  if (!names.length)
    return false;

  const baseHp = PokemonFactory.routeHealth(route, region);
  const avgHp = routeAverageHp(region, route);
  for (const name of names) {
    const base = PokemonHelper.getPokemonByName(name);
    const maxHealth = Math.round(baseHp * (0.9 + (base.hitpoints / avgHp) / 10));
    const attack = App.game.party.calculatePokemonAttack(
      base.type1, base.type2, false, region, false, false, undefined, false, true, subRegion
    );
    if (attack < maxHealth)
      return false;
  }
  return true;
}

function canOneshotGym(gym) {
  if (!gym?.isUnlocked?.())
    return false;
  const list = gym.getPokemonList();
  if (!list.length)
    return false;
  for (const gp of list) {
    const data = PokemonHelper.getPokemonByName(gp.name);
    const attack = App.game.party.calculatePokemonAttack(data.type1, data.type2);
    if (attack < gp.maxHealth)
      return false;
  }
  return true;
}

function dungeonBossHp(boss) {
  if (typeof DungeonBossPokemon !== 'undefined' && boss instanceof DungeonBossPokemon)
    return [{ name: boss.name, maxHealth: boss.baseHealth, level: boss.level }];

  if (typeof boss.getTeam === 'function') {
    const team = boss.getTeam();
    return team.map(p => ({ name: p.name, maxHealth: p.maxHealth, level: p.level }));
  }
  return [];
}

function canOneshotDungeon(dungeon) {
  if (!dungeon?.isUnlocked?.() || !dungeon.hasUnlockedBoss?.())
    return false;

  for (const enemy of dungeon.enemyList) {
    if (enemy?.options?.requirement && !enemy.options.requirement.isCompleted())
      continue;

    let names = [];
    if (typeof enemy === 'string')
      names = [enemy];
    else if (enemy?.pokemon)
      names = [enemy.pokemon];
    else if (typeof enemy?.getTeam === 'function')
      names = enemy.getTeam().map(p => p.name);

    for (const name of names) {
      const data = PokemonHelper.getPokemonByName(name);
      const attack = App.game.party.calculatePokemonAttack(data.type1, data.type2);
      if (attack < dungeon.baseHealth)
        return false;
    }
  }

  for (const boss of dungeon.availableBosses(true, false)) {
    for (const mon of dungeonBossHp(boss)) {
      const data = PokemonHelper.getPokemonByName(mon.name);
      const attack = App.game.party.calculatePokemonAttack(data.type1, data.type2);
      if (attack < mon.maxHealth)
        return false;
    }
  }
  return true;
}

function buildRouteRewardModel(routeData) {
  const { region, number: route } = routeData;
  const names = RouteHelper.getAvailablePokemonList(route, region);
  const level = PokemonFactory.routeLevel(route, region);
  const money = PokemonFactory.routeMoney(route, region, false);
  const eggSteps = +Math.sqrt(MapHelper.normalizeRoute(route, region)).toFixed(2);
  let expSum = 0;
  const gemsByType = {};

  for (const name of names) {
    const base = PokemonHelper.getPokemonByName(name);
    expSum += base.exp;
    const type1Amt = base.type2 === PokemonType.None ? 2 : 1;
    gemsByType[base.type1] = (gemsByType[base.type1] || 0) + type1Amt;
    if (base.type2 !== PokemonType.None)
      gemsByType[base.type2] = (gemsByType[base.type2] || 0) + 1;
  }

  const count = Math.max(1, names.length);
  for (const type of Object.keys(gemsByType))
    gemsByType[type] /= count;

  return {
    label: Routes.getName(route, region, true),
    region,
    route,
    level,
    money,
    avgExp: expSum / count,
    gemsByType,
    eggSteps,
  };
}

function buildGymRewardModel(gym) {
  const list = gym.getPokemonList();
  const gemsByType = {};
  const expParts = [];

  for (const gp of list) {
    const data = PokemonHelper.getPokemonByName(gp.name);
    expParts.push({ exp: data.exp, level: gp.level });
    const type1Amt = GameConstants.GYM_GEMS * (data.type2 === PokemonType.None ? 2 : 1);
    gemsByType[data.type1] = (gemsByType[data.type1] || 0) + type1Amt;
    if (data.type2 !== PokemonType.None)
      gemsByType[data.type2] = (gemsByType[data.type2] || 0) + GameConstants.GYM_GEMS;
  }

  const eggRoute = gym.badgeReward * 3 + 1;
  const eggStepsPerMon = +Math.sqrt(MapHelper.normalizeRoute(eggRoute, GameConstants.Region.none)).toFixed(2);

  return {
    label: gym.displayName || gym.town,
    gym,
    town: gym.town,
    money: gym.moneyReward,
    list,
    expParts,
    gemsByType,
    eggStepsPerClear: eggStepsPerMon * list.length,
  };
}

function buildDungeonRewardModel(dungeon) {
  const bosses = dungeon.availableBosses(true, false);
  // Use the first available boss as representative rewards for a clear (boss-rush)
  const boss = bosses[0];
  const mons = boss ? dungeonBossHp(boss) : [];
  const gemsByType = {};
  const expParts = [];
  const gemAmount = GameConstants.DUNGEON_BOSS_GEMS;

  for (const mon of mons) {
    const data = PokemonHelper.getPokemonByName(mon.name);
    expParts.push({ exp: data.exp, level: mon.level });
    const type1Amt = gemAmount * (data.type2 === PokemonType.None ? 2 : 1);
    gemsByType[data.type1] = (gemsByType[data.type1] || 0) + type1Amt;
    if (data.type2 !== PokemonType.None)
      gemsByType[data.type2] = (gemsByType[data.type2] || 0) + gemAmount;
  }

  const eggSteps = +Math.sqrt(MapHelper.normalizeRoute(dungeon.difficultyRoute, player.region)).toFixed(2);

  return {
    label: dungeon.name,
    dungeon,
    money: Math.round(dungeon.tokenCost), // approximate money from boss trainer path; wild bosses use their own
    expParts,
    gemsByType,
    eggStepsPerClear: eggSteps * Math.max(1, mons.length),
    monCount: Math.max(1, mons.length),
  };
}

async function awardRouteKills(model, kills, progress) {
  const stats = App.game.statistics.routeKills[model.region][model.route];
  let remaining = kills;
  while (remaining > 0) {
    const chunk = Math.min(BULK_CHUNK_SIZE, remaining);
    GameHelper.incrementObservable(stats, chunk);
    App.game.wallet.gainMoney(model.money * chunk, true);
    App.game.party.gainExp(model.avgExp * chunk, model.level, false);
    addGemsBulk(model.gemsByType, chunk);
    progressEggsForBattles(model.eggSteps, chunk);
    remaining -= chunk;
    progress.done += chunk;
    setBulkProgress(progress.done, progress.total);
    setBulkStatus(`Route ${model.label}: +${kills - remaining}/${kills}`);
    await yieldToUI();
  }
}

async function awardGymClears(model, clears, progress) {
  const idx = GameConstants.getGymIndex(model.town);
  const stats = App.game.statistics.gymsDefeated[idx];

  if (!App.game.badgeCase.hasBadge(model.gym.badgeReward)) {
    App.game.badgeCase.gainBadge(model.gym.badgeReward);
    try {
      model.gym.rewardFunction();
    } catch (e) {
      console.warn('Auto-Hatchery bulk gym first-win reward error:', e);
    }
  }

  let remaining = clears;
  while (remaining > 0) {
    const chunk = Math.min(BULK_CHUNK_SIZE, remaining);
    GameHelper.incrementObservable(stats, chunk);
    App.game.wallet.gainMoney(model.money * chunk, true);
    for (const part of model.expParts)
      App.game.party.gainExp(part.exp * chunk, part.level, true);
    addGemsBulk(model.gemsByType, chunk);
    progressEggsForBattles(model.eggStepsPerClear, chunk);
    remaining -= chunk;
    progress.done += chunk;
    setBulkProgress(progress.done, progress.total);
    setBulkStatus(`Gym ${model.label}: +${clears - remaining}/${clears}`);
    await yieldToUI();
  }
}

async function awardDungeonClears(model, clears, progress) {
  const idx = GameConstants.getDungeonIndex(model.dungeon.name);
  const stats = App.game.statistics.dungeonsCleared[idx];

  let remaining = clears;
  while (remaining > 0) {
    const chunk = Math.min(BULK_CHUNK_SIZE, remaining);
    GameHelper.incrementObservable(stats, chunk);
    if (model.money > 0)
      App.game.wallet.gainMoney(model.money * chunk, true);
    for (const part of model.expParts)
      App.game.party.gainExp(part.exp * chunk, part.level, true);
    addGemsBulk(model.gemsByType, chunk);
    progressEggsForBattles(model.eggStepsPerClear, chunk);
    remaining -= chunk;
    progress.done += chunk;
    setBulkProgress(progress.done, progress.total);
    setBulkStatus(`Dungeon ${model.label}: +${clears - remaining}/${clears}`);
    await yieldToUI();
  }
}

function getRouteKillCount(region, route) {
  return App.game.statistics.routeKills[region]?.[route]?.() || 0;
}

function getGymClearCount(town) {
  const idx = GameConstants.getGymIndex(town);
  return App.game.statistics.gymsDefeated[idx]?.() || 0;
}

function getDungeonClearCount(name) {
  const idx = GameConstants.getDungeonIndex(name);
  return App.game.statistics.dungeonsCleared[idx]?.() || 0;
}

function collectBulkTargets(region) {
  const routes = Routes.getRoutesByRegion(region)
    .filter(canOneshotRoute)
    .map(routeData => {
      const current = getRouteKillCount(routeData.region, routeData.number);
      const needed = Math.max(0, BULK_ROUTE_KILLS - current);
      if (current <= 0 || needed <= 0)
        return null;
      return { ...buildRouteRewardModel(routeData), current, needed };
    })
    .filter(Boolean);

  const gymNames = GameConstants.RegionGyms[region] || [];
  const gyms = gymNames
    .map(name => GymList[name])
    .filter(canOneshotGym)
    .map(gym => {
      const current = getGymClearCount(gym.town);
      const needed = Math.max(0, BULK_GYM_CLEARS - current);
      if (current <= 0 || needed <= 0)
        return null;
      return { ...buildGymRewardModel(gym), current, needed };
    })
    .filter(Boolean);

  const dungeonNames = GameConstants.RegionDungeons[region] || [];
  const dungeons = dungeonNames
    .map(name => dungeonList[name])
    .filter(canOneshotDungeon)
    .map(dungeon => {
      const current = getDungeonClearCount(dungeon.name);
      const needed = Math.max(0, BULK_DUNGEON_CLEARS - current);
      if (current <= 0 || needed <= 0)
        return null;
      return { ...buildDungeonRewardModel(dungeon), current, needed };
    })
    .filter(Boolean);

  return { routes, gyms, dungeons };
}

function sumNeeded(targets) {
  return targets.reduce((sum, t) => sum + t.needed, 0);
}

async function runBulkGrind(region) {
  const regionName = GameConstants.camelCaseToString(GameConstants.Region[region]);
  const { routes, gyms, dungeons } = collectBulkTargets(region);

  const progress = {
    done: 0,
    total: sumNeeded(routes) + sumNeeded(gyms) + sumNeeded(dungeons),
  };

  if (progress.total <= 0) {
    setBulkStatus(`Nothing to grind in ${regionName} (need started + oneshot + below cap)`);
    setBulkProgress(0, 0);
    return {
      regionName,
      routes: 0,
      gyms: 0,
      dungeons: 0,
      units: 0,
    };
  }

  setBulkProgress(0, progress.total);
  setBulkStatus(`Starting ${regionName}…`);

  for (const model of routes)
    await awardRouteKills(model, model.needed, progress);
  for (const model of gyms)
    await awardGymClears(model, model.needed, progress);
  for (const model of dungeons)
    await awardDungeonClears(model, model.needed, progress);

  refillHatcheryForBulk();
  setBulkProgress(progress.total, progress.total);

  return {
    regionName,
    routes: routes.length,
    gyms: gyms.length,
    dungeons: dungeons.length,
    units: progress.total,
  };
}

function startBulkGrindCurrentRegion() {
  if (bulkGrindRunning)
    return;

  const region = player.region;
  const regionName = GameConstants.camelCaseToString(GameConstants.Region[region]);
  const preview = collectBulkTargets(region);
  const routeUnits = sumNeeded(preview.routes);
  const gymUnits = sumNeeded(preview.gyms);
  const dungeonUnits = sumNeeded(preview.dungeons);
  const msg = [
    `Region: <b>${regionName}</b>`,
    `Routes: ${preview.routes.length} started/oneshot → +${routeUnits.toLocaleString()} kills (cap ${BULK_ROUTE_KILLS.toLocaleString()})`,
    `Gyms: ${preview.gyms.length} started/oneshot → +${gymUnits.toLocaleString()} clears (cap ${BULK_GYM_CLEARS.toLocaleString()})`,
    `Dungeons: ${preview.dungeons.length} started/oneshot → +${dungeonUnits.toLocaleString()} clears (cap ${BULK_DUNGEON_CLEARS.toLocaleString()})`,
    '',
    'Only content already started (>0) and below the cap. Skips non-oneshot.',
  ].join('<br/>');

  Notifier.confirm({
    title: 'Cheats — Bulk grind',
    message: msg,
    type: NotificationConstants.NotificationOption.info,
    confirm: 'Start bulk grind',
  }).then(async confirmed => {
    if (!confirmed)
      return;

    const btn = document.getElementById('ah-bulk-grind');
    bulkGrindRunning = true;
    if (btn)
      btn.disabled = true;

    const originalNotify = Notifier.notify;
    Notifier.notify = () => {};

    try {
      const result = await runBulkGrind(region);
      const summary = `Done ${result.regionName}: ${result.routes} routes, ${result.gyms} gyms, ${result.dungeons} dungeons (+${(result.units || 0).toLocaleString()} total)`;
      setBulkStatus(summary);
      console.log('Auto-Hatchery bulk grind:', summary);
      Notifier.notify = originalNotify;
      Notifier.notify({
        title: 'Cheats — Bulk grind',
        message: summary,
        type: NotificationConstants.NotificationOption.success,
        timeout: 5 * GameConstants.SECOND,
      });
    } catch (e) {
      console.error('Auto-Hatchery bulk grind error:', e);
      setBulkStatus('Error — see console');
      Notifier.notify = originalNotify;
    } finally {
      Notifier.notify = originalNotify;
      bulkGrindRunning = false;
      if (btn)
        btn.disabled = false;
      refillHatcheryForBulk();
    }
  });
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
  setElementText('ah-last-run', `Last check: ${message}`);
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
  const targets = [
    [GameConstants.Currency.money, INITIAL_MONEY, (n) => App.game.wallet.gainMoney(n, true)],
    [GameConstants.Currency.questPoint, INITIAL_QUEST_POINTS, (n) => App.game.wallet.gainQuestPoints(n, true)],
    [GameConstants.Currency.dungeonToken, INITIAL_DUNGEON_TOKENS, (n) => App.game.wallet.gainDungeonTokens(n, true)],
    [GameConstants.Currency.diamond, INITIAL_DIAMONDS, (n) => App.game.wallet.gainDiamonds(n, true)],
    [GameConstants.Currency.farmPoint, INITIAL_FARM_POINTS, (n) => App.game.wallet.gainFarmPoints(n, true)],
    [GameConstants.Currency.battlePoint, INITIAL_BATTLE_POINTS, (n) => App.game.wallet.gainBattlePoints(n, true)],
    [GameConstants.Currency.contestToken, INITIAL_CONTEST_TOKENS, (n) => App.game.wallet.gainContestTokens(n, true)],
  ];
  for (const [currency, minimum, gain] of targets) {
    const current = App.game.wallet.currencies[currency]();
    if (current < minimum)
      gain(minimum - current);
  }
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
/* ========== Auto Clicker / Gym / Dungeon (from Enhanced Auto Clicker, adapted for 0.10.26+) ========== */

class AutoClicker {
  static ticksPerSecond = 20;
  static maxClickMultiplier = 5;

  static autoClickState = false;
  static autoClickMultiplier = 1;
  static autoClickerLoop = null;

  static autoGymState = false;
  static autoGymSelect = 0;

  static autoDungeonState = false;
  static autoDungeonFinishBeforeStopping = true;
  static autoDungeonEncounterMode = false;
  static autoDungeonChestMode = false;
  static autoDungeonLootTier = 0;
  static autoDungeonAlwaysOpenRareChests = false;
  static autoDungeonTracker = {
    ID: 0,
    floor: null,
    floorSize: null,
    flashTier: null,
    flashCols: null,
    coords: null,
    targetCoords: null,
    bossCoords: null,
    encounterCoords: null,
    chestCoords: null,
    floorExplored: false,
    floorFinished: false,
    dungeonFinished: false,
    stopAfterFinishing: false,
    pathfindingPaused: false,
  };

  static autoClickCalcLoop = null;
  static autoClickCalcEfficiencyDisplayMode = 0;
  static autoClickCalcDamageDisplayMode = 0;
  static autoClickCalcTracker = {
    lastUpdate: null,
    playerState: -1,
    playerLocation: null,
    ticks: null,
    clicks: null,
    enemies: null,
    areaHealth: null,
  };

  static ready = false;

  static init() {
    if (this.ready)
      return;
    this.ready = true;

    this.autoClickState = loadSetting('ah_autoClickState', false);
    this.autoClickMultiplier = loadSetting('ah_autoClickMultiplier', 1);
    if (!Number.isInteger(this.autoClickMultiplier) || this.autoClickMultiplier < 1)
      this.autoClickMultiplier = 1;
    this.autoGymState = loadSetting('ah_autoGymState', false);
    this.autoGymSelect = loadSetting('ah_autoGymSelect', 0);
    this.autoDungeonState = loadSetting('ah_autoDungeonState', false);
    this.autoDungeonFinishBeforeStopping = loadSetting('ah_autoDungeonFinishBeforeStopping', true);
    this.autoDungeonEncounterMode = loadSetting('ah_autoDungeonEncounterMode', false);
    this.autoDungeonChestMode = loadSetting('ah_autoDungeonChestMode', false);
    this.autoDungeonLootTier = loadSetting('ah_autoDungeonLootTier', 0);
    this.autoDungeonAlwaysOpenRareChests = loadSetting('ah_autoDungeonAlwaysOpenRareChests', false);
    this.autoClickCalcEfficiencyDisplayMode = loadSetting('ah_autoClickCalcEfficiencyDisplayMode', 0);
    this.autoClickCalcDamageDisplayMode = loadSetting('ah_autoClickCalcDamageDisplayMode', 0);

    this.overrideGymRunner();
    this.overrideDungeonRunner();
    this.addStyles();
    this.addUI();

    window.AutoClicker = this;

    if (this.autoGymState && !this.autoClickState) {
      this.autoClickState = true;
      saveSetting('ah_autoClickState', true);
      const btn = document.getElementById('ah-auto-click-start');
      if (btn) {
        btn.classList.replace('btn-danger', 'btn-success');
        if (btn.childNodes[0])
          btn.childNodes[0].textContent = 'Auto Click [ON]';
      }
    }
    document.body.classList.toggle('ah-auto-gym-on', this.autoGymState);

    // Already inside a dungeon when the panel loads → start clicker
    if (App.game.gameState === GameConstants.GameState.dungeon)
      this.ensureClickerForDungeon();
    else if (this.autoClickState)
      this.toggleAutoClickerLoop();
  }

  static ensureClickerForDungeon() {
    if (!this.ready)
      return;
    if (!this.autoClickState)
      this.toggleAutoClick();
    else if (!this.autoClickerLoop)
      this.toggleAutoClickerLoop();
  }

  static addStyles() {
    addStyle(`
      #ah-auto-click-info { display: flex; flex-direction: row; justify-content: center; }
      #ah-auto-click-info > div { width: 25%; }
      #ah-click-rate-cont { display: flex; flex-direction: column; align-items: stretch; }
      #ah-auto-dungeon-loottier-dropdown img { max-height: 30px; width: auto; }
      body.ah-auto-gym-on button[data-bind*="GymRunner.autoRestart"] { display: none !important; }
    `);
  }

  static addUI() {
    const battleView = document.getElementsByClassName('battle-view')[0];
    if (!battleView)
      throw new Error('battle-view not found');

    const lootTiers = Object.keys(baseLootTierChance);
    if (this.autoDungeonLootTier < 0 || this.autoDungeonLootTier >= lootTiers.length)
      this.autoDungeonLootTier = 0;

    const elem = document.createElement('table');
    elem.id = 'ah-auto-clicker-panel';
    elem.className = 'table table-sm m-0';
    elem.innerHTML = `<tbody>
      <tr>
        <td colspan="4">
          <button id="ah-auto-click-start" class="btn btn-${this.autoClickState ? 'success' : 'danger'} btn-block" style="font-size:8pt;">
            Auto Click [${this.autoClickState ? 'ON' : 'OFF'}]<br />
            <div id="ah-auto-click-info"></div>
          </button>
          <div id="ah-click-rate-cont">
            <div id="ah-auto-click-rate-info">
              Click Attack Rate: ${(this.ticksPerSecond * this.autoClickMultiplier).toLocaleString('en-US', { maximumFractionDigits: 2 })}/s
            </div>
            <input id="ah-auto-click-rate" type="range" min="1" max="${this.maxClickMultiplier}" value="${this.autoClickMultiplier}">
          </div>
        </td>
      </tr>
      <tr>
        <td style="display:flex; column-gap:2px;">
          <div style="flex:auto;">
            <button id="ah-auto-dungeon-start" class="btn btn-block btn-${this.autoDungeonState ? 'success' : 'danger'}" style="font-size:8pt;" title="Auto-restart the current dungeon after clearing it">
              Dungeon Restart [${this.autoDungeonState ? 'ON' : 'OFF'}]
            </button>
          </div>
          <div id="ah-auto-dungeon-encounter-mode" style="flex:initial; max-height:30px; max-width:30px; padding:2px; cursor:pointer;">
            <img title="Fight encounters" src="assets/images/dungeons/encounter.png" height="100%" style="${this.autoDungeonEncounterMode ? '' : 'filter: grayscale(100%);'}" />
          </div>
          <div id="ah-auto-dungeon-chest-mode" style="flex:initial; max-height:30px; max-width:40px; padding:2px; cursor:pointer;">
            <img title="Open chests" src="assets/images/dungeons/chest.png" height="100%" style="${this.autoDungeonChestMode ? '' : 'filter: grayscale(100%);'}" />
          </div>
          <div style="flex:initial; display:flex; flex-direction:column;">
            <div id="ah-auto-dungeon-loottier" class="dropdown show">
              <button type="button" class="text-left custom-select col-12 btn btn-dropdown" data-toggle="dropdown" style="max-height:30px; display:flex; flex:1; align-items:center;">
                <img id="ah-auto-dungeon-loottier-img" src="assets/images/dungeons/chest-${lootTiers[this.autoDungeonLootTier]}.png" style="height:100%;">
              </button>
              <div id="ah-auto-dungeon-loottier-dropdown" class="border-secondary dropdown-menu col-12">
                ${lootTiers.map((tier, i) => `<div class="dropdown-item" data-value="${i}" style="cursor:pointer;"><img src="assets/images/dungeons/chest-${tier}.png"></div>`).join('\n')}
              </div>
            </div>
          </div>
          <div style="flex:auto;">
            <button id="ah-auto-gym-start" class="btn btn-block btn-${this.autoGymState ? 'success' : 'danger'}" style="font-size:8pt;">
              Auto Gym [${this.autoGymState ? 'ON' : 'OFF'}]
            </button>
          </div>
          <div style="flex:initial; display:flex; flex-direction:column;">
            <select id="ah-auto-gym-select" style="flex:auto;">
              <option value="0">#1</option>
              <option value="1">#2</option>
              <option value="2">#3</option>
              <option value="3">#4</option>
              <option value="4">#5</option>
            </select>
          </div>
        </td>
      </tr>
      <tr>
        <td>
          <div class="d-flex flex-wrap align-items-center small" style="gap:8px; padding:4px;">
            <label class="mb-0"><input type="checkbox" id="ah-dungeon-finish-before-stop" ${this.autoDungeonFinishBeforeStopping ? 'checked' : ''}> Finish dungeon before disabling restart</label>
            <label class="mb-0"><input type="checkbox" id="ah-dungeon-open-rare" ${this.autoDungeonAlwaysOpenRareChests ? 'checked' : ''}> Always open visible rare+ chests</label>
            <label class="mb-0">Efficiency
              <select id="ah-calc-efficiency-mode" class="custom-select custom-select-sm d-inline-block" style="width:auto;">
                <option value="0">%</option>
                <option value="1">Ticks/s</option>
              </select>
            </label>
            <label class="mb-0">Damage
              <select id="ah-calc-damage-mode" class="custom-select custom-select-sm d-inline-block" style="width:auto;">
                <option value="0">Clicks</option>
                <option value="1">DPS</option>
              </select>
            </label>
          </div>
        </td>
      </tr>
    </tbody>`;

    battleView.before(elem);
    document.getElementById('ah-auto-gym-select').value = String(this.autoGymSelect);
    document.getElementById('ah-calc-efficiency-mode').value = String(this.autoClickCalcEfficiencyDisplayMode);
    document.getElementById('ah-calc-damage-mode').value = String(this.autoClickCalcDamageDisplayMode);
    this.resetCalculator();

    document.getElementById('ah-auto-click-start').addEventListener('click', () => this.toggleAutoClick());
    document.getElementById('ah-auto-click-rate').addEventListener('change', (e) => this.changeClickMultiplier(e));
    document.getElementById('ah-auto-gym-start').addEventListener('click', () => this.toggleAutoGym());
    document.getElementById('ah-auto-gym-select').addEventListener('change', (e) => this.changeSelectedGym(e));
    document.getElementById('ah-auto-dungeon-start').addEventListener('click', () => this.toggleAutoDungeon(true));
    document.getElementById('ah-auto-dungeon-encounter-mode').addEventListener('click', () => this.toggleAutoDungeonEncounterMode());
    document.getElementById('ah-auto-dungeon-chest-mode').addEventListener('click', () => this.toggleAutoDungeonChestMode());
    document.getElementById('ah-dungeon-finish-before-stop').addEventListener('change', () => this.toggleAutoDungeonFinishBeforeStopping());
    document.getElementById('ah-dungeon-open-rare').addEventListener('change', () => this.toggleAutoDungeonAlwaysOpenRareChests());
    document.getElementById('ah-calc-efficiency-mode').addEventListener('change', (e) => this.changeCalcEfficiencyDisplayMode(e));
    document.getElementById('ah-calc-damage-mode').addEventListener('change', (e) => this.changeCalcDamageDisplayMode(e));
    document.querySelectorAll('#ah-auto-dungeon-loottier-dropdown > div').forEach((el) => {
      el.addEventListener('click', () => this.changeAutoDungeonLootTier(el.getAttribute('data-value')));
    });
  }

  static toggleAutoClick() {
    const element = document.getElementById('ah-auto-click-start');
    this.autoClickState = !this.autoClickState;
    saveSetting('ah_autoClickState', this.autoClickState);
    element.classList.replace(...(this.autoClickState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    if (element.childNodes[0])
      element.childNodes[0].textContent = `Auto Click [${this.autoClickState ? 'ON' : 'OFF'}]`;
    if (!this.autoClickState && this.autoGymState)
      this.toggleAutoGym();
    // Dungeon Restart stays independent — clicker re-enables on next dungeon enter
    this.toggleAutoClickerLoop();
  }

  static changeClickMultiplier(event) {
    const multiplier = +event.target.value;
    if (Number.isInteger(multiplier) && multiplier > 0) {
      this.autoClickMultiplier = multiplier;
      saveSetting('ah_autoClickMultiplier', this.autoClickMultiplier);
      document.getElementById('ah-auto-click-rate-info').innerText =
        `Click Attack Rate: ${(this.ticksPerSecond * this.autoClickMultiplier).toLocaleString('en-US', { maximumFractionDigits: 2 })}/s`;
      this.toggleAutoClickerLoop();
    }
  }

  static toggleAutoGym() {
    const element = document.getElementById('ah-auto-gym-start');
    const newState = !this.autoGymState;
    if (newState && !this.canStartAutoGym())
      return;
    if (newState && this.autoDungeonState)
      return;

    this.autoGymState = newState;
    saveSetting('ah_autoGymState', this.autoGymState);
    element.classList.replace(...(this.autoGymState ? ['btn-danger', 'btn-success'] : ['btn-success', 'btn-danger']));
    element.textContent = `Auto Gym [${this.autoGymState ? 'ON' : 'OFF'}]`;
    document.body.classList.toggle('ah-auto-gym-on', this.autoGymState);

    if (this.autoGymState) {
      if (!this.autoClickState)
        this.toggleAutoClick();
    } else {
      GymRunner.autoRestart(false);
    }
  }

  static changeSelectedGym(event) {
    const val = +event.target.value;
    if ([0, 1, 2, 3, 4].includes(val)) {
      this.autoGymSelect = val;
      saveSetting('ah_autoGymSelect', this.autoGymSelect);
      if (this.autoClickState && this.autoGymState)
        GymRunner.autoRestart(false);
    }
  }

  static toggleAutoDungeon(allowSlowStop = false) {
    // Toggle only controls auto-restart after clearing; pathfinding runs whenever clicker is on in a dungeon
    const element = document.getElementById('ah-auto-dungeon-start');
    let newState = !this.autoDungeonState;

    if (DungeonGuides.hired()) {
      newState = false;
      allowSlowStop = false;
      Notifier.notify({
        type: NotificationConstants.NotificationOption.warning,
        title: 'Auto Clicker',
        message: 'Dungeon Restart is not compatible with Dungeon Guides.',
        timeout: GameConstants.SECOND * 15,
      });
    } else if (newState && this.autoGymState) {
      return;
    }

    saveSetting('ah_autoDungeonState', newState);

    if (allowSlowStop && this.autoDungeonFinishBeforeStopping && App.game.gameState === GameConstants.GameState.dungeon
      && (!newState && !this.autoDungeonTracker.stopAfterFinishing)) {
      this.autoDungeonTracker.stopAfterFinishing = true;
    } else {
      this.autoDungeonState = newState;
      this.autoDungeonTracker.stopAfterFinishing = false;
    }

    element.classList.remove('btn-success', 'btn-danger', 'btn-warning');
    element.classList.add(this.autoDungeonTracker.stopAfterFinishing ? 'btn-warning' : (newState ? 'btn-success' : 'btn-danger'));
    element.textContent = `Dungeon Restart [${newState ? 'ON' : 'OFF'}]`;
  }

  static toggleAutoDungeonEncounterMode() {
    this.autoDungeonEncounterMode = !this.autoDungeonEncounterMode;
    $('#ah-auto-dungeon-encounter-mode img').css('filter', this.autoDungeonEncounterMode ? '' : 'grayscale(100%)');
    saveSetting('ah_autoDungeonEncounterMode', this.autoDungeonEncounterMode);
    this.autoDungeonTracker.coords = null;
  }

  static toggleAutoDungeonChestMode() {
    this.autoDungeonChestMode = !this.autoDungeonChestMode;
    $('#ah-auto-dungeon-chest-mode img').css('filter', this.autoDungeonChestMode ? '' : 'grayscale(100%)');
    saveSetting('ah_autoDungeonChestMode', this.autoDungeonChestMode);
    this.autoDungeonTracker.coords = null;
  }

  static changeAutoDungeonLootTier(tier) {
    const val = +tier;
    const keys = Object.keys(baseLootTierChance);
    if (val >= 0 && val < keys.length) {
      this.autoDungeonLootTier = val;
      document.getElementById('ah-auto-dungeon-loottier-img').setAttribute('src', `assets/images/dungeons/chest-${keys[val]}.png`);
      saveSetting('ah_autoDungeonLootTier', this.autoDungeonLootTier);
    }
  }

  static toggleAutoDungeonFinishBeforeStopping() {
    this.autoDungeonFinishBeforeStopping = document.getElementById('ah-dungeon-finish-before-stop').checked;
    if (!this.autoDungeonFinishBeforeStopping && this.autoDungeonTracker.stopAfterFinishing)
      this.toggleAutoDungeon();
    saveSetting('ah_autoDungeonFinishBeforeStopping', this.autoDungeonFinishBeforeStopping);
  }

  static toggleAutoDungeonAlwaysOpenRareChests() {
    this.autoDungeonAlwaysOpenRareChests = document.getElementById('ah-dungeon-open-rare').checked;
    saveSetting('ah_autoDungeonAlwaysOpenRareChests', this.autoDungeonAlwaysOpenRareChests);
  }

  static changeCalcEfficiencyDisplayMode(event) {
    const val = +event.target.value;
    if (val !== this.autoClickCalcEfficiencyDisplayMode && [0, 1].includes(val)) {
      this.autoClickCalcEfficiencyDisplayMode = val;
      saveSetting('ah_autoClickCalcEfficiencyDisplayMode', val);
      this.resetCalculator();
    }
  }

  static changeCalcDamageDisplayMode(event) {
    const val = +event.target.value;
    if (val !== this.autoClickCalcDamageDisplayMode && [0, 1].includes(val)) {
      this.autoClickCalcDamageDisplayMode = val;
      saveSetting('ah_autoClickCalcDamageDisplayMode', val);
      this.resetCalculator();
    }
  }

  static toggleAutoClickerLoop() {
    const delay = Math.ceil(1000 / this.ticksPerSecond);
    clearInterval(this.autoClickerLoop);
    this.resetCalculator();
    this.overrideClickAttack(this.autoClickState ? this.autoClickMultiplier : 1);
    if (this.autoClickState) {
      this.autoClickerLoop = setInterval(() => AutoClicker.autoClicker(), delay);
    } else if (this.autoGymState) {
      GymRunner.autoRestart(false);
    }
  }

  static autoClicker() {
    if (App.game.gameState === GameConstants.GameState.fighting) {
      Battle.clickAttack();
    } else if (App.game.gameState === GameConstants.GameState.gym) {
      GymBattle.clickAttack();
    } else if (App.game.gameState === GameConstants.GameState.dungeon && DungeonRunner.fighting()) {
      DungeonBattle.clickAttack();
    } else if (App.game.gameState === GameConstants.GameState.temporaryBattle) {
      TemporaryBattleBattle.clickAttack();
    } else if (App.game.gameState === GameConstants.GameState.dungeon) {
      // Always progress the dungeon map while clicker is on; restart is gated separately
      this.progressDungeon();
    } else if (this.autoGymState) {
      this.autoGym();
    } else if (App.game.gameState === GameConstants.GameState.battleFrontier || App.game.gameState === GameConstants.GameState.safari) {
      this.toggleAutoClick();
    }
    this.autoClickCalcTracker.ticks[0]++;
  }

  /**
   * Override Battle.clickAttack so Gym/Dungeon/Temporary battles (via super) also get multi-click.
   * Fixed for 0.10.x: native clickAttack takes no args; multiplier comes from closure.
   */
  static overrideClickAttack(clickMultiplier = 1) {
    const delay = Math.min(Math.ceil(1000 / this.ticksPerSecond) - 10, 50);
    Battle.clickAttack = function () {
      if (App.game.challenges.list.disableClickAttack.active() && player.regionStarters[GameConstants.Region.kanto]() != GameConstants.Starter.None)
        return;
      const now = Date.now();
      if (this.lastClickAttack > now - delay)
        return;
      if (!this.enemyPokemon()?.isAlive())
        return;
      this.lastClickAttack = now;
      const clickDamage = App.game.party.calculateClickAttack(true);
      const clicks = Math.min(clickMultiplier, Math.ceil(this.enemyPokemon().health() / clickDamage));
      GameHelper.incrementObservable(App.game.statistics.clickAttacks, clicks);
      this.enemyPokemon().damage(clickDamage * clicks);
      if (!this.enemyPokemon().isAlive())
        this.defeatPokemon();
    };
  }

  static autoGym() {
    if (this.canStartAutoGym()) {
      const gymList = player.town.content.filter((c) => c instanceof Gym && c.isUnlocked());
      if (gymList.length > 0) {
        const gymIndex = Math.min(this.autoGymSelect, gymList.length - 1);
        GymRunner.startGym(gymList[gymIndex], true);
        return;
      }
    }
    this.toggleAutoGym();
  }

  static canStartAutoGym() {
    return App.game.gameState === GameConstants.GameState.gym
      || (App.game.gameState === GameConstants.GameState.town
        && player.town.content.some((c) => c instanceof Gym && c.isUnlocked()));
  }

  static overrideGymRunner() {
    GymRunner.gymWonNormal = GymRunner.gymWon;
    GymRunner.gymWonAuto = function (gym) {
      if (GymRunner.running()) {
        GymRunner.running(false);
        if (!App.game.badgeCase.hasBadge(gym.badgeReward))
          gym.firstWinReward();
        GameHelper.incrementObservable(App.game.statistics.gymsDefeated[GameConstants.getGymIndex(gym.town)]);
        App.game.wallet.gainMoney(gym.moneyReward);

        if (GymRunner.autoRestart()) {
          GymRunner.startGym(GymRunner.gymObservable(), GymRunner.autoRestart(), false);
          return;
        }

        player.town = gym.parent;
        App.game.gameState = GameConstants.GameState.town;
      }
    };
    GymRunner.gymWon = function (...args) {
      if (AutoClicker.autoClickState && AutoClicker.autoGymState)
        GymRunner.gymWonAuto(...args);
      else
        GymRunner.gymWonNormal(...args);
    };
  }

  static progressDungeon() {
    if (App.game.gameState !== GameConstants.GameState.dungeon)
      return;
    if (DungeonRunner.fighting() || DungeonBattle.catching())
      return;
    if (DungeonGuides.hired())
      return;
    if (this.autoDungeonTracker.ID !== DungeonRunner.dungeonID || this.autoDungeonTracker.floor !== DungeonRunner.map.playerPosition().floor)
      this.scanDungeon();
    if (this.autoDungeonTracker.dungeonFinished || this.autoDungeonTracker.pathfindingPaused)
      return;
    if (this.autoDungeonTracker.coords == null) {
      this.autoDungeonTracker.coords = new Point(
        Math.floor(this.autoDungeonTracker.floorSize / 2),
        this.autoDungeonTracker.floorSize - 1,
        this.autoDungeonTracker.floor
      );
    }
    const floorMap = DungeonRunner.map.board()[this.autoDungeonTracker.floor];
    if (floorMap[this.autoDungeonTracker.bossCoords.y][this.autoDungeonTracker.bossCoords.x].isVisible
      && !((this.autoDungeonChestMode || this.autoDungeonEncounterMode) && !this.autoDungeonTracker.floorExplored)) {
      this.clearDungeon();
    } else {
      this.exploreDungeon();
    }
  }

  static canRestartDungeon() {
    if (DungeonGuides.hired())
      return false;
    const dungeon = DungeonRunner.dungeon || player.town?.dungeon;
    return !!(dungeon?.isUnlocked() && dungeon.hasUnlockedBoss() && DungeonRunner.hasEnoughTokens(dungeon));
  }

  static scanDungeon() {
    this.autoDungeonTracker.ID = DungeonRunner.dungeonID;
    this.autoDungeonTracker.floor = DungeonRunner.map.playerPosition().floor;
    this.autoDungeonTracker.floorSize = DungeonRunner.map.floorSizes[DungeonRunner.map.playerPosition().floor];
    this.autoDungeonTracker.encounterCoords = [];
    this.autoDungeonTracker.chestCoords = [];
    this.autoDungeonTracker.coords = null;
    this.autoDungeonTracker.targetCoords = null;
    this.autoDungeonTracker.floorExplored = false;
    this.autoDungeonTracker.floorFinished = false;
    this.autoDungeonTracker.dungeonFinished = false;
    this.autoDungeonTracker.pathfindingPaused = false;

    const dungeonBoard = DungeonRunner.map.board()[this.autoDungeonTracker.floor];
    for (let y = 0; y < dungeonBoard.length; y++) {
      for (let x = 0; x < dungeonBoard[y].length; x++) {
        const tile = dungeonBoard[y][x];
        if (tile.type() == GameConstants.DungeonTileType.enemy) {
          this.autoDungeonTracker.encounterCoords.push(new Point(x, y, this.autoDungeonTracker.floor));
        } else if (tile.type() == GameConstants.DungeonTileType.chest) {
          const lootTier = Object.keys(baseLootTierChance).indexOf(tile.metadata.tier);
          this.autoDungeonTracker.chestCoords.push({ xy: new Point(x, y, this.autoDungeonTracker.floor), tier: lootTier });
        } else if (tile.type() == GameConstants.DungeonTileType.boss || tile.type() == GameConstants.DungeonTileType.ladder) {
          this.autoDungeonTracker.bossCoords = new Point(x, y, this.autoDungeonTracker.floor);
        }
      }
    }
    this.autoDungeonTracker.chestCoords.sort((a, b) => b.tier - a.tier);

    this.autoDungeonTracker.flashTier = DungeonFlash.tiers.findIndex(tier => tier === DungeonRunner.map.flash);
    this.autoDungeonTracker.flashCols = [];
    // playerOffset[1] is column index of player in flash matrix (= horizontal radius for current symmetric configs)
    const flashRadius = DungeonRunner.map.flash?.playerOffset?.[1] ?? DungeonRunner.map.flash?.playerOffset?.[0] ?? 0;
    if (flashRadius > 0) {
      const cols = new Set();
      cols.add(flashRadius);
      let i = this.autoDungeonTracker.floorSize - flashRadius - 1;
      while (i > flashRadius) {
        cols.add(i);
        i -= flashRadius * 2 + 1;
      }
      this.autoDungeonTracker.flashCols = [...cols].sort((a, b) => a - b);
    }
  }

  static exploreDungeon() {
    const dungeonBoard = DungeonRunner.map.board()[this.autoDungeonTracker.floor];
    let hasMoved = false;
    let stuckInLoopCounter = 0;
    while (!hasMoved) {
      if (this.autoDungeonTracker.coords.y == 0) {
        if (this.autoDungeonTracker.coords.x <= 0 || this.autoDungeonTracker.coords.x === this.autoDungeonTracker.flashCols[0]) {
          this.autoDungeonTracker.floorExplored = true;
          return;
        }
        this.autoDungeonTracker.coords.y = this.autoDungeonTracker.floorSize - 1;
        if (this.autoDungeonTracker.coords.x >= this.autoDungeonTracker.floorSize - 1 || this.autoDungeonTracker.coords.x === this.autoDungeonTracker.flashCols.at(-1)) {
          this.autoDungeonTracker.coords.x = Math.floor(this.autoDungeonTracker.floorSize / 2) - 1;
        } else {
          this.autoDungeonTracker.coords.x += (this.autoDungeonTracker.coords.x >= Math.floor(this.autoDungeonTracker.floorSize / 2) ? 1 : -1);
        }
      } else if (this.autoDungeonTracker.flashTier > -1
        && this.autoDungeonTracker.coords.y == (this.autoDungeonTracker.floorSize - 1)
        && !this.autoDungeonTracker.flashCols.includes(this.autoDungeonTracker.coords.x)) {
        this.autoDungeonTracker.coords.x += (this.autoDungeonTracker.coords.x >= Math.floor(this.autoDungeonTracker.floorSize / 2) ? 1 : -1);
      } else {
        this.autoDungeonTracker.coords.y -= 1;
      }

      if (!dungeonBoard[this.autoDungeonTracker.coords.y][this.autoDungeonTracker.coords.x].isVisited) {
        DungeonRunner.map.moveToCoordinates(this.autoDungeonTracker.coords.x, this.autoDungeonTracker.coords.y);
        hasMoved = true;
      }
      stuckInLoopCounter++;
      if (stuckInLoopCounter > 100) {
        console.warn('Dungeon pathfinding got stuck while exploring');
        this.autoDungeonTracker.pathfindingPaused = true;
        return;
      }
    }
  }

  static clearDungeon() {
    const dungeonBoard = DungeonRunner.map.board()[this.autoDungeonTracker.floor];
    let hasMoved = false;
    let stuckInLoopCounter = 0;
    while (!hasMoved) {
      if (!this.autoDungeonTracker.targetCoords)
        this.autoDungeonTracker.targetCoords = this.chooseDungeonTargetTile();
      this.autoDungeonTracker.coords = this.pathfindTowardDungeonTarget();
      if (!this.autoDungeonTracker.coords) {
        const t = this.autoDungeonTracker.targetCoords;
        console.warn(`Dungeon pathfinding could not path to (${t?.x}, ${t?.y})`);
        this.autoDungeonTracker.pathfindingPaused = true;
        return;
      }
      if (!(dungeonBoard[this.autoDungeonTracker.coords.y][this.autoDungeonTracker.coords.x] === DungeonRunner.map.currentTile())) {
        DungeonRunner.map.moveToCoordinates(this.autoDungeonTracker.coords.x, this.autoDungeonTracker.coords.y);
        hasMoved = true;
      }
      if (this.autoDungeonTracker.coords.x === this.autoDungeonTracker.targetCoords.x
        && this.autoDungeonTracker.coords.y === this.autoDungeonTracker.targetCoords.y) {
        this.autoDungeonTracker.targetCoords = null;
        hasMoved = true;
        const tileType = DungeonRunner.map.currentTile().type();
        if (tileType === GameConstants.DungeonTileType.chest) {
          DungeonRunner.openChest();
        } else if (tileType === GameConstants.DungeonTileType.boss) {
          if (this.autoDungeonTracker.floorFinished)
            DungeonRunner.startBossFight();
        } else if (tileType === GameConstants.DungeonTileType.ladder) {
          if (this.autoDungeonTracker.floorFinished)
            DungeonRunner.nextFloor();
        }
      }
      stuckInLoopCounter++;
      if (stuckInLoopCounter > 5) {
        console.warn('Dungeon pathfinding got stuck while clearing');
        this.autoDungeonTracker.pathfindingPaused = true;
        return;
      }
    }
  }

  static chooseDungeonTargetTile() {
    const dungeonBoard = DungeonRunner.map.board()[this.autoDungeonTracker.floor];
    let target = null;
    while (!target) {
      if (!dungeonBoard[this.autoDungeonTracker.bossCoords.y][this.autoDungeonTracker.bossCoords.x].isVisited) {
        target = this.autoDungeonTracker.bossCoords;
      } else if (this.autoDungeonEncounterMode && this.autoDungeonTracker.encounterCoords.length) {
        const encounter = this.autoDungeonTracker.encounterCoords.pop();
        if (dungeonBoard[encounter.y][encounter.x].type() == GameConstants.DungeonTileType.enemy)
          target = encounter;
      } else if (this.autoDungeonChestMode && this.autoDungeonTracker.chestCoords.length
        && this.autoDungeonTracker.chestCoords[0].tier >= this.autoDungeonLootTier) {
        target = this.autoDungeonTracker.chestCoords.shift().xy;
      } else if (this.autoDungeonAlwaysOpenRareChests
        && this.autoDungeonTracker.chestCoords.some((c) => c.tier >= this.autoDungeonLootTier && dungeonBoard[c.xy.y][c.xy.x].isVisible)) {
        const index = this.autoDungeonTracker.chestCoords.findIndex((c) => c.tier >= this.autoDungeonLootTier && dungeonBoard[c.xy.y][c.xy.x].isVisible);
        target = this.autoDungeonTracker.chestCoords[index].xy;
        this.autoDungeonTracker.chestCoords.splice(index, 1);
      } else {
        target = this.autoDungeonTracker.bossCoords;
        this.autoDungeonTracker.floorFinished = true;
      }
    }
    return target;
  }

  static pathfindTowardDungeonTarget() {
    const target = this.autoDungeonTracker.targetCoords;
    if (!target)
      return null;
    const queue = [target];
    const visited = new Set(`${target.x}-${target.y}`);
    while (queue.length) {
      const p = queue.shift();
      if (DungeonRunner.map.hasAccessToTile(p))
        return p;
      for (const [nx, ny] of [[p.x - 1, p.y], [p.x + 1, p.y], [p.x, p.y - 1], [p.x, p.y + 1]]) {
        const xy = `${nx}-${ny}`;
        if (0 <= nx && nx < this.autoDungeonTracker.floorSize && 0 <= ny && ny < this.autoDungeonTracker.floorSize && !visited.has(xy)) {
          queue.push(new Point(nx, ny, target.floor));
          visited.add(xy);
        }
      }
    }
    return null;
  }

  static restartDungeon() {
    if (App.game.gameState !== GameConstants.GameState.dungeon) {
      return;
    } else if (!AutoClicker.canRestartDungeon()) {
      MapHelper.moveToTown(DungeonRunner.dungeon.name);
      return;
    }
    this.autoDungeonTracker.dungeonFinished = false;
    DungeonRunner.map.board([]);
    DungeonRunner.initializeDungeon(DungeonRunner.dungeon);
  }

  static overrideDungeonRunner() {
    DungeonRunner.dungeonID = 0;
    const oldInit = DungeonRunner.initializeDungeon.bind(DungeonRunner);
    DungeonRunner.initializeDungeon = function (...args) {
      DungeonRunner.dungeonID++;
      const result = oldInit(...args);
      // Entering any dungeon always starts the autoclicker
      AutoClicker.ensureClickerForDungeon();
      return result;
    };

    DungeonRunner.dungeonWonNormal = DungeonRunner.dungeonWon;
    DungeonRunner.dungeonWonAuto = function () {
      if (!DungeonRunner.dungeonFinished()) {
        DungeonRunner.dungeonFinished(true);
        if (!App.game.statistics.dungeonsCleared[GameConstants.getDungeonIndex(DungeonRunner.dungeon.name)]())
          DungeonRunner.dungeon.rewardFunction();
        GameHelper.incrementObservable(App.game.statistics.dungeonsCleared[GameConstants.getDungeonIndex(DungeonRunner.dungeon.name)]);

        if (AutoClicker.autoDungeonTracker.stopAfterFinishing)
          AutoClicker.toggleAutoDungeon();

        if (AutoClicker.autoDungeonState && AutoClicker.canRestartDungeon()) {
          AutoClicker.autoDungeonTracker.dungeonFinished = true;
          setTimeout(() => AutoClicker.restartDungeon(), 50);
        } else {
          if (AutoClicker.autoDungeonState && !DungeonRunner.hasEnoughTokens()) {
            Notifier.notify({
              type: NotificationConstants.NotificationOption.warning,
              title: 'Auto Clicker',
              message: 'Dungeon Restart ran out of dungeon tokens.',
              timeout: GameConstants.DAY,
            });
            AutoClicker.toggleAutoDungeon();
          }
          MapHelper.moveToTown(DungeonRunner.dungeon.name);
        }
      }
    };
    // Restart is controlled solely by Dungeon Restart toggle
    DungeonRunner.dungeonWon = function (...args) {
      if (AutoClicker.autoDungeonState)
        DungeonRunner.dungeonWonAuto(...args);
      else
        DungeonRunner.dungeonWonNormal(...args);
    };
  }

  static resetCalculator() {
    clearInterval(this.autoClickCalcLoop);
    this.autoClickCalcTracker.lastUpdate = [Date.now()];
    this.autoClickCalcTracker.ticks = [0];
    this.autoClickCalcTracker.clicks = [App.game.statistics.clickAttacks()];
    this.autoClickCalcTracker.enemies = [App.game.statistics.totalPokemonDefeated()];
    this.calculateAreaHealth();
    const info = document.getElementById('ah-auto-click-info');
    if (!info)
      return;
    info.innerHTML = `<div>${this.autoClickCalcEfficiencyDisplayMode == 0 ? 'Clicker Efficiency' : 'Ticks/s'}:<br><div id="ah-tick-efficiency" style="font-weight:bold;">-</div></div>
      <div>${this.autoClickCalcDamageDisplayMode == 0 ? 'Click Attacks/s' : 'DPS'}:<br><div id="ah-clicks-per-second" style="font-weight:bold;">-</div></div>
      <div>Req. ${this.autoClickCalcDamageDisplayMode == 0 ? 'Clicks' : 'Click Damage'}:<br><div id="ah-req-clicks" style="font-weight:bold;">-</div></div>
      <div>Enemies/s:<br><div id="ah-enemies-per-second" style="font-weight:bold;">-</div></div>`;
    if (this.autoClickState)
      this.autoClickCalcLoop = setInterval(() => AutoClicker.calcClickStats(), 1000);
  }

  static calcClickStats() {
    if (this.hasPlayerMoved()) {
      this.resetCalculator();
      return;
    }
    const clickDamage = App.game.party.calculateClickAttack(true);
    const actualElapsed = (Date.now() - this.autoClickCalcTracker.lastUpdate.at(-1)) / (1000 * this.autoClickCalcTracker.lastUpdate.length);

    let elem = document.getElementById('ah-tick-efficiency');
    let avgTicks = this.autoClickCalcTracker.ticks.reduce((a, b) => a + b, 0) / this.autoClickCalcTracker.ticks.length;
    avgTicks = avgTicks / actualElapsed;
    if (this.autoClickCalcEfficiencyDisplayMode == 1) {
      elem.innerHTML = avgTicks.toLocaleString('en-US', { maximumFractionDigits: 1 });
    } else {
      elem.innerHTML = (avgTicks / this.ticksPerSecond).toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 0 });
    }
    elem.style.color = 'gold';

    elem = document.getElementById('ah-clicks-per-second');
    let avgClicks = (App.game.statistics.clickAttacks() - this.autoClickCalcTracker.clicks.at(-1)) / this.autoClickCalcTracker.clicks.length;
    avgClicks = avgClicks / actualElapsed;
    if (this.autoClickCalcDamageDisplayMode == 1) {
      elem.innerHTML = (avgClicks * clickDamage).toLocaleString('en-US', { maximumFractionDigits: 0 });
    } else {
      elem.innerHTML = avgClicks.toLocaleString('en-US', { maximumFractionDigits: 1 });
    }
    elem.style.color = 'gold';

    elem = document.getElementById('ah-req-clicks');
    if (this.autoClickCalcTracker.areaHealth == 0) {
      elem.innerHTML = '-';
      elem.style.removeProperty('color');
    } else if (this.autoClickCalcDamageDisplayMode == 1) {
      elem.innerHTML = this.autoClickCalcTracker.areaHealth.toLocaleString('en-US');
      elem.style.color = (clickDamage * this.autoClickMultiplier >= this.autoClickCalcTracker.areaHealth ? 'greenyellow' : 'darkred');
    } else {
      let reqClicks = Math.max(this.autoClickCalcTracker.areaHealth / clickDamage, 1);
      reqClicks = Math.ceil(reqClicks * 10) / 10;
      elem.innerHTML = reqClicks.toLocaleString('en-US', { maximumFractionDigits: 1 });
      elem.style.color = (reqClicks <= this.autoClickMultiplier ? 'greenyellow' : 'darkred');
    }

    elem = document.getElementById('ah-enemies-per-second');
    let avgEnemies = (App.game.statistics.totalPokemonDefeated() - this.autoClickCalcTracker.enemies.at(-1)) / this.autoClickCalcTracker.enemies.length;
    avgEnemies = avgEnemies / actualElapsed;
    elem.innerHTML = avgEnemies.toLocaleString('en-US', { maximumFractionDigits: 1 });
    elem.style.color = 'gold';

    this.autoClickCalcTracker.ticks.unshift(0);
    if (this.autoClickCalcTracker.ticks.length > 10) this.autoClickCalcTracker.ticks.pop();
    this.autoClickCalcTracker.clicks.unshift(App.game.statistics.clickAttacks());
    if (this.autoClickCalcTracker.clicks.length > 10) this.autoClickCalcTracker.clicks.pop();
    this.autoClickCalcTracker.enemies.unshift(App.game.statistics.totalPokemonDefeated());
    if (this.autoClickCalcTracker.enemies.length > 10) this.autoClickCalcTracker.enemies.pop();
    this.autoClickCalcTracker.lastUpdate.unshift(Date.now());
    if (this.autoClickCalcTracker.lastUpdate.length > 10) this.autoClickCalcTracker.lastUpdate.pop();
  }

  static hasPlayerMoved() {
    let moved = false;
    const newState = App.game.gameState;
    if (this.autoClickCalcTracker.playerState != newState) {
      this.autoClickCalcTracker.playerState = newState;
      moved = true;
    }
    let newLocation;
    if (App.game.gameState === GameConstants.GameState.gym)
      newLocation = GymRunner.gymObservable().leaderName;
    else if (App.game.gameState === GameConstants.GameState.dungeon)
      newLocation = DungeonRunner.dungeon.name;
    else if (App.game.gameState === GameConstants.GameState.temporaryBattle)
      newLocation = TemporaryBattleRunner.battleObservable().name;
    else
      newLocation = player.route || player.town.name;
    if (this.autoClickCalcTracker.playerLocation != newLocation) {
      this.autoClickCalcTracker.playerLocation = newLocation;
      moved = true;
    }
    return moved;
  }

  static calculateAreaHealth() {
    if (App.game.gameState === GameConstants.GameState.fighting) {
      this.autoClickCalcTracker.areaHealth = PokemonFactory.routeHealth(player.route, player.region);
      const pokeHP = [...new Set(Object.values(Routes.getRoute(player.region, player.route).pokemon).flat().flatMap(p => p.pokemon ?? p))].map(p => pokemonMap[p].base.hitpoints);
      const averageHP = pokeHP.reduce((s, a) => s + a, 0) / pokeHP.length;
      const highestHP = pokeHP.reduce((m, a) => Math.max(m, a), 0);
      this.autoClickCalcTracker.areaHealth = Math.round(this.autoClickCalcTracker.areaHealth * (0.9 + (highestHP / averageHP) / 10));
    } else if (App.game.gameState === GameConstants.GameState.gym) {
      this.autoClickCalcTracker.areaHealth = GymRunner.gymObservable().getPokemonList().reduce((a, b) => Math.max(a, b.maxHealth), 0);
    } else if (App.game.gameState === GameConstants.GameState.dungeon) {
      this.autoClickCalcTracker.areaHealth = DungeonRunner.dungeon.baseHealth;
    } else if (App.game.gameState === GameConstants.GameState.temporaryBattle) {
      this.autoClickCalcTracker.areaHealth = TemporaryBattleRunner.battleObservable().getPokemonList().reduce((a, b) => Math.max(a, b.maxHealth), 0);
    } else {
      this.autoClickCalcTracker.areaHealth = 0;
    }
  }
}

/* ========== Weather Changer (from Simple Weather Changer, adapted for 0.10.26+) ========== */

class WeatherChanger {
  static weather = -1;
  static oldGenerateWeather = null;
  static coreReady = false;
  static uiReady = false;

  static initCore() {
    if (this.coreReady)
      return;
    this.coreReady = true;

    this.weather = loadSetting('ah_weather', -1);
    if (this.weather === -1) {
      const legacy = parseInt(localStorage.getItem('weatherChangerWeather'), 10);
      if (!Number.isNaN(legacy)) {
        this.weather = legacy;
        saveSetting('ah_weather', this.weather);
      }
    }

    this.overrideGenerateWeather();
    if (this.weather >= 0)
      Weather.generateWeather(new Date());
    window.WeatherChanger = this;
  }

  static initUI() {
    if (this.uiReady)
      return;
    this.uiReady = true;
    this.initCore();

    const dayCycleBtn = document.querySelector('#townMap button[data-bind*="DayCycle.color"]');
    if (!dayCycleBtn) {
      console.warn('WeatherChanger: town map DayCycle button not found');
      return;
    }

    const weatherSelect = document.createElement('select');
    weatherSelect.id = 'ah-weather-select';
    weatherSelect.title = 'Freeze weather for all regions (−1 = default)';
    const options = GameHelper.enumSelectOption(WeatherType)
      .map((w) => `<option value="${w.value}">${w.name.replaceAll('_', ' ')}</option>`)
      .join('\n');
    weatherSelect.innerHTML = `<option value="-1">Default Weather</option>\n${options}`;
    weatherSelect.value = String(this.weather);
    dayCycleBtn.before(weatherSelect);
    weatherSelect.addEventListener('change', (event) => this.changeWeather(+event.target.value));

    addStyle('#ah-weather-select { position: absolute; right: 148px; top: 10px; width: auto; height: 20px; font-size: 9px; z-index: 1; }');
  }

  static changeWeather(value) {
    this.weather = value;
    saveSetting('ah_weather', this.weather);
    Weather.generateWeather(new Date());
  }

  static overrideGenerateWeather() {
    if (this.oldGenerateWeather)
      return;
    this.oldGenerateWeather = Weather.generateWeather.bind(Weather);
    Weather.generateWeather = (...args) => {
      if (WeatherChanger.weather >= 0) {
        Weather.regionalWeather.forEach((weather) => weather(WeatherChanger.weather));
        return;
      }
      return WeatherChanger.oldGenerateWeather(...args);
    };
  }
}

