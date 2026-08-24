#!/usr/bin/env python
"""Audit a generated sg/ folder. No cctbx required.

Reads the JSON the generator wrote and checks it against itself. The strongest
check needs no external authority at all: the general Wyckoff position's own
structure-factor sum IS the space group's systematic absence rule, so the
conditions stored in reflection_zones can be held against a calculation that
never consulted them. If the zone derivation is wrong anywhere, those two
disagree.

    python audit_sg.py                 # audits ./sg next to the app
    python audit_sg.py --sg path/to/sg --gen path/to/cctbx_SpaceExplorer_v6.py
    python audit_sg.py --box 6         # larger reflection box, slower
    python audit_sg.py --only 205,88   # a few space groups
    python audit_sg.py --selftest      # prove the auditor catches planted faults

Exits nonzero if anything failed.
"""
import argparse, ast, base64, json, os, re, sys, math, itertools, functools, tempfile
from collections import OrderedDict
from fractions import Fraction
from math import gcd

SCHEMA_EXPECTED = 13


# --------------------------------------------------------------- generator
def load_generator(path):
    """Pull the pure functions out of the generator without importing cctbx."""
    ns = dict(OrderedDict=OrderedDict, Fraction=Fraction, gcd=gcd, base64=base64,
              math=math, itertools=itertools, sys=sys, re=re, functools=functools)
    for node in ast.parse(open(path, encoding='utf-8').read()).body:
        if isinstance(node, (ast.FunctionDef, ast.Assign)):
            try:
                exec(compile(ast.Module([node], []), '<gen>', 'exec'), ns)
            except Exception:
                pass
    missing = [n for n in ('site_is_absent', 'reflection_is_absent', 'evaluate_rule',
                           '_machinery_from_data', '_rank3')
               if n not in ns]
    if missing:
        sys.exit(f"{path} does not define {', '.join(missing)} -- is it the current script?")
    return ns


# ------------------------------------------------------------------ report
class Report:
    def __init__(self):
        self.fail = OrderedDict()
        self.checked = 0

    def bad(self, category, detail):
        self.fail.setdefault(category, []).append(detail)

    def done(self):
        print()
        if not self.fail:
            print(f"{self.checked} setting(s) audited. Everything agrees.")
            return 0
        total = sum(len(v) for v in self.fail.values())
        print(f"{self.checked} setting(s) audited, {total} problem(s):\n")
        for cat, items in self.fail.items():
            print(f"  {cat}  ({len(items)})")
            for d in items[:6]:
                print(f"      {d}")
            if len(items) > 6:
                print(f"      ... and {len(items) - 6} more")
        return 1


def box_points(rng):
    for h in range(-rng, rng + 1):
        for k in range(-rng, rng + 1):
            for l in range(-rng, rng + 1):
                if (h, k, l) != (0, 0, 0):
                    yield (h, k, l)


