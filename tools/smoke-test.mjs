// Headless smoke test: drive the launcher with "remote" keys the way a TV
// would, boot cores and make sure RetroArch renders without errors.
//
// Usage: node smoke-test.mjs <site url> <rom folder url> [cross-origin url]
//   - scenario "menu": boot the first core straight into the RetroArch menu
//   - scenario "rom":  load a ROM through the network-folder browser
//   - scenario "remote-assets": cores and the bundle come from another origin,
//     as in the .wgt (file://) where they come from GitHub Pages
//   - scenario "gamepad": a controller already in use in the launcher must
//     still reach RetroArch (app/pads.js)
//   - scenario "pad-swap": face buttons of a controller numbered by label are
//     swapped back, and the Controller test screen can turn that off
import { chromium } from "playwright";

const [siteUrl, romUrl, remoteUrl] = process.argv.slice(2);
const browser = await chromium.launch();
let failed = false;

async function scenario(name, url, steps, init) {
   const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
   if (init) await page.addInitScript(init);
   const logs = [];
   page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
   page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
   const shot = (n) => page.screenshot({ path: `shot-${name}-${n}.png` });
   try {
      await page.goto(url);
      await page.waitForSelector(".tile.focused");
      await steps(page, shot);
      const errors = await page.$eval("#errors", (e) => e.textContent);
      if (errors.trim()) throw new Error("on-screen errors:\n" + errors);
      if (!logs.some((l) => /\[INFO\] RetroArch|RetroArch: /.test(l))) throw new Error("RetroArch did not start");
      console.log(`PASS ${name}`);
   } catch (e) {
      failed = true;
      console.error(`FAIL ${name}: ${e.stack || e}`);
      await shot("error").catch(() => {});
   }
   console.log(`--- ${name} log (tail) ---\n` + logs.slice(-40).join("\n"));
   await page.close();
}

// Simulates a TV remote key (TV keys have keyCodes but no event.code).
async function remoteKey(page, keyCode) {
   const fire = (type) => page.evaluate(([type, keyCode]) => {
      const e = new KeyboardEvent(type, { bubbles: true });
      Object.defineProperty(e, "keyCode", { get: () => keyCode });
      window.dispatchEvent(e);
   }, [type, keyCode]);
   await fire("keydown");
   await page.waitForTimeout(150);
   await fire("keyup");
}

async function bootMenu(page, shot) {
   await shot("1-home");
   await page.keyboard.press("Enter"); // first system (FCEUmm)
   await page.waitForSelector("#screen-source.active");
   for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown"); // last entry: menu
   await page.keyboard.press("Enter");
   await page.waitForSelector("body.playing", { timeout: 180000 });
   await page.waitForTimeout(8000);
   await shot("2-menu");
   await page.keyboard.press("ArrowDown");
   await page.waitForTimeout(300);
   await page.keyboard.press("ArrowDown");
   await page.waitForTimeout(1000);
   await shot("3-menu-nav");
}

await scenario("menu", siteUrl, bootMenu);

await scenario("rom", siteUrl, async (page, shot) => {
   await page.keyboard.press("Enter"); // FCEUmm
   await page.waitForSelector("#screen-source.active");
   await page.keyboard.press("Enter"); // network folder (first entry without USB)
   await page.waitForSelector("#screen-url.active");
   await page.fill("#url-input", romUrl);
   await page.keyboard.press("Enter");
   await page.waitForSelector("#screen-browser.active .item.focused");
   await shot("1-browser");
   await page.keyboard.press("Enter"); // first ROM
   await page.waitForSelector("body.playing", { timeout: 180000 });
   await page.waitForTimeout(6000);
   await shot("2-game");
   // Red key on the remote opens the RetroArch menu
   const before = await page.screenshot();
   await remoteKey(page, 403);
   await page.waitForTimeout(1500);
   const after = await page.screenshot({ path: "shot-rom-3-quickmenu.png" });
   if (before.equals(after)) throw new Error("red key did not change the screen (menu not opened)");
});

if (remoteUrl) await scenario("remote-assets", remoteUrl, bootMenu);

// A pad the page can see from the start: the browser never sends a
// "gamepadconnected" event for it once RetroArch is listening, which is what
// happens on a TV when the controller was used to pick the game.
const fakePadScript = (id) => {
   const pad = {
      id, index: 0, connected: true, mapping: "standard", timestamp: 0,
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
   };
   navigator.getGamepads = () => [pad, null, null, null];
   window.__padButton = (i, down) => {
      pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp = performance.now();
   };
};
const fakePad = { content: `(${fakePadScript})("Smoke test pad (STANDARD GAMEPAD)")` };

