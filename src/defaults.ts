import { InnerTracker3DOptions } from './types';

export const DEFAULT_HARDWARE_MAPPING = JSON.stringify({
  '0/0/0': {
    subdetector: 'TBPX',
    layer: 3,
    signed_ladder: 1,
    z_side: 'z+',
    module_index: 1,
  },
});

export const DEFAULT_OPTIONS: InnerTracker3DOptions = {
  nominalValue: 20,
  deviation: 2,
  goodColor: '#329b62',
  badColor: '#e24d42',
  noDataColor: '#2b333d',
  selectedColor: '#f2c96d',
  aggregation: 'mean',
  detailsDashboardUid: 'cmsit-parts-chip-details',
  hardwareMappingJson: DEFAULT_HARDWARE_MAPPING,
  geometryOverridesJson: '',
  showBeamAxis: true,
  rememberVisibility: true,
};
