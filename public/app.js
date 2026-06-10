const NL = String.fromCharCode(10);

const demoGenes = [
  'PNPLA3', 'TM6SF2', 'MBOAT7', 'TNF', 'IL6', 'IL1B', 'CCL2', 'STAT3',
  'TGFB1', 'COL1A1', 'COL3A1', 'ACTA2', 'CTGF', 'SPP1', 'TIMP1', 'MMP2',
  'CASP3', 'TP53', 'AKT1', 'MTOR', 'PPARA', 'SREBF1', 'NFE2L2', 'HMOX1'
];

const state = {
  mode: 'combined',
  lastPayload: null,
  activeResults: []
};

const geneInput = document.getElementById('geneInput');
const fileInput = document.getElementById('fileInput');
const runBtn = document.getElementById('runBtn');
const demoBtn = document.getElementById('demoBtn');
const clearBtn = document.getElementById('clearBtn');
const downloadBtn = document.getElementById('downloadBtn');
const resultsArea = document.getElementById('resultsArea');
const expTitle = document.getElementById('expTitle');
const expText = document.getElementById('expText');
const expChips = document.getElementById('expChips');
const sourceLinks = document.getElementById('sourceLinks');
const chart = document.getElementById('chart');
const networkFrame = document.getElementById('networkFrame');
const normalizationBox = document.getElementById('normalizationBox');
const geneCount = document.getElementById('geneCount');
const resultCount = document.getElementById('resultCount');
const aliasCount = document.getElementById('aliasCount');
const analysisNote = document.getElementById('analysisNote');

function parseLocalGenes(text) {
  return [...new Set(
    String(text)
      .toUpperCase()
      .replace(/[^\w,\n;\t \-]/g, ' ')
      .split(/[\n,;\t ]+/)
      .map(s => s.trim())
      .filter(Boolean)
  )];
}

function setActiveSwitch(mode) {
  document.querySelectorAll('.switch').forEach(el => el.classList.toggle('active', el.dataset.mode === mode));
}

function getModeResults(payload, mode) {
  if (!payload) return [];
  if (mode === 'combined') return payload.allResults || [];
  const byMode = payload.resultsByMode || {};
  return byMode[mode] || [];
}

function updateResultCount(mode, results) {
  const label = mode === 'combined' ? 'enriched pathways shown' : `${mode.toUpperCase()} pathways shown`;
  resultCount.textContent = String(results.length);
  const metric = document.querySelector('#resultCount')?.parentElement?.querySelector('.l');
  if (metric) metric.textContent = label;
}

function renderLoading() {
  resultsArea.innerHTML = '<div class="empty-state">Running analysis…</div>';
  chart.innerHTML = '<div class="empty-state" style="width:100%">Waiting for results…</div>';
  networkFrame.innerHTML = '<div class="empty-state">STRING network is loading…</div>';
  if (analysisNote) analysisNote.style.display = 'none';
}

function renderNormalization(input) {
  if (!input) {
    normalizationBox.innerHTML = '<div class="empty-state">No gene list loaded yet.</div>';
    aliasCount.textContent = '0';
    return;
  }

  const lines = [];
  lines.push(`<div class="mini-list"><strong>Normalized genes (${input.normalized.length})</strong></div>`);
  lines.push('<div class="chip-row">');
  input.normalized.slice(0, 12).forEach(item => {
    lines.push(`<span class="chip">${escapeHtml(item.input)} → ${escapeHtml(item.symbol)}${item.alias ? ' (alias)' : ''}</span>`);
  });
  lines.push('</div>');

  if (input.normalized.length > 12) {
    lines.push(`<div class="helper">Showing first 12 normalized genes. ${input.normalized.length - 12} more hidden.</div>`);
  }
  if (input.unmatched.length) {
    lines.push('<div style="margin-top:12px" class="mini-list"><strong>Unmatched entries</strong></div>');
    lines.push('<div class="chip-row">');
    input.unmatched.slice(0, 8).forEach(item => {
      lines.push(`<span class="chip">${escapeHtml(item)}</span>`);
    });
    lines.push('</div>');
  }
  normalizationBox.innerHTML = lines.join('');
  aliasCount.textContent = String(input.normalized.filter(x => x.alias).length);
}

function renderNote(payload) {
  if (!analysisNote || !payload) return;
  const warnings = payload.diagnostics?.warnings || [];
  const note = payload.note || '';
  const chunks = [];
  if (note) chunks.push(`<div><strong>Analysis note:</strong> ${escapeHtml(note)}</div>`);
  if (warnings.length) chunks.push(`<div style="margin-top:6px"><strong>Warnings:</strong> ${warnings.map(escapeHtml).join(' · ')}</div>`);
  if (!chunks.length) {
    analysisNote.style.display = 'none';
    analysisNote.innerHTML = '';
    return;
  }
  analysisNote.innerHTML = chunks.join('');
  analysisNote.style.display = 'block';
}

