// HeIC Simulation effect hooks
//
// This file defines behaviours for selected weapons and items. Each entry
// corresponds to a slug used in the DETAILS database. The handlers
// expose functions keyed by event phase: `battleStart`, `turnStart`,
// `onHit`, `turnEnd`, etc. The main simulation engine calls these
// handlers at the appropriate times via the `window.HeICSimHooks` object.

// Attach hooks into global namespace if not already present
(function(){
  if(typeof window === 'undefined') return;
  if(!window.HeICSimHooks) window.HeICSimHooks = {};
  const hooks = window.HeICSimHooks;
  // Helper: get tags for a slug from global details (if available); fallback to heuristics
  function getTagsFor(slug){
    try {
      const d = (window.HEIC_DETAILS && window.HEIC_DETAILS[slug]) || null;
      if (d && Array.isArray(d.tags)) return d.tags;
    } catch(_){}
    const tags = [];
    if (/tome/i.test(slug)) tags.push('Tome');
    if (/(ring|earring|crown|gemstone|necklace|amulet|pendant|bracelet|talisman|diadem|circlet|band)/i.test(slug)) tags.push('Jewelry');
    if (/ring_/i.test(slug) || /_ring$/i.test(slug)) tags.push('Ring');
    if (/earring/i.test(slug)) tags.push('Earring');
    if (/bracelet/i.test(slug)) tags.push('Bracelet');
    if (/(stone|granite|marble|ore|rock|jade|quartz|sapphire|ruby|citrine|opal|gem|gemstone)/i.test(slug)) tags.push('Stone');
    return tags;
  }
  function countByTag(self, tag){
    let n = 0;
    const arr = self.items || [];
    for (const s of arr) {
      const slug = (typeof s === 'string') ? s : (s && (s.slug || s.key || ''));
      const tags = getTagsFor(slug);
      if (tags && tags.indexOf(tag) !== -1) n++;
    }
    return n;
  }
  const isBombSlug = (slug) => /items\/(kindling_bomb|time_bomb|sugar_bomb|melon_bomb)\b/.test(slug);
  function valByTier(base, gold, diamond, tier){
    switch((tier||'base').toLowerCase()){
      case 'gold': return gold;
      case 'diamond': return diamond;
      default: return base;
    }
  }

  // Example hook implementations. Adjust numerical values to match
  // Blood Sausage: Heal 5 total at Battle Start, 1 HP at a time (rapid-tick)
  hooks['items/blood_sausage'] = {
    battleStart({ self, log }) {
      let ticks = 5;
      for (let i = 0; i < ticks; i++) {
        const healed = self.heal(1);
        if (healed > 0) log(`${self.name} restores 1 health (Blood Sausage tick ${i+1}/5).`);
      }
    }
  };

  // Global hooks for cross-entity logic
  hooks._global = hooks._global || {};
  // Cleansing Edge support (global intercept): ignore the first status you would gain if the edge is equipped
  if (!hooks._global.onGainStatus) hooks._global.onGainStatus = function(ctx){};
  (function(){
    const prev = hooks._global.onGainStatus;
    hooks._global.onGainStatus = function({ self, log, key, amount }){
      try { if (typeof prev === 'function') prev({ self, log, key, amount }); } catch(_){ }
      try {
        if (!self || !Array.isArray(self.items)) return;
        if (!self.items.includes('upgrades/cleansing_edge')) return;
        if (self._cleanseUsed) return;
        if ((amount|0) > 0) {
          self.statuses[key] = Math.max(0, (self.statuses[key]||0) - (amount|0));
          self._cleanseUsed = true;
          if (log) log(`${self.name} ignores ${amount} ${key} (Cleansing Edge).`);
        }
      } catch(_){}
    };
  })();
  // Blood Chain (item): first time the enemy becomes Wounded, trigger all of your Wounded items
  hooks._global.onWounded = ({ self, other, log, withActor, withSource }) => {
    // 'self' is the newly wounded entity; 'other' might have Blood Chain
    if (!other || !Array.isArray(other.items)) return;
    if (!other.items.includes('items/blood_chain')) return;
    if (other._bloodChainUsed) return;
    other._bloodChainUsed = true;
    const run = () => {
      for (const slug of other.items) {
        const h = hooks[slug];
        if (h && typeof h.onWounded === 'function') {
          try { h.onWounded({ self: other, other: self, log }); } catch (_) {}
        }
      }
    };
    if (typeof withActor === 'function') withActor(other, () => withSource('items/blood_chain', run)); else run();
    withSource('items/blood_chain', () => log(`${other.name}'s Blood Chain triggers all Wounded effects.`));
  };

  // Earrings of Respite: heal 2 HP every other turn (even-numbered turns)
  hooks['items/earrings_of_respite'] = {
    turnEnd({ self, log }) {
      if (self.turnCount % 2 === 0) {
        const healed = self.heal(2);
        if (healed > 0) log(`${self.name} restores ${healed} health (Earrings of Respite, even turn).`);
      }
    }
  };

  // Emerald Earring: Every other turn (even turns) restore 1/2/4 health by tier
  hooks['items/emerald_earring'] = {
    turnStart({ self, log, tier }) {
      if ((self.turnCount|0) % 2 === 0) {
        const healed = self.heal(valByTier(1,2,4,tier));
        if (healed > 0) log(`${self.name} restores ${healed} health (Emerald Earring).`);
      }
    }
  };

  // Poisonous Mushroom: Turn Start — gain 1 Poison
  hooks['items/poisonous_mushroom'] = {
    turnStart({ self, log }) {
      self.addStatus('poison', 1);
      log(`${self.name} gains 1 poison (Poisonous Mushroom).`);
    }
  };

  // Friendship Bracelet: Battle Start: The enemy loses 1 attack
  hooks['items/friendship_bracelet'] = {
    battleStart({ other, log }){
      const before = other.atk|0;
      if (before > 0) {
        other.atk = Math.max(0, before - 1);
        log(`${other.name} loses 1 attack (Friendship Bracelet).`);
      }
    }
  };

  // Leather Belt: If you have 0 base armor, double your max health (baseline)
  hooks['items/leather_belt'] = {
    battleStart({ self, log, tier }){
      const base = self.baseArmor|0;
      if (base === 0) {
        const old = self.hpMax|0;
        const factor = valByTier(2, 4, 8, tier);
        const newMax = Math.max(old, old * factor);
        const extra = newMax - old;
        self.hpMax = newMax;
        // Do not auto-heal; keep current hp where it is
        if (extra>0) log(`${self.name}'s max health increases by ${extra} (Leather Belt ${tier||'base'}).`);
      }
    }
  };

  // Sour Lemon: Battle Start: Gain 1 acid (tier scaling omitted)
  hooks['items/sour_lemon'] = {
    battleStart({ self, log, tier }){
      const n = valByTier(1,2,4,tier);
      self.addStatus('acid', n);
      log(`${self.name} gains ${n} acid (Sour Lemon ${tier||'base'}).`);
    }
  };

  // Soap Stone: First turn: Spend 2 speed to temporarily gain 4 attack
  hooks['items/soap_stone'] = {
    turnStart({ self, log }){
      if (self.flags.firstTurn) {
        const spent = Math.min(2, self.speed);
        self.speed -= spent;
        if (spent > 0) log(`${self.name} spends ${spent} speed (Soap Stone).`);
        self.addTempAtk(4);
      }
    }
  };

  // Muscle Potion: Every 3 strikes: Gain 1 attack
  hooks['items/muscle_potion'] = {
    afterStrike({ self, log, tier }){
      self._mpStrikes = (self._mpStrikes||0)+1;
      if (self._mpStrikes % 3 === 0) {
        const inc = valByTier(1,2,4,tier);
        self.addAtk(inc);
        log(`${self.name} gains ${inc} attack (Muscle Potion ${tier||'base'}).`);
      }
    }
  };

  // Plated Shield: The first time you gain armor, double it
  hooks['items/plated_shield'] = {
    onGainArmor({ self, log, amount }){
      if (!self._platedUsed && amount > 0) {
        self.armor += amount;
        self._platedUsed = true;
        log(`${self.name} doubles armor gain (+${amount}) (Plated Shield).`);
      }
    }
  };

  // Weaver Armor: If base armor is 0, gain armor equal to current health at battle start
  hooks['items/weaver_armor'] = {
    battleStart({ self, log }){
      if ((self.baseArmor|0) === 0) {
        const gain = self.hp|0;
        if (gain > 0) {
          self.addArmor(gain);
          log(`${self.name} gains ${gain} armor (Weaver Armor).`);
        }
      }
    }
  };

  // Rusty Ring: Battle Start: Give enemy 1 acid
  hooks['items/rusty_ring'] = {
    battleStart({ other, log, tier }){
      const n = valByTier(1,2,4,tier);
      other.addStatus('acid', n);
      log(`${other.name} gains ${n} acid (Rusty Ring ${tier||'base'}).`);
    }
  };

  // Holy Tome: Countdown 6: +3 Attack
  hooks['items/holy_tome'] = {
    battleStart({ self, log, tier }){
      // Register a countdown that gives +3 attack when it fires
      if (typeof self.addCountdown === 'function') {
        const t = tier;
        self.addCountdown('Holy Tome', 6, 'Tome', (owner) => {
          owner.addAtk(valByTier(3,6,12,t));
        });
        log(`${self.name} prepares a holy rite (Holy Tome).`);
      }
    }
  };

  // Arcane Lens: If exactly 1 tome equipped, its countdown triggers 3 times total
  hooks['items/arcane_lens'] = {
    postCountdownTrigger({ self, other, log, countdown }){
      try {
        const items = self.items || [];
        const tomeCount = items.filter(s => (getTagsFor(s)||[]).includes('Tome')).length;
        if (tomeCount === 1 && countdown && typeof countdown.action === 'function') {
          // Already fired once; fire two more times
          countdown.action(self, other, log, countdown);
          countdown.action(self, other, log, countdown);
          log(`${self.name}'s Arcane Lens amplifies the tome.`);
        }
      } catch(_){ }
    }
  };

  // Ring Blades (weapon): Battle Start: Steal 1 attack from the enemy
  hooks['weapons/ring_blades'] = {
    battleStart({ self, other, log }){
      const steal = Math.min(1, other.atk|0);
      if (steal > 0) {
        other.atk -= steal;
        self.addAtk(steal);
        log(`${self.name} steals ${steal} attack (Ring Blades).`);
      }
    }
  };
  // the official game where known. Only a handful of items are
  // implemented; unlisted slugs will have no special behaviour.

  // Bee Stinger (food weapon): first turn on hit, give enemy poison, acid and stun
  hooks['items/bee_stinger'] = {
    onHit({ self, other, log }){
      if(self.flags.firstTurn){
        other.addStatus('poison', 4);
        other.addStatus('acid', 3);
        other.addStatus('stun', 2);
        log(`${other.name} gains 4 poison, 3 acid and 2 stun (Bee Stinger).`);
      }
    }
  };

  // Viper Extract: first time the enemy gains poison, give +3 poison
  hooks['items/viper_extract'] = {
    battleStart({ self }){
      self._viperTriggered = false;
    },
    onGainStatus({ self, other, log, key, isNew }){
      if(key === 'poison' && isNew && !self._viperTriggered){
        other.addStatus('poison', 3);
        self._viperTriggered = true;
        log(`${other.name} gains +3 poison (Viper Extract).`);
      }
    }
  };

  // Boiled Ham: if battle start and the holder is exposed or wounded, reduce
  // all statuses by 1 and log each decrease
  hooks['items/boiled_ham'] = {
    battleStart({ self, log }){
      // Determine if exposed or wounded on start
      const exposed = self.status && self.status.exposed > 0;
      const wounded = self.status && self.status.wounded > 0;
      if(exposed || wounded){
        for(const k of Object.keys(self.s || {})){
          if(self.s[k] && self.s[k] > 0){
            self.s[k] -= 1;
            log(`${self.name} decreases ${k} by 1 (Boiled Ham).`);
          }
        }
      }
    }
  };

  // Swiftstrike Belt: turn start, self-damage and grant extra strikes
  hooks['items/swiftstrike_belt'] = {
    turnStart({ self, log }){
      // Deal 3 self-damage
      if(self.hp > 0){
        self.hp = Math.max(0, self.hp - 3);
        log(`${self.name} takes 3 damage (Swiftstrike Belt).`);
      }
      // Grant one extra strike this turn
      self.extraStrikes = (self.extraStrikes || 0) + 1;
    }
  };

  // Limestone Fruit: if not at max health at turn start, gain 2 acid
  hooks['items/limestone_fruit'] = {
    turnStart({ self, log }){
      const maxHP = self._startHP || self.hpMax || self.hp;
      if(self.hp < maxHP){
        self.s.acid = (self.s.acid || 0) + 2;
        log(`${self.name} gains 2 acid (Limestone Fruit).`);
      }
    }
  };

  // Horned Melon: battle start, exposed or wounded: decrease two random statuses and add thorns

  hooks['items/horned_melon'] = {
    battleStart({ self, log }){
      const keys = Object.keys(self.s || {}).filter(k => self.s[k] > 0);
      for(let i=0; i<2 && keys.length>0; i++){
        const idx = Math.floor(Math.random()*keys.length);
        const key = keys[idx];
        self.s[key] -= 1;
        log(`${self.name} decreases ${key} by 1 (Horned Melon).`);
        keys.splice(idx,1);
      }
      self.s.thorns = (self.s.thorns || 0) + 5;
      log(`${self.name} gains 5 thorns (Horned Melon).`);
    }
  };

  // Gold Ring: Battle Start: Gain +1 Gold
  hooks['items/gold_ring'] = {
    battleStart({ self, log }) {
      self.gold = (self.gold || 0) + 1;
      log(`${self.name} gains 1 gold (Gold Ring).`);
    }
  };

  // Slime Armor: Battle Start: Gain 1 acid
  hooks['items/slime_armor'] = {
    battleStart({ self, log }) {
      self.addStatus('acid', 1);
      log(`${self.name} gains 1 acid (Slime Armor).`);
    }
  };

  // Slime Booster: Battle Start: Convert 1 acid into 2 attack
  hooks['items/slime_booster'] = {
    battleStart({ self, log }) {
      if (self.s.acid > 0) {
        self.s.acid -= 1;
        self.addTempAtk(2);
        log(`${self.name} converts 1 acid into 2 attack (Slime Booster).`);
      }
    }
  };

  // Trail Mix: Battle Start: Deal 1 damage and gain 1 Thorns (repeat twice)
  hooks['items/trail_mix'] = {
    battleStart({ self, other, log }) {
      for (let i = 0; i < 2; i++) {
        other.hp = Math.max(0, other.hp - 1);
        self.addStatus('thorns', 1);
        log(`${self.name} deals 1 damage and gains 1 thorns (Trail Mix).`);
      }
    }
  };

    // Acidic Witherleaf: give enemy acid equal to your speed at battle start
    hooks['items/acidic_witherleaf'] = {
      battleStart({ self, other, log }){
        if(self.speed > 0){
          other.addStatus('acid', self.speed);
          log(`${other.name} gains ${self.speed} acid (Acidic Witherleaf).`);
        }
      }
    };

    // Bramble Belt: gain 1 thorns and give enemy 1 extra strike at battle start
    hooks['items/bramble_belt'] = {
      battleStart({ self, other, log }){
        self.addStatus('thorns', 1);
        other.extraStrikes = (other.extraStrikes || 0) + 1;
        log(`${self.name} gains 1 thorns and ${other.name} gains 1 extra strike (Bramble Belt).`);
      }
    };

    // Bramble Buckler: convert 1 armor to 2 thorns each turn start
    hooks['items/bramble_buckler'] = {
      turnStart({ self, log }){
        if(self.armor > 0){
          self.armor -= 1;
          self.addStatus('thorns', 2);
          log(`${self.name} converts 1 armor to 2 thorns (Bramble Buckler).`);
        }
      }
    };

    // Bramble Talisman: whenever thorns are gained, gain 1 armor
    hooks['items/bramble_talisman'] = {
      onGainStatus({ self, log, key }){
        if(key === 'thorns'){
          self.addArmor(1);
          log(`${self.name} gains 1 armor (Bramble Talisman).`);
        }
      }
    };

    // Acid Mutation: gain 1 acid at battle start and temp attack equal to acid
    hooks['items/acid_mutation'] = {
      battleStart({ self, log }){
        self.addStatus('acid', 1);
        log(`${self.name} gains 1 acid (Acid Mutation).`);
      },
      turnStart({ self }){
        if(self.s.acid > 0){
          self.addTempAtk(self.s.acid);
        }
      }
    };

    // Chainmail Cloak: if you have armor, restore 2 health each turn
    hooks['items/chainmail_cloak'] = {
      turnStart({ self, log }){
        if(self.armor > 0){
          const healed = self.heal(2);
          if(healed>0) log(`${self.name} restores ${healed} health (Chainmail Cloak).`);
        } else {
          // Helpful for debugging flow: indicates why Cloak didn't tick this turn
          log(`${self.name}'s Chainmail Cloak does not heal (no armor).`);
        }
      }
    };

    // Chainmail Armor: when wounded, regain base armor
    hooks['items/chainmail_armor'] = {
      battleStart({ self }){
        self._chainmailBaseArmor = self.armor;
      },
      onWounded({ self, log }){
        if(self._chainmailBaseArmor !== undefined){
          self.armor = self._chainmailBaseArmor;
          log(`${self.name} restores base armor (Chainmail Armor).`);
        }
      }
    };

    // Clearspring Duck: gain 1 armor and decrease a random status by 1 each turn
    hooks['items/clearspring_duck'] = {
      turnStart({ self, log }){
        self.addArmor(1);
        const keys = Object.keys(self.s).filter(k => self.s[k] > 0);
        if(keys.length>0){
          const key = keys[Math.floor(Math.random()*keys.length)];
          self.s[key] -= 1;
          log(`${self.name} decreases ${key} by 1 (Clearspring Duck).`);
        }
      }
    };

    // Clearspring Feather: give enemy a decreased status at battle start
    hooks['items/clearspring_feather'] = {
      battleStart({ self, other, log }){
        const keys = Object.keys(self.s).filter(k => self.s[k] > 0);
        if(keys.length>0){
          const key = keys[Math.floor(Math.random()*keys.length)];
          self.s[key] -= 1;
          other.addStatus(key, 1);
          log(`${self.name} transfers 1 ${key} to ${other.name} (Clearspring Feather).`);
        }
      }
    };

    // Clearspring Opal: spend 1 speed to reduce a random status
    hooks['items/clearspring_opal'] = {
      turnStart({ self, log }){
        const keys = Object.keys(self.s).filter(k => self.s[k] > 0);
        if(keys.length>0 && self.speed > 0){
          self.speed -= 1;
          const key = keys[Math.floor(Math.random()*keys.length)];
          self.s[key] -= 1;
          log(`${self.name} spends 1 speed to decrease ${key} by 1 (Clearspring Opal).`);
        }
      }
    };

    // Clearspring Watermelon: reduce a random status at start, when exposed or wounded
    hooks['items/clearspring_watermelon'] = {
      _reduce(self, log){
        const keys = Object.keys(self.s).filter(k => self.s[k] > 0);
        if(keys.length>0){
          const key = keys[Math.floor(Math.random()*keys.length)];
          self.s[key] -= 1;
          log(`${self.name} decreases ${key} by 1 (Clearspring Watermelon).`);
        }
      }
    };
    hooks['items/clearspring_watermelon'].battleStart = ({ self, log }) => {
      hooks['items/clearspring_watermelon']._reduce(self, log);
    };
    hooks['items/clearspring_watermelon'].onExposed = ({ self, log }) => {
      hooks['items/clearspring_watermelon']._reduce(self, log);
    };
    hooks['items/clearspring_watermelon'].onWounded = ({ self, log }) => {
      hooks['items/clearspring_watermelon']._reduce(self, log);
    };

    // Corroded Bone: convert half the enemy's health into your armor
    hooks['items/corroded_bone'] = {
      battleStart({ self, other, log }){
        const converted = Math.floor(other.hp / 2);
        if(converted>0){
          other.hp -= converted;
          self.addArmor(converted);
          log(`${self.name} converts ${converted} enemy health into armor (Corroded Bone).`);
        }
      }
    };

    // Cracked Bouldershield: when exposed, gain 7 armor
    hooks['items/cracked_bouldershield'] = {
      onExposed({ self, log }){
        self.addArmor(7);
        log(`${self.name} gains 7 armor (Cracked Bouldershield).`);
      }
    };

    // Cracked Whetstone: first turn, temporarily gain 2 attack
    hooks['items/cracked_whetstone'] = {
      turnStart({ self }){
        if(self.flags.firstTurn){
          self.addTempAtk(2);
        }
      }
    };

    // Bramble Vest: first time you lose thorns, heal equal to thorns lost
    hooks['items/bramble_vest'] = {
      turnEnd({ self, log }){
        if(!self._brambleVestUsed && self.struckThisTurn && self.s.thorns>0){
          const lost = self.s.thorns;
          self.heal(lost);
          self._brambleVestUsed = true;
          log(`${self.name} restores ${lost} health (Bramble Vest).`);
        }
      }
    };

    // Briar Greaves: on hit, if you have thorns gain 1 armor
    hooks['items/briar_greaves'] = {
      onHit({ self, log }){
        if(self.s.thorns>0){
          self.addArmor(1);
          log(`${self.name} gains 1 armor (Briar Greaves).`);
        }
      }
    };

    // Horned Helmet: battle start gain 1 thorns
    hooks['items/horned_helmet'] = {
      battleStart({ self, log }){
        self.addStatus('thorns', 1);
        log(`${self.name} gains 1 thorns (Horned Helmet).`);
      }
    };

    // Ice Spikes: if you have freeze, gain 5 thorns at turn start
    hooks['items/ice_spikes'] = {
      turnStart({ self, log }){
        if(self.s.freeze>0){
          self.addStatus('thorns', 5);
          log(`${self.name} gains 5 thorns (Ice Spikes).`);
        }
      }
    };

    // Explosive Fish: give enemy riptide and deal damage per stack
    hooks['items/explosive_fish'] = {
      battleStart({ self, other, log }){
        other.addStatus('riptide', 1);
        const dmg = other.s.riptide * 2;
        self.damageOther(dmg);
        log(`${other.name} takes ${dmg} damage (Explosive Fish).`);
      }
    };

    // Deathcap Bow: gain poison at start and extra strike while poisoned
    hooks['weapons/deathcap_bow'] = {
      battleStart({ self, log }){
        self.addStatus('poison', 3);
        log(`${self.name} gains 3 poison (Deathcap Bow).`);
      },
      turnStart({ self }){
        if(self.s.poison>0){
          self.extraStrikes = (self.extraStrikes || 0) + 1;
        }
      }
    };

    // Blackbriar Armor: whenever you take damage, gain 2 thorns
    hooks['items/blackbriar_armor'] = {
      onDamaged({ self, log, armorLost, hpLost }){
        if(armorLost>0 || hpLost>0){
          self.addStatus('thorns', 2);
          log(`${self.name} gains 2 thorns (Blackbriar Armor).`);
        }
      }
    };

    // Blackbriar Gauntlet: gain 2 thorns per armor lost to the enemy's first strike
    hooks['items/blackbriar_gauntlet'] = {
      battleStart({ self }){ self._bbgDone = false; },
      onDamaged({ self, log, armorLost }){
        if(!self._bbgDone){
          const th = armorLost * 2;
          if(th>0) {
            self.addStatus('thorns', th);
            log(`${self.name} gains ${th} thorns (Blackbriar Gauntlet).`);
          }
          self._bbgDone = true;
        }
      }
    };

    // Blackbriar Rose: whenever you heal, gain 2 thorns
    hooks['items/blackbriar_rose'] = {
      onHeal({ self, log, amount }){
        if(amount>0){
          self.addStatus('thorns', 2);
          log(`${self.name} gains 2 thorns (Blackbriar Rose).`);
        }
      }
    };

  // Blacksmith Bond: exposed can trigger one additional time
  hooks['items/blacksmith_bond'] = {
    battleStart({ self }){
      self._exposedLimit = (self._exposedLimit || 1) + 1;
    }
  };

  // Countdown-related items
  hooks['items/arcane_bell'] = {
    battleStart({ self, log }) {
      if (typeof self.decAllCountdowns === 'function') {
        self.decAllCountdowns(1);
        log(`${self.name} decreases all countdowns by 1 (Arcane Bell).`);
      }
    }
  };

  hooks['items/arcane_gauntlet'] = {
    battleStart({ self, log }) {
      if (typeof self.halveCountdowns === 'function') {
        self.halveCountdowns();
        log(`${self.name} halves all countdowns (Arcane Gauntlet).`);
      }
    }
  };

  hooks['items/arcane_cloak'] = {
    postCountdownTrigger({ self, countdown, log }) {
      // Re-add the countdown at its original length (post-trigger)
      if (countdown && typeof self.addCountdown === 'function') {
        const t = countdown.origTurns || countdown.turnsLeft || 1;
        self.addCountdown(countdown.name, t, countdown.tag, countdown.action);
        log(`${self.name} resets countdown '${countdown.name}' (Arcane Cloak).`);
      }
    }
  };

  // Arcane Lens does not grant armor itself (Arcane Shield handles +3 armor).
  // Lens duplicates countdown effects via postCountdownTrigger below.
  if (hooks['items/arcane_lens']) {
    delete hooks['items/arcane_lens'].onCountdownTrigger;
  }

  // Arcane Shield: gain 3 armor on any countdown trigger
  hooks['items/arcane_shield'] = {
    onCountdownTrigger({ self, log }) { self.addArmor(3); log(`${self.name} gains 3 armor (Arcane Shield).`); }
  };
  // Arcane Lens: when exactly one Tome is equipped, multiply the FIRST Tome trigger (x3) without duplicating resets
  hooks['items/arcane_lens'] = hooks['items/arcane_lens'] || {};
  if (!hooks['items/arcane_lens'].postCountdownTrigger) {
    hooks['items/arcane_lens'].postCountdownTrigger = ({ self, other, log, countdown }) => {
      try {
        const tomes = (self.items || []).filter(s => /tome/i.test(s));
        if (tomes.length === 1 && countdown && typeof countdown.action === 'function') {
          if (self._lensBurstConsumed) return; // only the first Tome trigger is amplified
          if (self._lensBurstActive) return; // guard recursion
          self._lensBurstActive = true;
          const saveAdd = self.addCountdown;
          // Suppress resets during multiplier replays
          self.addCountdown = function(){};
          try {
            countdown.action(self, other, log, countdown);
            countdown.action(self, other, log, countdown);
            log(`${self.name}'s Arcane Lens multiplies tome effect (x3).`);
            self._lensBurstConsumed = true;
          } finally {
            self.addCountdown = saveAdd;
            self._lensBurstActive = false;
          }
        }
      } catch(_){}
    };
  }

  // Granite Thorns: preserve thorns for the first 3 strikes received
  hooks['items/granite_thorns'] = {
    battleStart({ self, log }) {
      self._preserveThorns = 3;
      log(`${self.name} will preserve thorns for 3 strikes (Granite Thorns).`);
    }
  };

  // Granite Crown: increase Max HP by base Armor and heal up to that amount
  hooks['items/granite_crown'] = {
    battleStart({ self, log }) {
      const add = Math.max(0, self.baseArmor || 0);
      if (add > 0) {
        self.hpMax += add;
        const healed = self.heal(add);
        log(`${self.name} fortifies: Max HP +${add}, heals ${healed} (Granite Crown).`);
      }
    }
  };

  // Granite Cherry: if at full HP at Battle Start, do (+2 Armor, 2 damage) ×3
  hooks['items/granite_cherry'] = {
    battleStart({ self, other, log }) {
      if (self.hp === self.hpMax) {
        for (let i = 0; i < 3; i++) {
          self.addArmor(2);
          self.damageOther(2);
        }
        log(`${self.name} erupts: +6 armor, 6 damage total (Granite Cherry).`);
      }
    }
  };

  // -----------------
  // H items
  // -----------------

  // Hero's Crossguard: First Turn — your on-hit effects trigger twice
  hooks['items/hero_s_crossguard'] = {
    afterStrike({ self, other, log, withActor, withSource }) {
      if (!self.flags.firstTurn) return;
      if (self._xguardReplaying) return;
      self._xguardReplaying = true;
      try {
        // Replay weapon onHit
        if (self.weapon) {
          const wh = hooks[self.weapon];
          if (wh && typeof wh.onHit === 'function') withActor(self, () => withSource(self.weapon, () => wh.onHit({ self, other, log })));
        }
        // Replay items' onHit (excluding Crossguard itself)
        for (const s of (self.items || [])) {
          if (s === 'items/hero_s_crossguard') continue;
          const h = hooks[s];
          if (h && typeof h.onHit === 'function') withActor(self, () => withSource(s, () => h.onHit({ self, other, log })));
        }
        log(`${self.name}'s on-hit effects trigger twice (Hero's Crossguard).`);
      } finally {
        self._xguardReplaying = false;
      }
    }
  };

  // Ham Bat: Battle Start — gain 2 extra strikes
  // (Already added above; kept for H grouping reference)

  // Honeydew Melon: Battle Start — transfer all statuses to enemy
  // (Already added above; kept for H grouping reference)

  // Helmet of Envy: Battle Start — double enemy attack
  // (Already added above; kept for H grouping reference)

  // -----------------
  // I items
  // -----------------

  // Ice Tomb: Turn Start — if no armor, gain 3 armor and 1 freeze
  hooks['items/ice_tomb'] = {
    turnStart({ self, log }) {
      if ((self.armor|0) === 0) { self.addArmor(3); self.addStatus('freeze', 1); log(`${self.name} gains 3 armor and 1 freeze (Ice Tomb).`);} }
  };

  // Impressive Physique: Exposed — Stun the enemy for 1 turn
  hooks['items/impressive_physique'] = {
    onExposed({ self, other, log }) { if (other) { other.addStatus('stun', 1); log(`${other.name} is stunned (Impressive Physique).`);} }
  };

  // Iron Rose: On Heal — gain 1 armor (equip limit handled outside sim)
  hooks['items/iron_rose'] = {
    onHeal({ self, log, amount }) { if (amount>0) { self.addArmor(1); log(`${self.name} gains 1 armor (Iron Rose).`);} }
  };

  // Iron Rune: If you have exactly one item with Exposed, it triggers thrice
  hooks['items/iron_rune'] = {
    battleStart({ self }) { self._ironRuneLock = false; },
    onExposed({ self, other, log }) {
      if (self._ironRuneLock) return;
      const candidates = (self.items||[]).filter(s => s !== 'items/iron_rune').filter(s => {
        const h = hooks[s];
        return h && typeof h.onExposed === 'function';
      });
      if (candidates.length === 1) {
        const s = candidates[0];
        const h = hooks[s];
        // replay the effect two more times
        self._ironRuneLock = true;
        try {
          h.onExposed({ self, other, log });
          h.onExposed({ self, other, log });
          log(`${self.name}'s Iron Rune amplifies Exposed effect (×3).`);
        } finally { self._ironRuneLock = false; }
      }
    }
  };

  // Iron Shrapnel: Battle Start — deal 3 damage (6 if enemy has no armor)
  hooks['items/iron_shrapnel'] = {
    battleStart({ self, other, log }) {
      const base = (other.armor|0) === 0 ? 6 : 3;
      const res = self.damageOther(base);
      log(`${other.name} takes ${res.toArmor + res.toHp} damage (Iron Shrapnel).`);
    }
  };

  // Iron Transfusion: Turn Start — gain 2 armor and lose 1 health
  hooks['items/iron_transfusion'] = {
    turnStart({ self, log }) {
      self.addArmor(2);
      if (self.hp > 0) { self.hp = Math.max(0, self.hp - 1); log(`${self.name} loses 1 health (Iron Transfusion).`);} }
  };

  // Ironskin Potion: Battle Start — gain armor equal to lost health
  hooks['items/ironskin_potion'] = {
    battleStart({ self, log }) {
      const lost = Math.max(0, (self.hpMax|0) - (self.hp|0));
      if (lost > 0) { self.addArmor(lost); log(`${self.name} gains ${lost} armor (Ironskin Potion).`);} }
  };

  // Ironstone Bracelet: while armored, reduce incoming strikes by 1
  // (the +1 otherwise side is left for a strike-scoped hook to avoid affecting bomb/indirect damage)
  hooks['items/ironstone_bracelet'] = {
    battleStart({ self, log }) {
      self._incomingReduceWhileArmored = Math.max(1, (self._incomingReduceWhileArmored||0));
      self._incomingIncreaseWhileNoArmor = Math.max(1, (self._incomingIncreaseWhileNoArmor||0));
      log(`${self.name} alters incoming strikes (−1 while armored, +1 otherwise) (Ironstone Bracelet).`);
    }
  };

  // Granite Fungi: End of your turn, both sides gain 2 armor
  hooks['items/granite_fungi'] = {
    turnEnd({ self, other, log }) {
      self.addArmor(2);
      if (other) other.addArmor(2);
      log(`${self.name} and ${other?.name || 'enemy'} gain 2 armor (Granite Fungi).`);
    }
  };

  // Gold Ring: Battle Start gain +1 Gold
  hooks['items/gold_ring'] = {
    battleStart({ self, log }) {
      const g = self.addGold(1);
      if (g > 0) log(`${self.name} gains ${g} gold (Gold Ring).`);
    }
  };

  // Grand Crescendo: requires instrument/symphony subsystem
  hooks['items/grand_crescendo'] = {
    battleStart({ self, log }) { log(`[TODO] ${self.name}'s Grand Crescendo requires instrument/symphony system.`); }
  };

  // Helmet of Envy: Battle Start double enemy attack
  hooks['items/helmet_of_envy'] = {
    battleStart({ other, log }) {
      other.addAtk(other.atk); // double by adding current atk
      log(`${other.name}'s attack is doubled (Helmet of Envy).`);
    }
  };

  // Heart-shaped Acorn: if base armor is 0, heal to full at Battle Start
  hooks['items/heart_shaped_acorn'] = {
    battleStart({ self, log }) {
      const base = self.baseArmor || 0;
      if (base === 0) {
        const needed = Math.max(0, self.hpMax - self.hp);
        if (needed > 0) {
          const healed = self.heal(needed);
          log(`${self.name} restores ${healed} health (Heart-shaped Acorn).`);
        }
      }
    }
  };

  // Heart-shaped Potion: first time reduced to exactly 1 health, heal to full
  hooks['items/heart_shaped_potion'] = {
    battleStart({ self }) { self._heartPotionUsed = false; },
    onDamaged({ self, log }) {
      if (!self._heartPotionUsed && self.hp === 1) {
        self._heartPotionUsed = true;
        const need = Math.max(0, self.hpMax - self.hp);
        if (need > 0) { const healed = self.heal(need); log(`${self.name} restores ${healed} health (Heart-shaped Potion).`); }
      }
    },
    onRiptideTick({ self, log }) {
      if (!self._heartPotionUsed && self.hp === 1) {
        self._heartPotionUsed = true;
        const need = Math.max(0, self.hpMax - self.hp);
        if (need > 0) { const healed = self.heal(need); log(`${self.name} restores ${healed} health (Heart-shaped Potion).`); }
      }
    },
    onPoisonTick({ self, log }) {
      if (!self._heartPotionUsed && self.hp === 1) {
        self._heartPotionUsed = true;
        const need = Math.max(0, self.hpMax - self.hp);
        if (need > 0) { const healed = self.heal(need); log(`${self.name} restores ${healed} health (Heart-shaped Potion).`); }
      }
    }
  };

  // Ham Bat: Battle Start gain 2 extra strikes
  hooks['items/ham_bat'] = {
    battleStart({ self, log }) { self.addExtraStrikes(2); log(`${self.name} gains 2 extra strikes (Ham Bat).`); }
  };

  // Honeydew Melon: transfer all your status stacks to enemy at Battle Start
  hooks['items/honeydew_melon'] = {
    battleStart({ self, other, log }) {
      const ks = Object.keys(self.s || {});
      let moved = 0;
      for (const k of ks) {
        const n = self.s[k] || 0;
        if (n > 0) {
          other.addStatus(k, n);
          self.s[k] = 0;
          moved += n;
        }
      }
      log(`${self.name} transfers all statuses to ${other.name} (Honeydew Melon).`);
    }
  };

  // Horned Melon: if Exposed or Wounded at Battle Start, reduce 2 random statuses by 1 and gain that much thorns
  hooks['items/horned_melon'] = {
    battleStart({ self, log }) {
      const ex = self.status && ((self.status.exposed||0) > 0 || (self.status.wounded||0) > 0);
      if (!ex) return;
      const keys = Object.keys(self.s||{}).filter(k => k !== 'thorns' && (self.s[k]||0) > 0);
      let dec = 0;
      for (let i=0; i<2 && keys.length>0; i++) {
        const idx = Math.floor(Math.random()*keys.length);
        const k = keys.splice(idx,1)[0];
        if ((self.s[k]||0) > 0) { self.s[k] -= 1; dec += 1; }
      }
      if (dec > 0) { self.addStatus('thorns', dec); log(`${self.name} decreases statuses and gains ${dec} thorns (Horned Melon).`); }
    }
  };

  // Sour Cherry: Battle Start — deal 1 damage twice (two pings)
  hooks['items/sour_cherry'] = {
    battleStart({ self, other, log }) {
      // Two separate 1-damage hits routed via armor then HP
      const p1 = self.damageOther(1);
      const p2 = self.damageOther(1);
      const t = (p1?.toHp || 0) + (p2?.toHp || 0);
      log(`${other.name} takes 2 cherry pings (Sour Cherry).`);
    }
  };

  // Stillwater Pearl: Riptide can trigger twice per turn
  hooks['items/stillwater_pearl'] = {
    battleStart({ self, log }) { self._riptideMaxTriggers = 2; log(`${self.name} allows Riptide to trigger twice (Stillwater Pearl).`); }
  };

  // Ironstone Armor: enemy strikes deal 2 less while you have armor
  hooks['items/ironstone_armor'] = {
    battleStart({ self, log }) { self._incomingReduceWhileArmored = 2; log(`${self.name} reduces incoming strikes by 2 while armored (Ironstone Armor).`); }
  };

  // Tomes: Flameburst, Granite, Grand
  function addCountdownOnce(self, name, turns, tag, action, log){
    if (typeof self.addCountdown !== 'function') return;
    self.addCountdown(name, turns, tag, action);
    log && log(`${self.name} prepares ${name} (${turns}-turn countdown).`);
  }

  // Flameburst Tome: Countdown 4 → deal 4 damage and reset
  hooks['items/flameburst_tome'] = {
    battleStart({ self, other, log }){
      const action = (owner, enemy, lg, cd) => {
        owner.damageOther(4);
        // reset
        owner.addCountdown('Flameburst Tome', 4, { item:'flameburst_tome' }, action);
      };
      addCountdownOnce(self, 'Flameburst Tome', 4, { item:'flameburst_tome' }, action, log);
    }
  };

  // Granite Tome: Countdown 4 → +6 Armor (base)
  hooks['items/granite_tome'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        owner.addArmor(6);
        owner.addCountdown('Granite Tome', 4, { item:'granite_tome' }, action);
      };
      addCountdownOnce(self, 'Granite Tome', 4, { item:'granite_tome' }, action, log);
    }
  };

  // Grand Tome: Countdown 10 → re-trigger all other tomes
  hooks['items/grand_tome'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        // retrigger other tome countdown effects once
        const cds = owner.countdowns || [];
        for (const oc of cds) {
          if (oc === cd) continue;
          if (oc.tag && oc.tag.item && /tome/i.test(oc.tag.item)) {
            try { oc.action(owner, enemy, lg, oc); } catch(_){ }
          }
        }
        owner.addCountdown('Grand Tome', 10, { item:'grand_tome' }, action);
        lg(`${owner.name} retriggers all other tomes (Grand Tome).`);
      };
      addCountdownOnce(self, 'Grand Tome', 10, { item:'grand_tome' }, action, log);
    }
  };

  // Holy Tome: Countdown 6 → +3 Attack (base)
  hooks['items/holy_tome'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        owner.addAtk(3);
        owner.addCountdown('Holy Tome', 6, { item:'holy_tome' }, action);
      };
      addCountdownOnce(self, 'Holy Tome', 6, { item:'holy_tome' }, action, log);
    }
  };

  // Liferoot Tome: Countdown 4 → +3 Regeneration
  hooks['items/liferoot_tome'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        owner.addStatus('regen', 3);
        owner.addCountdown('Liferoot Tome', 4, { item:'liferoot_tome' }, action);
      };
      addCountdownOnce(self, 'Liferoot Tome', 4, { item:'liferoot_tome' }, action, log);
    }
  };

  // Sanguine Tome: Countdown 6 → Restore health to full
  hooks['items/sanguine_tome'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        const needed = Math.max(0, owner.hpMax - owner.hp);
        if (needed > 0) { const healed = owner.heal(needed); lg(`${owner.name} restores ${healed} health (Sanguine Tome).`); }
        owner.addCountdown('Sanguine Tome', 6, { item:'sanguine_tome' }, action);
      };
      addCountdownOnce(self, 'Sanguine Tome', 6, { item:'sanguine_tome' }, action, log);
    }
  };

  // Silverscale Tome: Countdown 3 → Give enemy 2 Riptide
  hooks['items/silverscale_tome'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        enemy.addStatus('riptide', 2);
        owner.addCountdown('Silverscale Tome', 3, { item:'silverscale_tome' }, action);
      };
      addCountdownOnce(self, 'Silverscale Tome', 3, { item:'silverscale_tome' }, action, log);
    }
  };

  // Stormcloud Tome: Countdown 4 → Stun enemy 1 turn
  hooks['items/stormcloud_tome'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        enemy.addStatus('stun', 1);
        owner.addCountdown('Stormcloud Tome', 4, { item:'stormcloud_tome' }, action);
      };
      addCountdownOnce(self, 'Stormcloud Tome', 4, { item:'stormcloud_tome' }, action, log);
    }
  };

  // Tome of the Hero: Countdown 8 → +4 Attack, +4 Armor, +4 Speed
  hooks['items/tome_of_the_hero'] = {
    battleStart({ self, log }){
      const action = (owner, enemy, lg, cd) => {
        owner.addAtk(4); owner.addArmor(4); owner.speed += 4;
        owner.addCountdown('Tome Of The Hero', 8, { item:'tome_of_the_hero' }, action);
      };
      addCountdownOnce(self, 'Tome Of The Hero', 8, { item:'tome_of_the_hero' }, action, log);
    }
  };

  // Caustic Tome: Battle Start → Give enemy Acid equal to your Speed
  hooks['items/caustic_tome'] = {
    battleStart({ self, other, log }) { other.addStatus('acid', Math.max(0, self.speed|0)); log(`${other.name} gains acid equal to ${self.speed} (Caustic Tome).`); }
  };

  // Rusty Ring: Battle Start: enemy gains 1 acid
  hooks['items/rusty_ring'] = {
    battleStart({ other, log }) { other.addStatus('acid', 1); log(`${other.name} gains 1 acid (Rusty Ring).`); }
  };

  // Assault Greaves: Whenever you take damage (armor or HP), deal 1 damage back
  hooks['items/assault_greaves'] = {
    onDamaged({ self, other, armorLost, hpLost, log }) {
      if ((armorLost|0) > 0 || (hpLost|0) > 0) {
        self.damageOther(1);
        log(`${other.name} takes 1 damage (Assault Greaves).`);
      }
    }
  };

  // Sanguine Imp: Turn Start: enemy -1 HP; self heal 1
  hooks['items/sanguine_imp'] = {
    turnStart({ self, other, log }) { other.hp = Math.max(0, other.hp - 1); const h=self.heal(1); log(`${other.name} takes 1 and ${self.name} heals ${h} (Sanguine Imp).`); }
  };

  // Ironstone Sandals: If you have armor at turn start, gain +2 temp attack
  hooks['items/ironstone_sandals'] = {
    turnStart({ self }) { if (self.armor > 0) self.addTempAtk(2); }
  };

  // Featherweight Helmet: Spend 2 armor; if spent, gain +3 speed and +1 attack
  hooks['items/featherweight_helmet'] = {
    battleStart({ self, log }) {
      if (self.armor >= 2) { self.armor -= 2; self.speed += 3; self.addAtk(1); log(`${self.name} spends 2 armor for +3 speed, +1 attack (Featherweight Helmet).`); }
    }
  };

  // Spiritual Balance: If speed equals attack, gain +3 attack
  hooks['items/spiritual_balance'] = {
    battleStart({ self, log }) { if (self.speed === self.atk) { self.addAtk(3); log(`${self.name} gains 3 attack (Spiritual Balance).`); } }
  };

  // Rock Candy: Gain 15 armor; if at full health, gain 30 instead
  hooks['items/rock_candy'] = {
    battleStart({ self, log }) { if (self.hp === self.hpMax) { self.addArmor(30); log(`${self.name} gains 30 armor (Rock Candy, full health).`);} else { self.addArmor(15); log(`${self.name} gains 15 armor (Rock Candy).`);} }
  };

  // Clearspring Duck: Turn Start gain 1 armor and reduce random status by 1
  hooks['items/clearspring_duck'] = {
    turnStart({ self, log }) { self.addArmor(1); const keys=Object.keys(self.s||{}).filter(k=>(self.s[k]||0)>0); if(keys.length){ const k=keys[Math.floor(Math.random()*keys.length)]; self.s[k]-=1; log(`${self.name} decreases ${k} by 1 (Clearspring Duck).`);} }
  };

  // Clearspring Feather: Battle Start transfer 1 random status stack to enemy
  hooks['items/clearspring_feather'] = {
    battleStart({ self, other, log }) { const keys=Object.keys(self.s||{}).filter(k=>(self.s[k]||0)>0); if(keys.length){ const k=keys[Math.floor(Math.random()*keys.length)]; self.s[k]-=1; other.addStatus(k,1); log(`${other.name} gains 1 ${k} (Clearspring Feather).`);} }
  };

  // Clearspring Opal: Turn Start if you have any status, spend 1 speed and decrease random status by 1
  hooks['items/clearspring_opal'] = {
    turnStart({ self, log }) { const keys=Object.keys(self.s||{}).filter(k=>(self.s[k]||0)>0); if(keys.length && self.speed>0){ self.speed-=1; const k=keys[Math.floor(Math.random()*keys.length)]; self.s[k]-=1; log(`${self.name} spends 1 speed and decreases ${k} by 1 (Clearspring Opal).`);} }
  };

  // Explosive Arrow: Turn Start if enemy armor is 0, deal 3 damage
  hooks['items/explosive_arrow'] = { turnStart({ other, log }) { if ((other.armor|0) === 0) { other.hp = Math.max(0, other.hp - 3); log(`${other.name} takes 3 damage (Explosive Arrow).`);} } };

  // Bramble Buckler: Convert 1 armor into +2 thorns each turn start
  hooks['items/bramble_buckler'] = { turnStart({ self, log }) { if (self.armor > 0){ self.armor -= 1; self.addStatus('thorns', 2); log(`${self.name} converts 1 armor into 2 thorns (Bramble Buckler).`);} } };

  // Energy Drain: Pre-battle if your speed < enemy speed, steal 5 speed
  hooks['items/energy_drain'] = { pre({ self, other, log }) { if (self.speed < other.speed){ const steal = Math.min(5, other.speed); other.speed -= steal; self.speed += steal; log(`${self.name} steals ${steal} speed (Energy Drain).`);} } };

  // Poisoned Potion: Battle Start give yourself 5 poison
  hooks['items/poisoned_potion'] = { battleStart({ self, log }) { self.addStatus('poison', 5); log(`${self.name} gains 5 poison (Poisoned Potion).`);} };

  // Iceblock Shield: Battle Start +8 armor and +2 freeze
  hooks['items/iceblock_shield'] = { battleStart({ self, log }) { self.addArmor(8); self.addStatus('freeze', 2); log(`${self.name} gains 8 armor and 2 freeze (Iceblock Shield).`);} };

  // Horned Helm: Battle Start +1 thorns (alias of horned_helmet)
  hooks['items/horned_helm'] = { battleStart({ self, log }) { self.addStatus('thorns', 1); log(`${self.name} gains 1 thorns (Horned Helm).`);} };

  // Boom Stick: On Hit deal +1 HP damage (direct)
  hooks['weapons/boom_stick'] = { onHit({ other, log }) { other.hp = Math.max(0, other.hp - 1); log(`${other.name} takes 1 direct damage (Boom Stick).`);} };

  // Marshlight Lantern: On Exposed lose 3 HP and gain 8 armor (one-time)
  hooks['items/marshlight_lantern'] = { onExposed({ self, log }) { if (!self._marshUsed) { self._marshUsed = true; if (self.hp>0){ self.hp = Math.max(0, self.hp - 3); } self.addArmor(8); log(`${self.name} loses 3 HP and gains 8 armor (Marshlight Lantern).`);} } };

  // Lightning Bottle: Battle Start stun yourself 1
  hooks['items/lightning_bottle'] = { battleStart({ self, log }) { self.addStatus('stun', 1); log(`${self.name} is stunned (Lightning Bottle).`);} };

  // Slime Booster: Battle Start convert 1 acid to +2 attack
  hooks['items/slime_booster'] = { battleStart({ self, log }) { if ((self.s.acid||0)>0){ self.s.acid -= 1; self.addAtk(2); log(`${self.name} converts 1 acid to +2 attack (Slime Booster).`);} } };

  // Riverflow Talisman: Whenever you gain a status, gain +1 additional stack of the same status
  hooks['items/riverflow_talisman'] = { onGainStatus({ self, key, isNew, log }) { if (self._riverflowLock) return; self._riverflowLock = true; self.addStatus(key, 1); self._riverflowLock = false; log(`${self.name} gains +1 ${key} (Riverflow Talisman).`);} };

  // Silverscale Armor: Whenever enemy Riptide ticks, gain +2 armor
  hooks['items/silverscale_armor'] = { onEnemyRiptideTick({ self, log }) { self.addArmor(2); log(`${self.name} gains 2 armor (Silverscale Armor).`);} };

  // Silverscale Greaves: Battle Start if your speed > enemy's, enemy gains 2 riptide
  hooks['items/silverscale_greaves'] = { battleStart({ self, other, log }) { if (self.speed > other.speed){ other.addStatus('riptide', 2); log(`${other.name} gains 2 riptide (Silverscale Greaves).`);} } };

  // ---------- Bomb Items ----------
  // Explosive Powder: increase damage of all bombs by 1
  hooks['items/explosive_powder'] = {
    battleStart({ self }) {
      self._bombFlatBonus = (self._bombFlatBonus || 0) + 1;
    }
  };

  // Kindling Bomb: Battle Start — deal 1 damage; the next bomb gets +3 damage
  hooks['items/kindling_bomb'] = {
    battleStart({ self, other, log }) {
      const hp = self.bombDamage(1);
      if (hp > 0) log(`${other.name} takes ${hp} bomb damage (Kindling Bomb).`);
      self._bombNextBonus = (self._bombNextBonus || 0) + 3;
    }
  };
  // Cherry Bomb: Battle Start - deal N damage twice (N by tier 1/2/4)
  hooks['items/cherry_bomb'] = {
    battleStart({ self, other, log, tier }){
      const n = (tier||'base').toLowerCase()==='gold' ? 2 : (tier||'base').toLowerCase()==='diamond' ? 4 : 1;
      let dealt = 0;
      dealt += self.bombDamage(n);
      dealt += self.bombDamage(n);
      if (dealt > 0) log(`${other.name} takes ${dealt} bomb damage (Cherry Bomb).`);
    }
  };

  // Sugar Bomb: Turn Start — deal 1 damage three times
  hooks['items/sugar_bomb'] = {
    turnStart({ self, other, log }) {
      let dealt = 0;
      for (let i = 0; i < 3; i++) dealt += self.bombDamage(1);
      if (dealt > 0) log(`${other.name} takes ${dealt} bomb damage (Sugar Bomb).`);
    }
  };

  // Time Bomb: Exposed — deal N damage; Turn Start — N += 2 (starting from 1)
  hooks['items/time_bomb'] = {
    battleStart({ self }) { self._timeBomb = 1; },
    turnStart({ self }) { self._timeBomb = (self._timeBomb || 1) + 2; },
    onExposed({ self, other, log }) {
      const n = Math.max(1, self._timeBomb || 1);
      const hp = self.bombDamage(n);
      if (hp > 0) log(`${other.name} takes ${hp} bomb damage (Time Bomb).`);
    }
  };

  // Melon Bomb: On Exposed or Wounded — decrease a random status by 1; when decreased, deal 1 damage
  hooks['items/melon_bomb'] = {
    _tick(self, other, log){
      const keys = Object.keys(self.s || {}).filter(k => (self.s[k] || 0) > 0);
      if (keys.length === 0) return;
      const key = keys[Math.floor(Math.random()*keys.length)];
      self.s[key] = Math.max(0, (self.s[key] || 0) - 1);
      const hp = self.bombDamage(1);
      if (hp > 0) log(`${other.name} takes ${hp} bomb damage (Melon Bomb).`);
    },
    onExposed({ self, other, log }){ hooks['items/melon_bomb']._tick(self, other, log); },
    onWounded({ self, other, log }){ hooks['items/melon_bomb']._tick(self, other, log); }
  };

  // Powder Keg: If only 1 bomb item equipped, your bombs trigger 3 times
  hooks['items/powder_keg'] = {
    battleStart({ self, log }) {
      const bombs = (self.items || []).filter(isBombSlug);
      self._bombRepeat = bombs.length === 1 ? 3 : 1;
      if (self._bombRepeat > 1) log(`${self.name}'s bombs will trigger ${self._bombRepeat}x (Powder Keg).`);
    }
  };

  // ---------- Purity (Purelake) ----------
  hooks['items/purelake_chalice'] = {
    turnEnd({ self, log }) {
      if ((self.turnCount || 0) % 2 === 0) {
        self.addStatus('purity', 1);
        log(`${self.name} gains 1 purity (Purelake Chalice).`);
      }
    }
  };

  hooks['items/purelake_potion'] = {
    battleStart({ self, log }) {
      const lost = self.armor;
      self.armor = 0;
      if (lost > 0) log(`${self.name} loses ${lost} armor (Purelake Potion).`);
      self.addStatus('purity', 3);
      log(`${self.name} gains 3 purity (Purelake Potion).`);
    }
  };

  hooks['items/purelake_armor'] = {
    onExposed({ self, log }) {
      if ((self.s.purity || 0) > 0) {
        self.s.purity -= 1;
        // Purity removal benefit: +1 ATK and heal 3 per stack removed (here 1)
        self.addAtk(1);
        const healed = self.heal(3);
        self.addArmor(5);
        log(`${self.name} spends 1 purity (+1 ATK, +${healed} heal) to gain 5 armor (Purelake Armor).`);
      }
    }
  };

  hooks['items/purelake_helmet'] = {
    battleStart({ self, log }) { self.addStatus('purity', 1); log(`${self.name} gains 1 purity (Purelake Helmet).`); }
  };

  hooks['items/purelake_tome'] = {
    battleStart({ self, log }) {
      if (typeof self.addCountdown === 'function') {
        const action = (owner, enemy, lg) => {
          if ((owner.s.purity || 0) > 0) {
            owner.s.purity -= 1;
            owner.addAtk(1);
            const healed = owner.heal(3);
            lg(`${owner.name} loses 1 purity (+1 ATK, +${healed} heal) (Purelake Tome).`);
          } else {
            owner.addStatus('purity', 1);
          }
          // reset
          owner.addCountdown('Purelake Tome', 3, { item:'purelake_tome' }, action);
        };
        self.addCountdown('Purelake Tome', 3, { item:'purelake_tome' }, action);
        log(`${self.name} prepares a 3-turn purity countdown (Purelake Tome).`);
      }
    }
  };

  hooks['weapons/purelake_staff'] = {
    battleStart({ self, log }) { self.addStatus('purity', 2); log(`${self.name} gains 2 purity (Purelake Staff).`); },
    onHit({ self, log }) {
      if ((self.s.purity || 0) > 0) {
        self.s.purity -= 1;
        self.addAtk(1);
        const healed = self.heal(3);
        log(`${self.name} loses 1 purity (+1 ATK, +${healed} heal) (Purelake Staff).`);
      }
    }
  };

  // Explosive Sword: Gain +1 additional strike whenever a bomb deals >=5 HP (non-weapon) damage
  hooks['weapons/explosive_sword'] = {
    onBombDamage({ self, amount, log }) {
      if (amount >= 5) { self.addExtraStrikes(1); log(`${self.name} gains 1 additional strike (Explosive Sword).`); }
    }
  };

    // Blastcap Armor: on exposed take 5 damage
    hooks['items/blastcap_armor'] = {
      onExposed({ self, log }){
        if(self.hp>0){
          self.hp = Math.max(0, self.hp - 5);
          log(`${self.name} takes 5 damage (Blastcap Armor).`);
        }
      }
    };

  // Bloodstone Ring: gain max health and heal at battle start
  hooks['items/bloodstone_ring'] = {
    battleStart({ self, log }){
      self.hpMax += 5;
      log(`${self.name} gains 5 max health (Bloodstone Ring).`);
      const healed = self.heal(5);
      if(healed>0) log(`${self.name} restores ${healed} health (Bloodstone Ring).`);
    }
  };

  // Gold Ring: Battle Start — gain +1 gold (respects gold cap and greed)
  hooks['items/gold_ring'] = {
    battleStart({ self, log }) {
      const g = self.addGold(1);
      if (g > 0) log(`${self.name} gains 1 gold (Gold Ring).`);
    }
  };

  // Royal Scepter: see expanded behavior below (ATK equals GOLD, engine-enforced)
  hooks['weapons/royal_scepter'] = hooks['weapons/royal_scepter'] || {};

  // Honeycomb: lose 3 hp at battle start and gain 3 regen
  hooks['items/honeycomb'] = {
    battleStart({ self, log }){
      if(self.hp > 0){
        self.hp = Math.max(0, self.hp - 3);
        log(`${self.name} consumes Honeycomb and loses 3 HP.`);
      }
      self.addStatus('regen', 3);
      log(`${self.name} gains 3 regen (Honeycomb).`);
    }
  };

  // Lightning Rod: on hit, apply 1 stun to the enemy
  hooks['weapons/lightning_rod'] = {
    onHit({ other, log }){
      other.addStatus('stun', 1);
      log(`${other.name} is stunned (Lightning Rod).`);
    }
  };

  // Stormcloud Spear: Every 5 strikes — stun enemy for 2 turns
  hooks['weapons/stormcloud_spear'] = {
    battleStart({ self }) { self._spearStrikes = 0; },
    afterStrike({ self, other, log }) {
      self._spearStrikes = (self._spearStrikes || 0) + 1;
      if (self._spearStrikes % 5 === 0) { other.addStatus('stun', 2); log(`${other.name} is stunned for 2 turns (Stormcloud Spear).`); }
    }
  };
    // Trail Mix: Battle Start: Deal 1 damage and gain 1 Thorns (repeat twice)
    hooks['items/trail_mix'] = {
      battleStart({ self, other, log }) {
        for (let i = 0; i < 2; i++) {
          other.hp = Math.max(0, other.hp - 1);
          self.addStatus('thorns', 1);
          log(`${self.name} deals 1 damage and gains 1 thorns (Trail Mix).`);
        }
      }
    };

  // Battle Axe: While the enemy has armor, double your attack
  hooks['weapons/battle_axe'] = {
    turnStart({ self, other }) {
      if (other.armor > 0) {
        self.tempAtk = (self.tempAtk || 0) + self.atk;
      }
    }
  };

  // Bearclaw Blade: Attack is always equal to missing health
  hooks['weapons/bearclaw_blade'] = {
    turnStart({ self }) {
      self.atk = Math.max(0, self.hpMax - self.hp);
    }
  };

  // Bejeweled Blade: Gain 2 attack for each equipped Jewelry item
  hooks['weapons/bejeweled_blade'] = {
    battleStart({ self, log }) {
      const cnt = countByTag(self, 'Jewelry');
      if (cnt > 0) { self.addAtk(2 * cnt); log(`${self.name} gains ${2 * cnt} attack (Bejeweled Blade).`); }
    }
  };

  // Ore Heart: +3 Armor per Stone-tagged item
  hooks['items/ore_heart'] = {
    battleStart({ self, log }) {
      const cnt = countByTag(self, 'Stone');
      if (cnt > 0) { self.addArmor(3 * cnt); log(`${self.name} gains ${3 * cnt} armor (Ore Heart).`); }
    }
  };

  // Blackbriar Blade: Whenever you would gain thorns, gain 1 attack instead
  hooks['weapons/blackbriar_blade'] = {
    onGainStatus({ self, key, log }) {
      if (key === 'thorns') {
        self.addAtk(1);
        log(`${self.name} gains 1 attack instead of thorns (Blackbriar Blade).`);
      }
    }
  };

  // Ancient Warhammer, Arcane Wand, Banish Hammer, Basilisk Fang, Blackbriar Bow and more — added below

  // Bloodlord's Axe: Battle Start, enemy loses 5 health and you restore 5 health
  hooks['weapons/bloodlord_s_axe'] = {
    battleStart({ self, other, log }) {
      other.hp = Math.max(0, other.hp - 5);
      const healed = self.heal(5);
      log(`${other.name} loses 5 health and ${self.name} restores ${healed} health (Bloodlord's Axe).`);
    }
  };

  // Bloodmoon Dagger: Wounded, gain 5 attack and take 2 damage
  hooks['weapons/bloodmoon_dagger'] = {
    onWounded({ self, log }) {
      self.addAtk(5);
      self.hp = Math.max(0, self.hp - 2);
      log(`${self.name} gains 5 attack and takes 2 damage (Bloodmoon Dagger).`);
    }
  };

  // Bloodmoon Sickle: On Hit, take 1 damage
  hooks['weapons/bloodmoon_sickle'] = {
    onHit({ self, log }) {
      self.hp = Math.max(0, self.hp - 1);
      log(`${self.name} takes 1 damage (Bloodmoon Sickle).`);
    }
  };

  // Boom Stick: On Hit, deal 1 damage
  hooks['weapons/boom_stick'] = {
    onHit({ other, log }) {
      other.hp = Math.max(0, other.hp - 1);
      log(`${other.name} takes 1 damage (Boom Stick).`);
    }
  };

  // Brittlebark Bow: After 3 strikes, lose 2 attack
  hooks['weapons/brittlebark_bow'] = {
    turnEnd({ self, log }) {
      self._strikeCount = (self._strikeCount || 0) + 1;
      if (self._strikeCount === 3) {
        self.atk = Math.max(0, self.atk - 2);
        log(`${self.name} loses 2 attack after 3 strikes (Brittlebark Bow).`);
        self._strikeCount = 0;
      }
    }
  };

  // Brittlebark Club: Exposed & Wounded, lose 2 attack
  hooks['weapons/brittlebark_club'] = {
    onExposed({ self, log }) {
      self.atk = Math.max(0, self.atk - 2);
      log(`${self.name} loses 2 attack (Brittlebark Club, Exposed).`);
    },
    onWounded({ self, log }) {
      self.atk = Math.max(0, self.atk - 2);
      log(`${self.name} loses 2 attack (Brittlebark Club, Wounded).`);
    }
  };

  // Bubblegloop Staff: Can't strike. Turn Start: Spend 1 speed to give enemy 2 acid and 2 poison
  hooks['weapons/bubblegloop_staff'] = {
    turnStart({ self, other, log }) {
      if (self.speed > 0) {
        self.speed -= 1;
        other.addStatus('acid', 2);
        other.addStatus('poison', 2);
        log(`${other.name} gains 2 acid and 2 poison (Bubblegloop Staff).`);
      }
    }
  };

  // Chainmail Sword: Exposed, gain armor equal to base armor
  hooks['weapons/chainmail_sword'] = {
    onExposed({ self, log }) {
      if (self._chainmailBaseArmor !== undefined) {
        self.armor += self._chainmailBaseArmor;
        log(`${self.name} gains ${self._chainmailBaseArmor} armor (Chainmail Sword).`);
      }
    }
  };

  // Cherry Blade: Battle Start (if Exposed), deal 4 damage
  hooks['weapons/cherry_blade'] = {
    battleStart({ self, other, log }) {
      if (self.status && self.status.exposed > 0) {
        other.hp = Math.max(0, other.hp - 4);
        log(`${other.name} takes 4 damage (Cherry Blade).`);
      }
    }
  };

  // Cleaver of Wrath: Max health is always 1
  hooks['weapons/cleaver_of_wrath'] = {
    battleStart({ self }) {
      self.hpMax = 1;
      self.hp = Math.min(self.hp, 1);
    }
  };

  // Dashmaster's Dagger: Battle Start, gain additional strikes equal to speed
  hooks['weapons/dashmaster_s_dagger'] = {
    battleStart({ self, log }) {
      self.extraStrikes = (self.extraStrikes || 0) + self.speed;
      log(`${self.name} gains ${self.speed} additional strikes (Dashmaster's Dagger).`);
    }
  };

  // Fungal Rapier: Battle Start, gain 1 poison
  hooks['weapons/fungal_rapier'] = {
    battleStart({ self, log }) {
      self.addStatus('poison', 1);
      log(`${self.name} gains 1 poison (Fungal Rapier).`);
    }
  };

  // Forge Hammer: On Hit, give the enemy 2 armor
  hooks['weapons/forge_hammer'] = {
    onHit({ other, log }) {
      other.addArmor(2);
      log(`${other.name} gains 2 armor (Forge Hammer).`);
    }
  };

  // Frostbite Dagger: First turn, give the enemy freeze equal to your attack on hit
  hooks['weapons/frostbite_dagger'] = {
    onHit({ self, other, log }) {
      if (self.flags.firstTurn) {
        other.addStatus('freeze', self.atk);
        log(`${other.name} gains ${self.atk} freeze (Frostbite Dagger).`);
      }
    }
  };

  // Frozen Iceblade: Battle Start, gain 3 freeze
  hooks['weapons/frozen_iceblade'] = {
    battleStart({ self, log }) {
      self.addStatus('freeze', 3);
      log(`${self.name} gains 3 freeze (Frozen Iceblade).`);
    }
  };

  // Gale Staff: On Hit, lose 1 speed
  hooks['weapons/gale_staff'] = {
    onHit({ self, log }) {
      if (self.speed > 0) {
        self.speed -= 1;
        log(`${self.name} loses 1 speed (Gale Staff).`);
      }
    }
  };

  // Granite Axe: On Hit, lose 2 health and gain 4 armor
  hooks['weapons/granite_axe'] = {
    onHit({ self, log }) {
      self.hp = Math.max(0, self.hp - 2);
      self.addArmor(4);
      log(`${self.name} loses 2 health and gains 4 armor (Granite Axe).`);
    }
  };

  // Granite Hammer: On Hit, convert 1 armor to 2 attack
  hooks['weapons/granite_hammer'] = {
    onHit({ self, log }) {
      if (self.armor > 0) {
        self.armor -= 1;
        self.addAtk(2);
        log(`${self.name} converts 1 armor to 2 attack (Granite Hammer).`);
      }
    }
  };

  // Granite Lance: Your base armor is doubled
  hooks['weapons/granite_lance'] = {
    battleStart({ self, log }) {
      self.armor *= 2;
      // Ensure downstream items that reference baseArmor (e.g., Granite Crown) see the doubled value
      if (typeof self.baseArmor === 'number') self.baseArmor = self.armor;
      log(`${self.name}'s base armor is doubled (Granite Lance).`);
    }
  };

  // Grilling Skewer: Battle Start, gain 1 additional strike
  hooks['weapons/grilling_skewer'] = {
    battleStart({ self, log }) {
      self.extraStrikes = (self.extraStrikes || 0) + 1;
      log(`${self.name} gains 1 additional strike (Grilling Skewer).`);
    }
  };

  // Heart Drinker: On Hit, restore 1 health
  hooks['weapons/heart_drinker'] = {
    onHit({ self, log }) {
      const healed = self.heal(1);
      log(`${self.name} restores ${healed} health (Heart Drinker).`);
    }
  };

  // Icicle Spear: Exposed, give the enemy 2 freeze for each equipped water item
  hooks['weapons/icicle_spear'] = {
    onExposed({ self, other, log }) {
      let waterCount = (self.items || []).filter(s => /water/i.test(s)).length;
      if (waterCount > 0) {
        other.addStatus('freeze', 2 * waterCount);
        log(`${other.name} gains ${2 * waterCount} freeze (Icicle Spear).`);
      }
    }
  };

  // Ironstone Bow: On Hit, lose 1 speed. If speed is 0 or less, only strike every other turn
  hooks['weapons/ironstone_bow'] = {
    onHit({ self, log }) {
      self.speed = (self.speed || 0) - 1;
      log(`${self.name} loses 1 speed (Ironstone Bow).`);
    }
  };

  // Ironstone Spear: While you have armor, temporarily gain 2 attack
  hooks['weapons/ironstone_spear'] = {
    turnStart({ self }) {
      if (self.armor > 0) {
        self.addTempAtk(2);
      }
    }
  };

  // Leather Whip: Battle Start, gain 5 max health
  hooks['weapons/leather_whip'] = {
    battleStart({ self, log }) {
      self.hpMax += 5;
      log(`${self.name} gains 5 max health (Leather Whip).`);
    }
  };

  // Lifeblood Spear: Whenever you restore 3 or more health, gain 1 attack
  hooks['weapons/lifeblood_spear'] = {
    onHeal({ self, log, amount }) {
      if (amount >= 3) {
        self.addAtk(1);
        log(`${self.name} gains 1 attack (Lifeblood Spear).`);
      }
    }
  };

  // Liferoot Hammer: On Hit, if health is full, spend regeneration to gain 3x that amount of armor
  hooks['weapons/liferoot_hammer'] = {
    onHit({ self, log }) {
      if (self.hp === self.hpMax && self.s.regen > 0) {
        let regen = self.s.regen;
        self.s.regen = 0;
        self.addArmor(3 * regen);
        log(`${self.name} spends ${regen} regeneration to gain ${3 * regen} armor (Liferoot Hammer).`);
      }
    }
  };

  // Liferoot Staff: Wounded, gain 3 regeneration
  hooks['weapons/liferoot_staff'] = {
    onWounded({ self, log }) {
      self.addStatus('regen', 3);
      log(`${self.name} gains 3 regeneration (Liferoot Staff).`);
    }
  };

  // Lifesteal Scythe: On Hit, if enemy has no armor, restore health equal to your attack
  hooks['weapons/lifesteal_scythe'] = {
    onHit({ self, other, log }) {
      if (other.armor <= 0) {
        const healed = self.heal(self.atk);
        log(`${self.name} restores ${healed} health (Lifesteal Scythe).`);
      }
    }
  };

  // Lightning Rod: Turn Start, if you're stunned, gain 3 attack
  hooks['weapons/lightning_rod'] = {
    turnStart({ self, log }) {
      if (self.s.stun > 0) {
        self.addAtk(3);
        log(`${self.name} gains 3 attack (Lightning Rod).`);
      }
    }
  };

  // Lightning Whip: Turn Start, if enemy is stunned, gain 1 additional strike
  hooks['weapons/lightning_whip'] = {
    turnStart({ self, other }) {
      if (other.s.stun > 0) {
        self.addExtraStrikes(1);
      }
    }
  };

  // Marble Sword: Exposed, gain 3 attack
  hooks['weapons/marble_sword'] = {
    onExposed({ self, log }) {
      self.addAtk(3);
      log(`${self.name} gains 3 attack (Marble Sword).`);
    }
  };

  // Melting Iceblade: On Hit, lose 1 attack
  hooks['weapons/melting_iceblade'] = {
    onHit({ self, log }) {
      self.atk = Math.max(0, self.atk - 1);
      log(`${self.name} loses 1 attack (Melting Iceblade).`);
    }
  };

  // Mountain Cleaver: Attack always equals base armor
  hooks['weapons/mountain_cleaver'] = {
    turnStart({ self }) {
      self.atk = self.armor;
    }
  };

  // Pacifist Staff: On Hit, gain 1 armor and restore 1 health
  hooks['weapons/pacifist_staff'] = {
    onHit({ self, log }) {
      self.addArmor(1);
      const healed = self.heal(1);
      log(`${self.name} gains 1 armor and restores ${healed} health (Pacifist Staff).`);
    }
  };

  // Razorthorn Spear: On Hit, gain 2 thorns
  hooks['weapons/razorthorn_spear'] = {
    onHit({ self, log }) {
      self.addStatus('thorns', 2);
      log(`${self.name} gains 2 thorns (Razorthorn Spear).`);
    }
  };

  // Ring Blades: Battle Start, steal 1 attack from the enemy
  hooks['weapons/ring_blades'] = {
    battleStart({ self, other, log }) {
      if (other.atk > 0) {
        other.atk -= 1;
        self.atk += 1;
        log(`${self.name} steals 1 attack from ${other.name} (Ring Blades).`);
      }
    }
  };

  // Rusty Sword: First Turn, give acid equal to your attack on hit
  hooks['weapons/rusty_sword'] = {
    onHit({ self, other, log }) {
      if (self.flags.firstTurn) {
        other.addStatus('acid', self.atk);
        log(`${other.name} gains ${self.atk} acid (Rusty Sword).`);
      }
    }
  };

  // Serpent Dagger: Every 3 strikes — enemy gains 4 poison
  hooks['weapons/serpent_dagger'] = {
    battleStart({ self }) { self._strikeCount = 0; },
    afterStrike({ self, other, log }) {
      self._strikeCount = (self._strikeCount || 0) + 1;
      if (self._strikeCount % 3 === 0) { other.addStatus('poison', 4); log(`${other.name} gains 4 poison (Serpent Dagger).`); }
    }
  };

  // Silverscale Dagger: Battle Start, give the enemy 1 riptide
  hooks['weapons/silverscale_dagger'] = {
    battleStart({ other, log }) {
      other.addStatus('riptide', 1);
      log(`${other.name} gains 1 riptide (Silverscale Dagger).`);
    }
  };

  // Silverscale Trident: On Hit, give the enemy 1 riptide
  hooks['weapons/silverscale_trident'] = {
    onHit({ other, log }) {
      other.addStatus('riptide', 1);
      log(`${other.name} gains 1 riptide (Silverscale Trident).`);
    }
  };

  // Slime Sword: Battle Start, give yourself and the enemy 3 acid
  hooks['weapons/slime_sword'] = {
    battleStart({ self, other, log }) {
      self.addStatus('acid', 3);
      other.addStatus('acid', 3);
      log(`${self.name} and ${other.name} gain 3 acid (Slime Sword).`);
    }
  };

  // Stoneslab Sword: On Hit, gain 2 armor
  hooks['weapons/stoneslab_sword'] = {
    onHit({ self, log }) {
      self.addArmor(2);
      log(`${self.name} gains 2 armor (Stoneslab Sword).`);
    }
  };

  // Swiftstrike Rapier: Battle Start, if you have more speed than the enemy, gain 3 additional strikes
  hooks['weapons/swiftstrike_rapier'] = {
    battleStart({ self, other, log }) {
      if (self.speed > other.speed) {
        self.extraStrikes = (self.extraStrikes || 0) + 3;
        log(`${self.name} gains 3 additional strikes (Swiftstrike Rapier).`);
      }
    }
  };

  // Sword of Pride: Battle Start, if the enemy has more attack, armor or speed, take 3 damage
  hooks['weapons/sword_of_pride'] = {
    battleStart({ self, other, log }) {
      if (other.atk > self.atk || other.armor > self.armor || other.speed > self.speed) {
        self.hp = Math.max(0, self.hp - 3);
        log(`${self.name} takes 3 damage (Sword of Pride).`);
      }
    }
  };

  // Tempest Blade: Attack always equals speed
  hooks['weapons/tempest_blade'] = {
    turnStart({ self }) {
      self.atk = self.speed;
    }
  };

  // Thunderbound Sabre: Battle Start, stun yourself for 2 turns
  hooks['weapons/thunderbound_sabre'] = {
    battleStart({ self, log }) {
      self.addStatus('stun', 2);
      log(`${self.name} is stunned for 2 turns (Thunderbound Sabre).`);
    }
  };

  // Wave Breaker: Can't strike. Battle Start, give the enemy 2 riptide for each negative base attack
  hooks['weapons/wave_breaker'] = {
    battleStart({ self, other, log }) {
      if (self.atk < 0) {
        other.addStatus('riptide', 2 * Math.abs(self.atk));
        log(`${other.name} gains ${2 * Math.abs(self.atk)} riptide (Wave Breaker).`);
      }
    }
  };

  // Woodcutter's Axe: Wounded, gain 6 attack until the end of the turn

  hooks['weapons/woodcutter_s_axe'] = {
    onWounded({ self, log }) {
      self.addTempAtk(6);
      log(`${self.name} gains 6 temporary attack (Woodcutter's Axe).`);
    }
  };

  // -----------------
  // Additional Weapons (overrides/expanded)
  // -----------------

  // Hidden Dagger: gets stronger for every new hidden dagger you find (requires meta/progression)
  hooks['weapons/hidden_dagger'] = {
    battleStart({ self, log }) { log(`[TODO] ${self.name}'s Hidden Dagger scaling requires progression context.`); }
  };

  // Ancient Warhammer: On Hit — remove all enemy armor
  hooks['weapons/ancient_warhammer'] = {
    onHit({ other, log }) {
      if (other.armor > 0) {
        const lost = other.armor;
        other.armor = 0;
        log(`${other.name} loses all ${lost} armor (Ancient Warhammer).`);
      }
    }
  };

  // Arcane Wand: Can't strike; Turn Start — deal 2 + tomes to enemy
  hooks['weapons/arcane_wand'] = {
    battleStart({ self }) { self.cannotStrike = true; },
    turnStart({ self, other, log }) {
      const tomeCount = (self.items || []).filter(s => /tome/i.test(s)).length;
      const dmg = 2 + tomeCount;
      if (dmg > 0) {
        other.hp = Math.max(0, other.hp - dmg);
        log(`${other.name} takes ${dmg} arcane damage (Arcane Wand).`);
      }
    }
  };

  // Banish Hammer: Battle Start — remove all tomes from enemy before they trigger
  hooks['weapons/banish_hammer'] = {
    battleStart({ other, log }) {
      if (!other.items) return;
      const before = other.items.length;
      other.items = other.items.filter(s => !/tome/i.test(s));
      const removed = before - other.items.length;
      if (removed > 0) log(`${other.name} loses ${removed} tome(s) (Banish Hammer).`);
    }
  };

  // Basilisk Fang: On Hit — move up to 2 poison from you to the enemy
  hooks['weapons/basilisk_fang'] = {
    onHit({ self, other, log }) {
      const move = Math.min(2, self.s.poison || 0);
      if (move > 0) {
        self.s.poison -= move;
        other.addStatus('poison', move);
        log(`${self.name} transfers ${move} poison (Basilisk Fang).`);
      }
    }
  };

  // Blackbriar Bow: Can't strike; Turn Start — gain thorns equal to attack
  hooks['weapons/blackbriar_bow'] = {
    battleStart({ self }) { self.cannotStrike = true; },
    turnStart({ self, log }) {
      self.addStatus('thorns', self.atk);
      log(`${self.name} gains ${self.atk} thorns (Blackbriar Bow).`);
    }
  };

  // Brittlebark Bow: every 3 strikes — lose 2 attack
  hooks['weapons/brittlebark_bow'] = {
    battleStart({ self }) { self._bbStrikes = 0; },
    afterStrike({ self, log }) {
      self._bbStrikes = (self._bbStrikes || 0) + 1;
      if (self._bbStrikes % 3 === 0) { self.atk = Math.max(0, self.atk - 2); log(`${self.name} loses 2 attack (Brittlebark Bow).`); }
    }
  };

  // Brittlebark Club: Require both Exposed & Wounded once — lose 2 attack
  hooks['weapons/brittlebark_club'] = {
    onExposed({ self, log }) { if (self.woundedDone && !self._bbcDone) { self._bbcDone = true; self.atk = Math.max(0, self.atk - 2); log(`${self.name} loses 2 attack (Brittlebark Club).`);} },
    onWounded({ self, log }) { if (self._exposedCount > 0 && !self._bbcDone) { self._bbcDone = true; self.atk = Math.max(0, self.atk - 2); log(`${self.name} loses 2 attack (Brittlebark Club).`);} }
  };

  // Bubblegloop Staff: Can't strike; Turn Start — spend 1 speed → give enemy 2 acid and 2 poison
  hooks['weapons/bubblegloop_staff'] = {
    battleStart({ self }) { self.cannotStrike = true; },
    turnStart({ self, other, log }) {
      if (self.speed > 0) {
        self.speed -= 1;
        other.addStatus('acid', 2);
        other.addStatus('poison', 2);
        log(`${self.name} spends 1 speed to inflict 2 acid and 2 poison (Bubblegloop Staff).`);
      }
    }
  };

  // Chainmail Sword: Exposed — gain armor equal to base armor
  hooks['weapons/chainmail_sword'] = {
    onExposed({ self, log }) { const add = self.baseArmor || 0; if (add > 0) { self.addArmor(add); log(`${self.name} gains ${add} armor (Chainmail Sword).`);} }
  };

  // Cherry Blade: Battle Start — -1 speed; After each strike — heal 1
  hooks['weapons/cherry_blade'] = {
    battleStart({ self, log }) { if (self.speed > 0) { self.speed -= 1; log(`${self.name} loses 1 speed (Cherry Blade).`);} },
    afterStrike({ self }) { self.heal(1); }
  };

  // Cleaver of Wrath: Max HP always 1
  hooks['weapons/cleaver_of_wrath'] = { battleStart({ self, log }) { self.hpMax = 1; self.hp = Math.min(self.hp, 1); log(`${self.name}'s max health becomes 1 (Cleaver of Wrath).`);} };

  // Dashmaster's Dagger: Battle Start — gain additional strikes equal to speed
  hooks['weapons/dashmaster_s_dagger'] = { battleStart({ self, log }) { if (self.speed > 0) { self.addExtraStrikes(self.speed); log(`${self.name} gains ${self.speed} additional strikes (Dashmaster's Dagger).`);} } };

  // Evergrowth Spear: Every other turn — gain 1 attack and heal 1
  hooks['weapons/evergrowth_spear'] = { turnEnd({ self, log }) { if ((self.turnCount || 0) % 2 === 0) { self.addAtk(1); const h = self.heal(1); log(`${self.name} grows: +1 attack, restores ${h} health (Evergrowth Spear).`);} } };

  // Ironstone Bow: speed <= 0 — only strike every other turn; On Hit — lose 1 speed
  hooks['weapons/ironstone_bow'] = {
    onHit({ self, log }) { self.speed = (self.speed || 0) - 1; log(`${self.name} loses 1 speed (Ironstone Bow).`); },
    turnStart({ self }) { if (self.speed <= 0) { self._ironAlt = !self._ironAlt; if (self._ironAlt) self.skipTurn = true; } }
  };

  // Riverflow Rapier: first time you gain a new status — gain 1 additional strike
  hooks['weapons/riverflow_rapier'] = { onGainStatus({ self, isNew }) { if (isNew && !self._riverRapierUsed) { self._riverRapierUsed = true; self.addExtraStrikes(1); } } };

  // Royal Crownblade: On Hit — gain 1 gold
  hooks['weapons/royal_crownblade'] = { onHit({ self, log }) { const g = self.addGold(1); if (g > 0) log(`${self.name} gains 1 gold (Royal Crownblade).`); } };

  // Royal Scepter: ATK equals GOLD (handled in engine); override any previous behavior
  hooks['weapons/royal_scepter'] = {};

  // Scepter of Greed: cannot gain gold (enforced by addGold)
  hooks['weapons/scepter_of_greed'] = {};

  // Swiftstrike Bow: double additional strikes at Turn Start
  hooks['weapons/swiftstrike_bow'] = {
    turnStart({ self }) { if (self.extraStrikes > 0 && !self._swiftDoubled) { self.extraStrikes += self.extraStrikes; self._swiftDoubled = true; } },
    turnEnd({ self }) { self._swiftDoubled = false; }
  };

  // Twin Blade: Strike twice
  hooks['weapons/twin_blade'] = { battleStart({ self }) { self.strikeFactor = 2; } };

  // Wave Breaker: Can't strike; Battle Start — give enemy 2 riptide per negative base attack
  hooks['weapons/wave_breaker'] = {
    battleStart({ self, other, log }) {
      self.cannotStrike = true;
      if (self.atk < 0) { const amt = 2 * Math.abs(self.atk); other.addStatus('riptide', amt); log(`${other.name} gains ${amt} riptide (Wave Breaker).`); }
    }
  };

  // ----- Edges (Upgrades applied to weapons) -----
  // Agile Edge: Battle Start — gain 1 additional strike
  hooks['upgrades/agile_edge'] = {
    battleStart({ self, log }) {
      self.extraStrikes = (self.extraStrikes || 0) + 1;
      log(`${self.name} gains 1 additional strike (Agile Edge).`);
    }
  };

  // Bleeding Edge: On Hit — restore 1 health
  hooks['upgrades/bleeding_edge'] = {
    onHit({ self, log }) {
      const healed = self.heal(1);
      if (healed > 0) log(`${self.name} restores ${healed} health (Bleeding Edge).`);
    }
  };

  // Blunt Edge: On Hit — gain 1 armor
  hooks['upgrades/blunt_edge'] = {
    onHit({ self, log }) {
      self.addArmor(1);
      log(`${self.name} gains 1 armor (Blunt Edge).`);
    }
  };

  // Cutting Edge: On Hit - deal 1 damage
  hooks['upgrades/cutting_edge'] = {
    onHit({ self, log }) { const res = self.damageOther(1); log(`${self.name} cuts for 1 (Cutting Edge).`); }
  };

  // Featherweight Edge: On Hit - convert 1 speed to 1 attack
  hooks['upgrades/featherweight_edge'] = {
    onHit({ self, log }) { if ((self.speed|0) > 0) { self.speed -= 1; self.addAtk(1); log(`${self.name} converts 1 speed to 1 attack (Featherweight Edge).`); } }
  };

  // Freezing Edge: Battle Start - give the enemy 3 freeze
  hooks['upgrades/freezing_edge'] = { battleStart({ other, log }) { other.addStatus('freeze', 3); log(`${other.name} gains 3 freeze (Freezing Edge).`); } };

  // Gilded Edge: On Hit - if gold < 10, gain 1 gold
  hooks['upgrades/gilded_edge'] = { onHit({ self, log }) { if ((self.gold||0) < 10) { const g = self.addGold(1); if (g>0) log(`${self.name} gains ${g} gold (Gilded Edge).`); } } };

  // Jagged Edge: On Hit - gain 2 thorns and take 1 damage
  hooks['upgrades/jagged_edge'] = { onHit({ self, log }) { self.addStatus('thorns', 2); self.hp = Math.max(0, self.hp - 1); log(`${self.name} gains 2 thorns and takes 1 damage (Jagged Edge).`); } };

  // Oaken Edge: Battle Start - gain 3 regeneration
  hooks['upgrades/oaken_edge'] = { battleStart({ self, log }) { self.addStatus('regen', 3); log(`${self.name} gains 3 regen (Oaken Edge).`); } };

  // Oozing Edge: On Hit - if enemy has no poison, give 2 poison
  hooks['upgrades/oozing_edge'] = { onHit({ other, log }) { if ((other.statuses.poison||0) === 0) { other.addStatus('poison', 2); log(`${other.name} gains 2 poison (Oozing Edge).`); } } };

  // Petrified Edge: Double your attack; On Hit - gain 1 stun
  hooks['upgrades/petrified_edge'] = { battleStart({ self, log }) { self.atk = (self.atk|0) * 2; log(`${self.name}'s attack is doubled (Petrified Edge).`); }, onHit({ self, log }) { self.addStatus('stun', 1); log(`${self.name} gains 1 stun (Petrified Edge).`); } };

  // Plated Edge: On Hit - convert 1 speed to 3 armor
  hooks['upgrades/plated_edge'] = { onHit({ self, log }) { if ((self.speed|0) > 0) { self.speed -= 1; self.addArmor(3); log(`${self.name} converts 1 speed to 3 armor (Plated Edge).`); } } };

  // Razor Edge: Battle Start - gain 1 attack
  hooks['upgrades/razor_edge'] = { battleStart({ self, log }) { self.addAtk(1); log(`${self.name} gains 1 attack (Razor Edge).`); } };

  // Stormcloud Edge: Battle Start - stun the enemy 1
  hooks['upgrades/stormcloud_edge'] = { battleStart({ other, log }) { other.addStatus('stun', 1); log(`${other.name} is stunned (Stormcloud Edge).`); } };

  // Whirlpool Edge: Every 3 strikes, give the enemy 1 riptide
  hooks['upgrades/whirlpool_edge'] = { afterStrike({ self, other, log }) { self._whirlStrikes = (self._whirlStrikes||0) + 1; if (self._whirlStrikes % 3 === 0) { other.addStatus('riptide', 1); log(`${other.name} gains 1 riptide (Whirlpool Edge).`); } } };
  // Cleansing Edge: On Hit — remove 1 debuff from yourself
  hooks['upgrades/cleansing_edge'] = {
    onHit({ self, log }) {
      const debuffs = ['poison','acid','freeze','stun','riptide'];
      for (const k of debuffs) {
        if ((self.s[k] || 0) > 0) {
          self.s[k] -= 1;
          log(`${self.name} removes 1 ${k} (Cleansing Edge).`);
          break;
        }
      }
    }
  };

})();
