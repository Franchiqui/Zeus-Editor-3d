'use client';

import { useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

interface TexturePreviewProps {
  color: string;
  opacity: number;
  roughness: number;
  type: 'glass' | 'water' | 'wood' | 'metal' | 'concrete' | 'plastic';
}

export default function TexturePreview({ texture }: { texture: TexturePreviewProps }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  useLayoutEffect(() => {
    const currentMount = mountRef.current;
    if (!currentMount) return;

    const width = currentMount.clientWidth || 720;
    const height = currentMount.clientHeight || 480;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05050a);
    scene.fog = new THREE.FogExp2(0x05050a, 0.0006);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(4, 2.5, 6);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
    });
    renderer.setClearColor(0x05050a, 1);
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    currentMount.appendChild(renderer.domElement);

    // Environment map (RoomEnvironment) for realistic reflections/refractions
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environment;
    scene.environmentIntensity = 1.2;

    // Lights
    const hemiLight = new THREE.HemisphereLight(0xb4d0ff, 0x443455, 0.8);
    hemiLight.position.set(0, 20, 0);
    scene.add(hemiLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight1.position.set(5, 12, 5);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.set(2048, 2048);
    dirLight1.shadow.radius = 4;
    dirLight1.shadow.bias = -0.0005;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 30;
    dirLight1.shadow.camera.left = -8;
    dirLight1.shadow.camera.right = 8;
    dirLight1.shadow.camera.top = 8;
    dirLight1.shadow.camera.bottom = -8;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x80aaff, 0.6);
    dirLight2.position.set(-8, 8, -6);
    scene.add(dirLight2);

    const dirLight3 = new THREE.DirectionalLight(0xffaa80, 0.3);
    dirLight3.position.set(0, 6, -10);
    scene.add(dirLight3);

    // Material tuned per texture type
    const color = new THREE.Color(texture.color || '#ffffff');
    const isTransparent = texture.opacity < 1;
    const common = {
      color,
      roughness: Math.max(0.04, texture.roughness),
      opacity: texture.opacity,
      transparent: isTransparent,
      side: THREE.DoubleSide as THREE.Side,
      envMapIntensity: 1.2,
    };

    let material: THREE.MeshPhysicalMaterial;
    switch (texture.type) {
      case 'metal':
        material = new THREE.MeshPhysicalMaterial({
          ...common,
          metalness: 1.0,
          clearcoat: 1 - texture.roughness * 0.5,
          clearcoatRoughness: texture.roughness * 0.5,
          envMapIntensity: 1.6,
        });
        break;
      case 'glass':
        material = new THREE.MeshPhysicalMaterial({
          ...common,
          metalness: 0,
          transmission: 0.95,
          thickness: 1.5,
          ior: 1.5,
          specularIntensity: 1,
          envMapIntensity: 1.5,
        });
        break;
      case 'water':
        material = new THREE.MeshPhysicalMaterial({
          ...common,
          metalness: 0,
          transmission: 1,
          thickness: 2,
          ior: 1.33,
          roughness: Math.max(0.02, texture.roughness * 0.5),
          specularIntensity: 1,
          envMapIntensity: 1.5,
        });
        break;
      case 'plastic':
        material = new THREE.MeshPhysicalMaterial({
          ...common,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
        });
        break;
      case 'wood':
        material = new THREE.MeshPhysicalMaterial({
          ...common,
          metalness: 0,
          sheen: 0.3,
          sheenRoughness: 0.6,
          roughness: Math.max(0.45, texture.roughness),
        });
        break;
      case 'concrete':
        material = new THREE.MeshPhysicalMaterial({
          ...common,
          metalness: 0,
          roughness: Math.max(0.6, texture.roughness),
          sheen: 0.15,
          sheenRoughness: 0.9,
        });
        break;
      default:
        material = new THREE.MeshPhysicalMaterial(common);
    }

    const cubeGeometry = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const cube = new THREE.Mesh(cubeGeometry, material);
    cube.position.set(-1.5, 0, 0);
    cube.castShadow = true;
    cube.receiveShadow = true;
    scene.add(cube);

    const sphereMaterial = material.clone();
    const sphereGeometry = new THREE.SphereGeometry(0.9, 96, 96);
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.set(1.5, 0, 0);
    sphere.castShadow = true;
    sphere.receiveShadow = true;
    scene.add(sphere);

    const groundGeometry = new THREE.PlaneGeometry(20, 20);
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x111111,
      roughness: 0.8,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Controls: orbit + zoom (wheel / pinch) + pan
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minDistance = 1.5;
    controls.maxDistance = 20;
    controls.maxPolarAngle = Math.PI - 0.1;
    controls.target.set(0, 0, 0);
    controlsRef.current = controls;

    let animateId: number;
    const animate = () => {
      cube.rotation.y += 0.003;
      cube.rotation.x += 0.001;
      sphere.rotation.y -= 0.003;
      sphere.rotation.x += 0.001;
      controls.update();
      renderer.render(scene, camera);
      animateId = requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
      const w = currentMount.clientWidth || width;
      const h = currentMount.clientHeight || height;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    resizeObserver.observe(currentMount);

    return () => {
      cancelAnimationFrame(animateId);
      resizeObserver.disconnect();
      controls.dispose();
      controlsRef.current = null;
      cubeGeometry.dispose();
      sphereGeometry.dispose();
      groundGeometry.dispose();
      material.dispose();
      sphereMaterial.dispose();
      groundMaterial.dispose();
      environment.dispose();
      pmremGenerator.dispose();
      renderer.dispose();
      if (currentMount.contains(renderer.domElement)) {
        currentMount.removeChild(renderer.domElement);
      }
    };
  }, [texture]);

  // Zoom via buttons: scales camera distance relative to target
  const zoomBy = (factor: number) => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cam = controls.object;
    cam.position
      .sub(controls.target)
      .multiplyScalar(factor)
      .add(controls.target);
    cam.lookAt(controls.target);
    controls.update();
  };

  const resetView = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(4, 2.5, 6);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mountRef} className="w-full h-full" style={{ minHeight: '480px' }} />

      {/* Zoom controls */}
      <div className="absolute top-3 left-3 flex flex-col gap-1 z-10">
        <button
          type="button"
          onClick={() => zoomBy(0.8)}
          className="w-9 h-9 flex items-center justify-center text-lg font-bold text-slate-200 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded-lg backdrop-blur-sm transition-colors"
          aria-label="Acercar"
          title="Acercar"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          className="w-9 h-9 flex items-center justify-center text-lg font-bold text-slate-200 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded-lg backdrop-blur-sm transition-colors"
          aria-label="Alejar"
          title="Alejar"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          className="w-9 h-9 flex items-center justify-center text-slate-200 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded-lg backdrop-blur-sm transition-colors"
          aria-label="Restablecer vista"
          title="Restablecer vista"
        >
          ⟲
        </button>
      </div>

      <div className="absolute bottom-3 left-3 z-10 text-xs text-slate-500 bg-slate-900/70 backdrop-blur-sm border border-slate-800 rounded-lg px-2 py-1 pointer-events-none">
        Rueda / pellizco: zoom · Arrastrar: rotar · Clic derecho: desplazar
      </div>
    </div>
  );
}