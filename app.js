/* Space Group Explorer — vanilla JS, no dependencies.
   Presentation follows International Tables Vol. A: roto-inversions carry an
   overbar, screw axes a subscript, coordinates are italic with vulgar
   fractions, and a Wyckoff position is shown as its full coordinate list. */

const state = {
  requestId: 0,
  controller: null,
  index: null,
  settings: [],
  filtered: [],
  selected: null,
  detail: null,
  tab: 'positions',
  wySelected: 0,
  wyShow: 'all',
  hkl: { h: 1, k: 0, l: 0 },
  opSelected: 0,
  cache: new Map()
};

const $ = id => document.getElementById(id);
const crystal = $('crystal'), bravais = $('bravais'), number = $('number'), search = $('search');

const CRYSTALS = [
  ['triclinic', 'Triclinic'], ['monoclinic', 'Monoclinic'], ['orthorhombic', 'Orthorhombic'],
  ['tetragonal', 'Tetragonal'], ['trigonal', 'Trigonal'], ['hexagonal', 'Hexagonal'], ['cubic', 'Cubic']
];
const CRYSTAL_ORDER = Object.fromEntries(CRYSTALS.map((x, i) => [x[0], i]));
const BRAVAIS_ORDER = ['P', 'A', 'B', 'C', 'I', 'F', 'R'];

const esc = (v = '') => String(v).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (v = '') => String(v).toLowerCase().replace(/−/g, '-').replace(/([1-6])\u0305/g, '-$1').replace(/[\s_]/g, '');

/* ── Crystallographic typesetting ─────────────────────────────────────── */

const VULGAR = {
  '1/2': '½', '1/3': '⅓', '2/3': '⅔', '1/4': '¼', '3/4': '¾',
  '1/6': '⅙', '5/6': '⅚', '1/8': '⅛', '3/8': '⅜', '5/8': '⅝', '7/8': '⅞'
};
const vulgar = (n, d) => VULGAR[`${n}/${d}`] || `${n}/${d}`;

/* A Hermann-Mauguin symbol can only be typeset from its spaced form: "P 65 2 2"
   says that 65 is one axis and each 2 is another, which "P6522" does not. The
   generator writes that form as `hm`; without it, fall back to the standard
   symbol's spacing when it matches, and otherwise set the symbol plainly. */
function spacedSymbol(rec) {
  if (!rec) return '';
  if (rec.hm) return rec.hm;
  const std = rec.standard_symbol || '';
  if (std && norm(std) === norm(rec.symbol || '')) return std;
  return rec.symbol || '';
}

function fmtSymbol(src) {
  if (!src) return '';
  const [main, ext] = String(src).split(':');
  const spaced = /\s/.test(main.trim());
  const html = main.trim().split(/\s+/).map(tok => {
    let out = '';
    for (let i = 0; i < tok.length; i++) {
      const c = tok[i];
      if (c === '-' && /\d/.test(tok[i + 1] || '')) {          // roto-inversion
        out += `<span class="ovl">${tok[i + 1]}</span>`;
        i++;
      } else if (spaced && /\d/.test(c) && /\d/.test(tok[i - 1] || '')) {
        out += `<sub>${c}</sub>`;                               // screw axis
      } else {
        out += esc(c);
      }
    }
    return out;
  }).join('');
  return html + (ext ? `<span class="ext">:${esc(ext)}</span>` : '');
}

/* "-x+1/2,y,-z" → "x̄+½, y, z̄" */
function fmtTriplet(src) {
  if (!src) return '—';
  return String(src).split(',').map(part => {
    let s = esc(part.trim().replace(/\s+/g, ''));
    s = s.replace(/(\d+)\/(\d+)/g, (m, n, d) => vulgar(n, d));
    // The overbar stands for a negative variable only at the head of a term.
    // Further along, "x-y" keeps its minus sign, as the tables print it.
    s = s.replace(/([+-]?)([xyz])/g, (m, sign, v, off) =>
      sign === '-'
        ? (off === 0 ? `<i class="ovl">${v}</i>` : `−<i>${v}</i>`)
        : `${sign}<i>${v}</i>`);
    return s;
  }).join('<span class="csep">, </span>');
}

/* "h+k=2n" → "h + k = 2n", set as the book sets it */
function fmtRule(rule) {
  if (!String(rule).includes('=')) return esc(rule);
  return String(rule).split(' or ').map(clause => {
    const neq = clause.includes('!=');
    const [lhs, rhs] = clause.split(neq ? '!=' : '=');
    const left = esc(lhs)
      .replace(/\*/g, '')
      .replace(/(?!^)([+-])/g, ' $1 ')  // a leading sign is not an operator
      .replace(/\s+/g, ' ')
      .replace(/-/g, '−')
      .trim();
    return `${left} ${neq ? '≠' : '='} ${esc((rhs || '').trim())}`;
  }).join('<span class="orword"> or </span>');
}

/* ── Exact rational helpers for generated coordinates ─────────────────── */

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a || 1; }
function reduce(n, d) { if (d < 0) { n = -n; d = -d; } const g = gcd(n, d); return [n / g, d / g]; }

/* One coordinate of one image: c = coefficients of x,y,z over `den`, plus a
   translation n/d. Leading negative variables take an overbar, later ones a
   minus sign — the convention used in the Positions blocks. */
function coordTerm(c, den, tn, td) {
  const parts = [];
  ['x', 'y', 'z'].forEach((v, i) => {
    if (!c[i]) return;
    const [a, b] = reduce(c[i], den);
    const mag = Math.abs(a);
    const coef = (b === 1) ? (mag === 1 ? '' : String(mag)) : vulgar(mag, b);
    parts.push({ neg: a < 0, coef, v });
  });

  let out = '';
  parts.forEach((p, i) => {
    if (i === 0 && p.neg && !p.coef) out += `<i class="ovl">${p.v}</i>`;
    else out += `${i === 0 ? (p.neg ? '−' : '') : (p.neg ? ' − ' : ' + ')}${p.coef}<i>${p.v}</i>`;
  });

  const [tnr, tdr] = reduce(((tn % td) + td) % td, td);
  if (tnr) out += (out ? '+' : '') + vulgar(tnr, tdr);
  return out || '0';
}

