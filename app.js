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
  agencyTaxPct: 0.15,
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
  const pct = (v * 100).toFixed(1).replace('.', ',');
  return v > 0 ? `+${pct}%` : `${pct}%`;
};

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

  document.getElementById('total-seller').textContent = formatBRL(totals.seller);
  document.getElementById('avg-seller').textContent = `Média: ${formatBRL(totals.seller / 12)}/mês`;

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
    minInput.type = 'number';
    minInput.value = Math.round(t.min);
    minInput.step = '1000';
    if (i === 0) {
      minInput.value = 0;
      minInput.classList.add('locked');
      minInput.readOnly = true;
    } else {
      minInput.addEventListener('input', () => {
        state.thresholds[i].min = parseFloat(minInput.value) || 0;
        if (i > 0) state.thresholds[i - 1].max = state.thresholds[i].min - 0.01;
        recalculate();
      });
    }
    tdMin.appendChild(minInput);
    tr.appendChild(tdMin);

    const tdMax = document.createElement('td');
    if (i === n - 1) {
      const maxInput = document.createElement('input');
      maxInput.type = 'text';
      maxInput.value = 'sem limite';
      maxInput.classList.add('locked');
      maxInput.readOnly = true;
      tdMax.appendChild(maxInput);
    } else {
      const maxInput = document.createElement('input');
      maxInput.type = 'number';
      maxInput.value = Math.round(t.max);
      maxInput.step = '1000';
      maxInput.addEventListener('input', () => {
        state.thresholds[i].max = parseFloat(maxInput.value) || 0;
        if (i + 1 < n) state.thresholds[i + 1].min = state.thresholds[i].max + 0.01;
        renderThresholds();
        recalculate();
      });
      tdMax.appendChild(maxInput);
    }
    tr.appendChild(tdMax);

    const tdPct = document.createElement('td');
    const pctInput = document.createElement('input');
    pctInput.type = 'number';
    pctInput.value = (t.commissionPct * 100).toFixed(1);
    pctInput.step = '0.5';
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
function renderMonthlySales() {
  const container = document.getElementById('monthly-sales-grid');
  container.innerHTML = '';

  MONTHS.forEach((month, i) => {
    const cell = document.createElement('div');
    cell.className = 'monthly-cell';

    const label = document.createElement('div');
    label.className = 'monthly-label';
    label.textContent = month;

    function makeStepBtn(text, delta) {
      const btn = document.createElement('button');
      btn.className = 'step-btn';
      btn.textContent = text;
      btn.addEventListener('click', () => {
        state.monthlySales[i] = Math.max(0, (state.monthlySales[i] || 0) + delta);
        input.value = state.monthlySales[i];
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
    input.type = 'number';
    input.value = state.monthlySales[i];
    input.step = '1000';
    input.min = '0';
    input.id = `monthly-sales-${i}`;

    input.addEventListener('input', () => {
      state.monthlySales[i] = parseFloat(input.value) || 0;
      recalculate();
    });

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
    container.appendChild(cell);
  });
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
  const baseParams = {
    agencyCommissionPct: 0.20,
    agencyTaxPct: 0.15,
    numThresholds: 3,
    thresholds: [
      { min: 0, max: 30000, commissionPct: 0.10 },
      { min: 30000.01, max: 100000, commissionPct: 0.20 },
      { min: 100000.01, max: Infinity, commissionPct: 0.30 },
    ],
    monthlySales: generateDefaultMonthlySales(50000, 0.10, 12),
  };

  const conservador1Params = {
    agencyCommissionPct: 0.20,
    agencyTaxPct: 0.15,
    numThresholds: 3,
    thresholds: [
      { min: 0, max: 30000, commissionPct: 0.05 },
      { min: 30000.01, max: 100000, commissionPct: 0.10 },
      { min: 100000.01, max: Infinity, commissionPct: 0.15 },
    ],
    monthlySales: generateDefaultMonthlySales(50000, 0.10, 12),
  };

  const conservador2Params = {
    agencyCommissionPct: 0.25,
    agencyTaxPct: 0.15,
    numThresholds: 3,
    thresholds: [
      { min: 0, max: 50000, commissionPct: 0.05 },
      { min: 50000.01, max: 100000, commissionPct: 0.08 },
      { min: 100000.01, max: Infinity, commissionPct: 0.12 },
    ],
    monthlySales: generateDefaultMonthlySales(50000, 0.10, 12),
  };

  function calcWithParams(params) {
    const saved = getStateSnapshot();
    Object.assign(state, params);
    state.thresholds = params.thresholds.map((t) => ({ ...t }));
    state.monthlySales = [...params.monthlySales];
    const monthly = calculate();
    const totals = getTotals(monthly);
    Object.assign(state, saved);
    state.thresholds = saved.thresholds.map((t) => ({ ...t }));
    state.monthlySales = [...saved.monthlySales];
    return { monthly, totals };
  }

  const r1 = calcWithParams(baseParams);
  const r2 = calcWithParams(conservador1Params);
  const r3 = calcWithParams(conservador2Params);

  scenarios = [
    { name: 'Base - Rafa', params: baseParams, results: { ...r1.totals, monthly: r1.monthly } },
    { name: 'Conservador - Comissão Reduzida', params: conservador1Params, results: { ...r2.totals, monthly: r2.monthly } },
    { name: 'Conservador - Margem Agência', params: conservador2Params, results: { ...r3.totals, monthly: r3.monthly } },
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
    monthlySales: [...state.monthlySales],
  };
}

function saveScenario() {
  const name = prompt('Nome do cenário:');
  if (!name || !name.trim()) return;

  const monthly = calculate();
  const totals = getTotals(monthly);

  scenarios.push({
    name: name.trim(),
    params: getStateSnapshot(),
    results: { ...totals, monthly },
  });

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
  state.monthlySales = [...p.monthlySales];

  // Update DOM inputs
  document.getElementById('agency-commission').value = (state.agencyCommissionPct * 100).toFixed(1);
  document.getElementById('agency-tax').value = (state.agencyTaxPct * 100).toFixed(1);
  document.getElementById('num-thresholds').value = state.numThresholds;

  renderThresholds();
  renderMonthlySales();
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
  const chipsContainer = document.getElementById('scenario-chips');
  chipsContainer.innerHTML = '';

  scenarios.forEach((s, i) => {
    const chip = document.createElement('div');
    chip.className = 'scenario-chip';

    const chipName = document.createElement('span');
    chipName.textContent = s.name;
    chipName.addEventListener('click', () => loadScenario(i));

    const chipDelete = document.createElement('span');
    chipDelete.className = 'chip-delete';
    chipDelete.textContent = '\u00d7';
    chipDelete.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteScenario(i);
    });

    chip.appendChild(chipName);
    chip.appendChild(chipDelete);
    chipsContainer.appendChild(chip);
  });

  // Show/hide compare button
  const compareBtn = document.getElementById('btn-compare');
  compareBtn.style.display = scenarios.length >= 1 ? 'inline-flex' : 'none';
}

// ===== Comparison =====
function openComparison() {
  const section = document.getElementById('comparison-section');
  section.style.display = 'block';
  renderComparisonCheckboxes();
  updateComparison();
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeComparison() {
  document.getElementById('comparison-section').style.display = 'none';
  if (comparisonChart) {
    comparisonChart.destroy();
    comparisonChart = null;
  }
}

function renderComparisonCheckboxes() {
  const container = document.getElementById('comparison-checkboxes');
  container.innerHTML = '';

  // Add "current" option
  const currentLabel = createCheckbox(-1, 'Atual (sem salvar)', true);
  container.appendChild(currentLabel);

  scenarios.forEach((s, i) => {
    const label = createCheckbox(i, s.name, i < 3);
    container.appendChild(label);
  });
}

function createCheckbox(index, name, checked) {
  const label = document.createElement('label');
  label.className = 'comparison-check';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.value = index;
  cb.checked = checked;
  cb.addEventListener('change', updateComparison);

  const dot = document.createElement('span');
  dot.className = 'color-dot';
  const colorIdx = index === -1 ? 0 : (index % SCENARIO_COLORS.length) + 1;
  dot.style.background = SCENARIO_COLORS[colorIdx] || SCENARIO_COLORS[0];

  const text = document.createElement('span');
  text.textContent = name;

  label.appendChild(cb);
  label.appendChild(dot);
  label.appendChild(text);
  return label;
}

function updateComparison() {
  const checkboxes = document.querySelectorAll('#comparison-checkboxes input:checked');
  const selected = Array.from(checkboxes).map((cb) => parseInt(cb.value));

  if (selected.length === 0) {
    document.getElementById('comparison-table-body').innerHTML = '<tr><td colspan="10">Selecione ao menos um cenário</td></tr>';
    return;
  }

  // Build data for each selected scenario
  const scenarioData = selected.map((idx) => {
    if (idx === -1) {
      const monthly = calculate();
      const totals = getTotals(monthly);
      return { name: 'Atual', totals, monthly, colorIdx: 0 };
    }
    const s = scenarios[idx];
    // Recalculate with saved params
    const oldState = getStateSnapshot();
    Object.assign(state, s.params);
    state.thresholds = s.params.thresholds.map((t) => ({ ...t }));
    state.monthlySales = [...s.params.monthlySales];
    const monthly = calculate();
    const totals = getTotals(monthly);
    // Restore current state
    Object.assign(state, oldState);
    state.thresholds = oldState.thresholds.map((t) => ({ ...t }));
    state.monthlySales = [...oldState.monthlySales];
    return { name: s.name, totals, monthly, colorIdx: (idx % SCENARIO_COLORS.length) + 1 };
  });

  renderComparisonTable(scenarioData);
  renderComparisonChart(scenarioData);
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

  const datasets = scenarioData.map((s) => ({
    label: s.name,
    data: s.monthly.map((m) => m.dealValue),
    borderColor: SCENARIO_COLORS[s.colorIdx],
    backgroundColor: SCENARIO_COLORS[s.colorIdx] + '20',
    borderWidth: 2.5,
    pointRadius: 4,
    pointBackgroundColor: SCENARIO_COLORS[s.colorIdx],
    fill: false,
    tension: 0.3,
  }));

  comparisonChart = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels: MONTHS, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: '#8A9A98',
            font: { family: 'Inter', size: 12 },
            padding: 16,
            usePointStyle: true,
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
  document.getElementById('btn-compare').addEventListener('click', openComparison);
  document.getElementById('btn-close-comparison').addEventListener('click', closeComparison);
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
