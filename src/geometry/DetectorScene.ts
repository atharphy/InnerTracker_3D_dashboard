import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  CameraMode,
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

interface DividerMesh {
  mesh: THREE.LineSegments;
  visibilityKey: string;
  sectionKey: string;
}

interface BoardTextures {
  color: THREE.CanvasTexture;
  bump: THREE.CanvasTexture;
  roughness: THREE.CanvasTexture;
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
  // Chips fill their complete share of the module. Their boundary is drawn
  // separately, so only complete modules retain a physical gap.
  const width = xMax - xMin;
  const depth = zMax - zMin;
  const geometry = new THREE.BoxGeometry(width, 1, depth);
  geometry.translate((xMin + xMax) / 2, 0, (zMin + zMax) / 2);
  return geometry;
}

function polygonPrism(points: Array<[number, number]>): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
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

function chipDividerSegments(module: ModuleDescriptor): THREE.Vector3[] {
  const segments: THREE.Vector3[] = [];
  const add = (a: THREE.Vector3, b: THREE.Vector3): void => {
    segments.push(a, b);
  };

  if (module.subdetector === 'TBPX') {
    // Draw the divider on both radial faces so it remains visible as the
    // detector is rotated. Local X/Z span the module face.
    for (const y of [-0.501, 0.501]) {
      add(new THREE.Vector3(-0.5, y, 0), new THREE.Vector3(0.5, y, 0));
      if (module.moduleType === 'quad') {
        add(new THREE.Vector3(0, y, -0.5), new THREE.Vector3(0, y, 0.5));
      }
    }
    return segments;
  }

  const ratio = module.wedgeInnerRatio ?? 0.72;
  const halfAngle = module.wedgeHalfAngle ?? 0.1;
  const inner = 0.5 * ratio;
  const middle = (inner + 0.5) / 2;
  const radialCentre = (1 + ratio) / 2;
  const radialSpan = 1 - ratio;
  const innerY = (ratio * Math.cos(halfAngle) - radialCentre) / radialSpan;
  const outerY = (Math.cos(halfAngle) - radialCentre) / radialSpan;
  const middleY = (innerY + outerY) / 2;

  // Disk modules can be viewed from either detector side, so draw on both
  // faces of the thin prism. The lines divide chips without opening a gap.
  for (const z of [-0.501, 0.501]) {
    add(new THREE.Vector3(-middle, middleY, z), new THREE.Vector3(middle, middleY, z));
    if (module.moduleType === 'quad') {
      add(new THREE.Vector3(0, innerY, z), new THREE.Vector3(0, outerY, z));
    }
  }
  return segments;
}

