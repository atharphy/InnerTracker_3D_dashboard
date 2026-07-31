import { PanelPlugin } from '@grafana/data';
import { InnerTracker3DPanel } from './components/InnerTracker3DPanel';
import { DEFAULT_OPTIONS } from './defaults';
import { InnerTracker3DOptions } from './types';

export const plugin = new PanelPlugin<InnerTracker3DOptions>(InnerTracker3DPanel)
  .setPanelOptions((builder) => {
    return builder
      .addRadio({
        path: 'aggregation',
        name: 'Chip-to-module aggregation',
        description: 'How multiple live chip values are combined for the module colour.',
        defaultValue: DEFAULT_OPTIONS.aggregation,
        settings: {
          options: [
            { label: 'Mean', value: 'mean' },
            { label: 'Maximum', value: 'max' },
            { label: 'Minimum', value: 'min' },
            { label: 'Latest', value: 'last' },
          ],
        },
      })
      .addColorPicker({
        path: 'goodColor',
        name: 'Within-limits colour',
        defaultValue: DEFAULT_OPTIONS.goodColor,
      })
      .addColorPicker({
        path: 'badColor',
        name: 'Outside-limits colour',
        defaultValue: DEFAULT_OPTIONS.badColor,
      })
      .addColorPicker({
        path: 'noDataColor',
        name: 'No-data colour',
        defaultValue: DEFAULT_OPTIONS.noDataColor,
      })
      .addColorPicker({
        path: 'selectedColor',
        name: 'Hover outline colour',
        defaultValue: DEFAULT_OPTIONS.selectedColor,
      })
      .addTextInput({
        path: 'detailsDashboardUid',
        name: 'Module-details dashboard UID',
        defaultValue: DEFAULT_OPTIONS.detailsDashboardUid,
      })
      .addBooleanSwitch({
        path: 'showBeamAxis',
        name: 'Show beam axis',
        defaultValue: DEFAULT_OPTIONS.showBeamAxis,
      })
      .addBooleanSwitch({
        path: 'rememberVisibility',
        name: 'Remember visibility controls',
        defaultValue: DEFAULT_OPTIONS.rememberVisibility,
      })
      .addTextInput({
        path: 'hardwareMappingJson',
        name: 'Hardware mapping (JSON)',
        description:
          'Map board/optical_group/hybrid keys to detector positions. Direct detector labels in Prometheus take priority.',
        defaultValue: DEFAULT_OPTIONS.hardwareMappingJson,
        settings: {
          useTextarea: true,
          rows: 8,
        },
      })
      .addTextInput({
        path: 'geometryOverridesJson',
        name: '3D placement overrides (JSON)',
        description:
          'Optional TBPX/TFPX/TEPX geometry overrides. Leave empty to use the bundled complete topology.',
        defaultValue: DEFAULT_OPTIONS.geometryOverridesJson,
        settings: {
          useTextarea: true,
          rows: 8,
        },
      });
  });
