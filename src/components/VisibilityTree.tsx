import React, { useEffect, useRef } from 'react';
import { VisibilityState } from '../types';

interface VisibilityTreeProps {
  value: VisibilityState;
  onChange: (value: VisibilityState) => void;
  onResetCamera: () => void;
}

interface GroupProps {
  label: string;
  itemLabel: string;
  values: boolean[];
  onChange: (values: boolean[]) => void;
  partLabels: string[];
  partValues: boolean[];
  onPartsChange: (values: boolean[]) => void;
}

const CheckBox = ({
  checked,
  indeterminate = false,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
}) => {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.currentTarget.checked)}
    />
  );
};

const VisibilityGroup = ({
  label,
  itemLabel,
  values,
  onChange,
  partLabels,
  partValues,
  onPartsChange,
}: GroupProps) => {
  const enabled = values.filter(Boolean).length;
  const enabledParts = partValues.filter(Boolean).length;
  const all = enabled === values.length && enabledParts === partValues.length;
  const partial = (enabled > 0 || enabledParts > 0) && !all;

  return (
    <div className="cmsit3d-group">
      <label className="cmsit3d-parent">
        <CheckBox
          checked={all}
          indeterminate={partial}
          onChange={(checked) => {
            onChange(values.map(() => checked));
            onPartsChange(partValues.map(() => checked));
          }}
        />
        <span>{label}</span>
        <small>{enabled}/{values.length}</small>
      </label>
      <div className="cmsit3d-children">
        {values.map((checked, index) => (
          <label key={index}>
            <CheckBox
              checked={checked}
              onChange={(next) => {
                const copy = [...values];
                copy[index] = next;
                onChange(copy);
              }}
            />
            <span>{itemLabel} {index + 1}</span>
          </label>
        ))}
      </div>
      <div className="cmsit3d-parts-title">Visible sections</div>
      <div className="cmsit3d-children cmsit3d-parts">
        {partValues.map((checked, index) => (
          <label key={partLabels[index]}>
            <CheckBox
              checked={checked}
              onChange={(next) => {
                const copy = [...partValues];
                copy[index] = next;
                onPartsChange(copy);
              }}
            />
            <span>{partLabels[index]}</span>
          </label>
        ))}
      </div>
    </div>
  );
};

function allVisibility(enabled: boolean): VisibilityState {
  return {
    TBPX: Array(4).fill(enabled),
    TFPX: Array(8).fill(enabled),
    TEPX: Array(4).fill(enabled),
    TBPXParts: Array(4).fill(enabled),
    TFPXParts: Array(4).fill(enabled),
    TEPXParts: Array(4).fill(enabled),
  };
}

export const VisibilityTree = ({ value, onChange, onResetCamera }: VisibilityTreeProps) => (
  <aside className="cmsit3d-sidebar">
    <div className="cmsit3d-sidebar-title">Inner Tracker</div>
    <div className="cmsit3d-actions">
      <button type="button" onClick={() => onChange(allVisibility(true))}>Enable all</button>
      <button type="button" onClick={() => onChange(allVisibility(false))}>Disable all</button>
    </div>
    <button type="button" className="cmsit3d-reset" onClick={onResetCamera}>Reset camera</button>

    <VisibilityGroup
      label="TBPX"
      itemLabel="Layer"
      values={value.TBPX}
      onChange={(TBPX) => onChange({ ...value, TBPX })}
      partLabels={['Right half / Z+', 'Right half / Z−', 'Left half / Z+', 'Left half / Z−']}
      partValues={value.TBPXParts}
      onPartsChange={(TBPXParts) => onChange({ ...value, TBPXParts })}
    />
    <VisibilityGroup
      label="TFPX"
      itemLabel="Disk"
      values={value.TFPX}
      onChange={(TFPX) => onChange({ ...value, TFPX })}
      partLabels={['+Z right half', '+Z left half', '−Z right half', '−Z left half']}
      partValues={value.TFPXParts}
      onPartsChange={(TFPXParts) => onChange({ ...value, TFPXParts })}
    />
    <VisibilityGroup
      label="TEPX"
      itemLabel="Disk"
      values={value.TEPX}
      onChange={(TEPX) => onChange({ ...value, TEPX })}
      partLabels={['+Z right half', '+Z left half', '−Z right half', '−Z left half']}
      partValues={value.TEPXParts}
      onPartsChange={(TEPXParts) => onChange({ ...value, TEPXParts })}
    />
    <div className="cmsit3d-help">
      Drag to rotate<br />
      Scroll to zoom<br />
      Right-drag to pan<br />
      Double-click to focus
    </div>
  </aside>
);

export function defaultVisibility(): VisibilityState {
  return allVisibility(true);
}