function circuitBoardTextures(): BoardTextures {
  const size = 1024;
  const colorCanvas = document.createElement('canvas');
  const bumpCanvas = document.createElement('canvas');
  const roughnessCanvas = document.createElement('canvas');
  [colorCanvas, bumpCanvas, roughnessCanvas].forEach((canvas) => {
    canvas.width = size;
    canvas.height = size;
  });
  const color = colorCanvas.getContext('2d');
  const bump = bumpCanvas.getContext('2d');
  const roughness = roughnessCanvas.getContext('2d');
  if (!color || !bump || !roughness) {
    return {
      color: new THREE.CanvasTexture(colorCanvas),
      bump: new THREE.CanvasTexture(bumpCanvas),
      roughness: new THREE.CanvasTexture(roughnessCanvas),
    };
  }

  // Deep green solder mask with a subtle woven substrate pattern.
  color.fillStyle = '#174f3c';
  color.fillRect(0, 0, size, size);
  const maskGradient = color.createRadialGradient(512, 420, 80, 512, 512, 730);
  maskGradient.addColorStop(0, 'rgba(76, 151, 111, 0.22)');
  maskGradient.addColorStop(1, 'rgba(3, 34, 26, 0.18)');
  color.fillStyle = maskGradient;
  color.fillRect(0, 0, size, size);
  color.strokeStyle = 'rgba(110, 184, 139, 0.08)';
  color.lineWidth = 1;
  for (let coordinate = 8; coordinate < size; coordinate += 16) {
    color.beginPath();
    color.moveTo(coordinate, 0);
    color.lineTo(coordinate, size);
    color.stroke();
    color.beginPath();
    color.moveTo(0, coordinate);
    color.lineTo(size, coordinate);
    color.stroke();
  }

  bump.fillStyle = '#595959';
  bump.fillRect(0, 0, size, size);
  roughness.fillStyle = '#c2c2c2';
  roughness.fillRect(0, 0, size, size);

  const tracePaths: Array<Array<[number, number]>> = [
    [[0, 90], [170, 90], [220, 140], [410, 140], [462, 192], [1024, 192]],
    [[0, 286], [128, 286], [198, 216], [470, 216], [536, 282], [1024, 282]],
    [[0, 496], [232, 496], [302, 426], [640, 426], [708, 494], [1024, 494]],
    [[0, 706], [186, 706], [246, 646], [542, 646], [620, 724], [1024, 724]],
    [[0, 902], [340, 902], [398, 844], [714, 844], [772, 902], [1024, 902]],
    [[104, 0], [104, 172], [162, 230], [162, 1024]],
    [[354, 0], [354, 112], [412, 170], [412, 1024]],
    [[648, 0], [648, 232], [706, 290], [706, 1024]],
    [[892, 0], [892, 360], [836, 416], [836, 1024]],
  ];
  tracePaths.forEach((path, index) => {
    const width = index % 3 === 0 ? 9 : 5;
    color.strokeStyle = index % 2 === 0
      ? 'rgba(130, 196, 151, 0.72)'
      : 'rgba(87, 161, 123, 0.68)';
    color.lineWidth = width;
    color.lineJoin = 'round';
    color.beginPath();
    path.forEach(([x, y], pointIndex) => {
      if (pointIndex === 0) {
        color.moveTo(x, y);
      } else {
        color.lineTo(x, y);
      }
    });
    color.stroke();
    bump.strokeStyle = '#a8a8a8';
    bump.lineWidth = width;
    bump.lineJoin = 'round';
    bump.beginPath();
    path.forEach(([x, y], pointIndex) => {
      if (pointIndex === 0) {
        bump.moveTo(x, y);
      } else {
        bump.lineTo(x, y);
      }
    });
    bump.stroke();
  });

  // Plated vias and test pads.
  const vias: Array<[number, number, number]> = [];
  for (let row = 0; row < 5; row++) {
    for (let column = 0; column < 7; column++) {
      vias.push([70 + column * 148 + (row % 2) * 28, 64 + row * 205, (row + column) % 3 === 0 ? 10 : 7]);
    }
  }
  vias.forEach(([x, y, radius]) => {
    color.fillStyle = '#d5b55b';
    color.beginPath();
    color.arc(x, y, radius, 0, Math.PI * 2);
    color.fill();
    color.fillStyle = '#594c28';
    color.beginPath();
    color.arc(x, y, radius * 0.38, 0, Math.PI * 2);
    color.fill();
    bump.fillStyle = '#d2d2d2';
    bump.beginPath();
    bump.arc(x, y, radius, 0, Math.PI * 2);
    bump.fill();
  });

  // Repeating integrated circuits with visible pins and orientation marks.
  const integratedCircuits: Array<[number, number, number, number]> = [
    [248, 310, 148, 104],
    [602, 548, 184, 126],
    [748, 86, 132, 92],
    [94, 776, 138, 98],
  ];
  integratedCircuits.forEach(([x, y, width, height], icIndex) => {
    color.fillStyle = 'rgba(7, 15, 14, 0.96)';
    color.fillRect(x, y, width, height);
    color.strokeStyle = 'rgba(187, 207, 198, 0.34)';
    color.lineWidth = 3;
    color.strokeRect(x + 3, y + 3, width - 6, height - 6);
    const pinCount = Math.max(6, Math.floor(width / 22));
    color.fillStyle = '#aeb8b2';
    bump.fillStyle = '#e0e0e0';
    for (let pin = 0; pin < pinCount; pin++) {
      const pinX = x + 8 + pin * ((width - 16) / (pinCount - 1));
      color.fillRect(pinX - 3, y - 11, 6, 11);
      color.fillRect(pinX - 3, y + height, 6, 11);
      bump.fillRect(pinX - 3, y - 11, 6, height + 22);
    }
    color.fillStyle = '#d8ddd9';
    color.beginPath();
    color.arc(x + 17, y + 17, 5, 0, Math.PI * 2);
    color.fill();
    color.font = 'bold 15px sans-serif';
    color.fillText(`IT${icIndex + 1}`, x + 31, y + 23);
    bump.fillStyle = '#272727';
    bump.fillRect(x, y, width, height);
    roughness.fillStyle = '#585858';
    roughness.fillRect(x, y, width, height);
  });

  // Small SMD resistors and capacitors add scale when zooming into a disk.
  for (let index = 0; index < 34; index++) {
    const x = 34 + ((index * 83) % 930);
    const y = 38 + ((index * 137) % 920);
    const vertical = index % 3 === 0;
    const width = vertical ? 12 : 30;
    const height = vertical ? 30 : 12;
    color.fillStyle = index % 2 === 0 ? '#b8a477' : '#71847c';
    color.fillRect(x, y, width, height);
    color.fillStyle = '#c8c4ae';
    if (vertical) {
      color.fillRect(x, y, width, 4);
      color.fillRect(x, y + height - 4, width, 4);
    } else {
      color.fillRect(x, y, 4, height);
      color.fillRect(x + width - 4, y, 4, height);
    }
    bump.fillStyle = '#bcbcbc';
    bump.fillRect(x, y, width, height);
  }

  // Sparse silkscreen reference marks.
  color.strokeStyle = 'rgba(226, 235, 227, 0.58)';
  color.lineWidth = 3;
  color.strokeRect(26, 26, 972, 972);
  color.fillStyle = 'rgba(235, 241, 236, 0.72)';
  color.font = 'bold 19px sans-serif';
  color.fillText('CMS IT  •  PHASE-2', 34, 1010);

  const makeTexture = (canvas: HTMLCanvasElement, srgb = false): THREE.CanvasTexture => {
    const texture = new THREE.CanvasTexture(canvas);
    if (srgb) {
      texture.colorSpace = THREE.SRGBColorSpace;
    }
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(2.25, 2.25);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    return texture;
  };
  return {
    color: makeTexture(colorCanvas, true),
    bump: makeTexture(bumpCanvas),
    roughness: makeTexture(roughnessCanvas),
  };
}

function studioBackgroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(460, 390, 40, 512, 512, 760);
    gradient.addColorStop(0, '#f7f9fc');
    gradient.addColorStop(0.52, '#e7edf4');
    gradient.addColorStop(1, '#cfd9e4');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
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
    bevelEnabled: true,
    bevelSize: Math.min(0.006, depth * 0.12),
    bevelThickness: Math.min(0.004, depth * 0.1),
    bevelSegments: 2,
    curveSegments: 128,
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
  private readonly boardTextures: BoardTextures;
  private readonly backgroundTexture: THREE.CanvasTexture;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly elements = new Map<string, ElementMesh>();
  private readonly supports: SupportMesh[] = [];
  private readonly dividers: DividerMesh[] = [];
  private readonly beamPipe = new THREE.Group();
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
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.backgroundTexture = studioBackgroundTexture();
    this.scene.background = this.backgroundTexture;
    this.boardTextures = circuitBoardTextures();
    const anisotropy = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    Object.values(this.boardTextures).forEach((texture) => {
      texture.anisotropy = anisotropy;
    });
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
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
    this.addChipDividers();
    this.addBeamPipe();
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
    this.scene.add(new THREE.HemisphereLight(0xf8fbff, 0x607080, 1.55));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    const key = new THREE.DirectionalLight(0xfff9ef, 2.75);
    key.position.set(4.5, 6.5, 7.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 0.1;
    key.shadow.camera.far = 24;
    key.shadow.camera.left = -5;
    key.shadow.camera.right = 5;
    key.shadow.camera.top = 5;
    key.shadow.camera.bottom = -5;
    key.shadow.bias = -0.00015;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xdcecff, 1.3);
    fill.position.set(-6, 1.5, -4.5);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xbad5e8, 1.05);
    rim.position.set(-2.5, 5, -7);
    this.scene.add(rim);
    const lowerFill = new THREE.PointLight(0xffffff, 0.7, 18, 2);
    lowerFill.position.set(0, -5, 2);
    this.scene.add(lowerFill);
  }

  private boardMaterial(): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: this.boardTextures.color,
      bumpMap: this.boardTextures.bump,
      bumpScale: 0.018,
      roughnessMap: this.boardTextures.roughness,
      metalness: 0.07,
      roughness: 0.62,
      clearcoat: 0.18,
      clearcoatRoughness: 0.68,
      side: THREE.DoubleSide,
      depthWrite: true,
    });
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
          96,
          1,
          true,
          thetaStart,
          Math.PI
        );
        const material = this.boardMaterial();
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.z = (zMin + zMax) / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
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
      const material = this.boardMaterial();
      const mesh = new THREE.Mesh(geometry, material);
      const basePositions = sectionModules.map((module) => {
        const direction = module.side === '+z' ? 1 : -1;
        const surfaceDirection = module.diskSurface === 'inner' ? -1 : 1;
        return module.position[2] - direction * surfaceDirection * 0.026;
      });
      mesh.position.z =
        basePositions.reduce((sum, position) => sum + position, 0)
        / basePositions.length;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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
      mesh.castShadow = true;
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

  private addChipDividers(): void {
    const sections = new Map<string, THREE.Vector3[]>();
    for (const module of this.modules) {
      const matrix = matrixFor(module);
      const transformed = chipDividerSegments(module)
        .map((point) => point.clone().applyMatrix4(matrix));
      const key = `${module.visibilityKey}|${module.sectionKey}`;
      const points = sections.get(key) ?? [];
      points.push(...transformed);
      sections.set(key, points);
    }

    for (const [key, points] of sections) {
      const [visibilityKey, sectionKey] = key.split('|');
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: 0x8aa19d,
        transparent: true,
        opacity: 0.95,
        depthTest: true,
        depthWrite: false,
        toneMapped: false,
      });
      const mesh = new THREE.LineSegments(geometry, material);
      mesh.renderOrder = 4;
      this.dividers.push({ mesh, visibilityKey, sectionKey });
      this.scene.add(mesh);
    }
  }

  private addBeamPipe(): void {
    const length = 9.25;
    const outerRadius = 0.052;
    const innerRadius = 0.043;
    const outerMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xb7aa82,
      metalness: 0.72,
      roughness: 0.3,
      clearcoat: 0.28,
      clearcoatRoughness: 0.3,
      side: THREE.DoubleSide,
    });
    const innerMaterial = new THREE.MeshStandardMaterial({
      color: 0x20262b,
      metalness: 0.25,
      roughness: 0.76,
      side: THREE.BackSide,
    });
    const ringMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x8d8060,
      metalness: 0.82,
      roughness: 0.27,
      clearcoat: 0.18,
    });

    const outerGeometry = new THREE.CylinderGeometry(
      outerRadius,
      outerRadius,
      length,
      48,
      1,
      true
    );
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    outer.rotation.x = Math.PI / 2;
    outer.castShadow = true;
    outer.receiveShadow = true;
    this.beamPipe.add(outer);

    const innerGeometry = new THREE.CylinderGeometry(
      innerRadius,
      innerRadius,
      length + 0.012,
      48,
      1,
      true
    );
    const inner = new THREE.Mesh(innerGeometry, innerMaterial);
    inner.rotation.x = Math.PI / 2;
    this.beamPipe.add(inner);

    // Narrow reinforcing collars give the pipe scale and definition without
    // obscuring the detector modules behind it.
    for (const z of [-4.56, -3.1, -1.55, 0, 1.55, 3.1, 4.56]) {
      const ringGeometry = new THREE.TorusGeometry(outerRadius * 1.07, 0.005, 10, 48);
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.position.z = z;
      ring.castShadow = true;
      this.beamPipe.add(ring);
    }

    // Annular end faces make the hollow bore clear when viewing along Z.
    for (const z of [-length / 2, length / 2]) {
      const faceGeometry = new THREE.RingGeometry(innerRadius, outerRadius, 48);
      const face = new THREE.Mesh(faceGeometry, ringMaterial);
      face.position.z = z;
      face.rotation.y = z < 0 ? Math.PI : 0;
      this.beamPipe.add(face);
    }

    this.beamPipe.name = 'beam-pipe';
    this.beamPipe.renderOrder = 1;
    this.scene.add(this.beamPipe);
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
    for (const divider of this.dividers) {
      divider.mesh.visible = visible(divider.visibilityKey, divider.sectionKey, visibility);
    }
    this.clearHover();
  }

  setCameraMode(mode: CameraMode): void {
    this.controls.mouseButtons.LEFT = mode === 'rotate'
      ? THREE.MOUSE.ROTATE
      : THREE.MOUSE.PAN;
    this.controls.mouseButtons.RIGHT = mode === 'rotate'
      ? THREE.MOUSE.PAN
      : THREE.MOUSE.ROTATE;
    this.controls.touches.ONE = mode === 'rotate'
      ? THREE.TOUCH.ROTATE
      : THREE.TOUCH.PAN;
    this.renderer.domElement.dataset.cameraMode = mode;
  }

  setBeamPipeVisible(visible: boolean): void {
    this.beamPipe.visible = visible;
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
    for (const divider of this.dividers) {
      divider.mesh.geometry.dispose();
      (divider.mesh.material as THREE.Material).dispose();
    }
    this.beamPipe.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    (this.outline.geometry as THREE.BufferGeometry).dispose();
    (this.outline.material as THREE.Material).dispose();
    Object.values(this.boardTextures).forEach((texture) => texture.dispose());
    this.backgroundTexture.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
