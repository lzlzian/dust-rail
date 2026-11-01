# Dust Rail — on-rails mobile shooter feel prototype

A throwaway web prototype for de-risking six questions about a portrait, on-rails, arcade FPS:
it uses a Gunfire Reborn / Borderlands-ish look built **entirely from code primitives**, with no art assets.
Three.js r186 is vendored, there's no build step, and all audio is synthesized at runtime.

## Run it

**Live build:** https://lzlzian.github.io/dust-rail/. Open it on any phone. Pushing to `main` redeploys it.

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
- Desktop keys: `1-5` guns, `R` reload, `Space` hold cover, `Q` grenade, `E` focus, `F` heal. The mouse works as the trackpad.

**START RUN** plays 5 on-rails encounters ending in a boss. Each stop is split into arcade camera **beats**: the front, then left/right flank sub-encounters. When a beat is cleared (the lull), a cue points to the next angle and the camera pans there; it then returns to the front, crosses to the other flank, or moves on down the rail. **SHOOTING RANGE** is endless and mixes every enemy type, which makes it the place for A/B testing guns.

## Where each question lives

All of these are in **⚙ Test bench**. Settings persist in localStorage, and opening the panel pauses the game.

| # | Question | What to try |
|---|----------|-------------|
| 1 | Portrait framing | Rotate the phone, or switch the simulated frame. Toggle **target px** to see real on-screen sizes of heads and bodies. Change *FOV fit* and *hFOV*. **1b · Camera beats**: pan speed, the cue before a pan, arrows for off-screen enemies. |
| 2 | Gun controls | One scheme, trackpad aim with aim-down-sights (below). Tune drag sensitivity, aim assist, recoil climb, spread pattern; sights on/off, iron-sight drag sensitivity, raise time and zoom; scope sensitivity and sway. |
| 3 | Shooting projectiles | Rockets, boss missiles, grenades and drone bolts can all be shot down. The bracket around each one is its true hit area. Tune *projectile hitbox size*, *assist bonus* and *speed*. |
| 4 | Charge-up telegraphs | Heavies (blue cannon), snipers (red laser) and the boss beam. Turn layers off one at a time. Interrupt a charge by dealing damage; the glowing core counts double. Spawn buttons are in the panel. |
| 5 | Juice | Drag master from 0 to 1, or isolate any of the 15 layers. Each gun has its own juice profile in `src/config.js`, and its own reload foley in `src/foley.js` (`node tools/foley-check.mjs` renders every reload to WAV + a spectrogram PNG in `shots/foley/`). |
| 6 | HUD real estate | Three layouts (bottom bar / thumb arc / side rails), button size, thumb-reach overlay (right / left / both). |

**STATS** (in the panel and on the end screen) records accuracy and crits per gun, projectile intercept %, charge interrupts vs. hits, and damage taken by source. **Copy stats JSON** after each playtester's run to compare.

## Controls: trackpad aim

Nikke-style: the reticle stays wherever you left it. Touch anywhere and drag to move it relatively, like a laptop trackpad, so your thumb never covers the target. (The other schemes we tried — tap, tap-burst, offset hold & sweep, paint & release, auto-trigger, touch-to-scope — are still in commit `56b790c` if you want them back.) The reticle starts at screen centre and glides back there on every scene change (a new area, a beat pan).

**Aim down sights.** Every gun except the SMG has a sight. Holding raises it: the view turns onto the reticle and zooms, the gun slides in until its sight line runs down the middle of the screen, and from then on the sight *is* the reticle; dragging turns the view. Letting go lowers it and leaves the reticle on the spot you were aiming at. Sights are data (`sight` in `src/config.js`: type, zoom, raise time, accuracy). Today they're iron sights (`iron`, the 3D gun's own notch/peep/bead) and the sniper's `scope` overlay. A red dot or holo sight would be another type.

