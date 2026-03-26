// ===== State =====
function generateDefaultMonthlySales(base, growth, count) {
  const arr = [base];
  for (let i = 1; i < count; i++) {
    arr.push(Math.round(arr[i - 1] * (1 + growth)));
  }
  return arr;
}

const state = {
  agencyCommissionPct: 0.20,
  agencyTaxPct: 0.30,
  numThresholds: 3,
  thresholds: [
    { min: 0, max: 30000, commissionPct: 0.10 },
    { min: 30000.01, max: 100000, commissionPct: 0.20 },
    { min: 100000.01, max: Infinity, commissionPct: 0.30 },
  ],
  monthlySales: generateDefaultMonthlySales(50000, 0.10, 12),
};

const MONTHS = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'];
const SCENARIO_COLORS = ['#00F0D0', '#80F090', '#D0F060', '#E0F050', '#FF8080', '#80C0FF'];

let chart = null;
let comparisonChart = null;
let rafPending = false;
let scenarios = [];

// ===== Formatting =====
const formatBRL = (v) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const formatBRLShort = (v) => {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${(v / 1_000).toFixed(1).replace('.', ',')}k`;
  return formatBRL(v);
};

const formatPct = (v) => {
  const pct = Math.round(v * 100);
  return v > 0 ? `+${pct}%` : `${pct}%`;
};

const formatK = (v) => {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}K`;
  return String(v);
};

// Parse K/M notation back to number: "100K" -> 100000, "1.5M" -> 1500000
const parseK = (str) => {
  if (!str) return 0;
  str = String(str).trim().toUpperCase().replace(',', '.');
  if (str.endsWith('M')) return parseFloat(str) * 1_000_000 || 0;
  if (str.endsWith('K')) return parseFloat(str) * 1_000 || 0;
  return parseFloat(str) || 0;
};

// Setup a K-formatted input: shows "50K" but stores 50000
function setupKInput(input, getValue, setValue) {
  input.type = 'text';
  input.value = formatK(getValue());
  input.inputMode = 'numeric';

  input.addEventListener('focus', () => {
    input.value = getValue();
    input.select();
  });

  input.addEventListener('blur', () => {
    const parsed = parseK(input.value);
    setValue(parsed);
    input.value = formatK(parsed);
    recalculate();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    }
  });
}

// ===== Calculation Engine =====
function calculate(salesArray) {
  const sales = salesArray || state.monthlySales;
  const monthly = [];

  for (let i = 0; i < 12; i++) {
    const dealValue = sales[i] || 0;
    const agencyCommission = dealValue * state.agencyCommissionPct;
    const influencerRevenue = dealValue - agencyCommission;
    const taxPaid = agencyCommission * state.agencyTaxPct;
    const netAgencyCommission = agencyCommission * (1 - state.agencyTaxPct);

    // Threshold is based on agency commission value, not deal value
    let sellerPct = 0;
    for (const t of state.thresholds) {
      if (t.max === Infinity && agencyCommission >= t.min) {
        sellerPct = t.commissionPct;
        break;
      }
      if (agencyCommission >= t.min && agencyCommission <= t.max) {
        sellerPct = t.commissionPct;
        break;
      }
    }

    const sellerCommission = netAgencyCommission * sellerPct;
    const agencyNet = netAgencyCommission - sellerCommission;

    monthly.push({
      dealValue,
      agencyCommission,
      influencerRevenue,
      taxPaid,
      netAgencyCommission,
      sellerCommission,
      agencyNet,
    });
  }

  return monthly;
}

function getTotals(monthly) {
  return monthly.reduce(
    (acc, m) => ({
      seller: acc.seller + m.sellerCommission,
      agency: acc.agency + m.agencyNet,
      influencer: acc.influencer + m.influencerRevenue,
      tax: acc.tax + m.taxPaid,
      deals: acc.deals + m.dealValue,
    }),
    { seller: 0, agency: 0, influencer: 0, tax: 0, deals: 0 }
  );
}

