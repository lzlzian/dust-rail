# Dust Rail — on-rails mobile shooter feel prototype

A throwaway web prototype for de-risking six questions about a portrait, on-rails, arcade FPS:
it uses a Gunfire Reborn / Borderlands-ish look built **entirely from code primitives**, with no art assets.
Three.js r186 is vendored, there's no build step, and all audio is synthesized at runtime.

## Run it

**Live build:** https://lzlzian.github.io/dust-rail/. Open it on any phone. It's HTTPS, so iOS will also allow the gyro permission prompt. Pushing to `main` redeploys it.

Locally:

```
node serve.mjs
```

- Desktop: http://localhost:8000. Use **⚙ → Simulated frame → Portrait 9:19.5** to get a phone-shaped frame.
- Phone on the same network: open the `phone (same network)` URL the server prints, typed as `http://…` (not https). Every request from another device is logged in the server console. If nothing gets logged when the phone loads the page, the request is being blocked before it reaches Node:
  - The phone must be on the same router and not a guest network. Its Wi-Fi IP should start with the same three numbers, e.g. `10.0.0.x`. Turn off any phone VPN.
  - Windows: set the network to **Private** (Settings → Network & internet → Ethernet → Network profile type), or from an admin terminal run `netsh advfirewall firewall add rule name="Dust Rail 8000" dir=in action=allow protocol=TCP localport=8000`.
  - Some routers isolate Wi-Fi clients from wired ones. If the PC is on Ethernet, try joining the PC to the same Wi-Fi instead.
  - Android over USB as a fallback: `adb reverse tcp:8000 tcp:8000`, then open `http://localhost:8000` on the phone.
- Android Chrome goes fullscreen on START and supports haptics. iOS Safari has no `navigator.vibrate`; use Share → *Add to Home Screen* for fullscreen.
- Desktop keys: `1-5` guns, `R` reload, `Tab` cycle scheme, `Space` hold cover, `Q` grenade, `E` focus, `F` heal, `A`/`D` or arrows to pan.

**START RUN** plays 5 on-rails encounters ending in a boss. Each stop is split into arcade camera **beats**: the front, then left/right flank sub-encounters. When a beat is cleared (the lull), a cue points to the next angle and the camera pans there; it then returns to the front, crosses to the other flank, or moves on down the rail. **SHOOTING RANGE** is endless and mixes every enemy type, which makes it the place for A/B testing guns and schemes.

## Where each question lives

All of these are in **⚙ Test bench**. Settings persist in localStorage, and opening the panel pauses the game.

| # | Question | What to try |
|---|----------|-------------|
| 1 | Portrait framing | Rotate the phone, or switch the simulated frame. Toggle **target px** to see real on-screen sizes of heads and bodies. Change *FOV fit* and *hFOV*. **1b · Looking around**: *Camera* = arcade beats (default), auto-frame director, or manual only. Also pan speed, the cue before a pan, edge push, gyro, and arrows for off-screen enemies. |
| 2 | Gun controls | Tap the **scheme chip** above the ammo counter to cycle schemes live. **Trackpad** (the Nikke-style drag reticle) is available on every gun. Tune reticle offset, assist and sensitivity. |
| 3 | Shooting projectiles | Rockets, boss missiles, grenades and drone bolts can all be shot down. The bracket around each one is its true hit area. Tune *projectile hitbox size*, *assist bonus* and *speed*. |
| 4 | Charge-up telegraphs | Heavies (blue cannon), snipers (red laser) and the boss beam. Turn layers off one at a time. Interrupt a charge by dealing damage; the glowing core counts double. Spawn buttons are in the panel. |
| 5 | Juice | Drag master from 0 to 1, or isolate any of the 15 layers. Each gun has its own juice profile in `src/config.js`, and its own reload foley in `src/foley.js` (`node tools/foley-check.mjs` renders every reload to WAV + a spectrogram PNG in `shots/foley/`). |
| 6 | HUD real estate | Three layouts (bottom bar / thumb arc / side rails), button size, thumb-reach overlay (right / left / both). |

**STATS** (in the panel and on the end screen) records accuracy and crits per gun, which schemes fired how many shots, projectile intercept %, charge interrupts vs. hits, and damage taken by source. **Copy stats JSON** after each playtester's run to compare schemes.

## Control schemes

