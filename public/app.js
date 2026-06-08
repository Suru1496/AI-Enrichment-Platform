const demoGenes = [
  'PNPLA3', 'TM6SF2', 'MBOAT7', 'TNF', 'IL6', 'IL1B', 'CCL2', 'STAT3',
  'TGFB1', 'COL1A1', 'COL3A1', 'ACTA2', 'CTGF', 'SPP1', 'TIMP1', 'MMP2',
  'CASP3', 'TP53', 'AKT1', 'MTOR', 'PPARA', 'SREBF1', 'NFE2L2', 'HMOX1'
];

const state = {
  mode: 'combined',
  lastPayload: null,
  activeResults: [],
  activeResult: null,
  selectedSignature: '',
  isSendingChat: false
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
const chart = document.getElementById('chart');
const networkFrame = document.getElementById('networkFrame');
const normalizationBox = document.getElementById('normalizationBox');
const geneCount = document.getElementById('geneCount');
const resultCount = document.getElementById('resultCount');
const aliasCount = document.getElementById('aliasCount');
const chatBox = document.getElementById('chatBox');
const pathwayQuestion = document.getElementById('pathwayQuestion');
const askPathwayBtn = document.getElementById('askPathwayBtn');
const selectedPathwayLabel = document.getElementById('selectedPathwayLabel');
const quickPrompts = [...document.querySelectorAll('.quick-prompt')];

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
  resultCount.textContent = String(results.length);
  const metric = document.querySelector('#resultCount')?.parentElement?.querySelector('.l');
  if (metric) {
    metric.textContent = mode === 'combined'
      ? 'enriched pathways shown'
      : `${mode.toUpperCase()} pathways shown`;
  }
}