// ===== DOM Updates =====
function updateSummaryCards(monthly) {
  const totals = getTotals(monthly);

  document.getElementById('total-deals').textContent = formatBRL(totals.deals);
  document.getElementById('avg-deals').textContent = `Média: ${formatBRL(totals.deals / 12)}/mês`;

  const sellerPctOfAgency = totals.agency + totals.seller > 0
    ? Math.round(totals.seller / (totals.agency + totals.seller) * 100)
    : 0;
  const sellerPctOfDeals = totals.deals > 0
    ? (totals.seller / totals.deals * 100).toFixed(1).replace('.', ',')
    : '0';
  document.getElementById('total-seller').textContent = formatBRL(totals.seller);
  document.getElementById('avg-seller').textContent = `${sellerPctOfDeals}% do deal · ${sellerPctOfAgency}% da agência`;

  document.getElementById('total-agency').textContent = formatBRL(totals.agency);
  document.getElementById('avg-agency').textContent = `Média: ${formatBRL(totals.agency / 12)}/mês`;

  document.getElementById('total-influencer').textContent = formatBRL(totals.influencer);
  document.getElementById('avg-influencer').textContent = `Média: ${formatBRL(totals.influencer / 12)}/mês`;

  document.getElementById('total-tax').textContent = formatBRL(totals.tax);
  document.getElementById('avg-tax').textContent = `Média: ${formatBRL(totals.tax / 12)}/mês`;
}

function updateChart(monthly) {
  if (!chart) return;

  chart.data.datasets[0].data = monthly.map((m) => m.sellerCommission);
  chart.data.datasets[1].data = monthly.map((m) => m.agencyNet);
  chart.data.datasets[2].data = monthly.map((m) => m.taxPaid);
  chart.data.datasets[3].data = monthly.map((m) => m.influencerRevenue);
  chart.data.datasets[4].data = monthly.map((m) => m.dealValue);

  chart.update('none');
}

function updateGrowthBadges() {
  for (let i = 0; i < 12; i++) {
    const badge = document.getElementById(`growth-badge-${i}`);
    if (!badge) continue;

    if (i === 0) {
      badge.textContent = '—';
      badge.className = 'growth-badge neutral';
    } else {
      const prev = state.monthlySales[i - 1];
      const curr = state.monthlySales[i];
      if (prev === 0) {
        badge.textContent = '—';
        badge.className = 'growth-badge neutral';
      } else {
        const pct = (curr - prev) / prev;
        badge.textContent = formatPct(pct);
        badge.className = `growth-badge ${pct >= 0 ? 'positive' : 'negative'}`;
      }
    }
  }
}

function recalculate() {
  const monthly = calculate();
  updateSummaryCards(monthly);
  updateGrowthBadges();

  if (!rafPending) {
    rafPending = true;
    requestAnimationFrame(() => {
      updateChart(calculate());
      rafPending = false;
    });
  }
}

