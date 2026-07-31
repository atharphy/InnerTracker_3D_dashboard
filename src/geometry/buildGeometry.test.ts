import { buildDetectorGeometry } from './buildGeometry';
import { DEFAULT_GEOMETRY } from './config';

describe('buildDetectorGeometry', () => {
  const modules = buildDetectorGeometry(DEFAULT_GEOMETRY);

  it('builds the complete Inner Tracker topology', () => {
    expect(modules).toHaveLength(2324);
    expect(modules.filter((module) => module.subdetector === 'TBPX')).toHaveLength(756);
    expect(modules.filter((module) => module.subdetector === 'TFPX')).toHaveLength(864);
    expect(modules.filter((module) => module.subdetector === 'TEPX')).toHaveLength(704);
  });

  it('assigns a unique id to every module', () => {
    expect(new Set(modules.map((module) => module.id)).size).toBe(modules.length);
  });

  it('does not duplicate any detector position', () => {
    const positions = modules.map((module) => [
      module.subdetector,
      module.side,
      module.layer,
      module.disk,
      module.ladder,
      module.zSide,
      module.ring,
      module.half,
      module.moduleIndex,
    ].join(':'));
    expect(new Set(positions).size).toBe(modules.length);
  });

  it('creates all configured elements', () => {
    expect(new Set(modules.map((module) => module.visibilityKey))).toEqual(
      new Set([
        'TBPX:1', 'TBPX:2', 'TBPX:3', 'TBPX:4',
        'TFPX:1', 'TFPX:2', 'TFPX:3', 'TFPX:4',
        'TFPX:5', 'TFPX:6', 'TFPX:7', 'TFPX:8',
        'TEPX:1', 'TEPX:2', 'TEPX:3', 'TEPX:4',
      ])
    );
  });

  it('assigns every module to one selectable detector section', () => {
    const sections = new Set(modules.map((module) => module.sectionKey));
    expect(sections).toEqual(new Set([
      'TBPX:right:+z', 'TBPX:right:-z',
      'TBPX:left:+z', 'TBPX:left:-z',
      'TFPX:+z:upper', 'TFPX:+z:lower',
      'TFPX:-z:upper', 'TFPX:-z:lower',
      'TEPX:+z:upper', 'TEPX:+z:lower',
      'TEPX:-z:upper', 'TEPX:-z:lower',
    ]));
  });

  it('places configured disk halves on the right and left', () => {
    const right = modules.filter((module) =>
      module.subdetector === 'TFPX'
      && module.side === '+z'
      && module.disk === 1
      && module.half === 'upper'
    );
    const left = modules.filter((module) =>
      module.subdetector === 'TFPX'
      && module.side === '+z'
      && module.disk === 1
      && module.half === 'lower'
    );
    expect(right.every((module) => module.position[0] >= -1e-12)).toBe(true);
    expect(left.every((module) => module.position[0] <= 1e-12)).toBe(true);
  });

  it('keeps barrel modules wholly inside their spatial half', () => {
    const barrel = modules.filter((module) => module.subdetector === 'TBPX');
    expect(barrel.every((module) =>
      module.sectionKey.includes(':right:')
        ? module.position[0] > 0
        : module.position[0] < 0
    )).toBe(true);
  });

  it('places inner and outer rings on opposite disk faces', () => {
    const plusInner = modules.find((module) =>
      module.subdetector === 'TFPX'
      && module.side === '+z'
      && module.disk === 1
      && module.ring === 1
    );
    const plusOuter = modules.find((module) =>
      module.subdetector === 'TFPX'
      && module.side === '+z'
      && module.disk === 1
      && module.ring === 2
    );
    const minusInner = modules.find((module) =>
      module.subdetector === 'TFPX'
      && module.side === '-z'
      && module.disk === 1
      && module.ring === 1
    );
    const minusOuter = modules.find((module) =>
      module.subdetector === 'TFPX'
      && module.side === '-z'
      && module.disk === 1
      && module.ring === 2
    );

    expect(plusInner!.position[2]).toBeLessThan(plusOuter!.position[2]);
    expect(minusInner!.position[2]).toBeGreaterThan(minusOuter!.position[2]);
    expect(plusInner!.rotationY).toBe(0);
    expect(plusOuter!.rotationY).toBe(0);
    expect(minusInner!.rotationY).toBe(0);
    expect(minusOuter!.rotationY).toBe(0);
  });

  it('points the narrow edge of every disk wedge towards the beam opening', () => {
    const diskModules = modules.filter((module) => module.subdetector !== 'TBPX');
    expect(diskModules.every((module) => {
      const theta = Math.atan2(module.position[1], module.position[0]);
      const difference = module.rotationZ - theta;
      return Math.abs(Math.sin(difference) + 1) < 1e-12
        && Math.abs(Math.cos(difference)) < 1e-12;
    })).toBe(true);
  });

  it('changes the disk wedge taper with the radial ring position', () => {
    const tepxDiskOne = modules.filter((module) =>
      module.subdetector === 'TEPX'
      && module.side === '+z'
      && module.disk === 1
      && module.half === 'upper'
    );
    const ringRatios = [1, 2, 3, 4, 5].map((ring) =>
      tepxDiskOne.find((module) => module.ring === ring)!.wedgeInnerRatio!
    );
    expect(ringRatios.every((ratio, index) =>
      index === 0 || ratio > ringRatios[index - 1]
    )).toBe(true);
  });

  it('uses the exact outer chord width for every disk wedge', () => {
    const diskModules = modules.filter((module) => module.subdetector !== 'TBPX');
    expect(diskModules.every((module) => {
      const ratio = module.wedgeInnerRatio!;
      const radius = Math.hypot(module.position[0], module.position[1]);
      const outerRadius = (2 * radius) / (1 + ratio);
      const config = module.subdetector === 'TFPX'
        ? DEFAULT_GEOMETRY.TFPX
        : DEFAULT_GEOMETRY.TEPX;
      const ring = config.rings[module.ring! - 1];
      const angularPitch = Math.PI / ring.modulesPerHalf;
      const expectedWidth = 2 * outerRadius * Math.sin(angularPitch / 2);
      return Math.abs(module.size[0] - expectedWidth) < 1e-12;
    })).toBe(true);
  });

  it('gives neighbouring disk wedges identical polar boundary corners', () => {
    const ring = modules.filter((module) =>
      module.subdetector === 'TEPX'
      && module.side === '+z'
      && module.disk === 1
      && module.ring === 5
    );
    const first = ring[0];
    const second = ring[1];
    const firstTheta = Math.atan2(first.position[1], first.position[0]);
    const secondTheta = Math.atan2(second.position[1], second.position[0]);
    const sharedFromFirst = firstTheta + first.wedgeHalfAngle!;
    const sharedFromSecond = secondTheta - second.wedgeHalfAngle!;
    expect(Math.sin(sharedFromFirst)).toBeCloseTo(Math.sin(sharedFromSecond), 12);
    expect(Math.cos(sharedFromFirst)).toBeCloseTo(Math.cos(sharedFromSecond), 12);
  });

  it('alternates the four- and five-module barrel sides by layer', () => {
    const expected = [
      { minus: 4, plus: 5 },
      { minus: 5, plus: 4 },
      { minus: 4, plus: 5 },
      { minus: 5, plus: 4 },
    ];
    expected.forEach(({ minus, plus }, index) => {
      const layer = index + 1;
      const ladderOne = modules.filter((module) =>
        module.subdetector === 'TBPX'
        && module.layer === layer
        && module.ladder === 1
      );
      expect(ladderOne.filter((module) => module.zSide === '-z')).toHaveLength(minus);
      expect(ladderOne.filter((module) => module.zSide === '+z')).toHaveLength(plus);
      expect(ladderOne.every((module) => Math.abs(module.position[2]) > 0)).toBe(true);
    });
  });

  it('keeps the complete barrel symmetric across its four layers', () => {
    const barrel = modules.filter((module) => module.subdetector === 'TBPX');
    const zPositions = barrel.map((module) => module.position[2]);
    expect(Math.max(...zPositions)).toBeCloseTo(-Math.min(...zPositions), 12);
  });
});