# ----------------------------------------------------------------- checks
def check_setting(d, ns, rng, rep, do_invariance=True):
    tag = f"SG {d.get('number')} {d.get('symbol')} ({d.get('description')})"
    ops = d.get("sym_ops") or []
    zones = d.get("reflection_zones") or []
    zone_defs = d.get("zone_defs") or {}
    wy = d.get("wyckoff") or []

    if d.get("schema_version") != SCHEMA_EXPECTED:
        rep.bad("schema version", f"{tag}: {d.get('schema_version')}")

    # --- operators -------------------------------------------------------
    if len(ops) != d.get("order_z"):
        rep.bad("operator count", f"{tag}: {len(ops)} ops, order_z {d.get('order_z')}")
    keys = {(tuple(o["r"]), tuple(Fraction(n, o["t_den"]) % 1 for n in o["t_num"]))
            for o in ops}
    if len(keys) != len(ops):
        rep.bad("duplicate operators", tag)

    ident = (1, 0, 0, 0, 1, 0, 0, 0, 1)
    centring = {tuple(Fraction(n, o["t_den"]) % 1 for n in o["t_num"])
                for o in ops if tuple(o["r"]) == ident}
    stored = {tuple(Fraction(n, t["t_den"]) % 1 for n in t["t_num"])
              for t in d.get("centring_translations") or []}
    if centring != stored:
        rep.bad("centring translations", f"{tag}: {len(stored)} stored, {len(centring)} implied")
    expect = {"P": 1, "A": 2, "B": 2, "C": 2, "I": 2, "R": 3, "F": 4, "H": 3}
    want = expect.get(d.get("centering"))
    if want and want != len(centring):
        rep.bad("centring letter", f"{tag}: {d.get('centering')} with {len(centring)}")

    # --- Wyckoff structure ----------------------------------------------
    general = [w for w in wy if w.get("n_free") == 3]
    if len(general) != 1:
        rep.bad("general position", f"{tag}: {len(general)} positions with n_free=3")
    for w in wy:
        name = f"{w.get('multiplicity')}{w.get('letter')}"
        if "coset_ops" in w and w.get("coset_exact") is not False:
            if len(w["coset_ops"]) != w.get("multiplicity"):
                rep.bad("coset count", f"{tag} {name}")
        if "coordinates" in w:
            if len(w["coordinates"]) != w.get("multiplicity"):
                rep.bad("coordinate count", f"{tag} {name}")
            if w["coordinates"] and w.get("coordinate") != w["coordinates"][0]:
                rep.bad("coordinate mismatch", f"{tag} {name}")
        if "P_num" in w and ns['_rank3'](w["P_num"], w["P_den"]) != w.get("n_free"):
            rep.bad("n_free vs projector rank", f"{tag} {name}")
        for label in (w.get("conditions") or {}):
            if label not in zone_defs and not any(z["zone"] == label for z in zones):
                rep.bad("unresolvable zone label", f"{tag} {name}: {label}")

    # --- the general position IS the space group's absence rule ----------
    if general and ops:
        w = general[0]
        try:
            N, A, W = ns['_machinery_from_data'](ops, w["coset_ops"], w["P_num"],
                                                 w["P_den"], w["T_num"], w["T_den"])
        except Exception as e:
            rep.bad("machinery", f"{tag}: {e}")
        else:
            for r in box_points(rng):
                said = ns['reflection_is_absent'](r, zones)
                truth = ns['site_is_absent'](r, N, A, W)
                if said != truth:
                    rep.bad("general conditions vs structure factor",
                            f"{tag}: {r} stored={'absent' if said else 'present'}, "
                            f"calculated={'absent' if truth else 'present'}")
                    break

    # --- absences must be invariant under the point group ----------------
    if do_invariance and zones:
        rots = [[int(round(v)) for v in r] for r in (d.get("rotations") or [])]
        for r in box_points(rng):
            base = ns['reflection_is_absent'](r, zones)
            hit = None
            for R in rots:
                e = (r[0] * R[0] + r[1] * R[3] + r[2] * R[6],
                     r[0] * R[1] + r[1] * R[4] + r[2] * R[7],
                     r[0] * R[2] + r[1] * R[5] + r[2] * R[8])
                if ns['reflection_is_absent'](e, zones) != base:
                    hit = (r, e)
                    break
            if hit:
                rep.bad("absence not symmetry invariant", f"{tag}: {hit[0]} vs {hit[1]}")
                break

    # --- site conditions against the exact calculation -------------------
    if 'check_site_conditions' in ns:
        for mult, letter, why, detail in ns['check_site_conditions'](d, rng=max(rng, 8)):
            rep.bad("site conditions", f"{tag} {mult}{letter}: {why} at {detail}")

    # --- the exact fallback, decoded the way the app decodes it ------------
    for w in wy:
        ex = w.get("conditions_exact")
        if not ex:
            continue
        name = f"{w.get('multiplicity')}{w.get('letter')}"
        if ex.get("encoding") not in ("strata-bitsets", "base64-bitset"):
            rep.bad("bitset header", f"{tag} {name}: {ex.get('encoding')}")
            continue
        try:
            Ns, A, W = ns['_machinery_from_data'](ops, w["coset_ops"], w["P_num"],
                                                  w["P_den"], w["T_num"], w["T_den"])
        except Exception:
            continue
        for r in box_points(rng):
            if ns['reflection_is_absent'](r, zones):
                continue
            if _decode_exact(r, ex) != ns['site_is_absent'](r, Ns, A, W):
                rep.bad("bitset content", f"{tag} {name}: {r}")
                break