// The launcher reads pads once per frame; on a cold start the first frames
// can come later than a short press, so wait until a few have run.
async function framesRunning(page) {
   await page.evaluate(() => new Promise((done) => {
      let n = 0;
      const tick = () => (++n >= 10 ? done() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
   }));
}

async function padButton(page, button) {
   await page.evaluate((b) => window.__padButton(b, true), button);
   await page.waitForTimeout(150);
   await page.evaluate((b) => window.__padButton(b, false), button);
   await page.waitForTimeout(150);
}

await scenario("gamepad", siteUrl, async (page, shot) => {
   await framesRunning(page);
   await padButton(page, 0); // first system (FCEUmm)
   await page.waitForSelector("#screen-source.active");
   for (let i = 0; i < 5; i++) await padButton(page, 13); // last entry: menu
   await padButton(page, 0);
   await page.waitForSelector("body.playing", { timeout: 180000 });
   await page.waitForTimeout(8000);
   const before = await page.screenshot({ path: "shot-gamepad-1-menu.png" });
   await padButton(page, 13); // D-pad down in RetroArch's menu
   await page.waitForTimeout(1000);
   const after = await page.screenshot({ path: "shot-gamepad-2-menu-nav.png" });
   if (before.equals(after)) throw new Error("the controller did not move RetroArch's menu");
}, fakePad);

// An 8BitDo SF30 Pro in Android mode numbers its face buttons by label, so
// the TV reports A (right) as 0 (bottom). pads.js swaps them back, and Select
// on the Controller test screen turns that off again.
const fake8BitDo = { content: `(${fakePadScript})("8Bitdo SF30 Pro (STANDARD GAMEPAD Vendor: 2dc8 Product: 6101)")` };
await scenario("pad-swap", siteUrl, async (page, shot) => {
   await framesRunning(page);
   // A, on the right. Pressed, read and released in one go: A is now Back,
   // and the launcher must not see it.
   const seen = await page.evaluate(() => {
      window.__padButton(0, true);
      const pressed = navigator.getGamepads()[0].buttons.map((b) => b.pressed);
      window.__padButton(0, false);
      return pressed;
   });
   if (!seen[1] || seen[0]) throw new Error("A was not moved to the right button: " + seen.slice(0, 4));
   await padButton(page, 1); // B, at the bottom: confirms
   await page.waitForSelector("#screen-source.active");
   await page.keyboard.press("Escape");
   await page.waitForSelector("#screen-home.active");
   await page.click("#btn-pads");
   await page.waitForSelector("#screen-pads.active");
   await page.waitForFunction(() => /Face buttons: swapped/.test(document.getElementById("pads-list").textContent));
   await shot("1-swapped");
   await padButton(page, 8); // Select: back to the TV's numbering
   await page.waitForFunction(() => /Face buttons: as the TV reports/.test(document.getElementById("pads-list").textContent));
   const saved = await page.evaluate(() => localStorage.getItem("ra_pad_swap"));
   if (saved !== '{"2dc8:6101":false}') throw new Error("choice not saved: " + saved);
   const now = await page.evaluate(() => {
      window.__padButton(0, true);
      const pressed = navigator.getGamepads()[0].buttons[0].pressed;
      window.__padButton(0, false);
      return pressed;
   });
   if (!now) throw new Error("buttons still swapped after Select");
   await shot("2-as-reported");
   await padButton(page, 8); // swapped again
   await page.waitForFunction(() => /Face buttons: swapped/.test(document.getElementById("pads-list").textContent));
   await page.keyboard.press("Escape");
   await page.keyboard.press("Escape"); // twice to leave
   await page.waitForSelector("#screen-home.active");
   // Into RetroArch's menu with B (bottom), then B again must confirm there
   // too: RetroArch confirms with the bottom button by default.
   await padButton(page, 1);
   await page.waitForSelector("#screen-source.active");
   for (let i = 0; i < 5; i++) await padButton(page, 13);
   await padButton(page, 1);
   await page.waitForSelector("body.playing", { timeout: 180000 });
   await page.waitForTimeout(8000);
   const before = await page.screenshot({ path: "shot-pad-swap-3-menu.png" });
   await padButton(page, 1);
   await page.waitForTimeout(1000);
   const after = await page.screenshot({ path: "shot-pad-swap-4-confirmed.png" });
   if (before.equals(after)) throw new Error("B (bottom) did not confirm in RetroArch's menu");
}, fake8BitDo);

// Holding Select for 2 seconds opens RetroArch's menu in game (not Start,
// which also switches 8BitDo controllers off). A short press must not.
await scenario("hold-select", siteUrl, async (page, shot) => {
   await framesRunning(page);
   await padButton(page, 0); // FCEUmm
   await page.waitForSelector("#screen-source.active");
   await page.keyboard.press("Enter"); // network folder
   await page.waitForSelector("#screen-url.active");
   await page.fill("#url-input", romUrl);
   await page.keyboard.press("Enter");
   await page.waitForSelector("#screen-browser.active .item.focused");
   await page.keyboard.press("Enter"); // first ROM
   await page.waitForSelector("body.playing", { timeout: 180000 });
   await page.waitForTimeout(6000);
   await shot("1-game");
   // RGUI's background is a dark grey checkerboard; nestest is purple on
   // black, and switches its test page on a short Select press.
   const menuShare = (png) => page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] === d[i + 1] && d[i] === d[i + 2] && d[i] >= 20 && d[i] <= 60) n++;
      return n / (d.length / 4);
   }, png.toString("base64"));
   await page.evaluate(() => window.__padButton(8, true));
   await page.waitForTimeout(500);
   const short = await menuShare(await shot("2-select-short"));
   if (short > 0.05) throw new Error("menu opened before Select was held for 2 seconds");
   await page.waitForTimeout(2500);
   await page.evaluate(() => window.__padButton(8, false));
   await page.waitForTimeout(1000);
   const held = await menuShare(await shot("3-select-held"));
   if (held < 0.3) throw new Error("holding Select did not open the menu");
}, fakePad);

await scenario("n64", siteUrl + "?fps=1", async (page, shot) => {
   await page.click('.tile:has-text("Nintendo 64")');
   await page.waitForSelector("#screen-source.active");
   await page.keyboard.press("Enter"); // network folder
   await page.waitForSelector("#screen-url.active");
   await page.fill("#url-input", romUrl);
   await page.keyboard.press("Enter");
   await page.waitForSelector("#screen-browser.active .item.focused");
   await page.keyboard.press("Enter");
   await page.waitForSelector("body.playing", { timeout: 180000 });
   await page.waitForTimeout(15000);
   await shot("1-game");
   await page.waitForTimeout(30000);
   await shot("2-game-later");
   await remoteKey(page, 403); // red key -> RetroArch menu
   await page.waitForTimeout(2000);
   await shot("3-menu");
});

await browser.close();
process.exit(failed ? 1 : 0);
