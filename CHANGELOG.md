# Changelog

## 0.1.10

- Send monitoring colours through an explicit per-instance GPU attribute and
  dedicated status shader for reliable live chip colouring.

## 0.1.9

- Render live chip status with unlit, tone-mapping-independent materials so
  good and bad colours remain visible from every camera angle.

## 0.1.8

- Restore the system-test hardware mapping to TBPX Layer 3 module position 1.
- Pass the hovered live measurement directly into details navigation and do
  not open an unfiltered details dashboard for modules without hardware data.

## 0.1.7

- Map the current system-test hardware to TBPX Layer 3 module position 5.
- Add automatic standard-register limits copied from the general dashboard,
  with editable numeric or `None` overrides for all registers.

## 0.1.6

- Align TBPX signed-ladder numbering with the spatial right and left halves.

## 0.1.5

- Apply disk spacing around each complete module while retaining only a thin
  divider between its internal chips.

## 0.1.4

- Make the disk-module separators visible at the complete-detector zoom level.

## 0.1.3

- Add a narrow, consistent separator between neighbouring disk modules.

## 0.1.2

- Keep disk rings in separate instanced meshes so every ring uses its own
  polar trapezoid geometry.

## 0.1.1

- Build disk modules from exact per-ring polar trapezoids.
- Correct disk wedge orientation and shared angular boundaries.
- Add chip-level rendering, dynamic registers and dashboard limit controls.

## 0.1.0

- Initial interactive full Inner Tracker 3D Grafana panel.
- Added TBPX, TFPX and TEPX module geometry.
- Added visibility controls, live-value colouring, hover details and module navigation.
