;(function(global){
  const HOOKS = global.HeICSimHooks = global.HeICSimHooks || {};

  class Fighter {
    constructor(raw={}){
      const stats = raw.stats || raw;
      this.name = raw.name || 'Fighter';
      this.hp = stats.hp ?? 10;
      this.hpMax = this.hp;
      this.atk = stats.atk ?? 0;
      this.armor = stats.armor ?? 0;
      this.baseArmor = this.armor;
      this.speed = stats.speed ?? 0;
      this.weapon = raw.weaponSlug || raw.weapon || null;
      this.items = raw.itemSlugs || raw.items || [];
      this.statuses = Object.assign({
        poison:0, acid:0, riptide:0, freeze:0, stun:0,
        thorns:0, regen:0, purity:0
      }, raw.statuses || {});

      this.flags = { firstTurn: true };

      this.tempAtk = 0;
      this.extraStrikes = 0;
      this.strikeFactor = 1; // multiply number of strikes (e.g., Twin Blade)
      this.cannotStrike = false; // hard disable striking (e.g., Wave Breaker)
      this.skipTurn = false; // skip strikes this turn (e.g., Ironstone Bow <= 0)
      this._exposedCount = 0;
      this._exposedLimit = 1;
      this.woundedDone = false;
      this.struckThisTurn = false;
      this.healedThisTurn = 0;
      this.s = this.statuses; // compatibility alias
      this.status = this.statuses;
      this.turnCount = 0; // cadence support

      // Combat summary tracking
      this._summary = {
        strikesAttempted: 0,
        strikesLanded: 0,
        hpDamageDealt: 0,
        armorDestroyedDealt: 0,
        bombHpDealt: 0,
        statusesGained: Object.create(null),
        goldGained: 0
      };

      // Countdowns and thorns preservation (inspired by sim_v9)
      this.countdowns = [];
      this._preserveThorns = 0;
    }
    resetTurn(){
      this.tempAtk = 0;
      this.extraStrikes = 0;
      this.skipTurn = false;
      this.struckThisTurn = false;
      this.healedThisTurn = 0;
    }
  }

  function attachHelpers(self, other, log){
    self.addAtk = n => { self.atk += n; };
    self.addTempAtk = n => { self.tempAtk += n; };
    self.addArmor = n => {
      const before = self.armor|0;
      self.armor = before + (n|0);
      const gained = Math.max(0, self.armor - before);
      if (gained > 0) {
        // Notify listeners about armor gain (e.g., Plated Shield)
        callHooks('onGainArmor', self, other, log, { amount: gained });
      }
    };
    self.addThorns = n => { self.statuses.thorns = (self.statuses.thorns||0)+n; };
    self.onThornsGain = (delta) => { callHooks('onThornsGain', self, other, log, { delta }); };
    self.addExtraStrikes = n => { self.extraStrikes = (self.extraStrikes || 0) + n; };
    self.addGold = n => {
      if (!n) return 0;
      if (self.weapon === 'weapons/scepter_of_greed') return 0; // cannot gain gold
      const before = self.gold || 0;
      const after = Math.min(10, before + Math.max(0, n));
      self.gold = after;
      const gained = after - before;
      if (gained > 0 && self._summary) self._summary.goldGained += gained;
      return gained;
    };

    self.addStatus = (k, n) => {
      // Moonlight Cleaver: below 50% HP, cannot gain statuses
      if (n > 0 && self.weapon === 'weapons/moonlight_cleaver' && (self.hp * 2) < self.hpMax) {
        return;
      }
      const prev = self.statuses[k] || 0;
      const next = Math.max(0, prev + n);
      self.statuses[k] = next;
      // Summary: track statuses gained by this entity
      const delta = next - prev;
      if (delta > 0 && self._summary) {
        self._summary.statusesGained[k] = (self._summary.statusesGained[k] || 0) + delta;
      }
      // Attribution: if someone else is acting, count this as inflicted by them
      if (delta > 0 && CURRENT_ACTOR && CURRENT_ACTOR !== self && CURRENT_ACTOR._summary) {
        const inf = CURRENT_ACTOR._summary.statusesInflicted = CURRENT_ACTOR._summary.statusesInflicted || Object.create(null);
        inf[k] = (inf[k] || 0) + delta;
      }
      const isNew = prev === 0 && next > 0;
      if (k === 'thorns' && n > 0) {
        // notify on thorns gain
        self.onThornsGain(n);
      }
      if (n > 0) {
        callHooks('onGainStatus', self, other, log, { key: k, isNew, amount: n, delta });
      }
    };

    self.spendArmor = n => {
      const used = Math.min(self.armor, n);
      self.armor -= used;
      self.statuses.thorns = (self.statuses.thorns||0)+used;
      return used;
    };
    self.heal = n => {
      // Sanguine Scepter: healing is doubled
      if (self.weapon === 'weapons/sanguine_scepter') n = n * 2;
      const healed = Math.min(n, self.hpMax - self.hp);
      if(healed>0){
        self.hp += healed;
        self.healedThisTurn += healed;
        log(`${self.name} heals ${healed}`);
        callHooks('onHeal', self, other, log, { amount: healed });
      }
      return healed;
    };
    self.damageOther = (n) => {
      const res = applyDamage(self, other, n, log);
      if(res.exposedNow) callHooks('onExposed', other, self, log);
      if(res.woundedNow) callHooks('onWounded', other, self, log);
      return res;
    };

    // Bomb-tagged damage so hooks can react to bomb thresholds
    self.bombDamage = (base) => {
      const repeats = Math.max(1, self._bombRepeat || 1);
      let totalHp = 0;
      for (let i = 0; i < repeats; i++) {
        let n = Math.max(0, Math.floor(base + (self._bombFlatBonus || 0) + (self._bombNextBonus || 0)));
        // Consume one-time next-bomb bonus after first application
        if (self._bombNextBonus) self._bombNextBonus = 0;
        const res = self.damageOther(n);
        const h = (res && res.toHp) ? res.toHp : 0;
        totalHp += h;
        if (self._summary && h > 0) self._summary.bombHpDealt += h;
        // Notify hooks specifically about bomb damage dealt
        callHooks('onBombDamage', self, other, log, { amount: (res && res.toHp) || 0, toArmor: (res && res.toArmor) || 0 });
      }
      return totalHp;
    };

    // Countdown helpers (ported concept from sim_v9)
    self.addCountdown = (name, turns, tag, action) => {
      const id = Math.floor(Math.random()*1e9);
      const t = Math.max(1, turns|0);
      self.countdowns.push({ id, name, turnsLeft: t, origTurns: t, tag: tag||null, action });
      return id;
    };
    self.decAllCountdowns = (n=1) => {
      const delta = Math.max(1, n|0);
      for (const cd of self.countdowns) cd.turnsLeft = Math.max(1, cd.turnsLeft - delta);
    };
    self.halveCountdowns = () => {
      for (const cd of self.countdowns) cd.turnsLeft = Math.max(1, Math.floor(cd.turnsLeft/2));
    };
  }

// Current actor for attribution during hooks
let CURRENT_ACTOR = null;
let CURRENT_SOURCE_SLUG = null;

  function processCountdownsAtTurnStart(owner, enemy, log){
    // decrement then trigger any at 1
    for (const cd of owner.countdowns) cd.turnsLeft = Math.max(1, cd.turnsLeft - 1);
    const toFire = owner.countdowns.filter(cd => cd.turnsLeft === 1);
    owner.countdowns = owner.countdowns.filter(cd => cd.turnsLeft !== 1);
    for (const cd of toFire) {
      // emit hook and then run action
      callHooks('onCountdownTrigger', owner, enemy, log, { countdown: cd });
      if (typeof cd.action === 'function') cd.action(owner, enemy, log, cd);
      // post-trigger hook (for reset behaviors)
      callHooks('postCountdownTrigger', owner, enemy, log, { countdown: cd });
    }
  }

  // Source slug used to annotate log lines with an icon (set per-hook)
  function callHooks(event, self, other, baseLog, extra){
    attachHelpers(self, other, baseLog);
    attachHelpers(other, self, baseLog);
    const withActor = (actor, fn) => {
      const prev = CURRENT_ACTOR;
      CURRENT_ACTOR = actor;
      try { return fn && fn(); } finally { CURRENT_ACTOR = prev; }
    };
    const withSource = (slug, fn) => {
      const prev = CURRENT_SOURCE_SLUG;
      CURRENT_SOURCE_SLUG = slug;
      try { return fn && fn(); } finally { CURRENT_SOURCE_SLUG = prev; }
    };
    const mkCtx = () => ({
      self,
      other,
      log: (m) => baseLog(CURRENT_SOURCE_SLUG ? `::icon:${CURRENT_SOURCE_SLUG}:: ${m}` : m),
      withActor,
      withSource,
      ...extra
    });
    // Weapon triggers first, then items left-to-right
    if (self.weapon) {
      const h = HOOKS[self.weapon];
      const fn = h && h[event];
      if (typeof fn === 'function') withActor(self, () => withSource(self.weapon, () => fn(mkCtx())));
    }
    for (const s of self.items) {
      const slug = (typeof s === 'string') ? s : (s && (s.slug || s.key || s));
      const h = HOOKS[slug];
      const fn = h && h[event];
      if (typeof fn === 'function') withActor(self, () => withSource(slug, () => {
        const tier = (typeof s === 'object' && s && s.tier) ? s.tier : 'base';
        const ctx = Object.assign({}, mkCtx(), { tier, sourceItem: s });
        fn(ctx);
      }));
    }
    // Global hooks (if any)
    const gf = HOOKS._global && HOOKS._global[event];
    if (typeof gf === 'function') withActor(self, () => gf(mkCtx()));
  }

  function applyDamage(src, dst, amount, log){
    amount = Math.floor(Math.max(0, amount));
    let toArmor = Math.min(dst.armor, amount);
    dst.armor -= toArmor;
    amount -= toArmor;
    let toHp = amount;
    dst.hp -= toHp;
    if(dst.hp < 0) dst.hp = 0;
    dst.struckThisTurn = true;
    if(toArmor>0) log(`${src.name} destroys ${toArmor} armor`);
    if(toHp>0) log(`${src.name} hits ${dst.name} for ${toHp}`);
    // Summary: attribute dealt damage to src
    if (src && src._summary) {
      if (toArmor > 0) src._summary.armorDestroyedDealt += toArmor;
      if (toHp > 0) src._summary.hpDamageDealt += toHp;
    }
    callHooks('onDamaged', dst, src, log, { armorLost: toArmor, hpLost: toHp });
    const exposedNow = dst.armor === 0 && (toArmor+toHp>0) && dst._exposedCount < dst._exposedLimit;
    if(exposedNow) dst._exposedCount++;
    const woundedNow = !dst.woundedDone && dst.hp <= Math.floor(dst.hpMax/2);
    if(woundedNow) dst.woundedDone = true;
    return { toArmor, toHp, exposedNow, woundedNow };
  }

  function strike(att, def, log){
    if (att && att._summary) att._summary.strikesAttempted += 1;
    if (att.statuses.stun > 0) {
      att.statuses.stun--;
      log(`${att.name} is stunned and misses the strike`);
      return;
    }
    let dmg = Math.max(0, att.atk + att.tempAtk);
    const armorBefore = def.armor;
    // Freeze halves the attacker's ATK part (on-hit unaffected)
    if (att.statuses && att.statuses.freeze > 0) dmg = Math.floor(dmg / 2);
    // Ironstone-style incoming reduction: if defender has a reduce value and has armor
    if (def._incomingReduceWhileArmored && def.armor > 0) {
      dmg = Math.max(0, dmg - def._incomingReduceWhileArmored);
    }
    // Bracelet-style incoming increase: if defender has no armor, increase damage
    if (def._incomingIncreaseWhileNoArmor && def.armor <= 0) {
      dmg = Math.max(0, dmg + def._incomingIncreaseWhileNoArmor);
    }
    // Apply pre-soak strike modifiers
    const res = applyDamage(att, def, dmg, log);
    let totalDealt = res.toArmor + res.toHp;
    if (att && att._summary && (res.toArmor + res.toHp) > 0) att._summary.strikesLanded += 1;
    // On-Hit effects (attacker)
    const hpBefore = def.hp;
    callHooks('onHit', att, def, log);
    // Mid-strike re-check: on-hit effects can cause Exposed/Wounded outside the initial soak
    let exposedFired = !!res.exposedNow;
    let woundedFired = !!res.woundedNow;
    if (!exposedFired && armorBefore > 0 && def.armor === 0 && def._exposedCount < (def._exposedLimit||1)) {
      def._exposedCount++;
      callHooks('onExposed', def, att, log);
      exposedFired = true;
    }
    if (!woundedFired && !def.woundedDone && def.hp <= Math.floor(def.hpMax/2)) {
      def.woundedDone = true;
      callHooks('onWounded', def, att, log);
      woundedFired = true;
    }
    const afterHp = def.hp;
    if (afterHp < hpBefore) totalDealt += (hpBefore - afterHp);
    // After-Strike hooks
    callHooks('afterStrike', att, def, log);
    // Re-check again in case afterStrike effects altered armor/hp thresholds
    if (!exposedFired && armorBefore > 0 && def.armor === 0 && def._exposedCount < (def._exposedLimit||1)) {
      def._exposedCount++;
      callHooks('onExposed', def, att, log);
      exposedFired = true;
    }
    if (!woundedFired && !def.woundedDone && def.hp <= Math.floor(def.hpMax/2)) {
      def.woundedDone = true;
      callHooks('onWounded', def, att, log);
      woundedFired = true;
    }
    // Mid-strike triggers: Exposed/Wounded (immediately after damage)
    // (Handled above; retained here for legacy clarity)
    // Thorns reflect after Strike+On-Hit
    if (def.statuses.thorns > 0) {
      let thorns = def.statuses.thorns;
      // Thorns reflect to attacker: Armor first, then HP
      let toArmor = Math.min(att.armor, thorns);
      att.armor -= toArmor;
      thorns -= toArmor;
      if (toArmor > 0) log(`${att.name} loses ${toArmor} armor to thorns`);
      if (thorns > 0) {
        att.hp -= thorns;
        if (att.hp < 0) att.hp = 0;
        log(`${att.name} takes ${thorns} thorns damage`);
      }
    }
    // Notify damage dealt aggregate
    if (totalDealt > 0) callHooks('onDamageDealt', att, def, log, { amount: totalDealt });
  }

  function turnStartTicks(a, other, log){
    // Pre-turn hook
    callHooks('preTurnStart', a, other, log);
    a.resetTurn();
    // Acid: At Turn Start, reduce Armor by Acid stacks
    if (a.statuses.acid > 0) {
      const lost = Math.min(a.armor, a.statuses.acid);
      a.armor -= lost;
      if (lost > 0) log(`${a.name} loses ${lost} armor due to Acid`);
    }
    // Poison: At Turn Start, if Armor is 0, take Poison damage, then decrement Poison
    if (a.statuses.poison > 0) {
      if (a.armor === 0) {
        a.hp -= a.statuses.poison;
        if (a.hp < 0) a.hp = 0;
        log(`${a.name} suffers ${a.statuses.poison} poison damage`);
        // Notify listeners about poison tick
        callHooks('onPoisonTick', a, other, m=>log(m), { amount: a.statuses.poison });
      }
      a.statuses.poison--;
    }

    // Countdowns (after status ticks)
    processCountdownsAtTurnStart(a, other, m=>log(m));
  }

  function turnEndTicks(a, other, log){
    // Regen: At End of Turn, heal, then decrement
    if (a.statuses.regen > 0) {
      const heal = Math.min(a.statuses.regen, a.hpMax - a.hp);
      if (heal > 0) {
        a.hp += heal;
        log(`${a.name} regenerates ${heal}`);
      }
      a.statuses.regen--;
    }
    // Riptide: End of afflicted unit's turn, armor-first 5 damage per stack, then -1 stack (cap per turn)
    if (a.statuses.riptide > 0) {
      const cap = a._riptideMaxTriggers || 1;
      let ticks = 0;
      while (a.statuses.riptide > 0 && ticks < cap) {
        let dmg = 5;
        const toArmor = Math.min(a.armor, dmg);
        if (toArmor > 0) a.armor -= toArmor;
        dmg -= toArmor;
        if (dmg > 0) {
          a.hp -= dmg;
          if (a.hp < 0) a.hp = 0;
        }
        log(`${a.name} is battered by Riptide`);
        if (other) callHooks('onEnemyRiptideTick', other, a, m=>log(m));
        callHooks('onRiptideTick', a, other, m=>log(m));
        a.statuses.riptide--;
        ticks++;
      }
    }
    // Thorns cleanup: if you were struck this turn, normally clear thorns
    // Granite Thorns (or similar effects) can preserve thorns for a limited number of strikes.
    if (a.struckThisTurn && a.statuses.thorns > 0) {
      if ((a._preserveThorns|0) > 0) {
        a._preserveThorns -= 1;
        log(`${a.name} preserves thorns (${a._preserveThorns} left)`);
      } else {
        a.statuses.thorns = 0;
      }
    }
    // Freeze: Decrement at End of Turn
    if (a.statuses.freeze > 0) a.statuses.freeze--;
  }

  function pickOrder(l, r){
    return l.speed >= r.speed ? [l, r] : [r, l];
  }

  function simulate(Lraw, Rraw, opts={}){
    const maxTurns = opts.maxTurns || opts.max_turns || 100;

    const logArr = [];
    const L = new Fighter(Lraw);
    const R = new Fighter(Rraw);
    // Pre-battle hooks (e.g., Energy Drain)
    callHooks('pre', L, R, m=>logArr.push(m));
    callHooks('pre', R, L, m=>logArr.push(m));
    // Battle Start hooks
    callHooks('battleStart', L, R, m=>logArr.push(m));
    callHooks('battleStart', R, L, m=>logArr.push(m));
    let [actor, target] = pickOrder(L, R);
    let round = 0;
    while(round < maxTurns && L.hp>0 && R.hp>0){
      round++;
      actor.turnCount = (actor.turnCount || 0) + 1;
      logArr.push(`-- Turn ${round} -- ${actor.name}`);
      // Turn Start: statuses first (Acid, Poison, Countdowns), then item effects
      turnStartTicks(actor, target, m=>logArr.push(m));
      callHooks('turnStart', actor, target, m=>logArr.push(m));
      // Royal Scepter: ATK equals GOLD each turn
      if (actor.weapon === 'weapons/royal_scepter') {
        actor.atk = Math.min(10, actor.gold || 0);
      }
      // Strikes: base 1 + explicit bonuses only (Speed does not inherently add strikes)
      let strikes = 1 + (actor.extraStrikes || 0);
      if (actor.cannotStrike) strikes = 0;
      if (actor.skipTurn) strikes = 0;
      strikes = Math.max(0, Math.floor(strikes * (actor.strikeFactor || 1)));
      while(strikes-- > 0 && actor.hp>0 && target.hp>0){
        strike(actor, target, m=>logArr.push(m));
      }
      // Turn End: temporal effects first (Riptide, Regen, Freeze), then item effects
      turnEndTicks(actor, target, m=>logArr.push(m));
      callHooks('turnEnd', actor, target, m=>logArr.push(m));

      actor.flags.firstTurn = false;

      [actor, target] = [target, actor];
    }
    const result = L.hp<=0 && R.hp<=0 ? 'Draw' : L.hp<=0 ? 'RightWin' : R.hp<=0 ? 'LeftWin' : 'Draw';
    const summarize = (x) => ({
      name: x.name,
      hpRemaining: x.hp,
      armorRemaining: x.armor,
      strikesAttempted: x._summary.strikesAttempted,
      strikesLanded: x._summary.strikesLanded,
      hpDamageDealt: x._summary.hpDamageDealt,
      armorDestroyedDealt: x._summary.armorDestroyedDealt,
      bombHpDealt: x._summary.bombHpDealt || 0,
      statusesGained: x._summary.statusesGained,
      statusesInflicted: x._summary.statusesInflicted || {},
      gold: x.gold || 0
    });
    return { result, rounds: round, log: logArr, summary: { left: summarize(L), right: summarize(R) } };
  }

  if(typeof module !== "undefined" && module.exports) module.exports = { simulate };
  global.HeICSim = { simulate };
})(typeof window !== 'undefined' ? window : globalThis);

