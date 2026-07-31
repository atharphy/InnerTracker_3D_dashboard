export interface BarrelLayerConfig {
  halfLadders: number;
  zPlusModules: number;
  zMinusModules: number;
  moduleType: 'double' | 'quad';
  radius: number;
  axialPitch: number;
}

export interface DiskRingConfig {
  modulesPerHalf: number;
  moduleType: 'double' | 'quad';
  innerRadius: number;
  outerRadius: number;
  surface: 'inner' | 'outer';
}

export interface DiskSystemConfig {
  diskZ: number[];
  radialScale: number;
  rings: DiskRingConfig[];
}

export interface DetectorGeometryConfig {
  TBPX: BarrelLayerConfig[];
  TFPX: DiskSystemConfig;
  TEPX: DiskSystemConfig;
}

// The topology matches the existing 2D detector dashboards. Radii and z
// positions are display coordinates and are deliberately isolated here so
// official engineering coordinates can replace them without changing the
// renderer.
export const DEFAULT_GEOMETRY: DetectorGeometryConfig = {
  TBPX: [
    {
      halfLadders: 6,
      zPlusModules: 5,
      zMinusModules: 4,
      moduleType: 'double',
      radius: 0.34,
      axialPitch: 0.2,
    },
    {
      halfLadders: 12,
      zPlusModules: 4,
      zMinusModules: 5,
      moduleType: 'double',
      radius: 0.48,
      axialPitch: 0.2,
    },
    {
      halfLadders: 10,
      zPlusModules: 5,
      zMinusModules: 4,
      moduleType: 'quad',
      radius: 0.64,
      axialPitch: 0.2,
    },
    {
      halfLadders: 14,
      zPlusModules: 4,
      zMinusModules: 5,
      moduleType: 'quad',
      radius: 0.82,
      axialPitch: 0.2,
    },
  ],
  TFPX: {
    diskZ: [1.28, 1.5, 1.72, 1.94, 2.16, 2.38, 2.6, 2.82],
    radialScale: 0.48,
    rings: [
      { modulesPerHalf: 5, surface: 'inner', moduleType: 'double', innerRadius: 0.3, outerRadius: 0.66 },
      { modulesPerHalf: 8, surface: 'outer', moduleType: 'double', innerRadius: 0.74, outerRadius: 1.08 },
      { modulesPerHalf: 6, surface: 'inner', moduleType: 'quad', innerRadius: 1.16, outerRadius: 1.53 },
      { modulesPerHalf: 8, surface: 'outer', moduleType: 'quad', innerRadius: 1.61, outerRadius: 1.98 },
    ],
  },
  TEPX: {
    diskZ: [3.12, 3.44, 3.76, 4.08],
    radialScale: 0.48,
    rings: [
      { modulesPerHalf: 5, surface: 'inner', moduleType: 'quad', innerRadius: 0.34, outerRadius: 0.73 },
      { modulesPerHalf: 7, surface: 'outer', moduleType: 'quad', innerRadius: 0.82, outerRadius: 1.21 },
      { modulesPerHalf: 9, surface: 'inner', moduleType: 'quad', innerRadius: 1.3, outerRadius: 1.69 },
      { modulesPerHalf: 11, surface: 'outer', moduleType: 'quad', innerRadius: 1.78, outerRadius: 2.17 },
      { modulesPerHalf: 12, surface: 'inner', moduleType: 'quad', innerRadius: 2.26, outerRadius: 2.65 },
    ],
  },
};

export function geometryFromJson(json: string): DetectorGeometryConfig {
  if (!json.trim()) {
    return DEFAULT_GEOMETRY;
  }

  try {
    const overrides = JSON.parse(json) as Partial<DetectorGeometryConfig>;
    return {
      TBPX: overrides.TBPX ?? DEFAULT_GEOMETRY.TBPX,
      TFPX: { ...DEFAULT_GEOMETRY.TFPX, ...(overrides.TFPX ?? {}) },
      TEPX: { ...DEFAULT_GEOMETRY.TEPX, ...(overrides.TEPX ?? {}) },
    };
  } catch {
    return DEFAULT_GEOMETRY;
  }
}
