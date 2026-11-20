# Room Studio

Design two connected exhibition rooms in the browser: shape the rooms, cut a doorway between them, place shapes and exhibition objects, and dress any surface with your own images. Runs entirely client-side (Vite + Three.js, vanilla JavaScript, no backend) and works on phones and laptops.

**Status:** Phase 1 (Studio mode) is done. Phase 2 (walk-through game mode) and Phase 3 (animated characters) are next. See [docs/SPEC.md](docs/SPEC.md).

## Run it

You need Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173).

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

`nginx.conf` caches the hashed files in `/assets/` for a year and makes browsers recheck `index.html` on every visit, so a redeploy shows up right away. The app has no server state, so you can run as many containers as you like behind a load balancer.

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
- **Objects:** poster and projector screen (placed on the nearest wall), table, stage (an editable platform) and projector.

### Image fill

Floors, walls, shapes, the stage, posters and screens can show an uploaded image. On a phone, **Upload image** opens your photo library.

- **Fit:** stretch, cover, contain (with a background colour), or tile (with a repeat count).
- **Adjust:** offset X/Y, scale, rotate, flip H/V, and reset. Changes preview live.
- **Apply to** (shapes only): all faces, the top only, or the sides only.
- Uploads are resized to at most 1024px. Surfaces that use the same image share one GPU texture, which is freed when nothing uses it any more.

### Saving

- **Save** downloads `room-studio.json` with both rooms, all objects (shapes as point lists) and the images they use.
- **Open** loads a saved file. **New** starts over from the default layout.
- The default layout is [src/default-project.json](src/default-project.json). To change it, design a layout, **Save** it, and replace that file with your saved file.
- Your work is also autosaved in the browser. Very large projects may skip the autosave, so use **Save** for anything you want to keep.

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
  storage.js          project JSON save/load, autosave
  ui/panels.js        tabs, library, room + properties panels, hint bar, drawer
  ui/fillEditor.js    image fill controls
  ui/dom.js           small DOM helpers
  style.css
docs/SPEC.md          full product requirements
```

## Performance notes

- Lighting is one ambient and one directional light, with no shadows. Materials use Lambert shading.
- The view only redraws when something changes, which saves battery on phones.
- Table legs and screen stand legs use `InstancedMesh`.
- Deleting an object disposes its geometries, materials and texture references.
- Image adjustments change only texture offset, repeat and rotation. Geometry isn't rebuilt.