// ===== Threshold Table =====
function renderThresholds() {
  const tbody = document.getElementById('threshold-body');
  const n = state.numThresholds;

  while (state.thresholds.length < n) {
    const last = state.thresholds[state.thresholds.length - 1];
    const prevMax = last.max === Infinity ? (last.min + 50000) : last.max;
    state.thresholds.push({
      min: prevMax + 0.01,
      max: Infinity,
      commissionPct: Math.min(last.commissionPct + 0.03, 0.5),
    });
    if (last.max === Infinity) {
      last.max = prevMax;
    }
  }
  while (state.thresholds.length > n) {
    state.thresholds.pop();
  }
  state.thresholds[n - 1].max = Infinity;

  tbody.innerHTML = '';

  state.thresholds.forEach((t, i) => {
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    tdLabel.className = 'tier-label';
    tdLabel.textContent = i + 1;
    tr.appendChild(tdLabel);

    const tdMin = document.createElement('td');
    const minInput = document.createElement('input');
    if (i === 0) {
      minInput.type = 'text';
      minInput.value = '0';
      minInput.classList.add('locked');
      minInput.readOnly = true;
    } else {
      setupKInput(minInput,
        () => state.thresholds[i].min,
        (v) => {
          state.thresholds[i].min = v;
          if (i > 0) state.thresholds[i - 1].max = v - 0.01;
        }
      );
    }
    tdMin.appendChild(minInput);
    tr.appendChild(tdMin);

    const tdMax = document.createElement('td');
    if (i === n - 1) {
      const maxInput = document.createElement('input');
      maxInput.type = 'text';
      maxInput.value = '∞';
      maxInput.classList.add('locked');
      maxInput.readOnly = true;
      tdMax.appendChild(maxInput);
    } else {
      const maxInput = document.createElement('input');
      setupKInput(maxInput,
        () => state.thresholds[i].max,
        (v) => {
          state.thresholds[i].max = v;
          if (i + 1 < n) state.thresholds[i + 1].min = v + 0.01;
          renderThresholds();
        }
      );
      tdMax.appendChild(maxInput);
    }
    tr.appendChild(tdMax);

    const tdPct = document.createElement('td');
    const pctInput = document.createElement('input');
    pctInput.type = 'number';
    pctInput.value = Math.round(t.commissionPct * 100);
    pctInput.step = '1';
    pctInput.min = '0';
    pctInput.max = '100';
    pctInput.addEventListener('input', () => {
      state.thresholds[i].commissionPct = (parseFloat(pctInput.value) || 0) / 100;
      recalculate();
    });
    tdPct.appendChild(pctInput);
    tr.appendChild(tdPct);

    tbody.appendChild(tr);
  });
}

// ===== Monthly Sales Inputs =====
let monthsExpanded = false;

function buildMonthCell(i) {
  const cell = document.createElement('div');
  cell.className = 'monthly-cell';

  const label = document.createElement('div');
  label.className = 'monthly-label';
  label.textContent = MONTHS[i];

  function makeStepBtn(text, delta) {
    const btn = document.createElement('button');
    btn.className = 'step-btn';
    btn.textContent = text;
    btn.addEventListener('click', () => {
      state.monthlySales[i] = Math.max(0, (state.monthlySales[i] || 0) + delta);
      const inp = document.getElementById(`monthly-sales-${i}`);
      inp.value = formatK(state.monthlySales[i]);
      recalculate();
    });
    return btn;
  }

  const stepDown = document.createElement('div');
  stepDown.className = 'step-group';
  stepDown.appendChild(makeStepBtn('--', -100000));
  stepDown.appendChild(makeStepBtn('-', -10000));

  const inputWrap = document.createElement('div');
  inputWrap.className = 'input-currency monthly-input';

  const prefix = document.createElement('span');
  prefix.className = 'currency-prefix';
  prefix.textContent = 'R$';

  const input = document.createElement('input');
  input.id = `monthly-sales-${i}`;
  setupKInput(input,
    () => state.monthlySales[i],
    (v) => { state.monthlySales[i] = v; }
  );

  inputWrap.appendChild(prefix);
  inputWrap.appendChild(input);

  const stepUp = document.createElement('div');
  stepUp.className = 'step-group';
  stepUp.appendChild(makeStepBtn('+', 10000));
  stepUp.appendChild(makeStepBtn('++', 100000));

  const badge = document.createElement('span');
  badge.className = 'growth-badge neutral';
  badge.id = `growth-badge-${i}`;
  badge.textContent = '—';

  cell.appendChild(label);
  cell.appendChild(stepDown);
  cell.appendChild(inputWrap);
  cell.appendChild(stepUp);
  cell.appendChild(badge);
  return cell;
}

function copyM01ToAll() {
  const val = state.monthlySales[0] || 0;
  for (let i = 1; i < 12; i++) {
    state.monthlySales[i] = val;
    const input = document.getElementById(`monthly-sales-${i}`);
    if (input) input.value = formatK(val);
  }
  recalculate();
}

