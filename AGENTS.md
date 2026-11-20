# AGENTS.md

Guidance for AI coding agents working in this repository.

## Project

**Room Studio** is a lightweight browser app for designing two connected exhibition rooms, then walking through them. It runs entirely client-side and must work well on phones and laptops.

The full requirements are in [docs/SPEC.md](docs/SPEC.md). Read it before starting any feature.

## Phases (strictly gated)

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | Studio mode: two rooms, doorway, polygon room editing, shapes, image fill, objects, save/load, touch support | Built, awaiting user testing |
| 2 | Game mode: WASD/mouse and joystick/swipe controls, 2D polygon collisions, room culling | Blocked on Phase 1 |
| 3 | Characters: animated low-poly GLB person | Blocked on Phase 2 |

- Don't start a phase until the user confirms the previous one works.
- When you finish a phase, stop. Tell the user how to test it on both a laptop and a phone, then wait for their go-ahead.
- Update the status column above when a phase changes state.

## Tech stack (fixed)

- **Vite** + **Three.js**, vanilla JavaScript (ES modules)
- No frameworks (no React, Vue, etc.), no backend, no physics engine
- Three.js addons: `OrbitControls`, `TransformControls`, `GLTFLoader` (Phase 3 only)
- Ask before adding any other dependency.

## Commands

| Task                      | Command                  |
| ------------------------- | ------------------------ |
| Install                   | `npm install`            |
| Dev server (also on LAN, for phone testing) | `npm run dev` |
| Production build          | `npm run build`          |
| Preview build             | `npm run preview`        |

There are no tests or linter yet. At minimum, `npm run build` must succeed, and the app must load in the browser without console errors.

## File structure

Keep files small and single-purpose. Current layout (README has one-line descriptions):

```
index.html
src/
  main.js         # renderer, scene, camera, lights, render loop
  studio.js       # studio mode: selection, modes/tools, pointer input
  rooms.js        # room model, polygon → floor/wall extrusion, doorway cutting
  geometry.js     # 2D polygon helpers, makePrism (extrusion + UVs)
  shapes.js       # box/cylinder/sphere/prism/stage + custom shapes
  objects.js      # poster, table, projector, screen; buildItem/disposeItem
  textures.js     # image upload/resize, shared texture cache + refcount, fill material
  handles.js      # screen-space (44px) corner/point handles
  storage.js      # save/load project JSON, autosave
  default-project.json  # starting layout for first launch and "New" (a saved project file)
  ui/             # panels.js, fillEditor.js, dom.js
  style.css
  game.js         # Phase 2 (planned): player controller, joystick, mouse look
  collision.js    # Phase 2 (planned): 2D polygon collision
  characters.js   # Phase 3 (planned): GLB person, animations
```

Key internals:
- `Studio` (studio.js) is the single owner of project data and scene objects. The UI calls its methods and re-renders on its `structure` event.
- Pointer handling: `studio.js` listens to `pointerdown` in the **capture** phase so handles can claim a drag before OrbitControls sees it. TransformControls is created **before** OrbitControls in main.js for the same reason.
- Walls extrude **inward** from the outline. Room walls are always rebuilt together (`rebuildRooms()`), because doorway cuts depend on every room.
- Fill textures are clones that share one `THREE.Source` per image (`textures.js`). Always release them with `disposeFillMaterial`.

## Data model rules

- Rooms, walls, and custom shapes are defined by **2D point lists** (polygons on the XZ floor plane). Geometry is always derived from data. Never treat meshes as the source of truth.
- Save files are one JSON document holding both rooms and everything in them. Keep the format versioned (`"version": 1`) and keep backwards compatibility when you change it.
- A doorway belongs to a shared wall and must cut the opening in **both** rooms' walls.

## Performance rules

- Instance repeated identical objects (`InstancedMesh`).
- Keep geometry low-poly. No real-time shadows. Lighting is one ambient light plus one directional light.
- On delete or rebuild, **dispose** geometries, materials, and textures.
- Textures: resize uploads to max 1024px. Cache one texture per image and refcount it, then dispose it when the count reaches 0.
- Image-fill adjustments (offset, repeat, rotation, flip) change texture properties. They must never rebuild geometry. Generate UVs from the outline's bounding box.
- Don't import or load the character model before Phase 3.
- Phase 2: render only the player's current room, plus the neighbor when the doorway is visible.

## Mobile and input rules

- Use **Pointer Events** only, so mouse, touch, and pen share one code path. Don't add separate `touch*` or `mouse*` handlers.
- The canvas uses `touch-action: none`. Prevent page scroll and browser pinch-zoom.
- Touch targets (buttons, corner handles, gizmos) must be at least **44px**.
- While the user drags an object or a handle, disable OrbitControls so the two don't fight.
- On narrow screens, side panels collapse into a bottom drawer.
- File inputs must accept images from the phone's photo library (`accept="image/*"`).
- Test every UI change at a phone viewport size as well as on desktop.

## Working rules for agents

- Keep changes focused. Don't refactor unrelated code.
- Follow existing patterns before you introduce new abstractions.
- Don't commit secrets. There shouldn't be any, because the app has no backend.
- Keep the README up to date with how to run and test the app.
- Don't commit or push unless asked.

## Git

- Branch names: `feat/...`, `fix/...`, `chore/...`
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), e.g. `feat(rooms): add doorway tool`.