function renderLinks(result) {
  if (!sourceLinks || !result) return;
  const links = result.links || {};
  const items = [];

  if (links.database) {
    items.push(`<a class="link-btn" href="${escapeHtmlAttr(links.database)}" target="_blank" rel="noopener noreferrer">${escapeHtml(links.databaseLabel || 'Open source')}</a>`);
  }
  if (links.pubmed) {
    items.push(`<a class="link-btn secondary" href="${escapeHtmlAttr(links.pubmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(links.pubmedLabel || 'PubMed')}</a>`);
  }

  sourceLinks.innerHTML = items.length
    ? items.join('')
    : '<div class="helper">No external link available for this result.</div>';
}

function renderResults(results) {
  if (!results.length) {
    resultsArea.innerHTML = '<div class="empty-state">No enrichment detected with the current input for this database.</div>';
    resultCount.textContent = '0';
    const metric = document.querySelector('#resultCount')?.parentElement?.querySelector('.l');
    if (metric) metric.textContent = 'enriched pathways shown';
    return;
  }

  resultCount.textContent = String(results.length);

  resultsArea.innerHTML = results.map((r, i) => `
    <article class="card" data-index="${i}" tabindex="0" role="button">
      <div class="card-top">
        <span class="tag">${escapeHtml((r.source || r.mode || 'RESULT').toUpperCase())}</span>
        <span class="score">${r.score}%</span>
      </div>
      <h4>${escapeHtml(r.title)}</h4>
      <p>${escapeHtml(r.description || '')}</p>
      <div class="mini">
        <span>${(r.overlap?.length || 0)} shared genes</span>
        <span>${r.pValue ? `p ${formatP(r.pValue)}` : `FDR ${r.fdr || 'n/a'}`}</span>
        <span>${escapeHtml(r.confidence ? `${r.confidence} confidence` : (r.mode ? r.mode.toUpperCase() : 'combined'))}</span>
      </div>
      <div class="card-actions">
        <a class="link-btn" href="${escapeHtmlAttr((r.links && r.links.database) || '#')}" target="_blank" rel="noopener noreferrer" data-stop="true">${escapeHtml((r.links && r.links.databaseLabel) || 'Open source')}</a>
        <a class="link-btn secondary" href="${escapeHtmlAttr((r.links && r.links.pubmed) || '#')}" target="_blank" rel="noopener noreferrer" data-stop="true">${escapeHtml((r.links && r.links.pubmedLabel) || 'PubMed')}</a>
      </div>
    </article>
  `).join('');

  const cards = [...resultsArea.querySelectorAll('.card')];
  cards.forEach((card, idx) => {
    const activate = () => {
      cards.forEach(c => c.style.outline = 'none');
      card.style.outline = '2px solid rgba(110,231,255,0.55)';
      card.style.outlineOffset = '2px';
      updateExplanation(results[idx]);
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate();
    });
    [...card.querySelectorAll('[data-stop="true"]')].forEach(link => {
      link.addEventListener('click', (e) => e.stopPropagation());
    });
  });

  cards[0]?.click();
}

function updateExplanation(result) {
  if (!result) return;
  expTitle.textContent = result.title;
  expText.textContent = result.explanation || result.description || '';
  const chips = [
    `Score: ${result.score}%`,
    `Genes: ${(result.overlap || []).join(', ') || 'none'}`,
    result.pValue ? `p: ${formatP(result.pValue)}` : (result.fdr ? `FDR: ${result.fdr}` : ''),
    result.termId ? `Term: ${result.termId}` : '',
    result.confidence ? `Confidence: ${result.confidence}` : ''
  ].filter(Boolean);
  expChips.innerHTML = chips.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('');
  renderLinks(result);
}

function updateChart(results) {
  const top = results.slice(0, 6);
  if (!top.length) {
    chart.innerHTML = '<div class="empty-state" style="width:100%">No chart data yet.</div>';
    return;
  }
  const max = Math.max(...top.map(r => r.score || 1), 1);
  chart.innerHTML = top.map(r => `
    <div class="bar-wrap" title="${escapeHtml(r.title)}: ${r.score}%">
      <div class="bar" style="height:${Math.max(14, ((r.score || 1) / max) * 180)}px"></div>
      <div class="bar-value">${r.score}%</div>
      <div class="bar-label">${escapeHtml(r.title)}</div>
    </div>
  `).join('');
}

function renderNetwork(url) {
  if (!url) {
    networkFrame.innerHTML = '<div class="empty-state">STRING network will appear here after analysis.</div>';
    return;
  }
  const safeUrl = escapeHtmlAttr(url);
  networkFrame.innerHTML = `
    <img src="${safeUrl}" alt="STRING network image" />
    <div class="helper" style="margin-top:10px">
      If the image does not load, open the STRING source link or verify that the listed genes are valid protein symbols.
    </div>
  `;
}

