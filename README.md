# Room Studio

Design two connected exhibition rooms in the browser: shape the rooms, cut a doorway between them, place shapes and exhibition objects, and dress any surface with your own images. Runs entirely client-side (Vite + Three.js, vanilla JavaScript, no backend) and works on phones and laptops.

**Status:** All three phases are built: Studio mode, the walk-through (game mode), and animated characters. See [docs/SPEC.md](docs/SPEC.md).

## Run it

You need Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

### Pages

| URL | Opens |
| --- | --- |
| `/` | Redirects to `/play` |
| `/play` | The walk-through (game mode) |
| `/studio` | The editor. Its **▶ Play** button goes to `/play`, and **Exit** in the game comes back. |

Behind a sub-path, the same pages live under it: `/v1/` → `/v1/play`, plus `/v1/studio`. Use these paths without a trailing slash (`/play`, not `/play/`), because the page loads its files relative to the URL. Browser back and forward switch between the two pages.

### On your phone

The dev server listens on your local network. Connect your phone to the same Wi-Fi as your computer, then open the **Network** URL Vite prints, such as `http://192.168.1.20:5173`.

### Production build

```bash
npm run build     # outputs to dist/
npm run preview   # serves dist/ locally
```

`dist/` is a static site, so you can host it anywhere (Netlify, GitHub Pages, any web server).

### Docker

The image builds the site with Node, then serves it with nginx. The final image is about 50 MB and has no Node.js inside.

```bash
docker compose up -d --build     # http://localhost:8080
PORT=3000 docker compose up -d   # use a different host port
docker compose down              # stop
```

Without Compose:

```bash
docker build -t room-studio .
docker run -d -p 8080:80 --name room-studio room-studio
```

`nginx.conf` caches the hashed files in `/assets/` for a year and makes browsers recheck `index.html` on every visit, so a redeploy shows up right away. Each image build is a new release, which clears visitors' old autosave once (see Saving). To name a release, add `--build-arg BUILD_ID=v1.2.0`. If the source hasn't changed, Docker reuses the cached build, which keeps the same ID and clears nothing. The app has no server state, so you can run as many containers as you like behind a load balancer.

**Serving under a sub-path** (e.g. `https://base.domain.com/v1/`): the build uses relative asset URLs, so the same image works at the root or under any path. Two things to check on the reverse proxy:
- Strip the prefix before forwarding, so the container receives `/assets/...` and not `/v1/assets/...`. In nginx, that's `location /v1/ { proxy_pass http://room-studio:80/; }`. The trailing `/` on `proxy_pass` is what strips the prefix.
- Redirect `/v1` to `/v1/`. Without the trailing slash, the browser resolves `./assets/...` against the domain root, and the files 404.

**On phones, serve it over HTTPS.** Browsers only allow motion-sensor access (needed for Phase 2's optional gyroscope look) on secure origins. Put the container behind a reverse proxy that handles TLS (Caddy, Traefik, or your platform's load balancer).

## Using the studio

| Action | Mouse | Touch |
| --- | --- | --- |
| Rotate view | Left-drag | One-finger drag |
| Zoom | Scroll | Pinch |
| Pan | Right-drag | Two-finger drag |
| Select object | Click it | Tap it |
| Deselect | Click empty space or press `Esc` | Tap empty space |
| Move / rotate / scale | Drag the gizmo; `W` / `E` / `R` switch modes | Drag the gizmo; Move / Rotate / Scale buttons |
| Delete | `Delete` or the Delete button | Delete button |

On a phone, the panels live in a bottom drawer. Use **Room**, **Add** and **Edit** to switch panels, and **☰** to hide or show the drawer. In landscape, the drawer opens on the right.

### Rooms

- Switch rooms with the tabs at the top. Double-click a tab, or use the Name field, to rename a room.
- **Edit corners:** drag the blue corners. Tap a white midpoint dot, or tap a wall, to add a corner. Select a corner and press **Delete corner** to remove it (a room needs at least 3).
- **Wall height** and **Thickness** sliders rebuild the walls live.
- **Move room:** drag the arrows, or type X/Z, to line the rooms up.
- **See-through** (top bar) fades the walls between you and the room interior.

### Doorways

- **+ Add doorway**, then tap a wall. The opening is cut through every room wall on that line, so a door on a shared wall appears in both rooms.
- Adjust position, width and height with the sliders. If the rooms aren't lined up, the doorway shows **Not on a shared wall**.

### Shapes and objects

- **Shapes:** box, cylinder, sphere, triangle prism, and **Custom…**. For a custom shape, tap points on the floor, then tap the first point (or press **Close shape**) to finish. Set its height in the Edit panel.
- Every shape except the sphere is stored as a point list, so **Edit points** lets you reshape it later.
- **Objects:** poster and projector screen (placed on the nearest wall), table, stage (an editable platform), projector, and X-banner (a free-standing 60 × 160 cm banner on crossed poles).
- **Person:** an extra animated character you can place, like a guide or another visitor. (In the walk-through you play as the same character model.) In the studio it stands in its idle pose. In the walk-through it either stands still (idle animation) or walks back and forth along the direction it faces (**Walk distance**, 1–10 m). It turns and waves when a visitor comes within about 2 m (you can switch this off). You can change its colour. The model downloads only when a project contains a person.