function toggleMonths() {
  monthsExpanded = !monthsExpanded;
  const grid = document.getElementById('monthly-sales-grid');
  const btn = document.getElementById('btn-toggle-months');
  grid.style.display = monthsExpanded ? 'grid' : 'none';
  btn.textContent = monthsExpanded ? 'Ocultar' : 'Expandir';
}

function renderMonthlySales() {
  // M01 row (always visible)
  const m01Container = document.getElementById('monthly-sales-m01');
  m01Container.innerHTML = '';

  const m01Row = document.createElement('div');
  m01Row.className = 'monthly-m01';

  const m01Cell = buildMonthCell(0);
  m01Cell.style.flex = '1';

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-secondary btn-sm';
  copyBtn.innerHTML = '<span class="copy-icon">&#9112;</span> Copiar p/ todos';
  copyBtn.title = 'Copiar valor do M01 para todos os meses';
  copyBtn.addEventListener('click', copyM01ToAll);

  m01Row.appendChild(m01Cell);
  m01Row.appendChild(copyBtn);
  m01Container.appendChild(m01Row);

  // M02-M12 grid (collapsible)
  const container = document.getElementById('monthly-sales-grid');
  container.innerHTML = '';

  for (let i = 1; i < 12; i++) {
    container.appendChild(buildMonthCell(i));
  }

  // Toggle button
  const btn = document.getElementById('btn-toggle-months');
  btn.addEventListener('click', toggleMonths);
}

// ===== Chart Setup =====
function initChart() {
  const ctx = document.getElementById('commission-chart').getContext('2d');

  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: MONTHS,
      datasets: [
        {
          label: 'Comissão Vendedor',
          data: Array(12).fill(0),
          backgroundColor: 'rgba(0, 240, 208, 0.85)',
          borderColor: '#00F0D0',
          borderWidth: 1,
          stack: 'stack1',
          order: 2,
        },
        {
          label: 'Receita Agência',
          data: Array(12).fill(0),
          backgroundColor: 'rgba(128, 240, 144, 0.85)',
          borderColor: '#80F090',
          borderWidth: 1,
          stack: 'stack1',
          order: 2,
        },
        {
          label: 'Impostos',
          data: Array(12).fill(0),
          backgroundColor: 'rgba(224, 240, 80, 0.85)',
          borderColor: '#E0F050',
          borderWidth: 1,
          stack: 'stack1',
          order: 2,
        },
        {
          label: 'Receita Influenciador',
          data: Array(12).fill(0),
          backgroundColor: 'rgba(208, 240, 96, 0.5)',
          borderColor: '#D0F060',
          borderWidth: 1,
          stack: 'stack1',
          order: 2,
        },
        {
          label: 'Valor Total Deal',
          data: Array(12).fill(0),
          type: 'line',
          borderColor: '#ffffff',
          borderDash: [6, 3],
          borderWidth: 2,
          pointBackgroundColor: '#ffffff',
          pointRadius: 3,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8A9A98',
            font: { family: 'Inter', size: 11 },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 12,
          },
        },
        tooltip: {
          backgroundColor: '#1A2228',
          titleColor: '#F0F4F0',
          bodyColor: '#F0F4F0',
          borderColor: '#2A3A38',
          borderWidth: 1,
          padding: 12,
          titleFont: { family: 'Inter', weight: '600' },
          bodyFont: { family: 'Inter' },
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8A9A98', font: { family: 'Inter', size: 12 } },
          grid: { color: 'rgba(42, 58, 56, 0.5)' },
        },
        y: {
          ticks: {
            color: '#8A9A98',
            font: { family: 'Inter', size: 11 },
            callback: (v) => formatBRLShort(v),
          },
          grid: { color: 'rgba(42, 58, 56, 0.5)' },
        },
      },
    },
  });
}