function renderMode() {
  if (!state.lastPayload) return;
  const results = getModeResults(state.lastPayload, state.mode);
  state.activeResults = results;
  renderResults(results);
  updateChart(results);
  renderNote(state.lastPayload);

  if (state.mode === 'string') {
    renderNetwork(state.lastPayload.stringNetworkUrl);
  } else {
    networkFrame.innerHTML = '<div class="empty-state">STRING view is available in the STRING tab. Switch to STRING to see the network image.</div>';
  }

  if (results.length && results[0]) {
    updateExplanation(results[0]);
  } else {
    expTitle.textContent = state.mode === 'combined' ? 'No strong enrichment found' : `No ${state.mode.toUpperCase()} enrichment found`;
    expText.textContent = 'Try a larger or more focused gene list, verify symbols, or lower the filtering threshold.';
    expChips.innerHTML = '';
    sourceLinks.innerHTML = '';
  }
  updateResultCount(state.mode, results);
}

function formatP(p) {
  const n = Number(p);
  if (!Number.isFinite(n)) return String(p);
  if (n < 0.0001) return n.toExponential(2);
  return n.toFixed(4);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttr(str) {
  return escapeHtml(str).replaceAll('`', '&#96;');
}

async function runAnalysis() {
  const genesText = geneInput.value.trim();
  if (!genesText) {
    resultsArea.innerHTML = '<div class="empty-state">Please enter a gene list first.</div>';
    return;
  }

  runBtn.disabled = true;
  runBtn.textContent = 'Analyzing...';
  renderLoading();

  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        genesText,
        organism: document.getElementById('organism').value,
        mode: state.mode,
        fdr: Number(document.getElementById('fdr').value || 0.05),
        aiTone: document.getElementById('aiTone').value
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Analysis failed');
    }

    state.lastPayload = data;
    geneCount.textContent = String(data.summary?.totalGenes || 0);
    renderNormalization(data.input);
    renderNote(data);
    renderMode();
  } catch (err) {
    resultsArea.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
    chart.innerHTML = '<div class="empty-state" style="width:100%">No chart data.</div>';
    networkFrame.innerHTML = '<div class="empty-state">STRING network could not be loaded.</div>';
    if (analysisNote) analysisNote.style.display = 'none';
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Analysis';
  }
}

demoBtn.addEventListener('click', () => {
  geneInput.value = demoGenes.join(NL);
  geneCount.textContent = String(parseLocalGenes(geneInput.value).length);
});

clearBtn.addEventListener('click', () => {
  geneInput.value = '';
  fileInput.value = '';
  state.lastPayload = null;
  geneCount.textContent = '0';
  resultCount.textContent = '0';
  const metric = document.querySelector('#resultCount')?.parentElement?.querySelector('.l');
  if (metric) metric.textContent = 'enriched pathways shown';
  aliasCount.textContent = '0';
  resultsArea.innerHTML = '<div class="empty-state">No results yet. Paste genes or load the demo set, then click <b>Load Demo NASH Genes</b>.</div>';
  chart.innerHTML = '<div class="empty-state" style="width:100%">No chart data yet.</div>';
  networkFrame.innerHTML = '<div class="empty-state">STRING network will appear here after analysis.</div>';
  normalizationBox.innerHTML = '<div class="empty-state">No gene list loaded yet.</div>';
  expTitle.textContent = 'Waiting for analysis';
  expText.textContent = 'Run an analysis to see how the platform connects your gene list with pathway biology, network context, and likely mechanistic themes.';
  expChips.innerHTML = '';
  sourceLinks.innerHTML = '';
  if (analysisNote) {
    analysisNote.style.display = 'none';
    analysisNote.innerHTML = '';
  }
});

downloadBtn.addEventListener('click', () => {
  if (!state.lastPayload) {
    alert('Run an analysis first.');
    return;
  }
  const blob = new Blob([JSON.stringify(state.lastPayload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'enrichment-report.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

runBtn.addEventListener('click', runAnalysis);

fileInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  geneInput.value = text;
  geneCount.textContent = String(parseLocalGenes(text).length);
});

geneInput.addEventListener('input', () => {
  geneCount.textContent = String(parseLocalGenes(geneInput.value).length);
});

document.getElementById('modeSwitches').addEventListener('click', (e) => {
  const sw = e.target.closest('.switch');
  if (!sw) return;
  state.mode = sw.dataset.mode;
  setActiveSwitch(state.mode);
  renderMode();
});

geneInput.value = demoGenes.join(NL);
geneCount.textContent = String(demoGenes.length);
state.mode = 'combined';
setActiveSwitch(state.mode);
renderNormalization(null);
runAnalysis();
