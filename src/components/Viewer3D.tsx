import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { downloadBlob, downloadText } from '../model/io';
import type { Plan } from '../model/types';
import { buildPlanModel, disposeModel } from '../three/buildModel';

interface Props {
  plan: Plan;
  /** Change to re-frame the camera on the model. */
  fitKey?: number;
}

interface Ctx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  model?: THREE.Group;
}

function frame(ctx: Ctx) {
  if (!ctx.model) return;
  const box = new THREE.Box3().setFromObject(ctx.model);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.z, 3);
  const { camera } = ctx;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const distance = (extent / 2 / Math.tan(halfFov)) * 1.25 / Math.min(1, camera.aspect);
  const dir = new THREE.Vector3(0.35, 1.1, 0.8).normalize();
  ctx.controls.target.copy(center);
  camera.position.copy(center).addScaledVector(dir, distance);
  ctx.controls.update();
}

export function Viewer3D({ plan, fitKey }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ctxRef = useRef<Ctx | null>(null);
  const framed = useRef(false);
  const [ceilings, setCeilings] = useState(false);

  useEffect(() => {
    const el = host.current!;
    framed.current = false;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xdfe6ec);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a85, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
    sun.shadow.camera.right = sun.shadow.camera.top = 25;
    sun.shadow.bias = -0.0005;
    scene.add(sun, sun.target);
    const grid = new THREE.GridHelper(60, 60, 0xb8c0c8, 0xcfd6dc);
    grid.position.y = -0.002;
    scene.add(grid);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02;

    const ctx: Ctx = { renderer, scene, camera, controls };
    ctxRef.current = ctx;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      if (ctx.model) disposeModel(ctx.model);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      ctxRef.current = null;
    };
  }, []);

  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (ctx.model) {
      ctx.scene.remove(ctx.model);
      disposeModel(ctx.model);
    }
    ctx.model = buildPlanModel(plan, { ceilings });
    ctx.scene.add(ctx.model);
    if (!framed.current) {
      frame(ctx);
      framed.current = true;
    }
  }, [plan, ceilings]);

  useEffect(() => {
    if (ctxRef.current) frame(ctxRef.current);
  }, [fitKey]);

  const exportThreeJson = () => {
    const model = buildPlanModel(plan, { ceilings });
    downloadText('floorplan.three.json', JSON.stringify(model.toJSON()));
    disposeModel(model);
  };

  const exportGlb = () => {
    const model = buildPlanModel(plan, { ceilings });
    new GLTFExporter().parse(
      model,
      (result) => {
        downloadBlob('floorplan.glb', new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' }));
        disposeModel(model);
      },
      (err) => alert(`GLB export failed: ${err}`),
      { binary: true },
    );
  };

  return (
    <div className="viewer">
      <div className="viewer-canvas" ref={host} />
      <div className="viewer-toolbar">
        <label>
          <input type="checkbox" checked={ceilings} onChange={(e) => setCeilings(e.target.checked)} /> Ceilings
        </label>
        <button onClick={() => ctxRef.current && frame(ctxRef.current)}>Reset view</button>
        <button onClick={exportThreeJson} title="THREE.ObjectLoader-compatible JSON">
          Export Three.js JSON
        </button>
        <button onClick={exportGlb}>Export GLB</button>
      </div>
    </div>
  );
}