// ===== Scenarios =====
function loadScenariosFromStorage() {
  try {
    const raw = localStorage.getItem('seekcomercial_scenarios');
    scenarios = raw ? JSON.parse(raw, (key, val) => {
      if (val === 'Infinity') return Infinity;
      return val;
    }) : [];
    // Fix Infinity deserialization from JSON (legacy data)
    scenarios.forEach((s) => {
      if (s.params && s.params.thresholds) {
        s.params.thresholds.forEach((t) => {
          if (t.max === null || t.max > 1e15) t.max = Infinity;
        });
      }
    });
  } catch {
    scenarios = [];
  }
  // Seed default scenarios on first visit
  if (scenarios.length === 0) {
    seedDefaultScenarios();
  }
}

function seedDefaultScenarios() {
  scenarios = [
    {
      name: 'Base - Rafa',
      params: {
        agencyCommissionPct: 0.20,
        agencyTaxPct: 0.30,
        numThresholds: 3,
        thresholds: [
          { min: 0, max: 30000, commissionPct: 0.10 },
          { min: 30000.01, max: 100000, commissionPct: 0.20 },
          { min: 100000.01, max: Infinity, commissionPct: 0.30 },
        ],
      },
    },
    {
      name: 'Conservador - Comissão Reduzida',
      params: {
        agencyCommissionPct: 0.20,
        agencyTaxPct: 0.30,
        numThresholds: 3,
        thresholds: [
          { min: 0, max: 30000, commissionPct: 0.05 },
          { min: 30000.01, max: 100000, commissionPct: 0.10 },
          { min: 100000.01, max: Infinity, commissionPct: 0.15 },
        ],
      },
    },
    {
      name: 'Conservador - Margem Agência',
      params: {
        agencyCommissionPct: 0.25,
        agencyTaxPct: 0.30,
        numThresholds: 3,
        thresholds: [
          { min: 0, max: 50000, commissionPct: 0.05 },
          { min: 50000.01, max: 100000, commissionPct: 0.08 },
          { min: 100000.01, max: Infinity, commissionPct: 0.12 },
        ],
      },
    },
  ];

  saveScenariosToStorage();
}

function saveScenariosToStorage() {
  // JSON.stringify converts Infinity to null, so we replace before saving
  const data = JSON.stringify(scenarios, (key, val) => {
    if (val === Infinity) return 'Infinity';
    return val;
  });
  localStorage.setItem('seekcomercial_scenarios', data);
}

function getStateSnapshot() {
  return {
    agencyCommissionPct: state.agencyCommissionPct,
    agencyTaxPct: state.agencyTaxPct,
    numThresholds: state.numThresholds,
    thresholds: state.thresholds.map((t) => ({ ...t })),
  };
}

function saveScenario() {
  const nameInput = document.getElementById('scenario-name-input');
  const name = (nameInput.value || '').trim();
  if (!name) {
    nameInput.focus();
    nameInput.style.borderColor = '#F87171';
    setTimeout(() => { nameInput.style.borderColor = ''; }, 1500);
    return;
  }

  scenarios.push({
    name,
    params: getStateSnapshot(),
  });

  nameInput.value = '';
  saveScenariosToStorage();
  renderScenarioBar();
}

function loadScenario(index) {
  const s = scenarios[index];
  if (!s) return;

  const p = s.params;
  state.agencyCommissionPct = p.agencyCommissionPct;
  state.agencyTaxPct = p.agencyTaxPct;
  state.numThresholds = p.numThresholds;
  state.thresholds = p.thresholds.map((t) => ({ ...t }));
  // monthlySales NOT overridden — vendas são independentes dos cenários

  // Update DOM inputs
  document.getElementById('agency-commission').value = Math.round(state.agencyCommissionPct * 100);
  document.getElementById('agency-tax').value = Math.round(state.agencyTaxPct * 100);
  document.getElementById('num-thresholds').value = state.numThresholds;

  renderThresholds();
  recalculate();
}

function deleteScenario(index) {
  scenarios.splice(index, 1);
  saveScenariosToStorage();
  renderScenarioBar();
  // Close comparison if open
  const compSection = document.getElementById('comparison-section');
  if (compSection) compSection.style.display = 'none';
}

