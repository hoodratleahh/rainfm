# rainfm

[Rain](https://github.com/ra1ncord/rain) (Discord client mod for iOS/Android) built with an extra **FakeMessage** plugin.

FakeMessage adds fake messages and call logs from other users to your own chat view. It runs only on your device: the messages go into Discord's local message list and are never sent, so nobody else sees them.

## Release files

The [v1 release](https://github.com/hoodratleahh/rainfm/releases/tag/v1) contains:

- `rain.98.hbc`: Rain + FakeMessage as Hermes bytecode v98 (what RainTweak loads)
- `rain.js`: the same build as plain JavaScript

Both are built from upstream Rain `main` at commit [`4b091e1`](https://github.com/ra1ncord/rain/commit/4b091e1) (v0.10.0), with `source/src/plugins/fakemessage/` added. Nothing else is changed.

## Using it

- **Options page:** Rain → Plugins → FakeMessage. Pick a user, type a message or choose a call log, set minutes ago, then tap Add.
- **Long-press a message:** "Fake Message As <name>". Long-press a fake: "Remove Fake Message".
- **Commands:** `/fakemessage`, `/fakecall`, `/fakeclear`.

## Build it yourself

1. Clone `ra1ncord/rain` at `4b091e1`.
2. Copy `source/src/plugins/fakemessage` into `src/plugins/`.
3. Run `npm install --ignore-scripts`.
4. Run `node scripts/build.mjs --release-branch=main --build-bytecode` (needs `hermesc` from `node_modules/hermes-compiler` on PATH).

## Credits and license

The plugin idea comes from [elioflex/fakeMessage](https://github.com/elioflex/fakeMessage) (Vencord). This is a separate implementation for Rain's plugin API.

Rain is licensed under the Mozilla Public License 2.0 (see `LICENSE`). Its source is available upstream at the commit above.

## Responsible use

Use it for pranks, mockups and tutorials. Don't use it to fake evidence, scam, harass or impersonate anyone. Client mods are against Discord's Terms of Service, so use it at your own risk.
