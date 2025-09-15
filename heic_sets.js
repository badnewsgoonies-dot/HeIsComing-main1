// HeIC Set Bonuses: definitions + hook registrations
//
// This module introduces "set bonuses" that activate when a loadout
// contains certain combinations (e.g., any 3 rings, or specific pairs).
//
// Implementation strategy
// - At build time (UI), active sets are detected and displayed.
// - For the simulator, active sets are injected as pseudo-items
//   using slugs under `sets/<key>`. Their effects are implemented
//   as normal hooks on window.HeICSimHooks so the engine doesn’t need
//   any special handling.
(function(){
  if (typeof window === 'undefined') return;
  const hooks = window.HeICSimHooks = window.HeICSimHooks || {};

  // Best-effort tag discovery
  function getTagsFor(slug){
    try {
      const d = (window.HEIC_DETAILS && window.HEIC_DETAILS[slug]) || null;
      if (d && Array.isArray(d.tags)) return d.tags;
    } catch(_){}
    const tags = [];
    if (/tome/i.test(slug)) tags.push('Tome');
    if (/(ring|earring|crown|gemstone|necklace|amulet|pendant|bracelet|talisman|diadem|circlet|band)/i.test(slug)) tags.push('Jewelry');
    if (/ring_/i.test(slug) || /_ring$/i.test(slug)) tags.push('Ring');
    return tags;
  }

  // Core set definitions (small curated subset; easy to expand)
  // key: stable id, name: display, desc: short effect text
  // reqs: array of requirements; currently supports:
  //   - { kind:'slugs', all:['items/foo','weapons/bar'] }
  //   - { kind:'tag-count', tag:'Ring', count:3 }
  const SETS = [
    {
      key: 'highborn', name: 'Highborn', desc: 'Ring items trigger twice',
      reqs: [ { kind: 'tag-count', tag: 'Ring', count: 3 } ],
      effectSlug: 'sets/highborn'
    },
    {
      key: 'iron_chain', name: 'Iron Chain', desc: 'Battle Start: Gain 5 armor',
      reqs: [ { kind:'slugs', all:['weapons/chainmail_sword','items/chainmail_armor'] } ],
      effectSlug: 'sets/iron_chain'
    },
    {
      key: 'ironstone_arrowhead', name: 'Ironstone Arrowhead', desc: 'On Hit: Gain 1 armor',
      reqs: [ { kind:'slugs', all:['weapons/ironstone_spear','items/ironstone_sandals'] } ],
      effectSlug: 'sets/ironstone_arrowhead'
    },
    {
      key: 'sanguine_gemstone', name: 'Sanguine Gemstone', desc: 'If ATK is 1, heal 1 on hit',
      reqs: [ { kind:'slugs', all:['weapons/sanguine_scepter','items/ruby_gemstone'] } ],
      effectSlug: 'sets/sanguine_gemstone'
    },
    {
      key: 'glasses_of_the_hero', name: 'Glasses of the Hero', desc: 'On Hit: Reduce countdowns by 1',
      reqs: [ { kind:'slugs', all:['items/tome_of_the_hero','items/hero_s_crossguard'] } ],
      effectSlug: 'sets/glasses_of_the_hero'
    },
    {
      key: 'weaver_medallion', name: 'Weaver Medallion', desc: 'Battle Start: Restore 5 health',
      reqs: [ { kind:'slugs', all:['items/weaver_armor','items/weaver_shield'] } ],
      effectSlug: 'sets/weaver_medallion'
    }
    ,
    // ------------------------------
    // Additional community itemsets (icons provided)
    // ------------------------------
    { key:'basilisk_gaze', name:"Basilisk's Gaze", desc:'On Hit: Give the enemy 1 poison',
      reqs:[{ kind:'slugs', all:['weapons/basilisk_fang','items/basilisk_scale'] }], effectSlug:'sets/basilisk_gaze' },
    { key:'bloodmoon_strike', name:'Bloodmoon Strike', desc:'First turn: +1 extra strike',
      reqs:[{ kind:'slugs', all:['weapons/bloodmoon_dagger','items/bloodmoon_armor'] }], effectSlug:'sets/bloodmoon_strike' },
    { key:'bloodstone_pendant', name:'Bloodstone Pendant', desc:'On Heal: Gain 1 gold',
      reqs:[{ kind:'slugs', all:['items/bloodstone_ring','items/elderwood_necklace'] }], effectSlug:'sets/bloodstone_pendant' },
    { key:'briar_greaves', name:'Briar Greaves', desc:'On Gain Armor: Gain 1 thorns',
      reqs:[{ kind:'slugs', all:['items/briar_greaves','items/blackbriar_rose'] }], effectSlug:'sets/briar_greaves' },
    { key:'brittlebark_blessing', name:'Brittlebark Blessing', desc:'Battle Start: Gain 1 armor and 1 thorns',
      reqs:[{ kind:'slugs', all:['items/brittlebark_armor','weapons/brittlebark_bow'] }], effectSlug:'sets/brittlebark_blessing' },
    { key:'champion_s_greaves', name:"Champion's Greaves", desc:'Battle Start: Gain 1 attack',
      reqs:[{ kind:'slugs', all:['items/champion_s_greaves','weapons/champion_s_blade'] }], effectSlug:'sets/champion_s_greaves' },
    { key:'crystal_mirror', name:'Crystal Mirror', desc:'When damaged: Restore 1 health',
      reqs:[{ kind:'slugs', all:['items/marble_mirror','items/sinful_mirror'] }], effectSlug:'sets/crystal_mirror' },
    { key:'deadly_toxin', name:'Deadly Toxin', desc:'First turn On Hit: +2 poison',
      reqs:[{ kind:'slugs', all:['items/venomous_fang','weapons/basilisk_fang'] }], effectSlug:'sets/deadly_toxin' },
    { key:'elderwood_mask', name:'Elderwood Mask', desc:'Turn End: Restore 1 health',
      reqs:[{ kind:'slugs', all:['weapons/elderwood_staff','items/elderwood_necklace'] }], effectSlug:'sets/elderwood_mask' },
    { key:'heros_return', name:"Hero's Return", desc:'When Wounded: Restore 5 health',
      reqs:[{ kind:'slugs', all:['items/tome_of_the_hero','items/hero_s_crossguard'] }], effectSlug:'sets/heros_return' },
    { key:'holy_crucifix', name:'Holy Crucifix', desc:'Negates negative base stats',
      reqs:[{ kind:'slugs', all:['items/holy_shield','items/holy_tome'] }], effectSlug:'sets/holy_crucifix' },
    { key:'ironbark_shield', name:'Ironbark Shield', desc:'On Gain Armor: Gain 1 thorns',
      reqs:[{ kind:'slugs', all:['items/brittlebark_buckler','items/brittlebark_armor'] }], effectSlug:'sets/ironbark_shield' },
    { key:'ironstone_crest', name:'Ironstone Crest', desc:'While armored: Incoming strike reduced by 1',
      reqs:[{ kind:'slugs', all:['items/ironstone_armor','weapons/ironstone_bow'] }], effectSlug:'sets/ironstone_crest' },
    { key:'ironstone_fang', name:'Ironstone Fang', desc:'On Hit: Gain 1 armor',
      reqs:[{ kind:'slugs', all:['weapons/ironstone_greatsword','items/ironstone_bracelet'] }], effectSlug:'sets/ironstone_fang' },
    { key:'ironstone_ore', name:'Ironstone Ore', desc:'Turn Start: Convert 1 armor to 2 thorns',
      reqs:[{ kind:'slugs', all:['items/ironstone_armor','items/iron_rune'] }], effectSlug:'sets/ironstone_ore' },
    { key:'lifeblood_transfusion', name:'Lifeblood Transfusion', desc:'On Heal: Gain 1 attack',
      reqs:[{ kind:'slugs', all:['weapons/lifeblood_spear','items/lifeblood_armor'] }], effectSlug:'sets/lifeblood_transfusion' },
    { key:'liquid_metal', name:'Liquid Metal', desc:'On Gain Armor: Gain 1 thorns',
      reqs:[{ kind:'slugs', all:['items/iron_transfusion','weapons/marble_sword'] }], effectSlug:'sets/liquid_metal' },
    { key:'marble_anvil', name:'Marble Anvil', desc:'Turn Start: If armor is 0, gain 1 armor',
      reqs:[{ kind:'slugs', all:['weapons/marble_sword','items/marble_mushroom'] }], effectSlug:'sets/marble_anvil' },
    { key:'marshlight_aria', name:'Marshlight Aria', desc:'Turn End: If you healed, gain 1 armor',
      reqs:[{ kind:'slugs', all:['items/marshlight_lantern','items/marbled_stonefish'] }], effectSlug:'sets/marshlight_aria' },
    { key:'raw_hide', name:'Raw Hide', desc:'Turn Start: Gain 1 armor',
      reqs:[{ kind:'slugs', all:['items/assault_greaves','items/chainmail_cloak'] }], effectSlug:'sets/raw_hide' },
    { key:'redwood_crown', name:'Redwood Crown', desc:'Turn End: Gain 1 regen',
      reqs:[{ kind:'slugs', all:['items/redwood_helmet','weapons/redwood_rod'] }], effectSlug:'sets/redwood_crown' },
    { key:'saffron_talon', name:'Saffron Talon', desc:'On Hit: Gain 1 thorns',
      reqs:[{ kind:'slugs', all:['items/saffron_feather','items/venomous_fang'] }], effectSlug:'sets/saffron_talon' },
    { key:'seafood_hotpot', name:'Seafood Hotpot', desc:'On Poison tick: Restore 1 health',
      reqs:[{ kind:'slugs', all:['items/marbled_stonefish','items/clearspring_cloak'] }], effectSlug:'sets/seafood_hotpot' },
    { key:'steelplated_thorns', name:'Steelplated Thorns', desc:'On Thorns gain: Gain 1 armor',
      reqs:[{ kind:'slugs', all:['items/granite_thorns','items/chainmail_cloak'] }], effectSlug:'sets/steelplated_thorns' },
    { key:'twilight_crest', name:'Twilight Crest', desc:'Battle Start: If faster, stun enemy 1',
      reqs:[{ kind:'slugs', all:['items/sunlight_crest','items/crimson_cloak'] }], effectSlug:'sets/twilight_crest' },
    { key:'vampire_cloak', name:'Vampire Cloak', desc:'On Hit: Restore 1 health',
      reqs:[{ kind:'slugs', all:['items/vampire_s_tooth','items/crimson_cloak'] }], effectSlug:'sets/vampire_cloak' }
  ];

  // Public API for the UI to compute active sets and render them
  function normalizeSlug(x){
    if (!x) return '';
    if (typeof x === 'string') return x;
    if (x.bucket && x.slug) return `${x.bucket}/${x.slug}`;
    if (x.slug) return String(x.slug);
    return String(x);
  }

  function countByTag(slugs, tag){
    let n = 0;
    for (const s of slugs) {
      const t = getTagsFor(s);
      if (t && t.indexOf(tag) !== -1) n++;
    }
    return n;
  }

  function reqSatisfied(req, slugs){
    if (!req) return false;
    if (req.kind === 'slugs') {
      const have = new Set(slugs);
      return (req.all || []).every(s => have.has(s));
    }
    if (req.kind === 'tag-count') {
      const c = countByTag(slugs.filter(s => /^items\//.test(s)), req.tag);
      return c >= (req.count || 0);
    }
    return false;
  }

  function computeActive(slugs){
    const list = [];
    try {
      const setSlugs = slugs.map(normalizeSlug).filter(Boolean);
      for (const def of SETS) {
        if ((def.reqs||[]).every(r => reqSatisfied(r, setSlugs))) {
          list.push(def);
        }
      }
    } catch(_){}
    return list;
  }

  function computeActiveEffectSlugs(slugs){
    return computeActive(slugs).map(d => d.effectSlug);
  }

  // Expose for UI consumption
  window.HeICSets = {
    definitions: SETS,
    computeActive,
    computeActiveEffectSlugs
  };

  // ------------------------------
  // Hook implementations for pseudo-items (effectSlugs)
  // ------------------------------
  hooks['sets/iron_chain'] = {
    battleStart({ self, log }) {
      self.addArmor(5);
      if (log) log(`${self.name} gains 5 armor (Iron Chain set).`);
    }
  };

  hooks['sets/ironstone_arrowhead'] = {
    onHit({ self, log }) {
      self.addArmor(1);
      if (log) log(`${self.name} gains 1 armor (Ironstone Arrowhead set).`);
    }
  };

  hooks['sets/sanguine_gemstone'] = {
    onHit({ self, log }) {
      // If your attack stat is exactly 1, restore 1 health on hit
      const atkNow = self.atk|0;
      if (atkNow === 1) {
        const h = self.heal(1);
        if (h > 0 && log) log(`${self.name} restores ${h} health (Sanguine Gemstone set).`);
      }
    }
  };

  hooks['sets/glasses_of_the_hero'] = {
    onHit({ self, log }) {
      if (typeof self.decAllCountdowns === 'function') {
        self.decAllCountdowns(1);
        if (log) log(`${self.name} reduces countdowns by 1 (Glasses of the Hero set).`);
      }
    }
  };

  hooks['sets/weaver_medallion'] = {
    battleStart({ self, log }) {
      const h = self.heal(5);
      if (h > 0 && log) log(`${self.name} restores ${h} health (Weaver Medallion set).`);
    }
  };

  // Highborn: Any 3 rings -> Ring items trigger twice
  // We mark the owner at battle start, then provide global wrappers that
  // re-trigger ring item hooks for many common events.
  hooks['sets/highborn'] = {
    battleStart({ self, log }){
      self._setHighborn = true;
      if (log) log(`${self.name} activates Highborn (ring items trigger twice).`);
    }
  };

  function isRingSlug(slug){
    if (!slug) return false;
    if (!/^items\//.test(slug)) return false;
    const tags = getTagsFor(slug) || [];
    return tags.includes('Ring') || /ring_/i.test(slug) || /_ring$/i.test(slug);
  }

  function duplicateRingTriggers(event, ctx){
    const { self, withActor, withSource } = ctx || {};
    if (!self || !self._setHighborn) return;
    // Ensure the set condition is still met (any 3 rings equipped)
    const slugs = (self.items||[]).map(normalizeSlug).filter(Boolean);
    const ringCount = slugs.filter(isRingSlug).length;
    if (ringCount < 3) return;
    for (const s of (self.items||[])) {
      const slug = normalizeSlug(s);
      if (!isRingSlug(slug)) continue;
      const h = hooks[slug];
      const fn = h && h[event];
      if (typeof fn === 'function') {
        const tier = (typeof s === 'object' && s && s.tier) ? s.tier : 'base';
        const nextCtx = Object.assign({}, ctx, { tier, sourceItem: s });
        if (typeof withActor === 'function') {
          withActor(self, () => withSource(slug, () => fn(nextCtx)));
        } else {
          // Fallback – should not happen in normal flow
          fn(nextCtx);
        }
      }
    }
  }

  // Chain into all common events so ring hooks are re-fired once more.
  const DUP_EVENTS = [
    'pre','battleStart','turnStart','onHit','afterStrike','turnEnd',
    'onExposed','onWounded','onGainArmor','onGainStatus','onHeal',
    'onPoisonTick','onCountdownTrigger','postCountdownTrigger',
    'onBombDamage','onDamageDealt','onDamaged','onEnemyRiptideTick','onRiptideTick','onThornsGain'
  ];
  hooks._global = hooks._global || {};
  for (const ev of DUP_EVENTS) {
    const prev = hooks._global[ev];
    hooks._global[ev] = function(ctx){
      try { if (typeof prev === 'function') prev(ctx); } catch(_){}
      try { duplicateRingTriggers(ev, ctx); } catch(_){}
    };
  }

  // Holy Crucifix: Negate negative base stats (e.g., -ATK, -SPD) at battle start
  hooks['sets/holy_crucifix'] = {
    battleStart({ self, log }) {
      let fixed = [];
      if ((self.atk|0) < 0) { const n = -(self.atk|0); self.addAtk(n); fixed.push(`+${n} ATK`); }
      if ((self.speed|0) < 0) { const n = -(self.speed|0); self.speed += n; fixed.push(`+${n} Speed`); }
      // Armor can also be negative in edge cases; normalize if so
      if ((self.armor|0) < 0) { const n = -(self.armor|0); self.addArmor(n); fixed.push(`+${n} Armor`); }
      if (fixed.length && log) log(`${self.name}'s Holy Crucifix negates negatives (${fixed.join(', ')}).`);
    }
  };

  // ------------------------------
  // Additional set effect hooks
  // ------------------------------
  hooks['sets/basilisk_gaze'] = {
    onHit({ other, log }) {
      other.addStatus('poison', 1);
      if (log) log(`Inflicts 1 poison (Basilisk's Gaze set).`);
    }
  };

  hooks['sets/bloodmoon_strike'] = {
    turnStart({ self, log }) {
      if (self.flags && self.flags.firstTurn) {
        self.addExtraStrikes(1);
        if (log) log(`Gains +1 extra strike on first turn (Bloodmoon Strike set).`);
      }
    }
  };

  hooks['sets/bloodstone_pendant'] = {
    onHeal({ self, log }) {
      const g = self.addGold ? self.addGold(1) : 0;
      if (g > 0 && log) log(`Gains ${g} gold (Bloodstone Pendant set).`);
    }
  };

  hooks['sets/briar_greaves'] = {
    onGainArmor({ self, log }) {
      self.addThorns(1);
      if (log) log(`Gains 1 thorns (Briar Greaves set).`);
    }
  };

  hooks['sets/brittlebark_blessing'] = {
    battleStart({ self, log }) {
      self.addArmor(1);
      self.addThorns(1);
      if (log) log(`Gains 1 armor and 1 thorns (Brittlebark Blessing set).`);
    }
  };

  hooks['sets/champion_s_greaves'] = {
    battleStart({ self, log }) {
      self.addAtk(1);
      if (log) log(`Gains +1 attack (Champion's Greaves set).`);
    }
  };

  hooks['sets/crystal_mirror'] = {
    onDamaged({ self, log }) {
      const h = self.heal(1);
      if (h > 0 && log) log(`Restores ${h} health (Crystal Mirror set).`);
    }
  };

  hooks['sets/deadly_toxin'] = {
    onHit({ self, other, log }) {
      if (self.flags && self.flags.firstTurn) {
        other.addStatus('poison', 2);
        if (log) log(`Inflicts 2 poison (Deadly Toxin set).`);
      }
    }
  };

  hooks['sets/elderwood_mask'] = {
    turnEnd({ self, log }) {
      const h = self.heal(1);
      if (h > 0 && log) log(`Restores ${h} health (Elderwood Mask set).`);
    }
  };

  hooks['sets/heros_return'] = {
    onWounded({ self, log }) {
      const h = self.heal(5);
      if (h > 0 && log) log(`Restores ${h} health (Hero's Return set).`);
    }
  };

  hooks['sets/holy_crucifix'] = {
    battleStart({ self, log }) {
      self.addStatus('purity', 2);
      if (log) log(`Gains 2 Purity (Holy Crucifix set).`);
    }
  };

  hooks['sets/ironbark_shield'] = {
    onGainArmor({ self, log }) {
      self.addThorns(1);
      if (log) log(`Gains 1 thorns (Ironbark Shield set).`);
    }
  };

  hooks['sets/ironstone_crest'] = {
    battleStart({ self, log }) {
      self._incomingReduceWhileArmored = Math.max(1, self._incomingReduceWhileArmored||0);
      if (log) log(`Incoming strike damage reduced by 1 while armored (Ironstone Crest set).`);
    }
  };

  hooks['sets/ironstone_fang'] = {
    onHit({ self, log }) {
      self.addArmor(1);
      if (log) log(`Gains 1 armor on hit (Ironstone Fang set).`);
    }
  };

  hooks['sets/ironstone_ore'] = {
    turnStart({ self, log }) {
      const used = self.spendArmor(1);
      if (used > 0) {
        self.addThorns(2);
        if (log) log(`Converts 1 armor into 2 thorns (Ironstone Ore set).`);
      }
    }
  };

  hooks['sets/lifeblood_transfusion'] = {
    onHeal({ self, log, amount }) {
      self.addAtk(1);
      if (log) log(`Gains +1 attack (Lifeblood Transfusion set).`);
    }
  };

  hooks['sets/liquid_metal'] = {
    onGainArmor({ self, log }) {
      self.addThorns(1);
      if (log) log(`Gains 1 thorns (Liquid Metal set).`);
    }
  };

  hooks['sets/marble_anvil'] = {
    turnStart({ self, log }) {
      if ((self.armor|0) <= 0) {
        self.addArmor(1);
        if (log) log(`Gains 1 armor (Marble Anvil set).`);
      }
    }
  };

  hooks['sets/marshlight_aria'] = {
    turnEnd({ self, log }) {
      if ((self.healedThisTurn|0) > 0) {
        self.addArmor(1);
        if (log) log(`Healed this turn: gains 1 armor (Marshlight Aria set).`);
      }
    }
  };

  hooks['sets/raw_hide'] = {
    turnStart({ self, log }) {
      self.addArmor(1);
      if (log) log(`Gains 1 armor (Raw Hide set).`);
    }
  };

  hooks['sets/redwood_crown'] = {
    turnEnd({ self, log }) {
      self.addStatus('regen', 1);
      if (log) log(`Gains 1 Regen (Redwood Crown set).`);
    }
  };

  hooks['sets/saffron_talon'] = {
    onHit({ self, log }) {
      self.addThorns(1);
      if (log) log(`Gains 1 thorns (Saffron Talon set).`);
    }
  };

  hooks['sets/seafood_hotpot'] = {
    onPoisonTick({ self, log }) {
      const h = self.heal(1);
      if (h > 0 && log) log(`Restores ${h} health (Seafood Hotpot set).`);
    }
  };

  hooks['sets/steelplated_thorns'] = {
    onThornsGain({ self, log }) {
      self.addArmor(1);
      if (log) log(`Gains 1 armor (Steelplated Thorns set).`);
    }
  };

  hooks['sets/twilight_crest'] = {
    battleStart({ self, other, log }) {
      if ((self.speed|0) > (other.speed|0)) {
        other.addStatus('stun', 1);
        if (log) log(`Stuns the enemy for 1 (Twilight Crest set).`);
      }
    }
  };

  hooks['sets/vampire_cloak'] = {
    onHit({ self, log }) {
      const h = self.heal(1);
      if (h > 0 && log) log(`Restores ${h} health (Vampire Cloak set).`);
    }
  };
})();
