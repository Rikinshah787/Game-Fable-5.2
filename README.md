# FOG CITY

An open-world crime game set in a compact, San Francisco-inspired city. It runs in the browser with Three.js and has no build step.

## Run it

```
npm start
```

Then open http://localhost:8765. Any static file server works; the game cannot run from a `file://` URL because it loads ES modules.

Add `?sky=sunset` to the URL for a golden-hour sky.

## Controls

| Key | On foot | In a car |
| --- | --- | --- |
| W A S D | Move | Accelerate, steer, brake / reverse |
| Mouse | Look | Orbit the camera |
| Shift | Sprint | |
| Space | Jump | Handbrake |
| F | Get in the nearest car | Get out |
| Left click | Shoot | |
| Right click | Aim | |
| 1 / 2 / Q / wheel | Switch weapon | |
| R | Reload | |
| H | | Horn |
| M | Mute | Mute |
| Esc | Pause | Pause |

## What is in it

- A 7 x 7 block city on hills, with a financial district, painted row houses, a waterfront boulevard, piers and parks.
- A drivable suspension bridge to a headland, a prison rock in the bay, a hilltop lookout tower and a pyramid tower downtown.
- Traffic that follows lanes and obeys signals, pedestrians who flee from gunfire, and parked cars you can take.
- A five-star wanted system: police cars chase you, officers get out and shoot, and the stars clear once you stay out of sight.
- Courier jobs for cash, cars that catch fire and explode, a rotating minimap, and fully synthesised sound.
- Photographic building fronts on the row houses and low-rise blocks, rooftop billboards for invented local brands, a cable car on the hill line and a city bus.

## Layout

| File | Purpose |
| --- | --- |
| `src/main.js` | Boot, input, player, camera, HUD, main loop |
| `src/city.js` | Terrain, streets, buildings, facade shader, collision queries |
| `src/landmarks.js` | Bridge, headland, piers, island, towers |
| `src/props.js` | Palms, street lamps, traffic signals, parks, parking |
| `src/vehicle.js` | Car model set-up and driving physics |
| `src/chars.js` | Animated characters and animation retargeting |
| `src/sim.js` | Traffic, pedestrians, police, wanted level, jobs |
| `src/transit.js` | Cable car and bus on fixed routes |
| `src/guns.js` | Pistol and SMG models |
| `src/decals.js` | Bullet holes and tyre marks |
| `src/screens.js` | LED advert screens downtown (plays `assets/gen/ad<N>.mp4` when listed in `VIDEO_ADS`) |
| `src/fx.js`, `src/audio.js`, `src/post.js` | Particles, sound synthesis, post-processing |

## Third-party assets

- Building-front photos, billboards, tram and bus textures and the key art in `assets/gen/`: generated for this project with [Higgsfield](https://higgsfield.ai) (GPT Image 2.6). The shop names and brands on them are invented.
- Sky HDRIs and surface textures: [Poly Haven](https://polyhaven.com), CC0.
- Car model (`assets/ferrari.glb`), character models (`Soldier.glb`, `Michelle.glb`, `rpm.glb`) and `waternormals.jpg`: from the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf). Check each model's licence there before publishing or selling the game. The car is a real manufacturer's design; replace it before any commercial release.
- [three.js](https://threejs.org), MIT.

The city, its characters and its name are original. This project is not affiliated with any commercial game.
# Game-Fable-5.2