def _decode_exact(r, ex):
    """The app's decoder, in Python, so the data is checked as it will be read."""
    h, k, l = r
    if ex["encoding"] == "strata-bitsets":
        for s in ex.get("strata", []):
            if not all(n[0] * h + n[1] * k + n[2] * l == 0 for n in s.get("normals", [])):
                continue
            N = s.get("modulus") or ex["modulus"]
            idx = 0
            for i in range(s["dim"]):
                c = h * s["duals"][0][i] + k * s["duals"][1][i] + l * s["duals"][2][i]
                idx = idx * N + (c % N)
            raw = base64.b64decode(s["data"])
            return bool(raw[idx >> 3] & (1 << (idx & 7))) if idx >> 3 < len(raw) else False
        return False
    N = ex["modulus"]
    idx = ((h % N) * N + (k % N)) * N + (l % N)
    raw = base64.b64decode(ex["data"])
    return bool(raw[idx >> 3] & (1 << (idx & 7))) if idx >> 3 < len(raw) else False


def check_index(sg_dir, rep):
    path = os.path.join(sg_dir, 'index.json')
    idx = json.load(open(path, encoding='utf-8'))
    if idx.get("schema_version") != SCHEMA_EXPECTED:
        rep.bad("schema version", f"index.json: {idx.get('schema_version')}")
    entries = idx.get("settings") or []
    if idx.get("setting_count") != len(entries):
        rep.bad("index count", f"{idx.get('setting_count')} declared, {len(entries)} listed")
    if len({e["setting_number"] for e in entries}) != len(entries):
        rep.bad("index count", "duplicate setting_number")
    if len({e["setting_id"] for e in entries}) != len(entries):
        rep.bad("index count", "duplicate setting_id")
    for e in entries:
        if not e.get("standard_symbol"):
            rep.bad("index fields", f"{e['setting_id']}: no standard_symbol")
    numbers = {n for e in entries for n in [e["setting_number"]]}
    for num, grp in (idx.get("space_groups") or {}).items():
        for s in grp.get("settings", []):
            if not isinstance(s, int) or s not in numbers:
                rep.bad("index fields", f"space_groups[{num}] does not list setting numbers")
                break
    return entries


def audit(sg_dir, gen, rng, only, invariance):
    ns = load_generator(gen)
    rep = Report()
    entries = check_index(sg_dir, rep)
    for n, e in enumerate(entries, 1):
        if only and e["number"] not in only:
            continue
        p = os.path.join(os.path.dirname(sg_dir.rstrip('/\\')), e["file"])
        if not os.path.isfile(p):
            p = os.path.join(sg_dir, os.path.basename(e["file"]))
        if not os.path.isfile(p):
            rep.bad("missing file", e["file"])
            continue
        d = json.load(open(p, encoding='utf-8'))
        for field in ("number", "symbol", "hall", "centering", "order_z"):
            if d.get(field) != e.get(field):
                rep.bad("index fields", f"{e['setting_id']}: {field} differs from its file")
        check_setting(d, ns, rng, rep, invariance)
        rep.checked += 1
        if rep.checked % 25 == 0:
            print(f"  {rep.checked} settings...", end='\r', flush=True)
    return rep.done()


