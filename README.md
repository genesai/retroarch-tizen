# RetroArch for Tizen

This is a fork of [Sype0/retroarch-tizen](https://github.com/Sype0/retroarch-tizen) with gamepad fixes
(controllers work in games after being used in the launcher, a Controller test screen, hold Select for the
menu) and Game Mode.

RetroArch for Samsung Tizen smart TVs. It adds a TV-specific layer on top of the
[libretro web player](https://web.libretro.com/) (RetroArch compiled to WebAssembly):

- Launcher you drive with the TV remote (pick a system → pick a ROM → play)
- Remote keys mapped to RetroArch controls, USB/Bluetooth gamepad support with a Controller test screen
- Load ROMs from a **USB drive** or a **network folder** (HTTP)
- Asks the TV for Game Mode (2022 and later models) for less input lag
- Lightweight RGUI menu and defaults tuned for TVs
- Saves and settings persist on the TV (IndexedDB)

## Installation

Install with [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) (TV in Developer Mode):

- add `github.com/genesai/retroarch-tizen` under **Your own sources**, then install and update
  RetroArch from the catalog like any other app, or
- download `RetroArch.wgt` from the [Releases](https://github.com/genesai/retroarch-tizen/releases)
  page and install it as your own `.wgt`.

Apps2Samsung signs the package with your own certificate. The app id is `RtArchTzn0.RetroArch`, the
same as upstream, so it replaces an upstream install signed with the same certificate. A
[Vetro](https://github.com/andrearicci93/vetro) launcher can start it like any other installed app.

The app runs on the TV; the emulator cores (wasm) and RetroArch's files are downloaded from
<https://genesai.github.io/retroarch-tizen/> when you start them, so the TV needs internet access.

## Loading ROMs

**Network folder:** on the computer or phone that has your ROMs (Termux works too):

```sh
python3 tools/rom-server.py /path/to/roms
```

Enter the address it prints (e.g. `http://192.168.1.20:8000/`) on the TV under
*Load ROM from network folder*. The address is remembered.

**USB:** copy the ROMs to a USB drive, plug it into the TV, choose *Load ROM from USB drive*.

## Remote control (in game)

| Key | Action |
| --- | --- |
| Arrow keys | D-Pad |
| OK | A (confirm in menus) |
| Back | B (back in menus) |
| Red / 0 | RetroArch menu |
| Green / Yellow | Start / Select |
| Blue / 2 | X / Y |
| 1 / 3 | L / R |
| CH+ / CH− | Save / load state |
| Play/Pause | Pause |

To leave a game, choose **Quit RetroArch** in the menu.

## Gamepads

USB and Bluetooth controllers that the TV passes on to apps work in the launcher and in games. On a
controller, hold **Select** for 2 seconds to open the RetroArch menu (not Start, which switches
8BitDo controllers off). **Controller test** on the home screen lists every controller the TV
reports, whether it uses the standard button layout, and the buttons and sticks as you press them. If a controller is missing there, try another of its modes (for
8BitDo controllers: hold Start with B, X, Y or A while switching it on) and pair it again. A controller
without the standard layout can be remapped under *Settings → Input → RetroPad Binds*.

Buttons go by position, as on a SNES pad: B at the bottom confirms and A on the right goes back, in
the launcher and in RetroArch's menu. Some controllers with a Nintendo layout number their buttons by
the printed letter instead, so A and B (and X and Y) come out swapped; the 8BitDo SF30 Pro in Android
mode does this on Samsung TVs and is swapped back automatically. For any other controller, press
**Select** on it on the Controller test screen to swap its face buttons; the choice is remembered per
controller model.

## Systems

NES, SNES, Game Boy / Color / Advance, Sega Master System / Game Gear / Mega Drive / CD / 32X,
PlayStation, PC Engine, Arcade (FBA 2012 CPS-1/2/Neo Geo, MAME 2003-Plus, FinalBurn Neo),
Atari 2600 / Lynx, Neo Geo Pocket, WonderSwan, Virtual Boy, Doom. Full list: [`tools/cores.txt`](tools/cores.txt).

**Nintendo 64 (experimental):** libretro doesn't build N64 for the web, so this repo builds
Mupen64Plus-Next from source ([`extra-cores.yml`](.github/workflows/extra-cores.yml)). WebAssembly has
no dynarec, so the emulator runs as an interpreter; on a TV CPU most 3D games (Ocarina of Time
included) run below full speed. To see the frame rate: RetroArch menu → *Settings → On-Screen Display →
Notification → Display Framerate*.

## Compatibility

The libretro web build needs Chromium 85+: **Tizen 6.5 or newer (2022 and later models)**.
On older TVs the launcher opens but the cores fail (the error is shown at the bottom of the screen).
PlayStation and large arcade games may be slow depending on the TV's CPU. ROMs are loaded into memory,
so very large CD images (hundreds of MB) can cause problems.

## How it works / building

`.github/workflows/build.yml`:

1. Downloads the cores listed in `tools/cores.txt` from web.libretro.com and turns their ES modules
   into classic scripts (so they also load from `file://` inside the .wgt).
2. Trims RetroArch's 133 MB asset bundle down to what is needed (core info, autoconfig, RGUI, shaders).
3. Adds the cores built from source in the `extra-cores` prerelease (N64).
4. Publishes `app/` + cores + bundle to GitHub Pages.
5. Builds a signed `RetroArch.wgt` with [tizen.js](https://github.com/reisxd/tizen.js); a `v*` tag creates a Release.
6. Runs headless Chromium smoke tests ([`tools/smoke-test.mjs`](tools/smoke-test.mjs)): booting a core,
   loading a ROM from a network folder, cross-origin assets as in the .wgt, a controller used in the
   launcher and then in game, and N64.

`extra-cores.yml` builds cores that the libretro buildbot doesn't ship for the web, together with
RetroArch master, using Emscripten ([`tools/extra-cores/build-core.sh`](tools/extra-cores/build-core.sh)):
symbols in the core's copy of libretro-common that clash with RetroArch are renamed automatically, and
libco gets an Emscripten fiber backend ([`libco_emscripten_fiber.c`](tools/extra-cores/libco_emscripten_fiber.c),
linked with Asyncify).

The release `.wgt` is signed with the repo secrets `TIZEN_AUTHOR_P12` (base64 PKCS#12) and
`TIZEN_AUTHOR_PASSWORD`, or a throwaway certificate without them; Apps2Samsung re-signs it with yours.
Until this repo has its own `extra-cores` release, the build takes those cores from
[Sype0/retroarch-tizen](https://github.com/Sype0/retroarch-tizen)'s.

To try it locally, serve the `app/` folder with any web server; the `?base=https://genesai.github.io/retroarch-tizen/`
parameter loads the cores from GitHub Pages, and `?fps=1` shows RetroArch's frame counter.

## License

GPLv3. RetroArch and the libretro cores are under their own licenses
([RetroArch](https://github.com/libretro/RetroArch), [libretro](https://www.libretro.com/)).
This project is not affiliated with the libretro team. No ROMs are included; only use games you own.
