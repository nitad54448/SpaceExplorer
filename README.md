# Space Group Explorer 1.3 — reviewed replacement

Replace the complete contents of your existing `index.html`, `app.js`, and `styles.css` with the corresponding files in this package. Keep your existing `sg/` directory next to `index.html`. Serve that directory over HTTP. No build step or new application dependencies are required. The uploaded filenames with `(1)` or `(2)` are download names; use the canonical filenames above when installing.

The package does not contain `sg/`, because the data and exporter were not supplied. It preserves the original fetch contract: `sg/index.json`, followed by each index entry's `file` path resolved relative to the page. It does not regenerate or certify cctbx output.

## Confirmed problems and fixes

| Priority | Original problem | Replacement behavior |
| --- | --- | --- |
| Critical | In `evaluateExactCondition`, `i >> 3 < raw.length` means `i >> (3 < raw.length)`, rather than comparing a byte offset. In particular, bit zero is never read successfully, even when set. | Uses explicit floor division and validates the entire bitset size and index. |
| High | Unknown exact encodings, missing matching strata and short bitsets could be treated as passing tests; malformed Base64 could interrupt rendering. | Returns an indeterminate result for invalid, unsupported or uncovered cases. Caches decoded bitsets. |
| High | The source itself documents that legacy flat Wyckoff bitsets cannot represent some nonperiodic site predicates, but still evaluates them as exact. | Refuses legacy `base64-bitset` site data; supported `strata-bitsets` retain the original convention that set bits mean absence. This convention and the stratum ordering still need exporter verification. |
| High | A later-arriving request could overwrite a more recently selected setting, or repopulate details after Clear all. Old details also remained printable while a new load failed. | Aborts superseded requests, checks a monotonically increasing request ID, clears stale details, disables printing during loading/failure and offers Retry. |
| High | `parseInt` silently changed `1.5` to `1`, `1e2` to `1`, and blank input to `0`. | Validates complete numeric input. Requires safe integers in the stated ±1,000,000 range; empty and fractional values are not tested. Treats 000 separately. |
| High | Some unreadable rules were excluded from the verdict while the result still said Allowed. Legacy unresolved zones were silently skipped. | Shows Indeterminate when a necessary test cannot run and no definite failure is known. Passing stored checks say “Not forbidden by stored rules,” with an explicit completeness/intensity qualification. |
| High | Only the first equivalent reflection within each zone was checked. Orbit deduplication could discard separate supplied rules. | Tests every equivalent in each supplied zone and preserves distinct zone records. |
| High | `fmtTriplet` inserted unescaped data into `innerHTML`; several metadata fields were also unescaped. | Escapes coordinate and metadata text before inserting markup. |
| Medium | Search normalization removed minus signs and slashes, conflating symbols such as P1 and P-1. The same normalization affected the standard-symbol fallback. | Preserves meaningful signs and slashes, normalizes whitespace, Unicode minus and combining overbars. |
| Medium | Rule strings were compiled as JavaScript using `Function`; unsupported arithmetic could be accepted accidentally, and strict Content Security Policy could block evaluation. | Parses linear integer expressions directly and uses BigInt modular arithmetic. Supports `h+k=2n`, `2h=4n`, `2*h=4n`, `!=`, signed residues and disjunctions; other syntax is indeterminate. |
| Medium | The old reciprocal-orbit code silently rounded matrix products and substituted an identity rotation if rotations were absent. | Uses supplied rotations, or supplied symmetry-operation matrices as fallback. Requires integral unimodular matrices and safe products; unsupported matrices make the test indeterminate. It does not prove that the supplied group is complete. |
| Medium | The old coordinate fallback assumed valid exact numerators and denominators. | Checks dimensions, denominators and safe-integer arithmetic, refuses unsupported rotation denominators, and flags coordinate-count versus multiplicity mismatches. |
| Medium | Filtering could silently erase other user selections. Wyckoff row selection was mouse-only and could retain a hidden selected row. | Filters intersect explicitly; adds keyboard-operable position buttons, selected-state attributes and consistent position selection. |
| Medium | Printing restored the DOM immediately after `window.print()`, which is not reliably blocking in every browser. Dark-mode variables survived into print styling. | Uses `beforeprint`/`afterprint`, supports the browser's Print command, includes all three sections and all position table rows, and resets print colors. The coordinate inspector still shows the selected position. |

## Scientific presentation and exporter checks

- The P/A/B/C/I/F/R control describes **lattice centring**, rather than the full Bravais lattice type. Its label now reflects that.
- Removed the unqualified `chiral` label pending verification of what the exporter means by it. Sohncke groups and chiral space groups are distinct concepts: see the [IUCr definition of Sohncke groups](https://dictionary.iucr.org/Sohncke_groups). A future exporter should emit unambiguous named fields before this label is restored.
- Missing reflection-condition data no longer implies that every reflection is allowed.
- Centring translations are no longer described as necessarily being added to every displayed operation: whether that would double-count depends on whether `sym_ops` already contains the full centred group.
- Check the exact meaning of `order_z`, `order_p`, the rotation basis/denominator, the completeness of `sym_ops` and `rotations`, `coset_ops` indexing, special-position parametrization, and setting/origin/basis transformations in the generator. The viewer cannot establish these from field names alone.
- The stratum evaluator preserves the exporter's first-matching-stratum convention. It validates the selected record but cannot prove that strata are correctly ordered or exhaustively cover reciprocal space. Nonintegral dual-coordinate results are reported as untested rather than rounded.
- Named and encoded site predicates that disagree are reported as inconsistent. Special-position absences describe the contribution of that orbit alone, rather than necessarily the total crystal intensity.
- Structural index/detail checks and a schema compatibility notice are included. These are not a complete formal schema validator. Schema 14 is retained as the original viewer's declared target, not independently certified.

The next scientific validation should compare a grid of positive and negative Miller indices against cctbx's systematic-absence predicate in each exported setting. Separately check special-position predicates, coordinate multiplicities, origin choices and alternative axes. Include primitive, centred, screw/glide, rhombohedral and complex Wyckoff examples. The [cctbx sgtbx documentation](https://cctbx.github.io/cctbx/cctbx.sgtbx.html) is the relevant API reference.

## Verification performed

`node --check app.js` passed. Run `node tests.cjs` from this directory to repeat the included dependency-free regression checks.

The suite passed 30 logical assertions plus 12 assertions for asynchronous selection, Clear all, load failures, mismatched records and number validation. It uses synthetic fixtures, including the bit-zero regression, signed modular rules, unknown encodings, truncated bitsets, unsafe coordinate markup and checking multiple equivalents.

The suite runs the actual JavaScript in a Node VM with minimal DOM stubs. It does **not** establish actual browser rendering, keyboard navigation, responsive layout or print-preview behavior. A Playwright run was attempted but no browser executable was available. Those visual/interaction checks remain to be performed, alongside validation against the real `sg/` files and exporter.