# ---------------------------------------------------------------- selftest
def selftest(gen, rng):
    """Plant known faults and confirm the auditor names them."""
    ns = load_generator(gen)
    P21 = {
        "schema_version": SCHEMA_EXPECTED, "number": 4, "symbol": "P21",
        "description": "standard", "hall": "P 2yb", "centering": "P",
        "order_z": 2, "order_p": 2,
        "sym_ops": [
            {"xyz": "x,y,z", "r": [1, 0, 0, 0, 1, 0, 0, 0, 1],
             "t_num": [0, 0, 0], "t_den": 1},
            {"xyz": "-x,y+1/2,-z", "r": [-1, 0, 0, 0, 1, 0, 0, 0, -1],
             "t_num": [0, 1, 0], "t_den": 2}],
        "centring_translations": [{"t_num": [0, 0, 0], "t_den": 1}],
        "rotations": [[1, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, 1, 0, 0, 0, -1]],
        "reflection_conditions": {"0k0": ["k=2n"]},
        "reflection_zones": [{"zone": "0k0", "orbit": "0k0",
                              "normals": [[1, 0, 0], [0, 0, 1]],
                              "rules": ["k=2n"], "printed": True}],
        "zone_defs": {"hkl": [], "0k0": [[1, 0, 0], [0, 0, 1]]},
        "wyckoff": [{"letter": "a", "multiplicity": 2, "site_symmetry": "1",
                     "special_op": "x,y,z", "n_free": 3,
                     "P_num": [1, 0, 0, 0, 1, 0, 0, 0, 1], "P_den": 1,
                     "T_num": [0, 0, 0], "T_den": 1, "coset_ops": [0, 1],
                     "coordinates": ["x,y,z", "-x,y+1/2,-z"], "coordinate": "x,y,z",
                     "special": False}],
    }

    import copy
    cases = [("clean P21", P21, None)]

    bad = copy.deepcopy(P21)                       # rule the group does not have
    bad["reflection_zones"][0]["rules"] = ["k=3n"]
    cases.append(("wrong general rule", bad, "general conditions vs structure factor"))

    bad = copy.deepcopy(P21)                       # zone dropped entirely
    bad["reflection_zones"] = []
    cases.append(("missing zone", bad, "general conditions vs structure factor"))

    bad = copy.deepcopy(P21)                       # only half an orbit of zones
    bad["reflection_zones"] = [{"zone": "h00", "orbit": "h00",
                                "normals": [[0, 1, 0], [0, 0, 1]],
                                "rules": ["h=2n"], "printed": True}]
    cases.append(("absence not symmetry invariant", bad, None))   # either check may fire

    bad = copy.deepcopy(P21)
    bad["order_z"] = 3
    cases.append(("operator count", bad, "operator count"))

    bad = copy.deepcopy(P21)
    bad["wyckoff"][0]["coset_ops"] = [0]
    cases.append(("coset count", bad, "coset count"))

    bad = copy.deepcopy(P21)
    bad["wyckoff"][0]["conditions"] = {"hkl": ["l=2n"]}
    cases.append(("bogus site condition", bad, "site conditions"))

    bad = copy.deepcopy(P21)
    bad["centering"] = "C"
    cases.append(("wrong centring letter", bad, "centring letter"))

    fails = 0
    for name, data, expect in cases:
        rep = Report()
        check_setting(data, ns, rng, rep)
        cats = list(rep.fail)
        if expect is None and name == "clean P21":
            ok = not cats
        elif expect is None:
            ok = bool(cats)
        else:
            ok = expect in cats
        print(f"  {'PASS' if ok else 'FAIL'}  {name}: "
              f"{', '.join(cats) if cats else 'accepted'}")
        fails += not ok
    print(f"\n{'selftest OK' if not fails else str(fails) + ' selftest failure(s)'}")
    return 1 if fails else 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--sg', default='sg', help="the generated folder (default: ./sg)")
    p.add_argument('--gen', default='cctbx_SpaceExplorer_v6.py',
                   help="the generator, read for its arithmetic only")
    p.add_argument('--box', type=int, default=4,
                   help="reflection box half-width (default 4; 8 is thorough and slow). Site conditions always use at least 8, to stay outside the box the derivation fits against.")
    p.add_argument('--only', default=None, help="space group numbers, e.g. 205,88")
    p.add_argument('--no-invariance', action='store_true',
                   help="skip the point-group invariance sweep")
    p.add_argument('--selftest', action='store_true',
                   help="plant faults and confirm they are caught")
    a = p.parse_args()

    if not os.path.isfile(a.gen):
        here = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            os.path.basename(a.gen))
        a.gen = here if os.path.isfile(here) else a.gen
    if not os.path.isfile(a.gen):
        sys.exit(f"generator not found: {a.gen} (pass --gen)")

    if a.selftest:
        sys.exit(selftest(a.gen, a.box))

    if not os.path.isdir(a.sg):
        sys.exit(f"no such folder: {a.sg} (pass --sg)")
    only = set(int(x) for x in a.only.replace(' ', '').split(',')) if a.only else None
    sys.exit(audit(a.sg, a.gen, a.box, only, not a.no_invariance))


if __name__ == '__main__':
    main()