| Scheme | Input | Best guess for |
|--------|-------|----------------|
| Tap to shoot | each tap = one shot at the finger (light gun), multi-finger OK | revolver, shotgun |
| Tap = burst | each tap = N-round burst at the finger | AR |
| Hold & sweep | hold to fire at a reticle *offset above* the finger, drag to sweep | SMG |
| Paint & release | drag over targets to tag them, release to unload a volley | SMG / AR alt |
| Trackpad + auto-trigger | drag a persistent reticle; it fires when on target | accessibility / casual |
| Trackpad | persistent reticle, drag anywhere to move it relatively (Nikke style). SMG/AR: hold = fire. Revolver/shotgun/sniper: hold = aim, release = fire (below) | every gun |
| Scope | press = zoom where you touched, drag = fine aim, release = fire | sniper |

### Trackpad on the precision guns: hold to aim, release to fire, each in its own way

| Gun | While held | Release | Its job |
|-----|------------|---------|---------|
| Sniper | scopes in on the reticle (3.5×, sway); drag = fine aim | one piercing shot; the reticle stays on that spot | long range, weak points, lines of enemies |
| Revolver | **dead-eye**: time slows; sweep the reticle over targets, dwelling marks one round each (dwell longer to stack) | fans the hammer through every mark; a quick tap is one fast shot | clearing a group of weak enemies / rockets in one press |
| Shotgun | **choke**: the pattern visibly tightens over 0.5 s (reticle ring shrinks, clicks when tight) | 9 pellets at that spread; tight patterns also lose less damage with range | tap = wide close blast, hold = mid-range slug |

Bench (2 · Gun controls) can switch these back to hold-to-fire and tunes dead-eye slow-mo, mark dwell and max hold. Releasing while the pump or bolt is still cycling queues the shot.

## What the headless runs showed (not a substitute for thumbs on glass)

Measured in a 390×844 portrait viewport (iPhone 12–15 class):

- **Targets are small in portrait.** With hFOV 60° the vertical FOV is ~103°. A bandit's head is about 24 px across at 10 m and about 11 px at 20 m; drone heads are 6–9 px. A finger pad is about 40–50 px. So combat has to happen at roughly 8–15 m, targets need to be chunky, and aim assist (default 34 px, biased toward bodies) carries a lot of weight. Encounters were restaged closer after this measurement.
- **Portrait's tall view is an asset if you design for it.** Towers, rooftops, flyers and a *tall* boss fill the upper half that a flat corridor would leave as empty sky. The boss was scaled up 1.45× to use it.
- **Landscape needs its own FOV fit and HUD.** Horizontal-fit FOV in landscape gives a 30° vertical slit, so the default is now *auto* (portrait: fixed hFOV; landscape: fixed vFOV 56°). The bottom-bar HUD takes ~15% of portrait height but ~33% of landscape height, and there the weapon strip covers enemies.
- **Projectile hits at the lens must stay small.** A full-size explosion 1.6 m in front of the camera hid the whole screen. Player hits now use a small burst, and the vignette, shake and direction arc tell the player they were hit.
- **Portrait only shows ±30° side to side** at hFOV 60°. The encounters are now staged as arcade beats: every beat keeps its enemies inside ±22° of its camera angle (measured: all enemies land between 20% and 81% of the screen width), and wider set pieces become flank beats the camera pans to at a lull. The earlier director camera, which auto-framed threats as they appeared, is still in the bench for comparison.
- **Telegraphs:** with all layers on, a charging heavy is unmissable even in a busy frame. The open question is which layers you can *remove*.

## Code map

```
src/config.js      weapons (stats + per-gun juice), schemes, persisted settings
src/main.js        boot, frame sizing, loop, screens
src/input.js       pointer → scheme state machines
src/weapons.js     firing, damage, viewmodels, recoil, shells
src/combat.js      ray vs. hitbox spheres / cover boxes, screen-space aim assist
src/enemies.js     8 enemy types incl. boss; charge-up telegraph layers
src/projectiles.js shootable rockets/missiles/grenades/bolts, player grenade
src/level.js       canyon built from primitives, encounters, rail motion, range
src/hud.js         DOM HUD + overlay canvas (reticles, numbers, rings, markers)
src/fx.js          pooled particles, tracers, decals, debris, camera trauma
src/audio.js       synthesized SFX + foley playback
src/foley.js       per-gun reload/pump/bolt foley, rendered sample by sample (hits, scrapes, springs, brass)
src/debug.js       test bench panel + stats
```

`window.DR` exposes game state for console poking, e.g. `DR.spawnAhead('heavy')`.
