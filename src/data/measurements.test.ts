import { measurementColor } from './measurements';

describe('measurementColor', () => {
  const colors = { good: '#00ff00', bad: '#ff0000', noData: '#777777' };

  it('uses no-data color when no measurement exists', () => {
    expect(measurementColor(undefined, {}, colors)).toBe(colors.noData);
  });

  it('uses good color inside the allowed deviation', () => {
    expect(
      measurementColor(
        { value: 21.5, chipCount: 1, chips: {}, hardwareKeys: [] },
        { lowerLimit: 18, upperLimit: 22 },
        colors
      )
    ).toBe(colors.good);
  });

  it('uses bad color outside the allowed deviation', () => {
    expect(
      measurementColor(
        { value: 23, chipCount: 1, chips: {}, hardwareKeys: [] },
        { lowerLimit: 18, upperLimit: 22 },
        colors
      )
    ).toBe(colors.bad);
  });

  it('supports open-ended and disabled limits', () => {
    const measurement = { value: 23, chipCount: 1, chips: {}, hardwareKeys: [] };
    expect(measurementColor(measurement, { lowerLimit: 20 }, colors)).toBe(colors.good);
    expect(measurementColor(measurement, { upperLimit: 20 }, colors)).toBe(colors.bad);
    expect(measurementColor(measurement, {}, colors)).toBe(colors.good);
  });
});
