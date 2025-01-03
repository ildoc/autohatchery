// ==UserScript==
// @name        Auto-Hatchery - pokeclicker.com
// @namespace   Violentmonkey Scripts
// @match       https://www.pokeclicker.com/
// @grant       none
// @version     1.3.3
// @author      il_doc
// @description 12/24/2020, 2:08:50 PM
// @run-at      document-end
// ==/UserScript==

const MINUTES = 2;
const QUEUESLOTS = 1500;

(async function waitGameReadyAndSetup(){
  while(App.game==undefined)
    await new Promise(r => setTimeout(r, 1000));
  addControls();
  setQueueDimension()
})();

function addControls() {
  document.querySelector('#breedingDisplay > .card-header > span').insertAdjacentHTML('beforebegin', '<div>Auto <input type="checkbox" id="autohatch" onclick="event.stopPropagation()" checked /> Max DMG <input type="text" id="maxattack" onclick="event.stopPropagation()" size="8" value="'+App.game.party.pokemonAttackObservable()+'"></div>');
}

function setQueueDimension() {
  if (App.game.breeding.queueSlots() != QUEUESLOTS) {
    App.game.breeding.gainQueueSlot(QUEUESLOTS);
    console.log("Queue slots set to " + QUEUESLOTS);
  }
}

function checkAndHatchEggs(isEnabled) {
  if (!isEnabled) return;
  App.game.breeding.eggList.forEach((egg, index) => {
    if (egg().progress() >= 100) {
      console.log(egg().pokemon);
      App.game.breeding.hatchPokemonEgg(index);
    }
  });
}

function enqueuePokemons(isEnabled) {
  if (!isEnabled) return;

  var maxAttack = Number(document.getElementById('maxattack').value) == 0 ? App.game.party.pokemonAttackObservable() : Number(document.getElementById('maxattack').value);
  try{
    var list = App.game.party.caughtPokemon.filter(x=> !x.breeding && x.level == 100).sort((a,b) => (b.breedingEfficiency() * BreedingController.calculateRegionalMultiplier(b) - a.breedingEfficiency() * BreedingController.calculateRegionalMultiplier(a)));
    var i=0;
    while(App.game.party.pokemonAttackObservable()>=maxAttack && (App.game.breeding.hasFreeQueueSlot() || App.game.breeding.hasFreeEggSlot()) && i<list.length)
    {
      if(App.game.breeding.hasFreeEggSlot())
        App.game.breeding.addPokemonToHatchery(list[i]);
      else
        App.game.breeding.addToQueue(list[i]);

      i++;
    }
    console.log('added ' + i + ' pokemon(s) to hatchery');
  }
  catch(e){
    console.log(e);
  }
}

let autoHatchIsEnabled = false;

(function autoHatch() {

  setInterval(() => { autoHatchIsEnabled = document.getElementById('autohatch')?.checked == true; }, 10 * 1000);
    
  setInterval(() => checkAndHatchEggs(autoHatchIsEnabled), 30 * 1000);
    
  setInterval(() => enqueuePokemons(autoHatchIsEnabled), MINUTES * 60 * 1000);
})();

console.log('---Auto-Hatchery script loaded!---');