function renderScenarioBar() {
  const listContainer = document.getElementById('scenario-list');
  listContainer.innerHTML = '';

  if (scenarios.length === 0) {
    listContainer.innerHTML = '<p class="hint" style="margin:0">Nenhum cenário salvo ainda</p>';
    // Hide comparison
    document.getElementById('comparison-section').style.display = 'none';
    return;
  }

  scenarios.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'scenario-row';

    const left = document.createElement('div');
    left.className = 'scenario-row-left';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'scenario-cb';
    cb.dataset.index = i;
    cb.addEventListener('change', onScenarioCheckChange);

    const colorDot = document.createElement('span');
    colorDot.className = 'color-dot';
    colorDot.style.background = SCENARIO_COLORS[(i % SCENARIO_COLORS.length) + 1] || SCENARIO_COLORS[0];

    const nameSpan = document.createElement('span');
    nameSpan.className = 'scenario-name';
    nameSpan.textContent = s.name;
    nameSpan.addEventListener('click', () => loadScenario(i));

    left.appendChild(cb);
    left.appendChild(colorDot);
    left.appendChild(nameSpan);

    const actions = document.createElement('div');
    actions.className = 'scenario-row-actions';

    const loadBtn = document.createElement('button');
    loadBtn.className = 'btn btn-ghost btn-xs';
    loadBtn.textContent = 'Carregar';
    loadBtn.addEventListener('click', () => loadScenario(i));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-ghost btn-xs del-btn';
    delBtn.textContent = '\u00d7';
    delBtn.addEventListener('click', () => deleteScenario(i));

    actions.appendChild(loadBtn);
    actions.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(actions);
    listContainer.appendChild(row);
  });
}

function onScenarioCheckChange() {
  const checked = document.querySelectorAll('.scenario-cb:checked');
  const section = document.getElementById('comparison-section');

  if (checked.length >= 2) {
    section.style.display = 'block';
    updateComparisonFromChecks();
  } else {
    section.style.display = 'none';
    if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
  }
}

function calcWithScenarioParams(params) {
  const saved = getStateSnapshot();
  state.agencyCommissionPct = params.agencyCommissionPct;
  state.agencyTaxPct = params.agencyTaxPct;
  state.numThresholds = params.numThresholds;
  state.thresholds = params.thresholds.map((t) => ({ ...t }));
  // Use current monthlySales — vendas são independentes
  const monthly = calculate();
  const totals = getTotals(monthly);
  // Restore
  state.agencyCommissionPct = saved.agencyCommissionPct;
  state.agencyTaxPct = saved.agencyTaxPct;
  state.numThresholds = saved.numThresholds;
  state.thresholds = saved.thresholds.map((t) => ({ ...t }));
  return { monthly, totals };
}

function updateComparisonFromChecks() {
  const checked = document.querySelectorAll('.scenario-cb:checked');
  const indices = Array.from(checked).map((cb) => parseInt(cb.dataset.index));

  const scenarioData = indices.map((idx) => {
    const s = scenarios[idx];
    const { monthly, totals } = calcWithScenarioParams(s.params);
    return { name: s.name, totals, monthly, colorIdx: (idx % SCENARIO_COLORS.length) + 1 };
  });

  renderComparisonTable(scenarioData);
  renderComparisonChart(scenarioData);
}

// ===== Comparison =====
function closeComparison() {
  document.getElementById('comparison-section').style.display = 'none';
  document.querySelectorAll('.scenario-cb').forEach((cb) => { cb.checked = false; });
  if (comparisonChart) { comparisonChart.destroy(); comparisonChart = null; }
}

