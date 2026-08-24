/* Space Group Explorer — vanilla JS, no dependencies.
   Presentation follows International Tables Vol. A: roto-inversions carry an
   overbar, screw axes a subscript, coordinates are italic with vulgar
   fractions, and a Wyckoff position is shown as its full coordinate list. */

const state = {
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
const norm = (v = '') => String(v).toLowerCase().replace(/[\s_\-\/]/g, '');

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
    let s = part.trim().replace(/\s+/g, '');
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
  const Pd = w.P_den || 1, Td = w.T_den || 1;

  const out = [];
  for (const i of w.coset_ops) {
    const o = ops[i];
    if (!o || !o.r) return null;
    const R = o.r, tn = o.t_num || [0, 0, 0], td = o.t_den || 1;
    const rows = [];
    for (let r = 0; r < 3; r++) {
      const c = [0, 1, 2].map(col => R[r * 3] * w.P_num[col] + R[r * 3 + 1] * w.P_num[3 + col] + R[r * 3 + 2] * w.P_num[6 + col]);
      const rt = R[r * 3] * w.T_num[0] + R[r * 3 + 1] * w.T_num[1] + R[r * 3 + 2] * w.T_num[2];
      rows.push(coordTerm(c, Pd, rt * td + tn[r] * Td, Td * td));
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
    (ignore === 'number' || !f.number || String(s.number) === f.number)
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

  const n = Number(f.number);
  number.classList.toggle('invalid',
    !!f.number && (!Number.isInteger(n) || n < 1 || n > 230));
}

function applyFilters() {
  const f = currentFilters();
  state.filtered = filterSettings();
  $('resultCount').textContent = state.filtered.length;
  $('activeFilters').innerHTML = [
    f.q ? `Search: ${esc(f.q)}` : '',
    f.crystal ? esc(crystalLabel(f.crystal)) : '',
    f.bravais ? `Lattice ${esc(f.bravais)}` : '',
    f.number ? `No. ${esc(f.number)}` : ''
  ].filter(Boolean).map(t => `<span class="chip">${t}</span>`).join('');
  renderResults();
}

/* A newly chosen broad filter wins; anything it contradicts is released. */
function updateFilters(source = '') {
  const compatible = (extra = {}) => {
    const f = Object.assign(currentFilters(), extra);
    return state.settings.some(s =>
      (!f.crystal || s.crystal_system === f.crystal) &&
      (!f.bravais || bravaisOf(s) === f.bravais) &&
      (!f.number || String(s.number) === f.number) &&
      (!f.q || matches(s, f.q)));
  };

  if (source === 'crystal' && !compatible()) bravais.dataset.value = '';
  if (source === 'bravais' && !compatible()) crystal.dataset.value = '';
  if ((source === 'crystal' || source === 'bravais') && number.value && !compatible()) number.value = '';
  if (source === 'number' && number.value.trim()) {
    if (crystal.dataset.value && !compatible({ crystal: crystal.dataset.value })) crystal.dataset.value = '';
    if (bravais.dataset.value && !compatible({ bravais: bravais.dataset.value })) bravais.dataset.value = '';
  }

  const f = currentFilters();
  const validNumber = !f.number || (/^\d+$/.test(f.number) && +f.number >= 1 && +f.number <= 230);
  refreshFilterUI();
  if (!validNumber) {
    state.filtered = [];
    $('resultCount').textContent = 0;
    $('resultList').innerHTML = '<div class="empty mini"><h2>Out of range</h2><p>Space groups are numbered 1 to 230.</p></div>';
    return;
  }
  applyFilters();
  if (state.filtered.length === 1) selectSetting(state.filtered[0].setting_number);
}

/* ── Results ──────────────────────────────────────────────────────────── */

function renderResults() {
  const list = $('resultList');
  if (!state.filtered.length) {
    list.innerHTML = '<div class="empty mini"><h2>Nothing matches</h2><p>Release a filter or clear the search.</p></div>';
    return;
  }
  list.innerHTML = state.filtered.map(s => `
    <button class="result${state.selected === s.setting_number ? ' active' : ''}" data-n="${s.setting_number}">
      <div class="result-symbol">${fmtSymbol(spacedSymbol(s))}</div>
      <div class="result-meta">No. ${esc(s.number)} · ${esc(crystalLabel(s.crystal_system))} · ${esc(s.description || 'standard')}</div>
    </button>`).join('');
  list.querySelectorAll('.result').forEach(b => b.onclick = () => selectSetting(+b.dataset.n));
}

async function selectSetting(n) {
  const meta = state.settings.find(s => s.setting_number === n);
  if (!meta) return;
  state.selected = n;
  state.wySelected = 0;
  state.wyShow = 'all';
  state.opSelected = 0;
  renderResults();
  history.replaceState(null, '', `#sg=${encodeURIComponent(meta.setting_id)}`);
  $('detail').innerHTML = `<div class="empty"><p class="loading">Loading ${esc(meta.symbol)}</p></div>`;
  try {
    if (!state.cache.has(meta.file)) {
      const r = await fetch(meta.file);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      state.cache.set(meta.file, await r.json());
    }
    state.detail = state.cache.get(meta.file);
    renderDetail();
  } catch (e) {
    $('detail').innerHTML = `<div class="empty"><h2>${esc(meta.file)} did not load</h2>
      <p>The setting file is missing or the server refused it. Regenerate the <code>sg/</code>
      folder, or serve it over http rather than opening the page from disk.</p>
      <p class="loading" style="margin-top:12px">${esc(e.message)}</p></div>`;
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
        <span>Lattice <b>${esc(d.centering)}</b></span>
        <span>Order <b>${esc(d.order_z)}</b> (point group ${esc(d.order_p)})</span>
        <span>${wy.length} Wyckoff position${wy.length === 1 ? '' : 's'}, ${special} special</span>
        <span>${d.centrosymmetric ? 'centrosymmetric' : 'non-centrosymmetric'}${d.chiral ? ', chiral' : ''}</span>
        <span class="hall">Hall: ${esc(d.hall)}</span>
      </div>
      
      <div style="margin: 16px 0 0; padding: 12px; border: 1px solid var(--border, #e0e0e0); border-radius: 6px;">
        <div style="font-weight: 600; margin-bottom: 8px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted, #666);">General Reflection Conditions</div>
        ${(Object.entries(d.reflection_conditions || {})).length ? `<table class="cond-table" style="font-size: 14px; width: auto;"><tbody>
          ${Object.entries(d.reflection_conditions || {}).sort((a, b) => zoneRank(a[0]) - zoneRank(b[0])).map(([z, rules]) => `<tr>
            <td class="zone" style="padding-right: 16px; font-weight: 600;">${esc(z)}</td>
            <td class="rule-str">${(Array.isArray(rules) ? rules : [rules]).map(fmtRule).join(' ; ')}</td>
          </tr>`).join('')}
        </tbody></table>` : '<div style="font-size:14px;">None. Every reflection is allowed by symmetry.</div>'}
      </div>

      <nav class="tabs" style="margin-top: 16px;">${TABS.map(([id, label]) =>
        `<button class="tab${state.tab === id ? ' active' : ''}" data-tab="${id}">${label}</button>`).join('')}</nav>
    </div>
    <div id="view"></div>`;

  $('detail').querySelectorAll('.tab').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; renderDetail(); });

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
      <td><span class="wy-letter">${esc(w.letter)}</span></td>
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
  if (!wy[state.wySelected]) state.wySelected = 0;
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
    renderPositions(v);
  });
}

function bindRows() {
  document.querySelectorAll('[data-wy]').forEach(r => r.onclick = () => {
    state.wySelected = +r.dataset.wy;
    document.querySelectorAll('[data-wy]').forEach(x => x.classList.toggle('selected', x === r));
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
      <span class="hint">${w.coset_exact === false ? 'Coset count is approximate for this position' : `${w.multiplicity} equivalent points`}</span>
    </div>
    <div class="inspector">
      <div>
        <div class="pos-mark">${esc(w.multiplicity)} <i>${esc(w.letter)}</i></div>
        <dl class="facts">
          <dt>Site symmetry</dt><dd class="sitesym">${fmtSymbol(w.site_symmetry)}</dd>
          <dt>Coordinate</dt><dd class="coord">${fmtTriplet(representative(w))}</dd>
          <dt>Free parameters</dt><dd>${w.n_free ?? '—'}</dd>
          <dt>Type</dt><dd>${w.special ? 'special' : 'general'}</dd>
          <dt>Projector</dt><dd class="coord dim">${fmtTriplet(w.special_op)}</dd>
        </dl>
      </div>
      <div>${body}</div>
    </div>`;
}

/* ── Reflection conditions ────────────────────────────────────────────── */

function renderReflections(v) {
  const d = state.detail;
  const sites = (d.wyckoff || []).filter(w => w.conditions);

  v.innerHTML = `
    <section class="block">
      <div class="section-head"><h3>Test a reflection</h3>
        <div class="hkl-entry">
          <input id="hIn" type="number" step="1" value="${state.hkl.h}" aria-label="h">
          <input id="kIn" type="number" step="1" value="${state.hkl.k}" aria-label="k">
          <input id="lIn" type="number" step="1" value="${state.hkl.l}" aria-label="l">
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
      const n = parseInt(el.value, 10);
      state.hkl[key] = Number.isFinite(n) ? n : 0;
      $('testerOut').innerHTML = tester();
    };
  });
}



/* Get all symmetrically equivalent (h,k,l) reflections by applying real-space rotations. */
function getEquivalentReflections(h, k, l) {
  const d = state.detail || {};
  const rots = d.rotations || [[1,0,0, 0,1,0, 0,0,1]];
  const eq = [];
  const seen = new Set();
  // The stored rotations are doubles, so the products are rounded back to the
  // integers they are: an index must compare exactly against a zone normal.
  rots.forEach(r => {
    const eh = Math.round(h * r[0] + k * r[3] + l * r[6]);
    const ek = Math.round(h * r[1] + k * r[4] + l * r[7]);
    const el = Math.round(h * r[2] + k * r[5] + l * r[8]);
    const key = `${eh},${ek},${el}`;
    if (!seen.has(key)) {
      seen.add(key);
      eq.push([eh, ek, el]);
    }
  });
  return eq;
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
  if (normals) return normals.every(n => n[0] * eh + n[1] * ek + n[2] * el === 0);
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
  let unparsed = false;
  for (const clause of String(rule).split(' or ')) {
    const neq = clause.includes('!=');
    const [lhs, rhs] = clause.split(neq ? '!=' : '=');
    const m = /^\s*(\d+)n(?:\s*\+\s*(\d+))?\s*$/.exec(rhs || '');
    // The left side is data, so it is checked against the generator's grammar
    // before it is compiled, not merely wrapped in a try.
    if (!m || +m[1] === 0 || !/^[hkl\d+\-*\s]+$/.test(lhs || '')) { unparsed = true; continue; }
    const mod = +m[1], rem = +(m[2] || 0);
    let val;
    try { val = Function('h', 'k', 'l', `return ${lhs}`)(h, k, l); }
    catch { unparsed = true; continue; }
    if (!Number.isFinite(val)) { unparsed = true; continue; }
    const hit = ((((val - rem) % mod) + mod) % mod) === 0;
    if (neq ? !hit : hit) return true;
  }
  return unparsed ? null : false;
}

/* Decodes the exact periodic residue bitset for complex Wyckoff positions */
/* True means the site allows the reflection.

   Two encodings. The flat bitset assumed the site predicate was periodic in
   each index; it is not. Operators share a phase group when h annihilates a
   difference of their projected matrices, and that is a lattice condition, not
   a congruence — in P-4, position 2g is extinct at (1,0,0) and not at (1,0,2),
   which are the same residue class. The strata encoding states the predicate on
   each sublattice where the grouping is constant, most special first, so the
   first stratum containing h is the one that governs it. */
function evaluateExactCondition(h, k, l, exactData) {
  if (!exactData) return true;
  const mod = (v, m) => ((v % m) + m) % m;
  const bitAt = (data, i) => {
    const raw = atob(data);
    return i >> 3 < raw.length && (raw.charCodeAt(i >> 3) & (1 << (i & 7))) !== 0;
  };

  if (exactData.encoding === 'strata-bitsets') {
    for (const s of exactData.strata || []) {
      if (!(s.normals || []).every(n => n[0] * h + n[1] * k + n[2] * l === 0)) continue;
      const N = s.modulus || exactData.modulus;
      let idx = 0;
      for (let i = 0; i < s.dim; i++) {
        const c = h * s.duals[0][i] + k * s.duals[1][i] + l * s.duals[2][i];
        idx = idx * N + mod(c, N);
      }
      return !bitAt(s.data, idx);
    }
    return true;
  }

  if (exactData.encoding !== 'base64-bitset') return true;
  const N = exactData.modulus;
  return !bitAt(exactData.data, (mod(h, N) * N + mod(k, N)) * N + mod(l, N));
}

function tester() {
  const { h, k, l } = state.hkl;
  const generalChecks = [];
  const specialChecks = [];
  const d = state.detail || {};
  
  const eqRefls = getEquivalentReflections(h, k, l);

  // 1. General reflection conditions.
  //    The zone universe holds one zone per operator kernel, so symmetry-
  //    equivalent zones each get their own record and the same rule would be
  //    listed several times. Since every equivalent of hkl is tested anyway,
  //    one zone per orbit says everything the orbit has to say. Note that this
  //    cannot dedupe on 'printed': a zone can head an orbit and still be
  //    unprinted, and dropping it would lose the orbit's rules altogether.
  const seenOrbit = new Set();
  const seenRule = new Set();
  (d.reflection_zones || []).forEach(z => {
    const orbit = z.orbit || z.zone;
    if (seenOrbit.has(orbit)) return;
    const { eq: matchedEq, unresolved } = equivalentInZone(eqRefls, z.zone, z.normals);
    if (unresolved) {
      seenOrbit.add(orbit);
      (z.rules || []).forEach(rule =>
        generalChecks.push({ zone: z.zone, rule, ok: null, why: 'zone not resolvable' }));
      return;
    }
    if (!matchedEq) return;
    seenOrbit.add(orbit);
    (z.rules || []).forEach(rule => {
      const key = `${z.zone}|${rule}`;
      if (seenRule.has(key)) return;
      seenRule.add(key);
      generalChecks.push({ zone: z.zone, rule, ok: evaluateRule(matchedEq[0], matchedEq[1], matchedEq[2], rule) });
    });
  });

  // Legacy general rules (if file lacks reflection_zones)
  if (!d.reflection_zones || !d.reflection_zones.length) {
    Object.entries(d.reflection_conditions || {}).forEach(([zName, rules]) => {
      const { eq: matchedEq } = equivalentInZone(eqRefls, zName, zoneNormals(zName));
      if (matchedEq) {
        (Array.isArray(rules) ? rules : [rules]).forEach(rule => {
          generalChecks.push({ zone: zName, rule, ok: evaluateRule(matchedEq[0], matchedEq[1], matchedEq[2], rule) });
        });
      }
    });
  }

  // 2. Exact and Named conditions for special positions
  (d.wyckoff || []).forEach(w => {
    let siteOk = true;
    let failedRule = '';
    let failedZone = '';
    let undecided = null;
    
    // Evaluate standard named rules
    if (w.conditions) {
      Object.entries(w.conditions).forEach(([zName, rules]) => {
        const { eq: matchedEq, unresolved } = equivalentInZone(eqRefls, zName, zoneNormals(zName));
        if (unresolved) { undecided = undecided || zName; return; }
        if (matchedEq) {
          (Array.isArray(rules) ? rules : [rules]).forEach(rule => {
            const verdict = evaluateRule(matchedEq[0], matchedEq[1], matchedEq[2], rule);
            if (verdict === null) { undecided = undecided || zName; return; }
            if (verdict === false) {
              siteOk = false;
              failedRule = rule;
              failedZone = zName;
            }
          });
        }
      });
    }
    
    // Evaluate exact lossless bitset fallback
    if (siteOk && w.conditions_exact && !evaluateExactCondition(h, k, l, w.conditions_exact)) {
      siteOk = false;
      failedRule = 'Exact absence (bitset fallback)';
      failedZone = 'Exact';
    }
    
    if (!siteOk) {
      specialChecks.push({ letter: w.letter, mult: w.multiplicity, zone: failedZone, rule: failedRule });
    } else if (undecided) {
      specialChecks.push({ letter: w.letter, mult: w.multiplicity, zone: undecided,
        rule: '', undecided: true });
    }
  });

  /* An undecided test is neither a pass nor a failure and is kept out of both
     counts, so the verdict never rests on a rule that was not read. */
  const decided = generalChecks.filter(c => c.ok !== null);
  const failedGeneral = decided.filter(c => c.ok === false);
  const unknown = generalChecks.length - decided.length;
  const plural = decided.length === 1 ? '' : 's';
  const cls = !decided.length ? '' : failedGeneral.length ? 'absent' : 'allowed';
  const word = !decided.length ? 'No condition' : failedGeneral.length ? 'Systematically absent' : 'Allowed';
  let said = !decided.length
    ? 'No stored condition covers this zone, so nothing forbids the reflection.'
    : failedGeneral.length
      ? `Fails ${failedGeneral.length} of ${decided.length} applicable condition${plural}.`
      : `Satisfies all ${decided.length} applicable condition${plural}.`;
  if (unknown) said += ` ${unknown} condition${unknown === 1 ? ' could' : 's could'} not be read; the verdict does not rest on ${unknown === 1 ? 'it' : 'them'}.`;

  let html = `<div class="verdict ${cls}">
      <span class="verdict-word">${word}</span>
      <div><i>h k l</i> = ${h} ${k} ${l}<p>${said}</p></div>
    </div>`;
    
  if (generalChecks.length) {
    const mark = c => c.ok === null ? ['warn', '?'] : c.ok ? ['yes', '✓'] : ['no', '✗'];
    html += `<table class="checks"><tbody>${generalChecks.map(c => {
      const [k2, glyph] = mark(c);
      return `<tr>
      <td class="${k2}">${glyph}</td>
      <td class="zone">${esc(c.zone)}</td>
      <td class="rule-str">${fmtRule(c.rule)}${c.why ? ` <span class="hint">(${esc(c.why)})</span>` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  
  const siteAbsent = specialChecks.filter(c => !c.undecided);
  const siteUnknown = specialChecks.filter(c => c.undecided);

  if (siteAbsent.length) {
    html += `<div style="margin-top: 24px; font-size: 13px;">
      <strong style="color: var(--text-muted, #666);">Note: This reflection is absent for atoms on these specific positions:</strong>
      <table class="checks" style="margin-top: 8px;"><tbody>${siteAbsent.map(c => `<tr>
        <td class="no" style="opacity: 0.6;">✗</td>
        <td class="zone">Wyckoff ${c.mult}${c.letter} (${esc(c.zone)})</td>
        <td class="rule-str" style="opacity: 0.8;">${fmtRule(c.rule)}</td>
      </tr>`).join('')}</tbody></table>
    </div>`;
  }

  if (siteUnknown.length) {
    html += `<div style="margin-top: 16px; font-size: 13px;">
      <strong style="color: var(--text-muted, #666);">Not tested on these positions:</strong>
      <table class="checks" style="margin-top: 8px;"><tbody>${siteUnknown.map(c => `<tr>
        <td class="warn" style="opacity: 0.6;">?</td>
        <td class="zone">Wyckoff ${c.mult}${c.letter}</td>
        <td class="rule-str" style="opacity: 0.8;">zone <b>${esc(c.zone)}</b> is not defined in this file; regenerate with the current script to get <code>zone_defs</code></td>
      </tr>`).join('')}</tbody></table>
    </div>`;
  }
  
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
        <span class="hint">${ops.length} operations, coset representatives included</span></div>
      <div class="sym-layout">
        <div class="op-list">${ops.map((o, i) =>
          `<button class="op${i === state.opSelected ? ' active' : ''}" data-op="${i}">
             <span class="n">(${i + 1})</span><span class="coord">${fmtTriplet(o.xyz)}</span>
           </button>`).join('')}</div>
        <div class="op-panel" id="opPanel">${opPanel(ops[state.opSelected], state.opSelected)}</div>
      </div>
    </section>
    ${trans.length > 1 ? `<section class="block">
      <div class="section-head"><h3>Centring translations</h3>
        <span class="hint">Added to every coordinate above</span></div>
      <div class="coord-list">${trans.map(t =>
        `<div>(${(t.t_frac || []).map(x => fmtTriplet(x)).join('<span class="csep">, </span>')})</div>`).join('')}</div>
    </section>` : ''}`;

  v.querySelectorAll('[data-op]').forEach(b => b.onclick = () => {
    state.opSelected = +b.dataset.op;
    v.querySelectorAll('[data-op]').forEach(x => x.classList.toggle('active', x === b));
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
  
  $('printBtn').onclick = () => {
    if (!state.detail) return;
    
    const view = $('view');
    const vPos = document.createElement('div');
    const vRef = document.createElement('div');
    const vSym = document.createElement('div');
    
    // Add spacing between the sections for the printed page
    vRef.style.marginTop = '32px';
    vSym.style.marginTop = '32px';
    
    // 1. Inject containers into the live DOM first
    view.innerHTML = '';
    view.appendChild(vPos);
    view.appendChild(vRef);
    view.appendChild(vSym);
    
    // 2. Render content (now document.getElementById will find the inputs)
    renderPositions(vPos);
    renderReflections(vRef);
    renderSymmetry(vSym);
    
    // Update document title so the PDF gets saved with the group's name
    const oldTitle = document.title;
    const safeSymbol = (state.detail.symbol || '').replace(/[^a-zA-Z0-9-]/g, '');
    document.title = `SpaceGroup_${state.detail.number}_${safeSymbol}`;
    
    // Allow DOM to update before triggering the blocking print dialog
    setTimeout(() => {
      window.print();
      document.title = oldTitle;
      renderDetail(); // Restores back to the single-tab view
    }, 100);
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

/* The generator's schema this build was written against. A stale sg/ folder
   used to fail one field at a time and look like a data error; say it once,
   plainly, and carry on rendering what is there. */
const SCHEMA_VERSION = 13;

function checkSchema(v) {
  if (v === SCHEMA_VERSION) return;
  const bar = document.createElement('div');
  bar.className = 'schema-warn';
  bar.style.cssText = 'margin:0 0 12px;padding:10px 12px;border:1px solid var(--border,#e0e0e0);' +
    'border-radius:6px;font-size:13px;line-height:1.5';
  bar.innerHTML = v == null
    ? `This <code>sg/</code> folder carries no <code>schema_version</code>. It predates
       <code>zone_defs</code>, so some site conditions cannot be tested. Regenerate it.`
    : `This <code>sg/</code> folder is schema ${esc(v)}; the page expects ${SCHEMA_VERSION}.
       Some fields may be missing or read differently. Regenerate with the current script.`;
  const ws = document.querySelector('.workspace');
  if (ws && ws.parentNode) ws.parentNode.insertBefore(bar, ws);
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
    state.settings = state.index.settings || [];
    checkSchema(state.index.schema_version);
    refreshFilterUI();
    applyFilters();

    const hash = new URLSearchParams(location.hash.replace(/^#/, '')).get('sg');
    const target = hash && state.settings.find(s =>
      String(s.setting_id) === hash || String(s.setting_number) === hash);
    if (target) selectSetting(target.setting_number);
  } catch (e) {
    $('resultList').innerHTML = `<div class="empty mini"><h2>sg/index.json did not load</h2>
      <p>Serve this folder over http next to the generated <code>sg/</code> directory;
      opening the page from disk blocks the fetch.</p>
      <p class="loading" style="margin-top:10px">${esc(e.message)}</p></div>`;
  }
}

init();
