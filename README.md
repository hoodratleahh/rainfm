# rainfm

[Rain](https://github.com/ra1ncord/rain) (Discord client mod for iOS/Android) built with an extra **LocalMessagePreview** plugin.

LocalMessagePreview lets you inject fake messages and swap user profiles locally. Everything runs only on your device: nothing is sent to Discord, so nobody else sees any of it.

## What it does

- **Presets** — create named presets with a target user, channel, and one or more message variants. "Send now" injects all variants at once and caches them.
- **Cache & replay** — injected messages survive app restarts if you keep the auto-replay option on.
- **Profile swap** — long-press a user's profile → "Swap profile" to make all their messages appear as if they came from someone else (enter the target user ID). Tap again to reset.

## Release files

The [v1 release](https://github.com/hoodratleahh/rainfm/releases/tag/v1) contains:

- `rain.98.hbc`: Rain + LocalMessagePreview as Hermes bytecode v98 (what RainTweak loads)
- `rain.js`: the same build as plain JavaScript

Both are built from upstream Rain `main` at commit [`4b091e1`](https://github.com/ra1ncord/rain/commit/4b091e1) (v0.10.0), with `source/src/plugins/localmessagepreview/` added. Nothing else is changed.

## Using it

- **Settings page:** Rain → Plugins → LocalMessagePreview → tap to open settings.
  - Under **Presets**, tap "Add preset" to create one, then set a channel ID, target user ID, and message variants. Tap "Send now" to inject.
  - Under **Cache & replay**, toggle auto-replay and replay or clear the cache.
- **Profile swap:** long-press any user's profile image or username → overflow menu → "Swap profile" (or "Quick local message"). Enter the target user ID, tap Apply.

## Build it yourself

1. Clone `ra1ncord/rain` at `4b091e1`.
2. Copy `source/src/plugins/localmessagepreview` (including all files) into `src/plugins/`.
3. Run `npm install --ignore-scripts`.
4. Run `node scripts/build.mjs --release-branch=main --build-bytecode` (needs `hermesc` from `node_modules/hermes-compiler` on PATH).

## Installing on iPhone (RainTweak / LiveContainer)

**Option A — Load Custom Bundle (easiest):**
1. Inside Discord, shake the phone → **Load Custom Bundle** → paste:
   `https://raw.githubusercontent.com/hoodratleahh/rainfm/main/rain.js`
2. Discord closes. Open it, wait ~10 seconds, fully close it, reopen.
3. Rain → About should show `v0.10.0-lmp`.
4. Rain → Plugins → LocalMessagePreview → turn it on.

**Option B — replace bundle.js directly:**
1. Download `rain.98.hbc` from the v1 release.
2. Files app → On My iPhone → Discord → rain → rename `bundle.js` to `bundle.js.orig`, then rename your download to `bundle.js`.
3. Fully close Discord and reopen. Enable the plugin under Plugins.

## Credits and license

Rain is licensed under the Mozilla Public License 2.0 (see `LICENSE`). Its source is available upstream at the commit above.

## Responsible use

Use it for pranks, mockups and tutorials. Don't use it to fake evidence, scam, harass or impersonate anyone. Client mods are against Discord's Terms of Service, so use it at your own risk.