/* The generator now emits the coordinate list in the tables' own
   parametrisation ("x, x, z", not the projector "1/2*x+1/2*y, ..."), computed
   exactly from cctbx's operators. The algebra below is only a fallback for
   older data files. */
function coordinateList(w) {
  if (Array.isArray(w && w.coordinates) && w.coordinates.length) {
    return w.coordinates.map(fmtTriplet);
  }
  return coordinateListFallback(w);
}

function coordinateListFallback(w) {
  const ops = (state.detail && state.detail.sym_ops) || [];
  if (!w || !w.coset_ops || !w.P_num || !w.T_num || !ops.length) return null;
  const Pd = w.P_den ?? 1, Td = w.T_den ?? 1;
  if (!Array.isArray(w.P_num) || w.P_num.length !== 9 || !w.P_num.every(Number.isSafeInteger) ||
      !Array.isArray(w.T_num) || w.T_num.length !== 3 || !w.T_num.every(Number.isSafeInteger) ||
      !Array.isArray(w.coset_ops) || !w.coset_ops.every(Number.isSafeInteger) ||
      !Number.isSafeInteger(Pd) || Pd <= 0 || !Number.isSafeInteger(Td) || Td <= 0) return null;

  const out = [];
  for (const i of w.coset_ops) {
    const o = ops[i];
    if (!o || !o.r) return null;
    if (!Array.isArray(o.r) || o.r.length !== 9 || !o.r.every(Number.isSafeInteger) || (o.r_den != null && o.r_den !== 1)) return null;
    const R = o.r, tn = o.t_num || [0, 0, 0], td = o.t_den || 1;
    if (!Array.isArray(tn) || tn.length !== 3 || !tn.every(Number.isSafeInteger) || !Number.isSafeInteger(td) || td <= 0) return null;
    const rows = [];
    for (let r = 0; r < 3; r++) {
      const c = [0, 1, 2].map(col => R[r * 3] * w.P_num[col] + R[r * 3 + 1] * w.P_num[3 + col] + R[r * 3 + 2] * w.P_num[6 + col]);
      const rt = R[r * 3] * w.T_num[0] + R[r * 3 + 1] * w.T_num[1] + R[r * 3 + 2] * w.T_num[2];
      const numerator = rt * td + tn[r] * Td, denominator = Td * td;
      if (![...c, rt, numerator, denominator].every(Number.isSafeInteger)) return null;
      rows.push(coordTerm(c, Pd, numerator, denominator));
    }
    out.push(rows.join('<span class="csep">, </span>'));
  }
  return out;
}

/* What the tables print in the Coordinate column. */
const representative = w => (w && (w.coordinate || w.special_op)) || '';

/* ── Filtering ────────────────────────────────────────────────────────── */

const bravaisOf = s => s.centering || '?';
const crystalLabel = v => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';

/* Absent fields are dropped before the join. An older index carried no
   standard_symbol, and joining it in anyway put the word "undefined" in every
   haystack, so any query that was a substring of it matched all 527 settings. */
function matches(s, q) {
  const hay = [s.symbol, s.hm, s.hall, s.number, s.standard_symbol, s.description,
    s.setting_id, s.point_group, s.laue_class, s.crystal_system, s.centering]
    .filter(v => v !== undefined && v !== null && v !== '')
    .join(' ');
  return norm(hay).includes(norm(q));
}

function currentFilters() {
  return {
    q: search.value.trim(),
    crystal: crystal.dataset.value || '',
    bravais: bravais.dataset.value || '',
    number: number.value.trim()
  };
}

function filterSettings(ignore = '') {
  const f = currentFilters();
  return state.settings.filter(s =>
    (ignore === 'search' || !f.q || matches(s, f.q)) &&
    (ignore === 'crystal' || !f.crystal || s.crystal_system === f.crystal) &&
    (ignore === 'bravais' || !f.bravais || bravaisOf(s) === f.bravais) &&
    (ignore === 'number' || !f.number || Number(s.number) === Number(f.number))
  );
}

function renderToggleGroup(el, items, active, disabled) {
  const btn = (value, label, isActive, isOff) =>
    `<button type="button" class="toggle${isActive ? ' active' : ''}" data-value="${esc(value)}"` +
    ` aria-pressed="${isActive}"${isOff ? ' disabled' : ''}>${esc(label)}</button>`;

  el.innerHTML = btn('', 'All', !active, false) +
    items.map(([value, label]) => btn(value, label, active === value, disabled.has(value))).join('');
  el.dataset.value = active || '';
  el.querySelectorAll('.toggle').forEach(b => {
    b.onclick = () => {
      el.dataset.value = b.dataset.value;
      updateFilters(el === crystal ? 'crystal' : 'bravais');
    };
  });
}

function bravaisItems() {
  const present = new Set(state.settings.map(bravaisOf));
  return BRAVAIS_ORDER.filter(v => present.has(v)).map(v => [v, v]);
}

function refreshFilterUI() {
  const f = currentFilters();
  const okCrystal = new Set(filterSettings('crystal').map(s => s.crystal_system));
  const okBravais = new Set(filterSettings('bravais').map(bravaisOf));
  const items = bravaisItems();

  renderToggleGroup(crystal, CRYSTALS, f.crystal,
    new Set(CRYSTALS.map(x => x[0]).filter(v => !okCrystal.has(v))));
  renderToggleGroup(bravais, items, f.bravais,
    new Set(items.map(x => x[0]).filter(v => !okBravais.has(v))));

  const invalid = !validGroupNumber();
  number.classList.toggle('invalid', invalid);
  number.setAttribute('aria-invalid', String(invalid));
  $('numberError').textContent = invalid ? 'Enter a whole number from 1 to 230.' : '';
}

