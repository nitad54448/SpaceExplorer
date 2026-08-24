# Space Group Explorer

**Space Group Explorer** is a lightweight, zero-dependency web application for inspecting crystallographic space groups, Wyckoff positions, reflection conditions, and symmetry operations across all 527 settings.

Data is pre-derived algebraically using [`cctbx`](https://cctbx.github.io/) and pre-compiled into lightweight per-setting JSON files, providing instantaneous client-side navigation and reflection testing.

---

## Features

* **Complete Space Group Coverage**: Explores all 230 space groups across 527 settings (origin choices, cell choices, and unique axis settings).
* **International Tables Vol. A Formatting**: Full crystallographic typesetting including roto-inversion overbars, screw axis subscripts, vulgar fractions, and Hermann-Mauguin / Hall symbols.
* **Wyckoff Positions & Coordinates**: Complete Wyckoff tables featuring multiplicities, site symmetries, representative coordinates, full coordinate lists, and exact site reflection conditions (systematic absences).
* **Interactive Reflection Tester ($hkl$)**: Instantly checks any Miller index against general space group extinction rules and special position absences, showing pass/fail status and exact rule clauses.
* **Symmetry Operations & Matrices**: Full operator list with 4x4 augmented matrices, fractional translation vectors, centring vectors, and Harker section geometry.
* **Print & Export Ready**: Clean print styling formatted for generating quick PDF reference sheets.
* **Zero External Dependencies**: Pure vanilla JavaScript, CSS, and HTML frontend with decoupled JSON data loading.

---

## Project Structure

```text
├── index.html            # Main web page
├── app.js                # Single-page app logic & reflection evaluator
├── styles.css            # Stylesheet with light/dark mode support
├── sg/                   # Generated JSON database
│   ├── index.json        # Search and picker index
│   └── setting_XXXX.json # Per-setting symmetry, Wyckoff, and condition data
└── scripts/
    ├── cctbx_SpaceExplorer_v7.py  # Database generator (requires cctbx)
    └── audit_sg.py                 # Standalone JSON schema & logic auditor