function renderLoading() {
  resultsArea.innerHTML = '<div class="empty-state">Running analysis…</div>';
  chart.innerHTML = '<div class="empty-state" style="width:100%">Waiting for results…</div>';
  networkFrame.innerHTML = '<div class="empty-state">STRING network is loading…</div>';
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
    <article class="card" data-index="${i}" tabindex="0" role="button" aria-label="Select ${escapeHtml(r.title)}">
      <div class="card-top">
        <span class="tag">${escapeHtml((r.source || r.mode || 'RESULT').toUpperCase())}</span>
        <span class="score">${r.score}%</span>
      </div>
      <h4>${escapeHtml(r.title)}</h4>
      <p>${escapeHtml(r.description || '')}</p>
      <div class="mini">
        <span>${r.overlap?.length || 0} shared genes</span>
        <span>${r.pValue ? `p ${formatP(r.pValue)}` : `FDR ${r.fdr || 'n/a'}`}</span>
        <span>${r.mode ? r.mode.toUpperCase() : 'combined'}</span>
      </div>
    </article>
  `).join('');

  const cards = [...resultsArea.querySelectorAll('.card')];
  cards.forEach((card, idx) => {
    const activate = () => {
      cards.forEach(c => c.style.outline = 'none');
      card.style.outline = '2px solid rgba(110,231,255,0.55)';
      card.style.outlineOffset = '2px';
      selectResult(results[idx], { resetChat: true });
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') activate();
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
    result.termId ? `Term: ${result.termId}` : ''
  ].filter(Boolean);

  expChips.innerHTML = chips.map(t => `<span class="chip">${escapeHtml(t)}</span>`).join('');
  selectedPathwayLabel.textContent = `Discussing: ${result.title} • ${result.mode ? result.mode.toUpperCase() : 'COMBINED'}`;
}

function selectResult(result, { resetChat = false } = {}) {
  if (!result) return;
  state.activeResult = result;
  updateExplanation(result);

  if (resetChat) {
    resetChatPanel(result);
  }
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

function updateNetwork(url) {
  if (!url) {
    networkFrame.innerHTML = '<div class="empty-state">STRING network will appear here after analysis.</div>';
    return;
  }

  const safeUrl = url.replace(/"/g, '&quot;');
  networkFrame.innerHTML = `
    <img src="${safeUrl}" alt="STRING network image" />
    <div class="helper" style="margin-top:10px">
      If the image does not load, open the network in STRING directly or verify that the listed genes are valid protein symbols.
    </div>
  `;
}

function renderMode() {
  if (!state.lastPayload) return;

  const results = getModeResults(state.lastPayload, state.mode);
  state.activeResults = results;
  renderResults(results);
  updateChart(results);

  if (state.mode === 'string') {
    updateNetwork(state.lastPayload.stringNetworkUrl);
  } else {
    networkFrame.innerHTML = '<div class="empty-state">STRING view is available in the STRING tab. Switch to STRING to see the network image.</div>';
  }

  if (results.length && results[0]) {
    selectResult(results[0], { resetChat: !state.activeResult || state.activeResult.title !== results[0].title || state.activeResult.mode !== results[0].mode });
  } else {
    expTitle.textContent = state.mode === 'combined' ? 'No strong enrichment found' : `No ${state.mode.toUpperCase()} enrichment found`;
    expText.textContent = 'Try a larger or more focused NASH gene list, or lower the filtering threshold.';
    expChips.innerHTML = '';
    selectedPathwayLabel.textContent = 'No pathway selected yet.';
    if (!chatBox.children.length) {
      resetChatPanel(null);
    }
  }

  updateResultCount(state.mode, results);
}

function resetChatPanel(result) {
  chatBox.innerHTML = '';
  if (result) {
    appendChatMessage('assistant', `You are now discussing ${result.title}. Ask me about the genes, disease relevance, biology, or next steps.`);
  } else {
    appendChatMessage('assistant', 'Ask me anything about the selected pathway. You can ask why the genes are linked, whether the pathway is relevant to NASH, which genes are driving the signal, or what drug targets might be interesting.');
  }
}

function appendChatMessage(role, text) {
  const msg = document.createElement('div');
  msg.className = `chat-msg ${role}`;
  msg.textContent = text;
  chatBox.appendChild(msg);
  chatBox.scrollTop = chatBox.scrollHeight;
  return msg;
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
    state.activeResult = null;
    geneCount.textContent = String(data.summary?.totalGenes || 0);
    renderNormalization(data.input);
    renderMode();
  } catch (err) {
    resultsArea.innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
    chart.innerHTML = '<div class="empty-state" style="width:100%">No chart data.</div>';
    networkFrame.innerHTML = '<div class="empty-state">STRING network could not be loaded.</div>';
  } finally {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Analysis';
  }
}

async function sendPathwayQuestion(questionText) {
  const question = String(questionText || pathwayQuestion.value || '').trim();
  if (!question) return;

  if (!state.activeResult) {
    appendChatMessage('assistant', 'Please run the analysis first and click a pathway card so I know which pathway you want to discuss.');
    return;
  }

  appendChatMessage('user', question);
  pathwayQuestion.value = '';

  askPathwayBtn.disabled = true;
  askPathwayBtn.textContent = 'Thinking...';
  state.isSendingChat = true;

  try {
    const response = await fetch('/api/pathway-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        pathway: state.activeResult,
        genes: state.lastPayload?.input?.genes || [],
        mode: state.mode
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Unable to answer the question.');
    }

    appendChatMessage('assistant', data.answer);
  } catch (err) {
    appendChatMessage('assistant', `Sorry, I could not answer that right now. ${err.message}`);
  } finally {
    askPathwayBtn.disabled = false;
    askPathwayBtn.textContent = 'Ask AI';
    state.isSendingChat = false;
  }
}

demoBtn.addEventListener('click', () => {
  geneInput.value = demoGenes.join('\n');
  geneCount.textContent = String(parseLocalGenes(geneInput.value).length);
});

clearBtn.addEventListener('click', () => {
  geneInput.value = '';
  fileInput.value = '';
  state.lastPayload = null;
  state.activeResults = [];
  state.activeResult = null;
  state.selectedSignature = '';
  geneCount.textContent = '0';
  resultCount.textContent = '0';
  const metric = document.querySelector('#resultCount')?.parentElement?.querySelector('.l');
  if (metric) metric.textContent = 'enriched pathways shown';
  aliasCount.textContent = '0';
  resultsArea.innerHTML = '<div class="empty-state">No results yet. Paste genes or load the demo set, then click <b>Run Analysis</b>.</div>';
  chart.innerHTML = '<div class="empty-state" style="width:100%">No chart data yet.</div>';
  networkFrame.innerHTML = '<div class="empty-state">STRING network will appear here after analysis.</div>';
  normalizationBox.innerHTML = '<div class="empty-state">No gene list loaded yet.</div>';
  expTitle.textContent = 'Waiting for analysis';
  expText.textContent = 'Run an analysis to see how the platform connects your gene list with pathway biology, network context, and likely mechanistic themes.';
  expChips.innerHTML = '';
  selectedPathwayLabel.textContent = 'No pathway selected yet.';
  resetChatPanel(null);
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

askPathwayBtn.addEventListener('click', () => sendPathwayQuestion());
pathwayQuestion.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendPathwayQuestion();
  }
});

quickPrompts.forEach(btn => {
  btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt || '';
    pathwayQuestion.value = prompt;
    pathwayQuestion.focus();
  });
});

geneInput.value = demoGenes.join('\n');
geneCount.textContent = String(demoGenes.length);
state.mode = 'combined';
setActiveSwitch(state.mode);
renderNormalization(null);
resetChatPanel(null);
runAnalysis();