function applyFilters() {
  const f = currentFilters();
  state.filtered = filterSettings();
  $('resultCount').textContent = state.filtered.length;
  $('activeFilters').innerHTML = [
    f.q ? `Search: ${esc(f.q)}` : '',
    f.crystal ? esc(crystalLabel(f.crystal)) : '',
    f.bravais ? `Centring ${esc(f.bravais)}` : '',
    f.number ? `No. ${esc(f.number)}` : ''
  ].filter(Boolean).map(t => `<span class="chip">${t}</span>`).join('');
  renderResults();
}

/* Filters intersect explicitly; changing one never silently erases another. */
function validGroupNumber() {
  return !number.validity.badInput && (number.value === '' ||
    (Number.isInteger(Number(number.value)) && +number.value >= 1 && +number.value <= 230));
}
function updateFilters() {
  const focused = document.activeElement;
  const parentId = focused?.parentElement?.id;
  const value = focused?.dataset?.value;
  refreshFilterUI();
  applyFilters();
  if (!validGroupNumber()) {
    state.filtered = [];
    $('resultCount').textContent = '0';
    $('resultList').innerHTML = '<div class="empty mini"><h2>Invalid number</h2><p>Enter a whole number from 1 to 230.</p></div>';
  }
  if (value !== undefined && [crystal.id, bravais.id].includes(parentId)) {
    [...$(parentId).querySelectorAll('button')].find(b => b.dataset.value === value)?.focus();
  }
  if (state.filtered.length === 1 && state.selected !== state.filtered[0].setting_number)
    selectSetting(state.filtered[0].setting_number);
}

/* ── Results ──────────────────────────────────────────────────────────── */

function renderResults() {
  const list = $('resultList');
  if (!state.filtered.length) {
    list.innerHTML = '<div class="empty mini"><h2>Nothing matches</h2><p>Release a filter or clear the search.</p></div>';
    return;
  }
  list.innerHTML = state.filtered.map(s => `
    <button class="result${state.selected === s.setting_number ? ' active' : ''}" aria-pressed="${state.selected === s.setting_number}" data-n="${esc(s.setting_number)}">
      <div class="result-symbol">${fmtSymbol(spacedSymbol(s))}</div>
      <div class="result-meta">No. ${esc(s.number)} · ${esc(crystalLabel(s.crystal_system))} · ${esc(s.description || 'standard')}</div>
    </button>`).join('');
  list.querySelectorAll('.result').forEach(b => b.onclick = () => selectSetting(+b.dataset.n));
}

function validateDetail(d, meta) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('Invalid setting record.');
  if (Number(d.number) !== Number(meta.number) ||
      (d.setting_id != null && String(d.setting_id) !== String(meta.setting_id)) ||
      (d.hall != null && meta.hall != null && d.hall !== meta.hall))
    throw new Error('The setting file does not match the selected index entry.');
  for (const key of ['wyckoff', 'sym_ops', 'rotations', 'reflection_zones', 'centring_translations'])
    if (d[key] != null && !Array.isArray(d[key])) throw new Error(`Invalid ${key} array.`);
  if (d.wyckoff?.some(w => !w || typeof w !== 'object') ||
      d.sym_ops?.some(o => !o || typeof o !== 'object') ||
      d.reflection_zones?.some(z => !z || typeof z !== 'object'))
    throw new Error('Invalid table entry.');
  return d;
}
async function selectSetting(n) {
  const meta = state.settings.find(s => s.setting_number === n);
  if (!meta) return;
  const requestId = ++state.requestId;
  state.controller?.abort();
  const controller = new AbortController();
  state.controller = controller;
  state.selected = n;
  state.detail = null;
  state.wySelected = 0;
  state.wyShow = 'all';
  state.opSelected = 0;
  $('printBtn').disabled = true;
  renderResults();
  history.replaceState(null, '', `#sg=${encodeURIComponent(meta.setting_id)}`);
  $('detail').setAttribute('aria-busy', 'true');
  $('detail').innerHTML = `<div class="empty"><p class="loading" role="status">Loading ${esc(meta.symbol)}</p></div>`;
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    if (!state.cache.has(meta.file)) {
      const r = await fetch(meta.file, { signal: controller.signal });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const data = validateDetail(await r.json(), meta);
      if (requestId !== state.requestId) return;
      state.cache.set(meta.file, data);
    }
    if (requestId !== state.requestId) return;
    state.detail = validateDetail(state.cache.get(meta.file), meta);
    renderDetail();
  } catch (e) {
    if (requestId !== state.requestId) return;
    state.detail = null;
    $('printBtn').disabled = true;
    $('detail').innerHTML = `<div class="empty" role="alert"><h2>Setting could not be loaded</h2>
      <p>${esc(e.name === 'AbortError' ? 'The request timed out.' : e.message)}</p>
      <p>Check ${esc(meta.file)} and serve the application over HTTP.</p>
      <button class="btn" id="retrySetting" type="button">Retry</button></div>`;
    $('retrySetting').onclick = () => selectSetting(n);
  } finally {
    clearTimeout(timeout);
    if (requestId === state.requestId) $('detail').setAttribute('aria-busy', 'false');
  }
}

/* ── The setting page ─────────────────────────────────────────────────── */

const TABS = [
  ['positions', 'Positions'],
  ['reflections', 'Reflection tests'],
  ['symmetry', 'Symmetry operations']
];

const ZONE_ORDER = ['hkl', '0kl', 'h0l', 'hk0', 'hhl', 'h-hl', 'hkh', 'hk-h',
  'h00', '0k0', '00l'];
const zoneRank = z => { const i = ZONE_ORDER.indexOf(z); return i < 0 ? 99 : i; };

