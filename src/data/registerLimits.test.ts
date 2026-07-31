import { effectiveRegisterLimit, REGISTER_LIMITS } from './registerLimits';

describe('register limits', () => {
  it('copies the standard limits from the general dashboard', () => {
    expect(REGISTER_LIMITS.INTERNAL_NTC_REL).toEqual({ unit: 'C', upper: 20 });
    expect(REGISTER_LIMITS.VDDA).toEqual({ unit: 'V', lower: 0.9468, upper: 1.4202 });
  });

  it('uses Auto defaults while allowing numeric and None overrides', () => {
    expect(effectiveRegisterLimit('Auto', 20)).toBe(20);
    expect(effectiveRegisterLimit('21.5', 20)).toBe(21.5);
    expect(effectiveRegisterLimit('None', 20)).toBeUndefined();
  });

  it('leaves virtual registers unbounded in Auto mode', () => {
    expect(effectiveRegisterLimit('Auto', undefined)).toBeUndefined();
  });
});
