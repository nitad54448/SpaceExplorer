"""Checks the site-condition derivation without needing cctbx.

Each case supplies a Wyckoff orbit by hand, together with the space group's own
zone rules, and asks two things of the generator:

  1. that it emits conditions at all, and
  2. that the conditions it emits reproduce the exact structure-factor
     calculation on every reflection in a box that the space group allows.

Test 2 is independent of how the derivation samples reflections, so it catches a
sampling bias rather than agreeing with it.

    python sitecheck.py [generator.py]
"""
import ast, sys, re, base64, math, itertools, functools
from collections import OrderedDict
from fractions import Fraction
from math import gcd

SRC = sys.argv[1] if len(sys.argv) > 1 else 'cctbx_SpaceExplorer_v6.py'
BOX = 8   # outside SITE_VERIFY_BOX, so the check stays independent

ns = dict(OrderedDict=OrderedDict, Fraction=Fraction, gcd=gcd, base64=base64,
          math=math, itertools=itertools, sys=sys, re=re, functools=functools)
src = open(SRC).read()
for node in ast.parse(src).body:                 # skip anything needing cctbx
    if isinstance(node, (ast.FunctionDef, ast.Assign)):
        try:
            exec(compile(ast.Module([node], []), '<x>', 'exec'), ns)
        except Exception:
            pass

# site_reflection_conditions builds its machinery from a cctbx group; here the
# machinery is supplied directly, so that one line is swapped out.
body = src[src.index('def site_reflection_conditions'):]
body = body[:body.index('\ndef ', 1)]
body = body.replace(
    "    N, A_list, w_list = site_absence_machinery(\n"
    "        sg, coset_ops, P_num, P_den, T_num, T_den)",
    "    N, A_list, w_list = coset_ops")
exec(compile(body, '<srr>', 'exec'), ns)

site_is_absent = ns['site_is_absent']
reflection_is_absent = ns['reflection_is_absent']
evaluate_rule = ns['evaluate_rule']


def zone(label, basis, normals, rules):
    return {"key": tuple(map(tuple, basis)), "basis": [list(b) for b in basis],
            "dim": len(basis), "normals": [list(n) for n in normals],
            "names": ['h', 'k', 'l'][:len(basis)], "label": label, "rules": rules}


def universe(ruled):
    """The standard zone list, with rules attached where the group has them."""
    out = []
    for rows in ns['STANDARD_ZONES']:
        basis = [list(r) for r in rows]
        d = len(basis)
        if d == 3:
            normals = []
        elif d == 2:
            a, b = basis
            normals = [[a[1] * b[2] - a[2] * b[1],
                        a[2] * b[0] - a[0] * b[2],
                        a[0] * b[1] - a[1] * b[0]]]
        else:
            a = basis[0]
            normals = [n for n in ([0, a[2], -a[1]], [-a[2], 0, a[0]], [a[1], -a[0], 0])
                       if any(n)][:2]
        lab = ns['zone_label'](basis, list(range(d)))
        out.append(zone(lab, basis, normals, ruled.get(lab, [])))
    out.sort(key=lambda z: -z["dim"])
    return out


def machinery_of(case):
    if "machinery" in case:
        return case["machinery"]
    return machinery(case["orbit"], case["den"])


def machinery(orbit, den):
    """N, A_list, w_list for a position whose projector is the zero matrix."""
    N = den
    A_list = [[[0, 0, 0], [0, 0, 0], [0, 0, 0]] for _ in orbit]
    w_list = [[int(round(c * N)) for c in p] for p in orbit]
    return N, A_list, w_list


CASES = [
    dict(name="205 Pa-3, 4a  (F-centred orbit)",
         orbit=[(0, 0, 0), (.5, 0, .5), (0, .5, .5), (.5, .5, 0)],
         den=2,
         ruled={'0kl': ['k=2n'], 'h0l': ['l=2n'], 'hk0': ['h=2n'],
                'h00': ['h=2n'], '0k0': ['k=2n'], '00l': ['l=2n']},
         must_emit=True),
    dict(name="88 I41/a, 4a",
         orbit=[(0, 0, 0), (0, .5, .25), (.5, .5, .5), (.5, 0, .75)],
         den=4,
         ruled={'hkl': ['h+k+l=2n'], '0kl': ['k+l=2n'], 'h0l': ['h+l=2n'],
                'hk0': ['h=2n', 'k=2n'], 'hhl': ['l=2n'], 'h-hl': ['l=2n'],
                'h00': ['h=2n'], '0k0': ['k=2n'], '00l': ['l=4n']},
         must_emit=True),
    # P-4 has no systematic absences of its own. 2g = (0,1/2,z) has an orbit of
    # two points whose phases only share a group when l = 0, so it is extinct
    # exactly when l = 0 and h+k is odd. Over a sample of period two, "l = 0"
    # and "l even" are indistinguishable, and the search used to return the
    # second -- right on its own sample, wrong at (1,0,2).
    dict(name="81 P-4, 2g  (l = 0, not l even)",
         machinery=(2,
                    [[[0, 0, 0], [0, 0, 0], [0, 0, 2]],
                     [[0, 0, 0], [0, 0, 0], [0, 0, -2]]],
                    [[0, 1, 0], [1, 0, 0]]),
         ruled={},
         must_emit=True),
    # P6(2) 3b = (1/2,0,z), orbit (1/2,0,z) (0,1/2,z+1/3) (1/2,1/2,z+2/3).
    # Extinct when h and k are both even and l is not a multiple of three --
    # a three-way disjunction, which no conjunction of the vocabulary reaches.
    dict(name="171 P6(2), 3b  (three-way disjunction)",
         machinery=(6,
                    [[[0, 0, 0], [0, 0, 0], [0, 0, 6]]] * 3,
                    [[3, 0, 0], [0, 3, 2], [-3, -3, 4]]),
         ruled={'00l': ['l=3n']},
         must_emit=True),
    dict(name="221 Pm-3m, 1a  (nothing to say)",
         orbit=[(0, 0, 0)],
         den=2,
         ruled={},
         must_emit=False),
]