function renderDetail() {
  const d = state.detail;
  if (!d) return;
  const wy = d.wyckoff || [];
  const special = wy.filter(w => w.special).length;
  
  $('printBtn').disabled = false;
  
  $('detail').innerHTML = `
    <div class="page-head">
      <div class="head-row">
        <div class="head-symbol">${fmtSymbol(spacedSymbol(d))}</div>
        <div class="head-class">
          <b>${fmtSymbol(d.point_group)}</b>
          ${esc(crystalLabel(d.crystal_system))} · Laue ${fmtSymbol(d.laue_class)}
        </div>
      </div>
      <div class="head-line">
        <span>No. <b>${esc(d.number)}</b></span>
        <span>${esc(d.description || 'standard setting')}</span>
        <span>Centring <b>${esc(d.centering)}</b></span>
        <span>Order <b>${esc(d.order_z)}</b> (point group ${esc(d.order_p)})</span>
        <span>${wy.length} Wyckoff position${wy.length === 1 ? '' : 's'}, ${special} special</span>
        <span>${d.centrosymmetric === true ? 'centrosymmetric' : d.centrosymmetric === false ? 'non-centrosymmetric' : 'centricity unspecified'}</span>
        <span class="hall">Hall: ${esc(d.hall)}</span>
      </div>
      
      <div style="margin: 16px 0 0; padding: 12px; border: 1px solid var(--border, #e0e0e0); border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted, #666);">Space-group reflection conditions</div>
        ${(Object.entries(d.reflection_conditions || {})).length ? `<table class="cond-table" style="font-size: 14px; width: auto;"><tbody>
          ${Object.entries(d.reflection_conditions || {}).sort((a, b) => zoneRank(a[0]) - zoneRank(b[0])).map(([z, rules]) => `<tr>
            <td class="zone" style="padding-right: 16px; font-weight: 600;">${esc(z)}</td>
            <td class="rule-str">${(Array.isArray(rules) ? rules : [rules]).map(fmtRule).join(' ; ')}</td>
          </tr>`).join('')}
        </tbody></table>` : '<div style="font-size:14px;">No reflection conditions are listed in this file.</div>'}
      </div>

      <nav class="tabs" style="margin-top: 16px;">${TABS.map(([id, label]) =>
        `<button class="tab${state.tab === id ? ' active' : ''}" aria-pressed="${state.tab === id}" data-tab="${id}">${label}</button>`).join('')}</nav>
    </div>
    <div id="view"></div>`;

  $('detail').querySelectorAll('.tab').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderDetail(); $('detail').querySelector(`[data-tab="${state.tab}"]`).focus(); });

  const view = $('view');
  if (state.tab === 'reflections') renderReflections(view);
  else if (state.tab === 'symmetry') renderSymmetry(view);
  else renderPositions(view);
}

/* ── Positions ────────────────────────────────────────────────────────── */

function positionsRows(wy) {
  return wy.map((w, i) => {
    if (state.wyShow === 'special' && !w.special) return '';
    if (state.wyShow === 'general' && w.special) return '';
    const cond = w.conditions
      ? Object.entries(w.conditions).map(([z, r]) =>
          `<span class="zone">${esc(z)}</span> : ${(Array.isArray(r) ? r : [r]).map(fmtRule).join('; ')}`).join('<br>')
      : '<span class="csep">—</span>';
    return `<tr class="click-row${state.wySelected === i ? ' selected' : ''}" data-wy="${i}">
      <td class="num">${esc(w.multiplicity)}</td>
      <td><button type="button" class="wy-select wy-letter" data-select-wy="${i}" aria-label="Inspect position ${esc(w.multiplicity)}${esc(w.letter)}" aria-pressed="${state.wySelected === i}">${esc(w.letter)}</button></td>
      <td class="sitesym">${fmtSymbol(w.site_symmetry)}</td>
      <td class="coord">${fmtTriplet(representative(w))}</td>
      <td>${cond}</td>
    </tr>`;
  }).join('');
}

