export interface RegisterLimits {
  unit: string;
  lower?: number;
  upper?: number;
}

// Kept in sync with inner_tracker_dashboard_general/register_limits.py.
// Virtual registers intentionally have no entry: their limits are supplied
// through the editable dashboard fields.
export const REGISTER_LIMITS: Record<string, RegisterLimits> = {
  ANA_IN_CURR: { unit: 'uA', lower: 606409, upper: 909613 },
  DIG_IN_CURR: { unit: 'uA', lower: 500317, upper: 750475 },
  INTERNAL_NTC_ABS: { unit: 'C', upper: 20.0 },
  INTERNAL_NTC_REL: { unit: 'C', upper: 20.0 },
  Iref: { unit: 'uA', lower: 2.8106, upper: 4.2159 },
  VDDA: { unit: 'V', lower: 0.9468, upper: 1.4202 },
  VINA: { unit: 'V', lower: 1.0024, upper: 1.5036 },
  VIND: { unit: 'V', lower: 0.9992, upper: 1.4988 },
};

export function effectiveRegisterLimit(
  input: string,
  automatic: number | undefined
): number | undefined {
  const normalized = input.trim().toLowerCase();
  if (!normalized || normalized === 'auto' || normalized.includes('${')) {
    return automatic;
  }
  if (normalized === 'none') {
    return undefined;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : automatic;
}
