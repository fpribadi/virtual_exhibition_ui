# Room Studio: Product Spec

The source of truth for what to build. AGENTS.md summarizes the rules; this file has the full requirements.

Build a lightweight web app called "Room Studio" using Vite + Three.js (vanilla JavaScript, no backend, no frameworks). It must run well on phones and laptops.

## PHASE 1: Studio mode (build this, then stop and let me test)

### Two rooms
- The project has 2 rooms placed side by side in one world, connected by a doorway.
- A room selector (tabs) switches which room I'm editing. Rooms can be renamed.
- Each room has its own floor outline, wall settings, shapes, and objects.
- Doorway tool: click a shared wall to cut a door opening between the rooms (adjustable width, height, position). The opening must exist in both rooms' walls.
- I can move a room's position so the two rooms line up at the door.

### Room shape editing
- Each room is a 2D floor outline (polygon) extruded into walls. Start with a rectangle.
- Draggable corner handles. Click a wall edge to add a corner, delete a corner (minimum 3).
- Sliders for wall height and thickness. Floor and walls rebuild automatically.

### Custom shapes
- Library: box, cylinder, sphere, triangle (prism), and a custom shape tool.
- Custom shape tool: click points on the floor to draw an outline, close it, set extrusion height.
- Shapes are selectable, editable (move, rotate, scale, color, delete), and their corner points can be edited afterward.

### Image fill
- Any shape, floor, wall, poster, or screen can use an uploaded image as fill.
- Modes: stretch, cover, contain (with background color), tile (repeat count).
- Controls: offset X/Y, scale, rotate, flip H/V, reset. Live preview.
- Choose which face gets the image: top, sides, or all.
- Generate UVs from the outline's bounding box; adjust via texture offset/repeat/rotation, not by rebuilding geometry.
- Resize uploads to max 1024px. Reuse one texture across shapes using the same image, and dispose it when unused.

### Objects and tools
- Library: poster, table, stage (raised platform), projector, projector screen.
- OrbitControls: rotate, zoom (scroll/pinch), pan (right-drag or two fingers).
- TransformControls for move, rotate, scale, plus a delete button.
- Lighting: one ambient + one directional, no real-time shadows.
- Save/load both rooms and everything in them as one JSON file (shapes stored as point lists).

### Touch and mobile support (studio mode)
- One-finger drag rotates the camera, two-finger pinch zooms, two-finger drag pans.
- Tap to select an object. Tapping empty space deselects.
- Touch-friendly handles: corner handles, TransformControls gizmos, and buttons must be large enough for a fingertip (min 44px targets).
- When dragging an object or corner handle, disable camera orbit so the two don't fight.
- Responsive layout: on narrow screens, the library, room tabs, and properties panel become a collapsible bottom drawer instead of side panels.
- Prevent page scroll and browser pinch-zoom on the canvas (touch-action: none).
- Use Pointer Events so mouse, touch, and pen share the same code.
- Image upload works from the phone's photo library.
- Add a fullscreen button.

## PHASE 2: Game mode (only after Phase 1 works)
- A toggle switches between Studio and Game mode using the same scene.
- Device detection: laptops use WASD + mouse look. Phones show touch controls automatically.
- Phone controls: semi-transparent virtual joystick in the bottom-left for moving, swipe on the right side of the screen to look around.
- Support multi-touch so the player can move and look at the same time.
- Lock page scroll and zoom while playing.
- Add an "enter fullscreen" button, and design for landscape orientation.
- Optional (off by default): tap-to-walk, and gyroscope look.
- Collisions use 2D polygon outlines for walls and shape footprints (not just bounding boxes). No physics engine.
- The doorway stays open so the player can walk from one room to the other.
- Optional low step height so the player can walk onto the stage.
- Only render the room the player is in, plus the neighbor if the doorway is visible.

## PHASE 3: Characters (only after Phase 2 works)
- Add a "person" object using a free low-poly GLB model with idle and walk animations.
- Placeable in studio mode, animates in game mode. Optionally waves when the player gets close.

## Performance rules
- Use instancing for repeated identical objects.
- Keep geometry simple. Dispose textures and geometries on delete.
- Don't load the character model before Phase 3.

## Output
- Clean file structure (main.js, studio.js, game.js, rooms.js, etc.) and a README on how to run it.
- After each phase, tell me how to test it and wait for my go-ahead.
