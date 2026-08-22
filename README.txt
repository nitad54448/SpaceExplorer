SPACE GROUP EXPLORER — interactive filter update

Pure vanilla HTML/CSS/JS. No framework or external dependency.

Place this folder beside the generated `sg/` directory from cctbx_Harko_v2.py.
Serve it over HTTP (for example: python -m http.server) rather than opening index.html via file://.

FILTER DESIGN
- Crystal system is a flat toggle group: All / Triclinic / Monoclinic / ... / Cubic.
- Bravais is a flat centering toggle group: All / P / A / B / C / I / F / R.
- Number is a real numeric input, 1–230.
- Search remains free text for symbols, Hall symbols and names.
- Crystal and Bravais filters constrain each other. Impossible choices are visibly disabled.
- If a newly chosen broad filter conflicts with an existing narrower filter, the conflicting filter is cleared rather than leaving a confusing empty state.
- Entering a space-group number makes that number authoritative and clears incompatible crystal/Bravais selections.

The rest of the explorer provides the Wyckoff, reflection-condition and symmetry-operation views.