fails = 0
for case in CASES:
    zones = universe(case["ruled"])
    N, A_list, w_list = machinery_of(case)
    res = ns['site_reflection_conditions'](
        None, zones, {}, (N, A_list, w_list), None, None, None, None)
    out, complete, exact = res[0], res[1], res[2]
    site_defs = res[3] if len(res) > 3 else {}
    for lab, nrm in (site_defs or {}).items():
        if not any(z["label"] == lab for z in zones):
            zones.append(zone(lab, [], nrm, []))

    rules = {z: list(r) for z, r in out.items()}
    print(f"\n{case['name']}")
    print(f"  conditions {rules or '{}'}   complete={complete}   "
          f"bitset={'yes' if exact else 'no'}")

    def predicted_absent(r, out=out, zones=zones):
        for z in zones:
            if z["label"] not in out or not ns['in_zone'](r, z):
                continue
            for rule in out[z["label"]]:
                if not evaluate_rule(r[0], r[1], r[2], rule):
                    return True
        return False

    missed, spurious, real = [], [], 0
    for h in range(-BOX, BOX + 1):
        for k in range(-BOX, BOX + 1):
            for l in range(-BOX, BOX + 1):
                r = (h, k, l)
                if r == (0, 0, 0) or reflection_is_absent(r, zones):
                    continue
                truth = site_is_absent(r, N, A_list, w_list)
                real += truth
                said = predicted_absent(r)
                if truth and not said and not exact:
                    missed.append(r)
                if said and not truth:
                    spurious.append(r)

    print(f"  {real} reflection(s) within +/-{BOX} are genuinely extinguished here")
    bad = False
    if case["must_emit"] and not rules:
        print("  FAIL: no condition emitted at all"); bad = True
    if spurious:
        print(f"  FAIL: {len(spurious)} wrongly called absent, e.g. {spurious[:3]}"); bad = True
    if missed:
        print(f"  FAIL: {len(missed)} real absence(s) undescribed, no bitset, "
              f"e.g. {missed[:3]}"); bad = True
    if bad:
        fails += 1
    else:
        print("  PASS")

print(f"\n{'ALL PASS' if not fails else str(fails) + ' FAILURE(S)'}")

# ---------------------------------------------------------------------------
# The cross-check in verify(): does it catch a wrong rule in a written setting?
# ---------------------------------------------------------------------------
if 'check_site_conditions' in ns:
    zones = universe(CASES[0]["ruled"])
    setting = {
        # identity rotation, the four F translations: enough for a 4a orbit
        "sym_ops": [{"r": [1, 0, 0, 0, 1, 0, 0, 0, 1], "t_num": t, "t_den": 2}
                    for t in ([0, 0, 0], [1, 0, 1], [0, 1, 1], [1, 1, 0])],
        "reflection_zones": [{"zone": z["label"], "normals": z["normals"],
                              "rules": z["rules"]} for z in zones if z["rules"]],
        "zone_defs": {z["label"]: z["normals"] for z in zones},
        "wyckoff": [],
    }

    def position(rules):
        return {"letter": "a", "multiplicity": 4, "coset_ops": [0, 1, 2, 3],
                "P_num": [0] * 9, "P_den": 1, "T_num": [0, 0, 0], "T_den": 1,
                "conditions": {"hkl": rules}}

    print("\nverify() cross-check on a written Pa-3 4a:")
    for label, rules, should_flag in [
            ("the correct rules", ["h+k=2n", "h+l=2n"], False),
            ("the rule the biased sample used to produce", ["h+k+l=3n"], True),
            ("a rule that is merely too weak", ["h+k=2n"], True)]:
        setting["wyckoff"] = [position(rules)]
        found = ns['check_site_conditions'](setting, rng=4)
        ok = bool(found) == should_flag
        print(f"  {'PASS' if ok else 'FAIL'}  {label}: "
              f"{'flagged ' + str(found[0][2]) if found else 'accepted'}")
        if not ok:
            fails += 1

    print(f"\n{'ALL PASS' if not fails else str(fails) + ' FAILURE(S)'}")

sys.exit(1 if fails else 0)
