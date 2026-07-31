import { DetectorGeometryConfig, DiskSystemConfig } from './config';
import { ModuleDescriptor, Subdetector } from '../types';

const TWO_PI = Math.PI * 2;

function barrelModules(config: DetectorGeometryConfig): ModuleDescriptor[] {
  const modules: ModuleDescriptor[] = [];

  config.TBPX.forEach((layer, layerIndex) => {
    const layerNumber = layerIndex + 1;
    const ladders = layer.halfLadders * 2;
    const angularPitch = TWO_PI / ladders;
    const tangentialSize = Math.max(0.055, layer.radius * angularPitch * 0.78);
    const axialSize = layer.axialPitch * 0.82;

    for (let ladderIndex = 0; ladderIndex < ladders; ladderIndex++) {
      const signedLadder = ladderIndex < layer.halfLadders
        ? ladderIndex + 1
        : -(ladderIndex - layer.halfLadders + 1);
      // Centre ladders within their angular cells so none straddles the
      // Y-axis used to divide the barrel into spatial right/left halves.
      const theta = (ladderIndex + 0.5) * angularPitch;
      const barrelHalf = Math.cos(theta) >= 0 ? 'right' : 'left';

      const addSide = (side: '+z' | '-z', count: number) => {
        for (let moduleIndex = 1; moduleIndex <= count; moduleIndex++) {
          const direction = side === '+z' ? 1 : -1;
          const axial = direction * (moduleIndex - 0.5) * layer.axialPitch;
          modules.push({
            id: `TBPX:L${layerNumber}:ladder${signedLadder}:${side}:module${moduleIndex}`,
            visibilityKey: `TBPX:${layerNumber}`,
            sectionKey: `TBPX:${barrelHalf}:${side}`,
            subdetector: 'TBPX',
            layer: layerNumber,
            ladder: signedLadder,
            zSide: side,
            moduleIndex,
            moduleType: layer.moduleType,
            position: [layer.radius * Math.cos(theta), layer.radius * Math.sin(theta), axial],
            rotationY: 0,
            rotationZ: theta - Math.PI / 2,
            size: [tangentialSize, 0.025, axialSize],
          });
        }
      };

      addSide('-z', layer.zMinusModules);
      addSide('+z', layer.zPlusModules);
    }
  });

  return modules;
}

function diskModules(subdetector: Exclude<Subdetector, 'TBPX'>, config: DiskSystemConfig): ModuleDescriptor[] {
  const modules: ModuleDescriptor[] = [];

  for (const side of ['-z', '+z'] as const) {
    const direction = side === '+z' ? 1 : -1;
    config.diskZ.forEach((absoluteZ, diskIndex) => {
      const disk = diskIndex + 1;

      config.rings.forEach((ring, ringIndex) => {
        const ringNumber = ringIndex + 1;
        const totalModules = ring.modulesPerHalf * 2;
        const angularPitch = TWO_PI / totalModules;
        const inner = ring.innerRadius * config.radialScale;
        const outer = ring.outerRadius * config.radialScale;
        const radialLength = outer - inner;
        const radius = (inner + outer) / 2;
        const tangentialSize = Math.max(
          0.045,
          // The outer edge is the chord between the two angular boundaries.
          2 * outer * Math.sin(angularPitch / 2)
        );
        // "Inner" faces the interaction point on both detector sides; "outer"
        // faces away from it. Multiplying by direction keeps that convention
        // correct on both +Z and -Z.
        const surfaceOffset = direction * (ring.surface === 'inner' ? -0.026 : 0.026);

        for (let index = 0; index < totalModules; index++) {
          // Start at -90 degrees so the first configured half occupies the
          // right side of the disk and the second occupies the left side.
          // Half-pitch centring keeps the complete wedge inside its selected
          // right/left half instead of placing a module on the Y-axis.
          const theta = (index + 0.5) * angularPitch - Math.PI / 2;
          const upper = index < ring.modulesPerHalf;
          const moduleIndex = upper ? index : index - ring.modulesPerHalf;

          modules.push({
            id: `${subdetector}:${side}:D${disk}:R${ringNumber}:${upper ? 'upper' : 'lower'}:module${moduleIndex}`,
            visibilityKey: `${subdetector}:${disk}`,
            sectionKey: `${subdetector}:${side}:${upper ? 'upper' : 'lower'}`,
            subdetector,
            side,
            disk,
            ring: ringNumber,
            half: upper ? 'upper' : 'lower',
            moduleIndex,
            moduleType: ring.moduleType,
            diskSurface: ring.surface,
            wedgeInnerRatio: inner / outer,
            wedgeHalfAngle: angularPitch / 2,
            position: [
              radius * Math.cos(theta),
              radius * Math.sin(theta),
              direction * absoluteZ + surfaceOffset,
            ],
            // Both disk faces use the same local wedge orientation. The
            // inner/outer distinction is represented by the Z position,
            // avoiding an edge-on silhouette on the opposite detector side.
            rotationY: 0,
            // Local +Y points radially outwards: the narrow edge therefore
            // faces the beam opening and the wide edge follows the outer arc.
            rotationZ: theta - Math.PI / 2,
            size: [tangentialSize, radialLength, 0.025],
          });
        }
      });
    });
  }

  return modules;
}

export function buildDetectorGeometry(config: DetectorGeometryConfig): ModuleDescriptor[] {
  return [
    ...barrelModules(config),
    ...diskModules('TFPX', config.TFPX),
    ...diskModules('TEPX', config.TEPX),
  ];
}
