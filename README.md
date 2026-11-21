# Floor plan prototype

A floor plan editor built with React and Three.js. The 2D plan is drawn in SVG as an orthographic top-down view. The 3D model is generated from the plan JSON.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # model unit tests
npm run build
```

## Deploying
Every push to `main` runs the tests, builds the site and deploys it to GitHub Pages (`.github/workflows/deploy.yml`). It can also be started by hand from the Actions tab. One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. The build uses relative asset paths, so it works under `https://<owner>.github.io/<repo>/`.

## Using it
- **Drag a floor** to move a room. **Drag a wall** to move it along its normal (hold Shift to move it freely). On the selected room, **drag a corner** handle.
- **Add a corner** by clicking or dragging the "+" handle in the middle of a wall of the selected room, by double-clicking a wall, or with "Split wall" in the wall inspector. Select a corner and press Delete to remove it.
- Rooms can't overlap. When you drag a room into another one, it goes to the free spot nearest the cursor instead: it stops flush against the other room, slides along its walls, and follows the cursor around it (for example from its west side to its south side) in one drag. Wall and corner moves that would overlap, or make an outline cross itself, are refused, and the room stays at its last valid shape.
- When two rooms share a wall, a doorway is created automatically. Its width and height are set under Plan settings.
- **Drag a doorway** to slide it along the shared wall. Select it and press Delete (or untick "Enabled") to disable it. Click its dashed outline to select it again and re-enable it.
- Select a wall to set its thickness (default 10 cm) and to add windows. Each window has a width, a height, a distance from the floor and a position along the wall. Windows can also be dragged along the wall.
- Ctrl+Z undoes and Ctrl+Shift+Z redoes. The plan is saved automatically to localStorage.

## Code map
- `src/model/types.ts`: the JSON plan format (units are cm)
- `src/model/plan.ts`: editing operations, validation and JSON parsing
- `src/model/doorways.ts`: works out doorways from shared walls
- `src/model/placement.ts`: finds the nearest free position for a dragged room
- `src/model/walls.ts`: wall layout used by both the 2D plan and the 3D model (walls built inward, mitred corners, walls split around openings)
- `src/three/buildModel.ts`: `buildPlanModel(plan): THREE.Group`, with no React dependency
- `src/components/`: the SVG editor, 3D viewer, inspector and JSON dialog

## Design decisions
- A room's polygon is its **outer** outline, and its walls are built inward. Rooms that adjoin each other have back-to-back walls, so checking for overlap only needs a polygon test.
- Doorways are **derived**, not stored. Each pair of adjoining rooms gets one doorway, on the longest stretch of wall they share. Only your adjustments are stored, in `doorwaySettings`, keyed by the pair of room IDs: an offset from the middle of the shared stretch, and whether the doorway is disabled. They persist if the rooms are separated and rejoined. Doorways (including disabled ones) are included in exported JSON for other programs to use, and are recalculated when a plan is loaded.
- The 3D view toolbar exports the model as Three.js JSON (`THREE.ObjectLoader` format) or as GLB.