### Image fill

Floors, walls, shapes, the stage, posters, screens and X-banners can show an uploaded image. On a phone, **Upload image** opens your photo library.

- **Fit:** stretch, cover, contain (with a background colour), or tile (with a repeat count).
- **Adjust:** offset X/Y, scale, rotate, flip H/V, and reset. Changes preview live.
- **Apply to** (shapes only): all faces, the top only, or the sides only.
- Uploads are resized to at most 1024px. Surfaces that use the same image share one GPU texture, which is freed when nothing uses it any more.

### Saving

- **Save** downloads `room-studio.json` with both rooms, all objects (shapes as point lists) and the images they use.
- **Open** loads a saved file. **New** starts over from the default layout.
- The default layout is [src/default-project.json](src/default-project.json). To change it, design a layout, **Save** it, and replace that file with your saved file.
- Your work is also autosaved in the browser. Very large projects may skip the autosave, so use **Save** for anything you want to keep.
- **After a new release, the autosave is cleared.** Every production build has its own build ID. On the first visit after a release, the browser deletes its old autosave and loads the new default layout, with a short "Updated to a new version" notice. Save a file first if you want to keep an older layout. Game settings (look speed and so on) are kept.

### Game mode (walk-through)

Open `/play`, or press **▶ Play** in the studio, to walk through the rooms **as your own character**. A third-person camera follows it from behind. It walks when you move, runs when you hold Shift, idles when you stop, and turns to face the way you're going. Press **V** (or use ⚙ → **View**) to switch to first person and back. Your choice is remembered. You start in the room you were editing, facing its doorway.

| | Laptop | Phone |
| --- | --- | --- |
| Move | W A S D or arrow keys (Shift to run) | Joystick: put your left thumb anywhere on the left side |
| Look | Click once, then move the mouse | Swipe on the right side |
| Switch view | **V** | ⚙ → **View** |
| Leave | Esc frees the mouse, then Esc again (or **Exit**) | **Exit** button |

- On phones, the touch controls appear automatically, and you can move and look at the same time with two thumbs. Play in landscape: the app suggests rotating, and **Fullscreen & play** locks landscape where the browser allows it.
- **Settings (⚙):**
  - **Step onto low platforms** is on by default and lets you walk up onto the stage.
  - **Tap to walk** and **Gyroscope look** are off by default. Gyroscope look needs HTTPS, and on iPhone it asks for motion permission.
- **Camera:** when a wall is behind your character, the camera moves in so it never ends up inside the wall. If it gets very close, your character is hidden until there's room again.
- **Collisions:** walls and objects use their real floor outlines, so you can walk close to a triangle's slanted side or around a custom shape. Doorways are open passages.
- **What gets drawn:** only the room you're in, plus the next room when its doorway is in view. This keeps phones smooth.

### Fullscreen

The ⛶ button toggles fullscreen. iPhone Safari doesn't allow web pages to go fullscreen, so the button is hidden there. Use **Add to Home Screen** for a full-screen-like view.

## Project structure

```
index.html            app shell (top bar, panels, mobile drawer)
src/
  main.js             renderer, scene, camera, lights, controls, render loop
  studio.js           studio mode: selection, tools/modes, pointer input
  rooms.js            room data, floor/wall extrusion, doorway cutting
  geometry.js         2D polygon helpers, extruded prism geometry + UVs
  shapes.js           shape library (box, cylinder, sphere, prism, stage, custom)
  objects.js          poster, table, projector, screen; item build/dispose
  textures.js         image upload/resize, shared texture cache, fill material
  handles.js          touch-friendly corner/point handles
  game.js             game mode: player movement, mouse/keys/gyro, room culling
  router.js           /studio and /play URLs (works under any sub-path)
  collision.js        2D footprint collision for walls and objects
  characters.js       person: lazy-loaded GLB, idle/walk/wave, walk-through behaviour
  storage.js          project JSON save/load, autosave
  ui/panels.js        tabs, library, room + properties panels, hint bar, drawer
  ui/gameHud.js       game overlay: joystick, look zone, settings, start screen
  ui/fillEditor.js    image fill controls
  ui/dom.js           small DOM helpers
  style.css
public/models/        person.glb (character model) + CREDITS.md
docs/SPEC.md          full product requirements
```

## Performance notes

- Lighting is one ambient and one directional light, with no shadows. Materials use Lambert shading.
- The view only redraws when something changes, which saves battery on phones.
- Table legs and screen stand legs use `InstancedMesh`.
- Deleting an object disposes its geometries, materials and texture references.
- Image adjustments change only texture offset, repeat and rotation. Geometry isn't rebuilt.

## Credits

The person character is **RobotExpressive** by [Tomás Laulhé (Quaternius)](https://www.patreon.com/quaternius), with modifications by [Don McCurdy](https://donmccurdy.com/). It's released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain) and taken from the three.js r170 examples. See [public/models/CREDITS.md](public/models/CREDITS.md).