function renderComparisonTable(scenarioData) {
  const thead = document.getElementById('comparison-table-head');
  const tbody = document.getElementById('comparison-table-body');

  // Header row
  let headerHTML = '<th>Métrica</th>';
  scenarioData.forEach((s) => {
    headerHTML += `<th style="color:${SCENARIO_COLORS[s.colorIdx]}">${s.name}</th>`;
  });
  if (scenarioData.length === 2) {
    headerHTML += '<th>Diferença</th>';
  }
  thead.innerHTML = `<tr>${headerHTML}</tr>`;

  // Metrics
  const metrics = [
    { key: 'seller', label: 'Comissão Vendedor' },
    { key: 'agency', label: 'Receita Agência' },
    { key: 'influencer', label: 'Receita Influenciador' },
    { key: 'tax', label: 'Impostos Pagos' },
    { key: 'deals', label: 'Total Deals' },
  ];

  let bodyHTML = '';
  metrics.forEach((m) => {
    bodyHTML += `<tr><td class="metric-label">${m.label}</td>`;
    scenarioData.forEach((s) => {
      bodyHTML += `<td>${formatBRL(s.totals[m.key])}</td>`;
    });
    if (scenarioData.length === 2) {
      const a = scenarioData[0].totals[m.key];
      const b = scenarioData[1].totals[m.key];
      const diff = b !== 0 ? (a - b) / Math.abs(b) : 0;
      const diffClass = diff >= 0 ? 'positive' : 'negative';
      bodyHTML += `<td class="delta ${diffClass}">${formatPct(diff)}</td>`;
    }
    bodyHTML += '</tr>';
  });

  tbody.innerHTML = bodyHTML;
}

function renderComparisonChart(scenarioData) {
  const canvas = document.getElementById('comparison-chart');
  if (comparisonChart) {
    comparisonChart.destroy();
  }

  // Grouped bar chart — each metric as a group, each scenario as a bar
  const metricLabels = ['Vendedor', 'Agência', 'Influenciador', 'Impostos'];
  const metricKeys = ['seller', 'agency', 'influencer', 'tax'];

  const datasets = scenarioData.map((s) => ({
    label: s.name,
    data: metricKeys.map((key) => s.totals[key]),
    backgroundColor: SCENARIO_COLORS[s.colorIdx] + 'CC',
    borderColor: SCENARIO_COLORS[s.colorIdx],
    borderWidth: 1,
    borderRadius: 4,
  }));

  comparisonChart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: { labels: metricLabels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8A9A98',
            font: { family: 'Inter', size: 11 },
            padding: 16,
            usePointStyle: true,
            pointStyleWidth: 12,
          },
        },
        tooltip: {
          backgroundColor: '#1A2228',
          titleColor: '#F0F4F0',
          bodyColor: '#F0F4F0',
          borderColor: '#2A3A38',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#8A9A98', font: { family: 'Inter', size: 11 } },
          grid: { display: false },
        },
        y: {
          ticks: {
            color: '#8A9A98',
            font: { family: 'Inter', size: 11 },
            callback: (v) => formatBRLShort(v),
          },
          grid: { color: 'rgba(42, 58, 56, 0.5)' },
        },
      },
    },
  });
}

// ===== Event Bindings =====
function bindEvents() {
  document.getElementById('agency-commission').addEventListener('input', (e) => {
    state.agencyCommissionPct = (parseFloat(e.target.value) || 0) / 100;
    recalculate();
  });

  document.getElementById('agency-tax').addEventListener('input', (e) => {
    state.agencyTaxPct = (parseFloat(e.target.value) || 0) / 100;
    recalculate();
  });

  document.getElementById('num-thresholds').addEventListener('change', (e) => {
    state.numThresholds = parseInt(e.target.value);
    renderThresholds();
    recalculate();
  });

  document.getElementById('btn-save').addEventListener('click', saveScenario);
  document.getElementById('btn-close-comparison').addEventListener('click', closeComparison);

  // Allow Enter key to save scenario
  document.getElementById('scenario-name-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveScenario();
  });
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  loadScenariosFromStorage();
  renderThresholds();
  renderMonthlySales();
  initChart();
  bindEvents();
  renderScenarioBar();
  recalculate();
});