function renderPositions(v) {
  const wy = state.detail.wyckoff || [];
  if (!wy.length) {
    v.innerHTML = '<div class="block"><p class="note">No Wyckoff table was written for this setting. The generator reports which cctbx accessor was missing.</p></div>';
    return;
  }
  if (state.wySelected >= wy.length) state.wySelected = 0;
  const w = wy[state.wySelected];

  v.innerHTML = `
    <section class="block">
      <div class="section-head">
        <h3>Positions</h3>
        <span class="hint">Multiplicity, Wyckoff letter, site symmetry, representative coordinate</span>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th class="num">Mult.</th><th>Wyck.</th><th>Site sym.</th>
          <th>Coordinate</th><th>Reflection conditions</th>
        </tr></thead>
        <tbody id="wyRows">${positionsRows(wy)}</tbody>
      </table></div>
      <div class="section-head" style="margin:12px 0 0">
        <span class="hint">Show</span>
        <span class="finder-tools">
          ${['all', 'general', 'special'].map(k =>
            `<button class="btn${state.wyShow === k ? ' on' : ''}" data-show="${k}" aria-pressed="${state.wyShow === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
        </span>
      </div>
    </section>
    <section class="block" id="wyInspect">${inspector(w)}</section>`;

  bindRows();
  v.querySelectorAll('[data-show]').forEach(b => b.onclick = () => {
    state.wyShow = b.dataset.show;
    const visible = wy.map((w, i) => ({w, i})).filter(({w}) => state.wyShow === 'all' || (state.wyShow === 'special' ? w.special : !w.special));
    if (!visible.some(({i}) => i === state.wySelected)) state.wySelected = visible[0]?.i ?? -1;
    renderPositions(v);
    v.querySelector(`[data-show="${state.wyShow}"]`).focus();
  });
}

function bindRows() {
  document.querySelectorAll('[data-wy]').forEach(r => r.onclick = () => {
    state.wySelected = +r.dataset.wy;
    document.querySelectorAll('[data-wy]').forEach(x => x.classList.toggle('selected', x === r));
    document.querySelectorAll('[data-select-wy]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.selectWy === state.wySelected)));
    $('wyInspect').innerHTML = inspector((state.detail.wyckoff || [])[state.wySelected]);
  });
}

function inspector(w) {
  if (!w) return '<p class="note">Select a position.</p>';
  const list = coordinateList(w);
  const body = list
    ? `<div class="coord-list">${list.map((c, i) => `<div><span class="n">(${i + 1})</span>${c}</div>`).join('')}</div>`
    : `<p class="note">The coordinate list needs <code>P_num</code>, <code>T_num</code> and
       <code>coset_ops</code>, which this setting file does not carry. Regenerate with the
       current script to get them.</p>`;

  return `
    <div class="section-head"><h3>Coordinates</h3>
      <span class="hint">${w.coset_exact === false ? 'Coset count is approximate for this position' : `${esc(w.multiplicity)} equivalent points`}</span>
    </div>
    <div class="inspector">
      <div>
        <div class="pos-mark">${esc(w.multiplicity)} <i>${esc(w.letter)}</i></div>
        <dl class="facts">
          <dt>Site symmetry</dt><dd class="sitesym">${fmtSymbol(w.site_symmetry)}</dd>
          <dt>Coordinate</dt><dd class="coord">${fmtTriplet(representative(w))}</dd>
          <dt>Free parameters</dt><dd>${esc(w.n_free ?? '—')}</dd>
          <dt>Type</dt><dd>${w.special ? 'special' : 'general'}</dd>
          <dt>Projector</dt><dd class="coord dim">${fmtTriplet(w.special_op)}</dd>
        </dl>
      </div>
      <div>${list && list.length !== Number(w.multiplicity) ? `<p class="warn">Coordinate count (${list.length}) differs from multiplicity (${esc(w.multiplicity)}).</p>` : ''}${body}</div>
    </div>`;
}

/* ── Reflection conditions ────────────────────────────────────────────── */

function renderReflections(v) {
  const d = state.detail;
  const sites = (d.wyckoff || []).filter(w => w.special && w.conditions && Object.keys(w.conditions).length);

  v.innerHTML = `
    <section class="block">
      <div class="section-head"><h3>Test a reflection</h3>
        <div class="hkl-entry">
          <input id="hIn" type="number" step="1" value="${esc(state.hkl.h)}" aria-label="h">
          <input id="kIn" type="number" step="1" value="${esc(state.hkl.k)}" aria-label="k">
          <input id="lIn" type="number" step="1" value="${esc(state.hkl.l)}" aria-label="l">
        </div>
      </div>
      <div id="testerOut">${tester()}</div>
    </section>

    ${sites.length ? `<section class="block">
      <div class="section-head"><h3>Conditions on special positions</h3>
        <span class="hint">Additional absences for an atom on these sites alone</span></div>
      <div class="table-wrap"><table><thead><tr>
        <th class="num">Mult.</th><th>Wyck.</th><th>Coordinate</th><th>Adds</th>
      </tr></thead><tbody>
        ${sites.map(w => `<tr>
          <td class="num">${esc(w.multiplicity)}</td>
          <td><span class="wy-letter">${esc(w.letter)}</span></td>
          <td class="coord">${fmtTriplet(representative(w))}</td>
          <td class="rule-str">${Object.entries(w.conditions).map(([z, r]) =>
            `<span class="zone">${esc(z)}</span> : ${(Array.isArray(r) ? r : [r]).map(fmtRule).join(' ; ')}`).join('<br>')}
            ${w.conditions_named === false ? '<div class="warn">necessary, but not a complete description of the absences</div>' : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>
    </section>` : ''}`;

  /* Only the verdict is redrawn, so the field keeps focus while it is typed in. */
  ['h', 'k', 'l'].forEach(key => {
    const el = $(key + 'In');
    el.oninput = () => {
      const n = el.value.trim() === '' ? NaN : Number(el.value);
      state.hkl[key] = Number.isSafeInteger(n) && Math.abs(n) <= 1000000 ? n : '';
      el.setAttribute('aria-invalid', String(state.hkl[key] === ''));
      $('testerOut').innerHTML = tester();
    };
  });
}



/* The orbit uses R^T h. For a complete group R and R^-1 enumerate
   the same orbit. Do not round fractional or malformed rotations. */
function getEquivalentReflections(h, k, l) {
  const d = state.detail || {};
  if (!d.rotations?.length && d.sym_ops?.some(o => o.r_den != null && o.r_den !== 1)) return null;
  const rots = d.rotations?.length ? d.rotations : d.sym_ops?.map(o => o.r);
  if (!rots?.length) return null;
  const out = [], seen = new Set();
  for (const r of rots) {
    if (!Array.isArray(r) || r.length !== 9 || !r.every(Number.isSafeInteger)) return null;
    const a = r.map(BigInt);
    const det = a[0]*(a[4]*a[8]-a[5]*a[7])-a[1]*(a[3]*a[8]-a[5]*a[6])+a[2]*(a[3]*a[7]-a[4]*a[6]);
    if (det !== 1n && det !== -1n) return null;
    const eq = [h*r[0]+k*r[3]+l*r[6], h*r[1]+k*r[4]+l*r[7], h*r[2]+k*r[5]+l*r[8]];
    if (!eq.every(Number.isSafeInteger)) return null;
    if (!seen.has(eq.join(','))) { seen.add(eq.join(',')); out.push(eq); }
  }
  if (!seen.has([h,k,l].join(','))) out.unshift([h,k,l]);
  return out;
}

/* The normals cutting out a zone, wherever the generator recorded them.

   A Wyckoff position can carry a condition on a zone the space group itself
   puts no condition on, and such a zone never appears in reflection_zones.
   zone_defs covers the whole zone universe, so the label can be resolved
   arithmetically instead of being guessed from its spelling. */
function zoneNormals(zName) {
  const d = state.detail || {};
  const defs = d.zone_defs || {};
  if (Array.isArray(defs[zName])) return defs[zName];
  const rec = (d.reflection_zones || []).find(z => z.zone === zName);
  return (rec && rec.normals) || null;
}

const LEGACY_ZONES = new Set(ZONE_ORDER);

/* False means "outside the zone"; null means "this label cannot be resolved",
   which is not the same thing and must not be reported as a passing test. */
function matchesZone(zName, normals, eh, ek, el) {
  if (normals != null) {
    if (!Array.isArray(normals) || normals.some(n => !Array.isArray(n) || n.length !== 3 || !n.every(Number.isSafeInteger))) return null;
    return normals.every(n => BigInt(n[0])*BigInt(eh) + BigInt(n[1])*BigInt(ek) + BigInt(n[2])*BigInt(el) === 0n);
  }
  if (!LEGACY_ZONES.has(zName)) return null;
  return zName === 'hkl' ||
    (zName === '0kl' && eh === 0) || (zName === 'h0l' && ek === 0) || (zName === 'hk0' && el === 0) ||
    (zName === 'hhl' && eh === ek) || (zName === 'h-hl' && eh === -ek) ||
    (zName === 'hkh' && eh === el) || (zName === 'hk-h' && eh === -el) ||
    (zName === 'h00' && ek === 0 && el === 0) || (zName === '0k0' && eh === 0 && el === 0) ||
    (zName === '00l' && eh === 0 && ek === 0);
}

/* The equivalent this zone's rule should be read on, or null if none lies in
   the zone. `unresolved` is set when the zone label could not be resolved at
   all, so the caller can mark the test undone rather than silently skip it. */
function equivalentInZone(eqRefls, zName, normals) {
  let unresolved = false;
  for (const eq of eqRefls) {
    const hit = matchesZone(zName, normals, eq[0], eq[1], eq[2]);
    if (hit === null) { unresolved = true; break; }
    if (hit) return { eq, unresolved: false };
  }
  return { eq: null, unresolved };
}





/* Grammar, matching the generator: clause = <expr in h,k,l> '=' <m>'n' ['+' r],
   and a rule is one or more clauses joined by ' or '. */
/* true = satisfied, false = broken, null = the rule could not be read.

   Returning true for an unreadable rule, as this used to, prints a green tick
   against a test that never ran. A rule is a disjunction, so one clause that
   holds settles it; only when nothing holds and something failed to parse is
   the verdict withheld. */
function evaluateRule(h, k, l, rule) {
  if (![h,k,l].every(Number.isSafeInteger) || typeof rule !== 'string') return null;
  let unknown = false;
  for (const clause of rule.split(/\s+or\s+/i)) {
    const m = /^\s*(.*?)\s*(!=|=)\s*(\d+)n(?:\s*([+-])\s*(\d+))?\s*$/.exec(clause);
    if (!m || BigInt(m[3]) === 0n) { unknown = true; continue; }
    const lhs = m[1].replace(/\s+/g, '');
    // Parse a sum of integer coefficients and h/k/l; never execute data.
    const terms = lhs.match(/[+-]?(?:\d+\*?[hkl]|[hkl]|\d+)/g);
    if (!terms || terms.join('') !== lhs || terms.slice(1).some(t => !/^[+-]/.test(t))) {
      unknown = true; continue;
    }
    let val = 0n;
    for (const term of terms) {
      const t = /^([+-]?)(\d*)\*?([hkl]?)$/.exec(term);
      const sign = t[1] === '-' ? -1n : 1n;
      const coef = BigInt(t[2] || '1');
      val += sign * coef * (t[3] ? BigInt({h,k,l}[t[3]]) : 1n);
    }
    const modulus = BigInt(m[3]);
    const remainder = BigInt(m[5] || '0') * (m[4] === '-' ? -1n : 1n);
    const hit = (val - remainder) % modulus === 0n;
    if (m[2] === '!=' ? !hit : hit) return true;
  }
  return unknown ? null : false;
}

/* true = allowed by the encoded predicate; false = absent; null = untested.
   Legacy flat site bitsets are deliberately refused: the original exporter
   comments describe nonperiodic site predicates that this encoding loses. */
const decodedBitsets = new Map();
function evaluateExactCondition(h, k, l, exactData) {
  if (![h,k,l].every(Number.isSafeInteger) || !exactData ||
      exactData.encoding !== 'strata-bitsets' || !Array.isArray(exactData.strata)) return null;
  const mod = (v, m) => ((v % m) + m) % m;
  try {
    for (const s of exactData.strata) {
      if (!s || !Array.isArray(s.normals)) return null;
      const hit = matchesZone('', s.normals, h,k,l);
      if (hit === null) return null;
      if (!hit) continue;
      const N = s.modulus ?? exactData.modulus;
      if (!Number.isSafeInteger(N) || N < 1 || !Number.isInteger(s.dim) || s.dim < 0 || s.dim > 3 ||
          !Array.isArray(s.duals) || s.duals.length !== 3 ||
          s.duals.some(row => !Array.isArray(row) || row.length !== s.dim || !row.every(Number.isFinite))) return null;
      let idx = 0;
      for (let i = 0; i < s.dim; i++) {
        const c = h*s.duals[0][i] + k*s.duals[1][i] + l*s.duals[2][i];
        if (!Number.isSafeInteger(c)) return null;
        idx = idx*N + mod(c,N);
      }
      const bits = N ** s.dim;
      if (!Number.isSafeInteger(bits) || !Number.isSafeInteger(idx) || idx < 0 || idx >= bits ||
          typeof s.data !== 'string') return null;
      let raw = decodedBitsets.get(s.data);
      if (raw === undefined) {
        raw = atob(s.data);
        if (decodedBitsets.size >= 128) decodedBitsets.clear();
        decodedBitsets.set(s.data, raw);
      }
      if (raw.length !== Math.ceil(bits/8)) return null;
      // Floor division avoids both the old precedence bug and 32-bit shifts.
      return (raw.charCodeAt(Math.floor(idx/8)) & (1 << (idx % 8))) === 0;
    }
  } catch { return null; }
  return null;
}

const ruleArray = rules => Array.isArray(rules) ? rules : rules == null ? [] : [rules];
function checksForZone(eq, zone, normals, rules) {
  const values = ruleArray(rules);
  if (!values.length) return [{zone, rule: 'Missing rule', ok: null}];
  if (!eq) return values.map(rule => ({zone,rule,ok:null}));
  const hits = eq.map(v => ({v, hit: matchesZone(zone,normals,...v)}));
  if (hits.some(x => x.hit === null)) return values.map(rule => ({zone,rule,ok:null}));
  return values.flatMap(rule => {
    const applicable = hits.filter(x => x.hit);
    if (!applicable.length) return [];
    const verdicts = applicable.map(x => evaluateRule(...x.v,rule));
    return [{zone,rule,ok: verdicts.includes(false) ? false : verdicts.includes(null) ? null : true}];
  });
}
function tester() {
  const {h,k,l} = state.hkl;
  if (![h,k,l].every(n => Number.isSafeInteger(n) && Math.abs(n) <= 1000000))
    return '<div class="verdict" role="status">Enter whole-number h, k and l between −1000000 and 1000000. Empty or fractional indices are not tested.</div>';
  if (h === 0 && k === 0 && l === 0)
    return '<div class="verdict" role="status">000 is the forward-scattering origin, not a diffraction reflection.</div>';
  const d = state.detail || {}, eq = getEquivalentReflections(h,k,l);
  const checks = [];
  // Evaluate every supplied zone and every equivalent in it. No orbit-level
  // de-duplication may discard a distinct condition.
  if (d.reflection_zones?.length) {
    for (const z of d.reflection_zones)
      checks.push(...checksForZone(eq,z.zone,z.normals ?? zoneNormals(z.zone),z.rules));
  } else if (d.reflection_conditions && typeof d.reflection_conditions === 'object') {
    for (const [zone,rules] of Object.entries(d.reflection_conditions))
      checks.push(...checksForZone(eq,zone,zoneNormals(zone),rules));
  } else checks.push({zone:'—',rule:'No general-condition data supplied',ok:null});
  if (!eq) checks.push({zone:'—',rule:'Equivalent reflections could not be determined',ok:null});
  const failed = checks.filter(c => c.ok === false), unknown = checks.filter(c => c.ok === null);
  const word = failed.length ? 'Systematically absent' : unknown.length ? 'Indeterminate' : 'Not forbidden by stored rules';
  const cls = failed.length ? 'absent' : unknown.length ? '' : 'allowed';
  const explanation = failed.length ? `${failed.length} stored condition(s) fail.` : unknown.length
    ? `${unknown.length} test(s) could not be completed.`
    : 'The supplied rules do not forbid this reflection. This does not predict a nonzero intensity or establish that the exported rules are complete.';
  let html = `<div class="verdict ${cls}" role="status"><span class="verdict-word">${word}</span>
    <div><i>h k l</i> = ${h} ${k} ${l}<p>${explanation}</p></div></div>`;
  const table = rows => `<div class="table-wrap"><table class="checks"><tbody>${rows.map(c => `<tr>
    <td class="${c.ok === null ? 'warn' : c.ok ? 'yes' : 'no'}">${c.ok === null ? '?' : c.ok ? '✓' : '✗'}</td>
    <td class="zone">${esc(c.zone)}</td><td class="rule-str">${fmtRule(c.rule)}</td></tr>`).join('')}</tbody></table></div>`;
  if (checks.length) html += table(checks);
  const sites = [];
  for (const w of d.wyckoff || []) {
    if (!w.special) continue;
    const named = [];
    for (const [zone,rules] of Object.entries(w.conditions || {}))
      named.push(...checksForZone(eq,zone,zoneNormals(zone),rules));
    const exact = w.conditions_exact ? evaluateExactCondition(h,k,l,w.conditions_exact) : null;
    const namedFailed = named.some(c => c.ok === false);
    if (exact === true && namedFailed) {
      sites.push({zone:`Wyckoff ${w.multiplicity}${w.letter}`,rule:'Exact and named conditions disagree',ok:null});
    } else if (exact === false || namedFailed) {
      sites.push({zone:`Wyckoff ${w.multiplicity}${w.letter}`,rule:exact === false ? 'Absent by encoded site condition' : named.find(c => c.ok === false).rule,ok:false});
    } else if (exact !== true && (w.conditions_exact || w.conditions_named === false || named.some(c => c.ok === null))) {
      sites.push({zone:`Wyckoff ${w.multiplicity}${w.letter}`,rule:'Site test incomplete or encoding unsupported',ok:null});
    }
  }
  if (sites.length) html += '<p class="note">Site-specific absences concern the contribution from that Wyckoff orbit alone. Other occupied sites may contribute intensity. ? marks an incomplete or inconsistent site test.</p>' + table(sites);
  return html;
}

/* ── Symmetry operations ──────────────────────────────────────────────── */

function renderSymmetry(v) {
  const d = state.detail;
  const ops = d.sym_ops || [];
  const trans = d.centring_translations || [];
  if (!ops.length) {
    v.innerHTML = '<div class="block"><p class="note">No operator list in this setting file.</p></div>';
    return;
  }
  if (!ops[state.opSelected]) state.opSelected = 0;

  v.innerHTML = `
    <section class="block">
      <div class="section-head"><h3>Symmetry operations</h3>
        <span class="hint">${ops.length} stored operations</span></div>
      <div class="sym-layout">
        <div class="op-list">${ops.map((o, i) =>
          `<button class="op${i === state.opSelected ? ' active' : ''}" aria-pressed="${i === state.opSelected}" data-op="${i}">
             <span class="n">(${i + 1})</span><span class="coord">${fmtTriplet(o.xyz)}</span>
           </button>`).join('')}</div>
        <div class="op-panel" id="opPanel">${opPanel(ops[state.opSelected], state.opSelected)}</div>
      </div>
    </section>
    ${trans.length > 1 ? `<section class="block">
      <div class="section-head"><h3>Centring translations</h3>
        <span class="hint">Lattice translations; these may already be included in the stored operations</span></div>
      <div class="coord-list">${trans.map(t =>
        `<div>(${(t.t_frac || []).map(x => fmtTriplet(x)).join('<span class="csep">, </span>')})</div>`).join('')}</div>
    </section>` : ''}`;

  v.querySelectorAll('[data-op]').forEach(b => b.onclick = () => {
    state.opSelected = +b.dataset.op;
    v.querySelectorAll('[data-op]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    $('opPanel').innerHTML = opPanel((state.detail.sym_ops || [])[state.opSelected], state.opSelected);
  });
}

function opPanel(o, i) {
  if (!o) return '';
  const t = o.t_frac || ['0', '0', '0'];
  const cell = x => `<td>${esc(x)}</td>`;
  return `
    <div class="op-title"><span class="n">(${i + 1})</span> <span class="coord">${fmtTriplet(o.xyz)}</span></div>
    <h4>Augmented matrix</h4>
    <table class="aug"><tbody>
      ${[0, 1, 2].map(r => `<tr>
        ${[0, 1, 2].map(c => cell(o.r ? o.r[r * 3 + c] : '—')).join('')}
        <td class="tcol">${fmtTriplet(t[r])}</td></tr>`).join('')}
      <tr>${cell(0)}${cell(0)}${cell(0)}<td class="tcol">1</td></tr>
    </tbody></table>
    <h4>Translation</h4>
    <p style="font-size:14px">(${(o.t || []).map(x => Number(x).toFixed(4)).join(', ')})</p>`;
}

/* ── Wiring ───────────────────────────────────────────────────────────── */

function clearAll() {
  ++state.requestId;
  state.controller?.abort();
  $('detail').setAttribute('aria-busy', 'false');
  search.value = '';
  number.value = '';
  crystal.dataset.value = '';
  bravais.dataset.value = '';
  state.selected = null;
  state.detail = null;
  state.tab = 'positions';
  history.replaceState(null, '', location.pathname + location.search);
  refreshFilterUI();
  applyFilters();
  $('detail').innerHTML = `<div class="empty"><p class="empty-mark">◊</p>
    <h2>No setting selected</h2>
    <p>Pick a crystal system or lattice, type a number from 1 to 230, or search a symbol.</p></div>`;
  $('printBtn').disabled = true;
}

function wire() {
  search.addEventListener('input', () => updateFilters('search'));
  number.addEventListener('input', () => updateFilters('number'));
  $('clearFilters').onclick = clearAll;
  
  // Keep the print DOM until afterprint; some browsers return from print()
  // before the print preview has finished reading the document.
  let printSnapshot = null;
  const preparePrint = () => {
    if (!state.detail || printSnapshot) return;
    printSnapshot = {title: document.title, show: state.wyShow};
    state.wyShow = 'all';
    const view = $('view');
    view.innerHTML = '';
    for (const render of [renderPositions, renderReflections, renderSymmetry]) {
      const block = document.createElement('div');
      view.appendChild(block);
      render(block);
    }
    document.title = `SpaceGroup_${state.detail.number}_${state.detail.symbol || ''}`;
  };
  const restorePrint = () => {
    if (!printSnapshot) return;
    document.title = printSnapshot.title;
    state.wyShow = printSnapshot.show;
    printSnapshot = null;
    renderDetail();
  };
  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', restorePrint);
  $('printBtn').onclick = () => {
    if (!state.detail) return;
    preparePrint();
    try { window.print(); } catch (e) { restorePrint(); throw e; }
  };

  $('themeToggle').onclick = () => {
    const dark = document.body.classList.toggle('dark');
    const b = $('themeToggle');
    b.textContent = dark ? '☀' : '☾';
    b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
    b.title = b.getAttribute('aria-label');
  };
  if (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) $('themeToggle').click();
}

async function init() {
  wire();
  
  // Force clean state on load to override browser-cached inputs
  search.value = '';
  number.value = '';
  
  try {
    const r = await fetch('sg/index.json');
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    state.index = await r.json();
    if (!Array.isArray(state.index?.settings)) throw new Error('The index has no settings array.');
    state.settings = state.index.settings.map(s => {
      if (!s || !Number.isSafeInteger(Number(s.setting_number)) || !Number.isInteger(Number(s.number)) ||
          +s.number < 1 || +s.number > 230 || typeof s.file !== 'string' || !s.file || s.setting_id == null)
        throw new Error('Invalid index entry.');
      return {...s, setting_number: Number(s.setting_number)};
    });
    if (new Set(state.settings.map(s => s.setting_number)).size !== state.settings.length)
      throw new Error('Duplicate setting numbers in the index.');
    $('appStatus').textContent = state.settings.length ? '' : 'The index contains no settings.';
    const schema = state.index.schema_version;
    $('dataNotice').textContent = schema === 14 ? '' :
      `Data schema ${schema == null ? 'unspecified' : schema}: compatibility with this viewer has not been verified.`;
    refreshFilterUI();
    applyFilters();

    const hash = new URLSearchParams(location.hash.replace(/^#/, '')).get('sg');
    const target = hash && state.settings.find(s =>
      String(s.setting_id) === hash || String(s.setting_number) === hash);
    if (target) selectSetting(target.setting_number);
  } catch (e) {
    $('appStatus').textContent = 'The space-group index could not be loaded. Reload after checking sg/index.json.';
    $('resultList').innerHTML = `<div class="empty mini"><h2>sg/index.json did not load</h2>
      <p>Serve this folder over http next to the generated <code>sg/</code> directory;
      opening the page from disk blocks the fetch.</p>
      <p class="loading" style="margin-top:10px">${esc(e.message)}</p></div>`;
  }
}

init();
