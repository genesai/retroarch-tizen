/*
 * Gamepad bridge between the browser and RetroArch.
 *
 * RetroArch's web joypad driver (rwebpad) only reads a pad after it has
 * received a "gamepadconnected" event for it. Chromium fires that event once,
 * when a pad first becomes visible to the page, and only to listeners that
 * exist at that moment. The launcher reads pads from its first frame, so a
 * pad that was used there is old news by the time a core registers its
 * listener: RetroArch finds its joypad driver and never sees a controller.
 *
 * The bridge takes over delivery of the two connection events on window.
 * Listeners are kept here, and each one is told about every pad that
 * navigator.getGamepads() reports, whenever the listener was added. Pads are
 * also re-checked on a timer, so nothing depends on the TV's browser sending
 * the events at all.
 *
 * ES5 only, like app.js.
 */
(function () {
   "use strict";

   var TYPES = { gamepadconnected: true, gamepaddisconnected: true };
   var listeners = { gamepadconnected: [], gamepaddisconnected: [] };
   var known = {};      /* pad index -> Gamepad last reported as connected */
   var nativeAdd = window.addEventListener;
   var nativeRemove = window.removeEventListener;

   function list() {
      var out = [], all = null;
      try { all = navigator.getGamepads ? navigator.getGamepads() : null; } catch (e) { /* not allowed here */ }
      for (var i = 0; all && i < all.length; i++)
         if (all[i] && all[i].connected) out.push(all[i]);
      return out;
   }

   window.RAPads = { list: list };
   if (!navigator.getGamepads) return;

   function tell(l, type, pad) {
      var ev = new Event(type, { cancelable: true });
      Object.defineProperty(ev, "gamepad", { value: pad });
      try {
         if (typeof l.fn === "function") l.fn.call(window, ev);
         else l.fn.handleEvent(ev);
      } catch (e) {
         console.log("[pads] " + type + " listener failed: " + (e && e.message || e));
      }
   }

   function sync() {
      var now = {};
      list().forEach(function (p) { now[p.index] = p; });

      Object.keys(known).forEach(function (i) {
         if (now[i] && now[i].id === known[i].id) return;
         var gone = known[i];
         delete known[i];
         console.log("[pads] disconnected " + i + ": " + gone.id);
         listeners.gamepadconnected.forEach(function (l) { delete l.told[i]; });
         listeners.gamepaddisconnected.slice().forEach(function (l) { tell(l, "gamepaddisconnected", gone); });
      });

      Object.keys(now).forEach(function (i) {
         if (!known[i]) console.log("[pads] connected " + i + ": " + now[i].id + " (mapping: " + (now[i].mapping || "none") + ")");
         known[i] = now[i];
         listeners.gamepadconnected.slice().forEach(function (l) {
            if (l.told[i]) return;
            l.told[i] = true;
            tell(l, "gamepadconnected", now[i]);
         });
      });
   }

   function capture(opts) {
      return !!(opts && typeof opts === "object" ? opts.capture : opts);
   }

   window.addEventListener = function (type, fn, opts) {
      if (!TYPES[type] || !fn) return nativeAdd.apply(window, arguments);
      var cap = capture(opts);
      var dup = listeners[type].some(function (l) { return l.fn === fn && l.capture === cap; });
      if (dup) return;
      listeners[type].push({ fn: fn, capture: cap, told: {} });
      /* Not from inside the call: RetroArch registers while its joypad
         driver is still initialising. */
      setTimeout(sync, 0);
   };

   window.removeEventListener = function (type, fn, opts) {
      if (!TYPES[type] || !fn) return nativeRemove.apply(window, arguments);
      var cap = capture(opts);
      listeners[type] = listeners[type].filter(function (l) { return l.fn !== fn || l.capture !== cap; });
   };

   /* Native listeners keep the browser sampling pads and make changes show
      up at once; the timer covers browsers that are lax about the events. */
   nativeAdd.call(window, "gamepadconnected", sync);
   nativeAdd.call(window, "gamepaddisconnected", sync);
   setInterval(sync, 500);
})();
