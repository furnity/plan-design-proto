# Floor plan prototype

A floor plan editor built with React and Three.js. The 2D plan is drawn in SVG as an orthographic top-down view. The 3D model is generated from the plan JSON.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # model unit tests
npm run build
```

## Using it
- **Drag a floor** to move a room. **Drag a wall** to move it along its normal (hold Shift to move it freely). On the selected room, **drag a corner** handle.
- **Double-click a wall** to add a corner. Select a corner and press Delete to remove it.
- A move that would overlap another room or make a room's outline cross itself is refused, and a red banner appears.
- When two rooms share a wall, a doorway is created automatically. Its width and height are set under Plan settings.
- Select a wall to set its thickness (default 10 cm) and to add windows. Each window has a width, a height, a distance from the floor and a position along the wall. Windows can also be dragged along the wall.
- Ctrl+Z undoes and Ctrl+Shift+Z redoes. The plan is saved automatically to localStorage.

## Code map
- `src/model/types.ts`: the JSON plan format (units are cm)
- `src/model/plan.ts`: editing operations, validation and JSON parsing
- `src/model/doorways.ts`: works out doorways from shared walls
- `src/model/walls.ts`: wall layout used by both the 2D plan and the 3D model (walls built inward, mitred corners, walls split around openings)
- `src/three/buildModel.ts`: `buildPlanModel(plan): THREE.Group`, with no React dependency
- `src/components/`: the SVG editor, 3D viewer, inspector and JSON dialog

## Design decisions
- A room's polygon is its **outer** outline, and its walls are built inward. Rooms that adjoin each other have back-to-back walls, so checking for overlap only needs a polygon test.
- Doorways are **derived**, not stored. Each pair of adjoining rooms gets one doorway, centred on the longest stretch of wall they share. Doorways are included in exported JSON for other programs to use, and are recalculated when a plan is loaded.
- The 3D view toolbar exports the model as Three.js JSON (`THREE.ObjectLoader` format) or as GLB.
