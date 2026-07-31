import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  HoveredModule,
  InnerTracker3DOptions,
  ModuleDescriptor,
  ModuleMeasurement,
  VisibilityState,
} from '../types';
import { measurementColor } from '../data/measurements';
import { detectorModuleShapeKey } from './buildGeometry';

interface ElementMesh {
  mesh: THREE.InstancedMesh;
  statusColors: THREE.InstancedBufferAttribute;
  modules: ModuleDescriptor[];
  chipIndices: number[];
  matrices: THREE.Matrix4[];
  visibilityKey: string;
  sectionKey: string;
}

interface SupportMesh {
  mesh: THREE.Mesh;
  visibilityKey: string;
  sectionKey: string;
}

interface DetectorSceneCallbacks {
  onHover: (hovered?: HoveredModule) => void;
  onSelect: (
    module: ModuleDescriptor,
    chipIndex: number,
    measurement?: ModuleMeasurement
  ) => void;
}

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

function setStatusColor(
  attribute: THREE.InstancedBufferAttribute,
  index: number,
  value: string
): void {
  new THREE.Color(value).toArray(attribute.array, index * 3);
}

function statusMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec3 statusColor;
      varying vec3 vStatusColor;

      void main() {
        vStatusColor = statusColor;
        vec4 instancePosition = instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * modelViewMatrix * instancePosition;
      }
    `,
    fragmentShader: `
      varying vec3 vStatusColor;

      void main() {
        gl_FragColor = vec4(vStatusColor, 1.0);
        #include <colorspace_fragment>
      }
    `,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function rectangularCell(
  xMin: number,
  xMax: number,
  zMin: number,
  zMax: number
): THREE.BoxGeometry {
  const gap = 0.025;
  const width = (xMax - xMin) * (1 - gap);
  const depth = (zMax - zMin) * (1 - gap);
  const geometry = new THREE.BoxGeometry(width, 1, depth);
  geometry.translate((xMin + xMax) / 2, 0, (zMin + zMax) / 2);
  return geometry;
}

function polygonPrism(points: Array<[number, number]>): THREE.BufferGeometry {
  const centre = points.reduce(
    ([x, y], [pointX, pointY]) => [x + pointX / points.length, y + pointY / points.length],
    [0, 0]
  );
  // Keep only a hairline divider between chips. The visible gap between
  // complete disk modules is applied later by matrixFor(), around the common
  // module origin, so it does not pull the individual chips apart.
  const inset = points.map(([x, y]) => [
    centre[0] + (x - centre[0]) * 0.995,
    centre[1] + (y - centre[1]) * 0.995,
  ] as [number, number]);
  const shape = new THREE.Shape();
  inset.forEach(([x, y], index) => {
    if (index === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: false,
    steps: 1,
  });
  geometry.translate(0, 0, -0.5);
  return geometry;
}

const BARREL_DOUBLE_CELLS = [
  rectangularCell(-0.5, 0.5, -0.5, 0),
  rectangularCell(-0.5, 0.5, 0, 0.5),
];
const BARREL_QUAD_CELLS = [
  rectangularCell(-0.5, 0, -0.5, 0),
  rectangularCell(0, 0.5, -0.5, 0),
  rectangularCell(-0.5, 0, 0, 0.5),
  rectangularCell(0, 0.5, 0, 0.5),
];

const DISK_CELL_CACHE = new Map<string, THREE.BufferGeometry[]>();

function diskCellGeometries(module: ModuleDescriptor): THREE.BufferGeometry[] {
  const ratio = module.wedgeInnerRatio ?? 0.72;
  const halfAngle = module.wedgeHalfAngle ?? 0.1;
  const key = `${module.moduleType}:${ratio.toFixed(4)}:${halfAngle.toFixed(4)}`;
  const cached = DISK_CELL_CACHE.get(key);
  if (cached) {
    return cached;
  }
  const inner = 0.5 * ratio;
  const middle = (inner + 0.5) / 2;
  // Local coordinates are normalized by the descriptor's chord width and
  // radial thickness. These Y coordinates place the four corners on the
  // actual inner/outer circles at ±halfAngle, so adjacent wedges share their
  // boundary corners exactly.
  const radialCentre = (1 + ratio) / 2;
  const radialSpan = 1 - ratio;
  const innerY = (ratio * Math.cos(halfAngle) - radialCentre) / radialSpan;
  const outerY = (Math.cos(halfAngle) - radialCentre) / radialSpan;
  const middleY = (innerY + outerY) / 2;
  const doubleCells = [
    polygonPrism([[-inner, innerY], [inner, innerY], [middle, middleY], [-middle, middleY]]),
    polygonPrism([[-middle, middleY], [middle, middleY], [0.5, outerY], [-0.5, outerY]]),
  ];
  const cells = module.moduleType === 'double'
    ? doubleCells
    : [
      polygonPrism([[-inner, innerY], [0, innerY], [0, middleY], [-middle, middleY]]),
      polygonPrism([[0, innerY], [inner, innerY], [middle, middleY], [0, middleY]]),
      polygonPrism([[-middle, middleY], [0, middleY], [0, outerY], [-0.5, outerY]]),
      polygonPrism([[0, middleY], [middle, middleY], [0.5, outerY], [0, outerY]]),
    ];
  DISK_CELL_CACHE.set(key, cells);
  return cells;
}

function chipGeometries(module: ModuleDescriptor): THREE.BufferGeometry[] {
  if (module.subdetector === 'TBPX') {
    return module.moduleType === 'double' ? BARREL_DOUBLE_CELLS : BARREL_QUAD_CELLS;
  }
  return diskCellGeometries(module);
}

function circuitBoardTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  context.fillStyle = '#245b46';
  context.fillRect(0, 0, canvas.width, canvas.height);

  // A restrained PCB pattern: fine traces with occasional vias and pads.
  context.strokeStyle = 'rgba(139, 194, 155, 0.34)';
  context.lineWidth = 3;
  const traces = [
    [[0, 38], [82, 38], [108, 64], [256, 64]],
    [[0, 116], [54, 116], [82, 88], [176, 88], [204, 116], [256, 116]],
    [[0, 204], [118, 204], [146, 176], [256, 176]],
    [[38, 0], [38, 74], [64, 100], [64, 256]],
    [[176, 0], [176, 48], [202, 74], [202, 256]],
  ];
  traces.forEach((trace) => {
    context.beginPath();
    trace.forEach(([x, y], index) => {
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();
  });

  context.fillStyle = 'rgba(207, 175, 92, 0.58)';
  [[38, 38], [108, 64], [82, 116], [176, 88], [146, 176], [202, 116]].forEach(
    ([x, y]) => {
      context.beginPath();
      context.arc(x, y, 6, 0, Math.PI * 2);
      context.fill();
    }
  );

  context.fillStyle = 'rgba(14, 43, 34, 0.38)';
  for (let x = 22; x < 256; x += 58) {
    for (let y = 22; y < 256; y += 58) {
      context.fillRect(x, y, 18, 12);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function halfAnnulusGeometry(
  innerRadius: number,
  outerRadius: number,
  thetaStart: number,
  depth: number
): THREE.ExtrudeGeometry {
  const thetaEnd = thetaStart + Math.PI;
  const shape = new THREE.Shape();
  shape.moveTo(
    outerRadius * Math.cos(thetaStart),
    outerRadius * Math.sin(thetaStart)
  );
  shape.absarc(0, 0, outerRadius, thetaStart, thetaEnd, false);
  shape.lineTo(
    innerRadius * Math.cos(thetaEnd),
    innerRadius * Math.sin(thetaEnd)
  );
  shape.absarc(0, 0, innerRadius, thetaEnd, thetaStart, true);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 64,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

function elementEnabled(key: string, visibility: VisibilityState): boolean {
  const [subdetector, element] = key.split(':');
  const index = Number(element) - 1;
  if (subdetector === 'TBPX') {
    return visibility.TBPX[index] ?? false;
  }
  if (subdetector === 'TFPX') {
    return visibility.TFPX[index] ?? false;
  }
  return visibility.TEPX[index] ?? false;
}

function sectionEnabled(key: string, visibility: VisibilityState): boolean {
  const parts = key.split(':');
  if (parts[0] === 'TBPX') {
    const index = [
      'TBPX:right:+z',
      'TBPX:right:-z',
      'TBPX:left:+z',
      'TBPX:left:-z',
    ].indexOf(key);
    return visibility.TBPXParts[index] ?? false;
  }
  const index = [
    `${parts[0]}:+z:upper`,
    `${parts[0]}:+z:lower`,
    `${parts[0]}:-z:upper`,
    `${parts[0]}:-z:lower`,
  ].indexOf(key);
  const values = parts[0] === 'TFPX' ? visibility.TFPXParts : visibility.TEPXParts;
  return values[index] ?? false;
}

function visible(
  visibilityKey: string,
  sectionKey: string,
  visibility: VisibilityState
): boolean {
  return elementEnabled(visibilityKey, visibility) && sectionEnabled(sectionKey, visibility);
}

function matrixFor(module: ModuleDescriptor): THREE.Matrix4 {
  const position = new THREE.Vector3(...module.position);
  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, 0, module.rotationZ)
  );
  const moduleInset = module.subdetector === 'TBPX' ? 1 : 0.96;
  const scale = new THREE.Vector3(
    module.size[0] * moduleInset,
    module.size[1] * moduleInset,
    module.size[2]
  );
  return new THREE.Matrix4().compose(position, rotation, scale);
}

export class DetectorScene {
  private readonly container: HTMLDivElement;
  private readonly modules: ModuleDescriptor[];
  private readonly callbacks: DetectorSceneCallbacks;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly circuitTexture: THREE.CanvasTexture;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly elements = new Map<string, ElementMesh>();
  private readonly supports: SupportMesh[] = [];
  private readonly outline: THREE.LineSegments;
  private readonly resizeObserver: ResizeObserver;
  private options: InnerTracker3DOptions;
  private measurements = new Map<string, ModuleMeasurement>();
  private animationFrame = 0;
  private pointerDown?: { x: number; y: number };
  private hoveredId?: string;

  constructor(
    container: HTMLDivElement,
    modules: ModuleDescriptor[],
    options: InnerTracker3DOptions,
    callbacks: DetectorSceneCallbacks
  ) {
    this.container = container;
    this.modules = modules;
    this.options = options;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.setClearColor(0xe7ecf2, 1);
    this.circuitTexture = circuitBoardTexture();
    this.circuitTexture.anisotropy = Math.min(
      8,
      this.renderer.capabilities.getMaxAnisotropy()
    );
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 18;
    this.controls.target.set(0, 0, 0);

    const outlineGeometry = new THREE.EdgesGeometry(UNIT_BOX);
    const outlineMaterial = new THREE.LineBasicMaterial({
      color: options.selectedColor,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
    });
    this.outline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.outline.renderOrder = 100;
    this.outline.visible = false;
    this.scene.add(this.outline);

    this.addLighting();
    this.addSupportStructures();
    this.addDetectorMeshes();
    this.addBeamAxis();
    this.resetCamera();

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('dblclick', this.onDoubleClick);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  private addLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8794a5, 2.15));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(4, 5, 6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdce7f2, 1.15);
    fill.position.set(-5, -2, -4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.85);
    rim.position.set(-2, 4, -6);
    this.scene.add(rim);
  }

  private addSupportStructures(): void {
    const sections = new Map<string, ModuleDescriptor[]>();
    for (const module of this.modules) {
      const key = `${module.visibilityKey}|${module.sectionKey}`;
      const existing = sections.get(key) ?? [];
      existing.push(module);
      sections.set(key, existing);
    }

    for (const [compositeKey, sectionModules] of sections) {
      const [visibilityKey, sectionKey] = compositeKey.split('|');
      const first = sectionModules[0];

      if (first.subdetector === 'TBPX') {
        const radius =
          sectionModules.reduce(
            (sum, module) => sum + Math.hypot(module.position[0], module.position[1]),
            0
          ) / sectionModules.length;
        const zMin = Math.min(
          ...sectionModules.map((module) => module.position[2] - module.size[2] / 2)
        );
        const zMax = Math.max(
          ...sectionModules.map((module) => module.position[2] + module.size[2] / 2)
        );
        const thetaStart = sectionKey.includes(':right:') ? 0 : Math.PI;
        const geometry = new THREE.CylinderGeometry(
          radius * 0.975,
          radius * 0.975,
          Math.max(0.05, zMax - zMin),
          48,
          1,
          true,
          thetaStart,
          Math.PI
        );
        const material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
          map: this.circuitTexture,
          metalness: 0.04,
          roughness: 0.72,
          transparent: false,
          side: THREE.DoubleSide,
          depthWrite: true,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.z = (zMin + zMax) / 2;
        mesh.renderOrder = 0;
        this.supports.push({ mesh, visibilityKey, sectionKey });
        this.scene.add(mesh);
        continue;
      }

      const radii = sectionModules.map((module) =>
        Math.hypot(module.position[0], module.position[1])
      );
      const radialSizes = sectionModules.map((module) => module.size[1]);
      const innerRadius = Math.min(
        ...radii.map((radius, index) => radius - radialSizes[index] / 2)
      );
      const outerRadius = Math.max(
        ...radii.map((radius, index) => radius + radialSizes[index] / 2)
      );
      const thetaStart = sectionKey.endsWith(':upper') ? -Math.PI / 2 : Math.PI / 2;
      const geometry = halfAnnulusGeometry(
        Math.max(0.02, innerRadius * 0.94),
        outerRadius * 1.03,
        thetaStart,
        0.035
      );
      const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        map: this.circuitTexture,
        metalness: 0.04,
        roughness: 0.7,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const basePositions = sectionModules.map((module) => {
        const direction = module.side === '+z' ? 1 : -1;
        const surfaceDirection = module.diskSurface === 'inner' ? -1 : 1;
        return module.position[2] - direction * surfaceDirection * 0.026;
      });
      mesh.position.z =
        basePositions.reduce((sum, position) => sum + position, 0)
        / basePositions.length;
      mesh.renderOrder = 0;
      this.supports.push({ mesh, visibilityKey, sectionKey });
      this.scene.add(mesh);
    }
  }

  private addDetectorMeshes(): void {
    const grouped = new Map<string, Array<{ module: ModuleDescriptor; chipIndex: number }>>();
    for (const module of this.modules) {
      chipGeometries(module).forEach((_geometry, chipIndex) => {
        // Disk rings have different polar trapezoids. Keep each ring in a
        // separate instanced mesh so an inner-ring geometry is never reused
        // for modules farther out on the disk.
        const shapeKey = detectorModuleShapeKey(module);
        const key =
          `${module.visibilityKey}|${module.sectionKey}|${shapeKey}|${chipIndex}`;
        const existing = grouped.get(key) ?? [];
        existing.push({ module, chipIndex });
        grouped.set(key, existing);
      });
    }

    for (const [key, cells] of grouped) {
      const [visibilityKey, sectionKey, _shapeKey, chipKey] = key.split('|');
      const elementModules = cells.map((cell) => cell.module);
      const chipIndices = cells.map((cell) => cell.chipIndex);
      // Use an explicit instanced status-colour attribute rather than the
      // optional material instanceColor path. This keeps monitoring colours
      // reliable inside Grafana's WebGL runtime.
      const material = statusMaterial();
      const moduleGeometry = chipGeometries(elementModules[0])[Number(chipKey)].clone();
      const statusColors = new THREE.InstancedBufferAttribute(
        new Float32Array(elementModules.length * 3),
        3
      );
      statusColors.setUsage(THREE.DynamicDrawUsage);
      moduleGeometry.setAttribute('statusColor', statusColors);
      const mesh = new THREE.InstancedMesh(moduleGeometry, material, elementModules.length);
      mesh.name = key;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      const matrices = elementModules.map(matrixFor);

      matrices.forEach((matrix, index) => {
        mesh.setMatrixAt(index, matrix);
        setStatusColor(statusColors, index, this.options.noDataColor);
      });
      statusColors.needsUpdate = true;

      mesh.renderOrder = 2;
      this.elements.set(key, {
        mesh,
        statusColors,
        modules: elementModules,
        chipIndices,
        matrices,
        visibilityKey,
        sectionKey,
      });
      this.scene.add(mesh);
    }
  }

  private addBeamAxis(): void {
    const material = new THREE.LineDashedMaterial({
      color: 0x768294,
      dashSize: 0.12,
      gapSize: 0.08,
      transparent: true,
      opacity: 0.7,
    });
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -4.55),
      new THREE.Vector3(0, 0, 4.55),
    ]);
    const axis = new THREE.Line(geometry, material);
    axis.name = 'beam-axis';
    axis.computeLineDistances();
    axis.visible = this.options.showBeamAxis;
    this.scene.add(axis);

    const yMaterial = new THREE.LineBasicMaterial({
      color: 0x376b9e,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const yGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -1.35, 0),
      new THREE.Vector3(0, 1.35, 0),
    ]);
    const yAxis = new THREE.Line(yGeometry, yMaterial);
    yAxis.name = 'y-axis';
    yAxis.renderOrder = 90;
    this.scene.add(yAxis);
  }

  private animate = (): void => {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private updatePointer(event: PointerEvent | MouseEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private intersect(event: PointerEvent | MouseEvent): {
    module: ModuleDescriptor;
    chipIndex: number;
    matrix: THREE.Matrix4;
  } | undefined {
    this.updatePointer(event);
    const visibleMeshes = Array.from(this.elements.values())
      .map((element) => element.mesh)
      .filter((mesh) => mesh.visible);
    const hit = this.raycaster.intersectObjects(visibleMeshes, false)[0];
    if (!hit || hit.instanceId === undefined) {
      return undefined;
    }
    const element = this.elements.get(hit.object.name);
    if (!element) {
      return undefined;
    }
    return {
      module: element.modules[hit.instanceId],
      chipIndex: element.chipIndices[hit.instanceId],
      matrix: element.matrices[hit.instanceId],
    };
  }

  private onPointerMove = (event: PointerEvent): void => {
    const hit = this.intersect(event);
    if (!hit) {
      this.clearHover();
      return;
    }

    this.renderer.domElement.style.cursor = 'pointer';
    this.outline.matrixAutoUpdate = false;
    this.outline.matrix.copy(hit.matrix);
    this.outline.visible = true;
    this.hoveredId = hit.module.id;
    this.callbacks.onHover({
      module: hit.module,
      measurement: this.measurements.get(hit.module.id),
      chipIndex: hit.chipIndex,
      chipMeasurement: this.measurements.get(hit.module.id)?.chips[hit.chipIndex],
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  private onPointerLeave = (): void => this.clearHover();

  private onPointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.pointerDown) {
      return;
    }
    const distance = Math.hypot(
      event.clientX - this.pointerDown.x,
      event.clientY - this.pointerDown.y
    );
    this.pointerDown = undefined;
    if (distance > 5) {
      return;
    }
    const hit = this.intersect(event);
    if (hit) {
      this.callbacks.onSelect(
        hit.module,
        hit.chipIndex,
        this.measurements.get(hit.module.id)
      );
    }
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const hit = this.intersect(event);
    if (!hit) {
      this.resetCamera();
      return;
    }
    const target = new THREE.Vector3(...hit.module.position);
    this.controls.target.copy(target);
    const direction = this.camera.position.clone().sub(target).normalize();
    this.camera.position.copy(target.clone().add(direction.multiplyScalar(1.6)));
  };

  private clearHover(): void {
    if (this.hoveredId !== undefined) {
      this.hoveredId = undefined;
      this.outline.visible = false;
      this.renderer.domElement.style.cursor = 'grab';
      this.callbacks.onHover(undefined);
    }
  }

  updateOptions(options: InnerTracker3DOptions): void {
    this.options = options;
    const axis = this.scene.getObjectByName('beam-axis');
    if (axis) {
      axis.visible = options.showBeamAxis;
    }
    const material = this.outline.material as THREE.LineBasicMaterial;
    material.color.set(options.selectedColor);
    this.updateMeasurements(this.measurements);
  }

  updateMeasurements(measurements: Map<string, ModuleMeasurement>): void {
    this.measurements = measurements;
    for (const element of this.elements.values()) {
      element.modules.forEach((module, index) => {
        const moduleMeasurement = measurements.get(module.id);
        const chipMeasurement = moduleMeasurement?.chips[element.chipIndices[index]];
        const hasChipMeasurements =
          moduleMeasurement !== undefined
          && Object.keys(moduleMeasurement.chips).length > 0;
        setStatusColor(
          element.statusColors,
          index,
          measurementColor(
            hasChipMeasurements ? chipMeasurement : moduleMeasurement,
            this.options,
            {
              good: this.options.goodColor,
              bad: this.options.badColor,
              noData: this.options.noDataColor,
            }
          )
        );
      });
      element.statusColors.needsUpdate = true;
    }
  }

  setVisibility(visibility: VisibilityState): void {
    for (const element of this.elements.values()) {
      element.mesh.visible = visible(element.visibilityKey, element.sectionKey, visibility);
    }
    for (const support of this.supports) {
      support.mesh.visible = visible(support.visibilityKey, support.sectionKey, visibility);
    }
    this.clearHover();
  }

  resetCamera(): void {
    this.camera.position.set(5.8, 3.6, 6.8);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  dispose(): void {
    cancelAnimationFrame(this.animationFrame);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.removeEventListener('dblclick', this.onDoubleClick);
    this.controls.dispose();
    for (const element of this.elements.values()) {
      const materials = Array.isArray(element.mesh.material)
        ? element.mesh.material
        : [element.mesh.material];
      materials.forEach((material) => material.dispose());
    }
    for (const support of this.supports) {
      support.mesh.geometry.dispose();
      const materials = Array.isArray(support.mesh.material)
        ? support.mesh.material
        : [support.mesh.material];
      materials.forEach((material) => material.dispose());
    }
    (this.outline.geometry as THREE.BufferGeometry).dispose();
    (this.outline.material as THREE.Material).dispose();
    this.circuitTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