| Gun | Hold | Release | Its job |
|-----|------|---------|---------|
| SMG | hip fire from the reticle, instantly | stops | hoses crowds and drones; the only gun with no raise delay |
| AR | raises the peep sight (1.5×, 0.17 s), then fires; ~half the spread while sighted, climb lifts the view | lowers | controlled mid-range |
| Revolver | raises notch & blade (1.35×, 0.12 s), then fires | lowers | hits hard and slow, quick to the sights |
| Shotgun | down the rib to the bead (1.15×) + **choke**: the pattern ring at the bead shrinks over 0.5 s, clicks when tight | 9 pellets at that spread; tight patterns lose less damage with range | tap = wide close blast, hold = mid-range slug |
| Sniper | scopes in on the reticle (3.5×, sway); drag = fine aim | one piercing shot; the reticle stays on that spot | long range, weak points, lines of enemies |

The bench's *Hold raises sights* switch turns the AR/revolver/shotgun back into hip-fire guns for A/B. Releasing while the pump or bolt is still cycling queues the shot. If the gun runs dry mid-hold, the sights drop for the reload and come back up by themselves if you're still holding. Ammo rides on the reticle: an arc of rounds (or a bar and count for big mags) that turns yellow when low and red on the last rounds; reloading shows a progress ring and RELOADING under the reticle. A revolver dead-eye (time slows, sweep to mark targets, release to fan them) was prototyped in commit `56b790c` and set aside as a future ability.

## What the headless runs showed (not a substitute for thumbs on glass)

Measured in a 390×844 portrait viewport (iPhone 12–15 class):

- **Targets are small in portrait.** With hFOV 60° the vertical FOV is ~103°. A bandit's head is about 24 px across at 10 m and about 11 px at 20 m; drone heads are 6–9 px. A finger pad is about 40–50 px. So combat has to happen at roughly 8–15 m, targets need to be chunky, and aim assist (default 34 px, biased toward bodies) carries a lot of weight. Encounters were restaged closer after this measurement.
- **Portrait's tall view is an asset if you design for it.** Towers, rooftops, flyers and a *tall* boss fill the upper half that a flat corridor would leave as empty sky. The boss was scaled up 1.45× to use it.
- **Landscape needs its own FOV fit and HUD.** Horizontal-fit FOV in landscape gives a 30° vertical slit, so the default is now *auto* (portrait: fixed hFOV; landscape: fixed vFOV 56°). The bottom-bar HUD takes ~15% of portrait height but ~33% of landscape height, and there the weapon strip covers enemies.
- **Projectile hits at the lens must stay small.** A full-size explosion 1.6 m in front of the camera hid the whole screen. Player hits now use a small burst, and the vignette, shake and direction arc tell the player they were hit.
- **Portrait only shows ±30° side to side** at hFOV 60°. The encounters are now staged as arcade beats: every beat keeps its enemies inside ±22° of its camera angle (measured: all enemies land between 20% and 81% of the screen width), and wider set pieces become flank beats the camera pans to at a lull. An earlier director camera that auto-framed threats, plus edge-push and gyro look, were tried and dropped; they're still in commit `56b790c`.
- **Telegraphs:** with all layers on, a charging heavy is unmissable even in a busy frame. The open question is which layers you can *remove*.

## Code map

```
src/config.js      weapons (stats, hold behaviour, per-gun juice), persisted settings
src/main.js        boot, frame sizing, loop, screens
src/input.js       pointer → trackpad aim, aim-down-sights, reticle re-centring
src/weapons.js     firing, damage, viewmodels (incl. iron sights + ADS pose), recoil, shells
src/combat.js      ray vs. hitbox spheres / cover boxes, screen-space aim assist
src/enemies.js     8 enemy types incl. boss; charge-up telegraph layers
src/projectiles.js shootable rockets/missiles/grenades/bolts, player grenade
src/level.js       canyon built from primitives, encounters split into camera beats, rail motion, range
src/hud.js         DOM HUD + overlay canvas (reticles, ammo arc, numbers, rings, markers, beat cues)
src/fx.js          pooled particles, tracers, decals, debris, camera trauma
src/audio.js       synthesized SFX + foley playback
src/foley.js       per-gun reload/pump/bolt foley, rendered sample by sample (hits, scrapes, springs, brass)
src/debug.js       test bench panel + stats
```

`window.DR` exposes game state for console poking, e.g. `DR.spawnAhead('heavy')`.
