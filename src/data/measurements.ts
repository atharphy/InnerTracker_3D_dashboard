import { DataFrame, Field, PanelData } from '@grafana/data';
import {
  AggregationMode,
  ChipMeasurement,
  InnerTracker3DOptions,
  ModuleDescriptor,
  ModuleMeasurement,
  Subdetector,
} from '../types';

type Labels = Record<string, string>;
type MappingEntry = Record<string, unknown>;

interface RawMeasurement {
  value: number;
  unit?: string;
  register?: string;
  chip?: number;
  labels: Labels;
}

function label(labels: Labels, ...names: string[]): string | undefined {
  for (const name of names) {
    if (labels[name] !== undefined) {
      return String(labels[name]);
    }
  }
  return undefined;
}

function numberLabel(labels: Labels, ...names: string[]): number | undefined {
  const value = label(labels, ...names);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function vectorValue(field: Field, index: number): unknown {
  const values = field.values as unknown as { get?: (at: number) => unknown; [key: number]: unknown };
  return typeof values.get === 'function' ? values.get(index) : values[index];
}

function lastFiniteValue(field: Field): number | undefined {
  for (let index = field.values.length - 1; index >= 0; index--) {
    const value = Number(vectorValue(field, index));
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function labelsForField(frame: DataFrame, field: Field): Labels {
  const labels: Labels = { ...(field.labels ?? {}) };

  // Table-shaped queries may return detector identifiers as fields instead of
  // Prometheus labels. Use the last row for those identifiers.
  for (const candidate of frame.fields) {
    if (candidate === field || candidate.type === 'time' || candidate.type === 'number') {
      continue;
    }
    const value = vectorValue(candidate, Math.max(0, candidate.values.length - 1));
    if (value !== undefined && value !== null) {
      labels[candidate.name] = String(value);
    }
  }
  return labels;
}

function rawMeasurements(data: PanelData): RawMeasurement[] {
  const measurements: RawMeasurement[] = [];

  for (const frame of data.series) {
    for (const field of frame.fields) {
      if (field.type !== 'number' || field.name.toLowerCase() === 'time') {
        continue;
      }
      const value = lastFiniteValue(field);
      if (value === undefined) {
        continue;
      }
      const labels = labelsForField(frame, field);
      measurements.push({
        value,
        unit: label(labels, 'unit') ?? field.config.unit,
        register: label(labels, 'register', 'metric', '__name__') ?? frame.name,
        chip: numberLabel(labels, 'chip', 'chip_id'),
        labels,
      });
    }
  }
  return measurements;
}

function normalizeSide(value: unknown): '+z' | '-z' | undefined {
  const normalized = String(value ?? '').toLowerCase().replace(/\s/g, '');
  if (['+z', 'z+', 'plus', 'positive', '1'].includes(normalized)) {
    return '+z';
  }
  if (['-z', 'z-', 'minus', 'negative', '-1'].includes(normalized)) {
    return '-z';
  }
  return undefined;
}

function normalizeSubdetector(value: unknown, entry: MappingEntry): Subdetector | undefined {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized.includes('TBPX')) {
    return 'TBPX';
  }
  if (normalized.includes('TFPX')) {
    return 'TFPX';
  }
  if (normalized.includes('TEPX')) {
    return 'TEPX';
  }
  return entry.layer !== undefined ? 'TBPX' : undefined;
}

function directPlacement(labels: Labels): MappingEntry | undefined {
  const layer = numberLabel(labels, 'layer');
  const disk = numberLabel(labels, 'disk');
  if (layer === undefined && disk === undefined) {
    return undefined;
  }

  return {
    subdetector: label(labels, 'subdetector', 'detector', 'detector_region'),
    layer,
    disk,
    signed_ladder: numberLabel(labels, 'signed_ladder', 'ladder'),
    z_side: label(labels, 'z_side'),
    detector_side: label(labels, 'detector_side', 'side'),
    ring: numberLabel(labels, 'ring'),
    half: label(labels, 'half'),
    module_index: numberLabel(labels, 'module_index', 'module'),
  };
}

function parseMapping(json: string): Record<string, MappingEntry> {
  if (!json.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, MappingEntry>
      : {};
  } catch {
    return {};
  }
}

function hardwareKey(labels: Labels): string | undefined {
  const board = label(labels, 'board', 'board_id');
  const opticalGroup = label(labels, 'optical_group', 'opticalGroup', 'optical_group_id');
  const hybrid = label(labels, 'hybrid', 'hybrid_id');
  return board !== undefined && opticalGroup !== undefined && hybrid !== undefined
    ? `${board}/${opticalGroup}/${hybrid}`
    : undefined;
}

function moduleForPlacement(
  placement: MappingEntry,
  modules: ModuleDescriptor[]
): ModuleDescriptor | undefined {
  const subdetector = normalizeSubdetector(
    placement.subdetector ?? placement.detector ?? placement.detector_region,
    placement
  );
  if (!subdetector) {
    return undefined;
  }

  const moduleIndex = Number(placement.module_index ?? placement.module);
  if (!Number.isFinite(moduleIndex)) {
    return undefined;
  }

  if (subdetector === 'TBPX') {
    return modules.find((module) =>
      module.subdetector === 'TBPX'
      && module.layer === Number(placement.layer)
      && module.ladder === Number(placement.signed_ladder ?? placement.ladder)
      && module.zSide === normalizeSide(placement.z_side)
      && module.moduleIndex === moduleIndex
    );
  }

  return modules.find((module) =>
    module.subdetector === subdetector
    && module.side === normalizeSide(placement.detector_side ?? placement.side)
    && module.disk === Number(placement.disk)
    && module.ring === Number(placement.ring)
    && module.half === String(placement.half).toLowerCase()
    && module.moduleIndex === moduleIndex
  );
}

function aggregate(values: number[], mode: AggregationMode): number {
  if (mode === 'max') {
    return Math.max(...values);
  }
  if (mode === 'min') {
    return Math.min(...values);
  }
  if (mode === 'last') {
    return values[values.length - 1];
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function mapMeasurementsToModules(
  data: PanelData,
  modules: ModuleDescriptor[],
  mappingJson: string,
  aggregation: AggregationMode
): Map<string, ModuleMeasurement> {
  const mapping = parseMapping(mappingJson);
  const grouped = new Map<string, RawMeasurement[]>();

  for (const measurement of rawMeasurements(data)) {
    const key = hardwareKey(measurement.labels);
    const placement = directPlacement(measurement.labels) ?? (key ? mapping[key] : undefined);
    if (!placement) {
      continue;
    }
    const module = moduleForPlacement(placement, modules);
    if (!module) {
      continue;
    }
    const existing = grouped.get(module.id) ?? [];
    existing.push(measurement);
    grouped.set(module.id, existing);
  }

  const result = new Map<string, ModuleMeasurement>();
  for (const [moduleId, values] of grouped) {
    const chipGroups = new Map<number, RawMeasurement[]>();
    values.forEach((measurement) => {
      if (measurement.chip === undefined) {
        return;
      }
      const existing = chipGroups.get(measurement.chip) ?? [];
      existing.push(measurement);
      chipGroups.set(measurement.chip, existing);
    });
    const chips = Object.fromEntries(
      Array.from(chipGroups.entries()).map(([chip, chipValues]) => [
        chip,
        {
          value: aggregate(chipValues.map((measurement) => measurement.value), aggregation),
          unit: chipValues.find((measurement) => measurement.unit)?.unit,
          register: chipValues.find((measurement) => measurement.register)?.register,
        },
      ])
    );
    result.set(moduleId, {
      value: aggregate(values.map((measurement) => measurement.value), aggregation),
      unit: values.find((measurement) => measurement.unit)?.unit,
      register: values.find((measurement) => measurement.register)?.register,
      chipCount: values.length,
      chips,
      hardwareKeys: Array.from(
        new Set(values.map((measurement) => hardwareKey(measurement.labels)).filter(Boolean) as string[])
      ),
    });
  }
  return result;
}

export function measurementColor(
  measurement: ModuleMeasurement | ChipMeasurement | undefined,
  limits: Pick<InnerTracker3DOptions, 'lowerLimit' | 'upperLimit'>,
  colors: { good: string; bad: string; noData: string }
): string {
  if (!measurement) {
    return colors.noData;
  }
  const aboveLow = limits.lowerLimit === undefined || measurement.value >= limits.lowerLimit;
  const belowHigh = limits.upperLimit === undefined || measurement.value <= limits.upperLimit;
  return aboveLow && belowHigh ? colors.good : colors.bad;
}
