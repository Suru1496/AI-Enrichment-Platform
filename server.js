const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const aliasMap = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'gene_aliases.json'), 'utf8'));
const curatedPathways = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'pathways.json'), 'utf8'));

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function parseGeneText(text = '') {
  return [...new Set(
    String(text)
      .toUpperCase()
      .replace(/[^\w,\n;\t \-]/g, ' ')
      .split(/[\n,;\t ]+/)
      .map(s => s.trim())
      .filter(Boolean)
  )];
}

function normalizeToken(token) {
  const t = token.toUpperCase().trim();

  if (aliasMap[t]) {
    return { symbol: aliasMap[t], matchedAs: t, alias: true };
  }

  const compact = t.replace(/[\s\-_.]/g, '');
  for (const [k, v] of Object.entries(aliasMap)) {
    if (k.replace(/[\s\-_.]/g, '') === compact) {
      return { symbol: v, matchedAs: k, alias: true };
    }
  }

  const candidates = Object.keys(aliasMap)
    .map(k => ({
      key: k,
      score: similarity(compact, k.replace(/[\s\-_.]/g, ''))
    }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length && candidates[0].score >= 0.86) {
    return { symbol: aliasMap[candidates[0].key], matchedAs: candidates[0].key, alias: true };
  }

  if (/^[A-Z0-9][A-Z0-9\-_.]{1,12}$/.test(t)) {
    return { symbol: t.replace(/[_.]/g, ''), matchedAs: t, alias: false };
  }

  return { symbol: null, matchedAs: null, alias: false };
}

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

function normalizeGenes(text) {
  const rawTokens = parseGeneText(text);
  const normalized = [];
  const unmatched = [];
  const seen = new Set();

  for (const token of rawTokens) {
    const result = normalizeToken(token);
    if (!result.symbol) {
      unmatched.push(token);
      continue;
    }
    if (!seen.has(result.symbol)) {
      seen.add(result.symbol);
      normalized.push({
        input: token,
        symbol: result.symbol,
        matchedAs: result.matchedAs,
        alias: result.alias
      });
    }
  }

  return { rawTokens, normalized, genes: normalized.map(x => x.symbol), unmatched };
}

function overlapScore(inputGenes, pathwayGenes) {
  const set = new Set(inputGenes);
  const overlap = pathwayGenes.filter(g => set.has(g));
  const score = Math.round((overlap.length / Math.max(pathwayGenes.length, 1)) * 100);
  return { score, overlap };
}

function explainPathway(pathway, overlap, score, tone = 'balanced') {
  const shared = overlap.length ? overlap.join(', ') : 'no direct overlaps';
  const base = `The gene list shares ${overlap.length} gene${overlap.length === 1 ? '' : 's'} (${shared}) with ${pathway.title}. `;

  if (tone === 'concise') {
    return base + `Score: ${score}%.`;
  }

  if (tone === 'deep') {
    return base + pathway.description + ` This pattern suggests the input captures a coordinated biological program rather than an isolated event. Score: ${score}%.`;
  }

  return base + pathway.description + ` Score: ${score}%.`;
}

function organismToCode(organism) {
  switch (organism) {
    case 'mouse': return 'mmusculus';
    case 'rat': return 'rnorvegicus';
    default: return 'hsapiens';
  }
}

function organismToTaxon(organism) {
  switch (organism) {
    case 'mouse': return 10090;
    case 'rat': return 10116;
    default: return 9606;
  }
}

function pathwayBucket(mode, genes) {
  const rows = curatedPathways[mode] || [];
  const out = rows.map(p => {
    const { score, overlap } = overlapScore(genes, p.genes);
    return {
      mode,
      title: p.title,
      description: p.description,
      score,
      fdr: Math.max(0.001, (100 - score) / 1000).toFixed(4),
      overlap,
      totalGenes: p.genes.length,
      source: mode.toUpperCase()
    };
  }).sort((a, b) => b.score - a.score);
  return out.filter(x => x.score > 0);
}

async function fetchGProfiler(genes, organismCode, sources, fdr) {
  const url = 'https://biit.cs.ut.ee/gprofiler/api/gost/profile/';
  const payload = {
    organism: organismCode,
    query: genes,
    sources,
    user_threshold: Number(fdr) || 0.05,
    all_results: false,
    no_iea: false,
    ordered: false,
    combined: false
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'NASH-Enrichment-Prototype/1.0'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`g:Profiler request failed (${res.status})`);
  }

  const data = await res.json();
  const rows = Array.isArray(data.result) ? data.result : [];

  return rows.map(row => ({
    source: row.source,
    title: row.name,
    description: row.description || row.name,
    termId: row.native,
    score: row.p_value ? Math.max(1, Math.min(99, Math.round((1 - Math.min(row.p_value, 1)) * 100))) : 0,
    pValue: row.p_value,
    intersectionSize: row.intersection_size,
    termSize: row.term_size,
    querySize: row.query_size,
    overlap: Array.isArray(row.intersections)
      ? row.intersections
          .map(arr => Array.isArray(arr) ? arr[0] : null)
          .filter(Boolean)
      : [],
    raw: row
  })).sort((a, b) => (a.pValue || 1) - (b.pValue || 1));
}

function buildStringUrl(genes, organism) {
  const identifiers = encodeURIComponent(genes.join('%0d'));
  const species = organismToTaxon(organism);
  const requiredScore = 700;
  return `https://version-12-0.string-db.org/api/image/network?identifiers=${identifiers}&species=${species}&required_score=${requiredScore}&network_flavor=confidence&add_white_nodes=2&caller_identity=nash-enrichment-app`;
}

function isNashRelatedQuestion(question = '') {
  const q = String(question).toLowerCase();
  return /(nash|nafld|fatty liver|steatohepatitis|steatosis|fibrosis|lipid|inflammation)/.test(q);
}

function pickHubGenes(overlap = [], allGenes = []) {
  const priority = ['TP53', 'STAT3', 'AKT1', 'MTOR', 'TNF', 'IL6', 'EGFR', 'MYC', 'TGFB1', 'CCL2', 'COL1A1', 'CASP3', 'PTEN', 'MAPK1'];
  const pool = new Set([...overlap, ...allGenes]);
  return priority.filter(g => pool.has(g)).slice(0, 5);
}

function answerPathwayQuestion({ pathway = {}, question = '', genes = [], mode = 'combined' }) {
  const q = String(question).trim();
  const lower = q.toLowerCase();
  const title = pathway.title || 'this pathway';
  const description = pathway.description || '';
  const overlap = Array.isArray(pathway.overlap) ? pathway.overlap : [];
  const queryGenes = Array.isArray(genes) ? genes : [];

  const askSimple = /(simple|plain language|layman|easy|in simple terms)/.test(lower);
  const askWhy = /(why|how|mechanism|mechanistically|because)/.test(lower);
  const askGenes = /(which genes|what genes|gene(s)? (drive|support|are important)|key genes|drivers?)/.test(lower);
  const askDrug = /(drug|therapeutic|target|inhibitor|treatment|therapy|medication)/.test(lower);
  const askEvidence = /(literature|paper|reference|citation|evidence|study)/.test(lower);
  const askNash = isNashRelatedQuestion(lower);
  const askCompare = /(compare|different|specific|unique|distinct)/.test(lower);

  const opening = `We are discussing ${title}${mode && mode !== 'combined' ? ` from the ${mode.toUpperCase()} tab` : ''}.`;
  const overlapText = overlap.length
    ? `The strongest overlap genes are ${overlap.join(', ')}.`
    : `I do not see a strong direct overlap, so this may be a weaker but still biologically interesting signal.`;

  const context = askNash
    ? `For NASH / NAFLD, this matters most when the pathway reflects inflammation, fibrosis, lipid stress, apoptosis, or metabolic remodelling.`
    : `In general, the pathway becomes more meaningful when several input genes converge on the same biological process.`;

  const hubGenes = pickHubGenes(overlap, queryGenes);
  const hubText = hubGenes.length
    ? `Likely hub genes to watch in this context are ${hubGenes.join(', ')}.`
    : `The most informative genes will usually be the overlapping genes shown in the result card.`;

  const evidenceText = askEvidence
    ? `Good follow-up searches would be: "${title}" + pathway, "${title}" + disease context, and "${(overlap[0] || title)}" + signaling.`
    : '';

  const drugText = askDrug
    ? `For target discovery, treat this as a hypothesis-generating view only. Candidate targets often include hub-like genes such as ${hubGenes.length ? hubGenes.join(', ') : 'the strongest overlapping genes'}.`
    : '';

  const compareText = askCompare
    ? `If you compare tabs, GO usually explains biological processes, KEGG shows canonical signaling pathways, Reactome gives reaction-level detail, and STRING highlights interaction structure.`
    : '';

  const simpleText = askSimple
    ? `In simple terms, the pathway is a biological route that helps cells decide how to respond to stress, grow, repair, communicate, or die.`
    : '';

  const whyText = askWhy ? description : '';
  const geneText = askGenes
    ? `The genes most directly responsible for this hit are ${overlap.length ? overlap.join(', ') : 'the result-set genes that matched the pathway definition'}.`
    : '';

  const closing = `If you want, ask me about a specific gene, disease relevance, drug targets, or how this pathway compares with the GO / KEGG / Reactome / STRING views.`;

  return [opening, overlapText, context, simpleText, whyText, geneText, hubText, drugText, evidenceText, compareText, closing]
    .filter(Boolean)
    .join(' ');
}

app.get('/api/meta', (req, res) => {
  res.json({
    organismOptions: [
      { value: 'human', label: 'Human (Homo sapiens)' },
      { value: 'mouse', label: 'Mouse (Mus musculus)' },
      { value: 'rat', label: 'Rat (Rattus norvegicus)' }
    ],
    analysisModes: ['combined', 'go', 'kegg', 'reactome', 'string']
  });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const { genesText = '', organism = 'human', mode = 'combined', fdr = 0.05, aiTone = 'balanced' } = req.body || {};
    const normalizedInput = normalizeGenes(genesText);
    const genes = normalizedInput.genes;

    if (!genes.length) {
      return res.status(400).json({ error: 'Please provide at least one gene symbol.' });
    }

    const organismCode = organismToCode(organism);
    const stringNetworkUrl = buildStringUrl(genes, organism);

    let gprofilerRows = [];
    try {
      gprofilerRows = await fetchGProfiler(genes, organismCode, ['GO:BP', 'KEGG', 'REAC'], fdr);
    } catch (err) {
      gprofilerRows = [];
    }

    const bySource = {
      go: [],
      kegg: [],
      reactome: [],
      string: []
    };

    for (const row of gprofilerRows) {
      const source = row.source === 'GO:BP' ? 'go' : row.source === 'KEGG' ? 'kegg' : row.source === 'REAC' ? 'reactome' : null;
      if (!source) continue;
      bySource[source].push({
        mode: source,
        title: row.title,
        description: row.description,
        termId: row.termId,
        score: row.score,
        pValue: row.pValue,
        fdr: row.pValue ? Number(row.pValue).toExponential(2) : 'n/a',
        overlap: row.overlap,
        totalGenes: row.termSize,
        querySize: row.querySize,
        source: row.source,
        raw: row.raw,
        explanation: explainPathway({ title: row.title, description: row.description }, row.overlap, row.score, aiTone)
      });
    }

    bySource.string = pathwayBucket('string', genes).map(x => ({
      ...x,
      explanation: explainPathway(
        { title: x.title, description: x.description },
        x.overlap,
        x.score,
        aiTone
      )
    }));

    if (!bySource.go.length) bySource.go = pathwayBucket('go', genes).map(x => ({ ...x, explanation: explainPathway(x, x.overlap, x.score, aiTone) }));
    if (!bySource.kegg.length) bySource.kegg = pathwayBucket('kegg', genes).map(x => ({ ...x, explanation: explainPathway(x, x.overlap, x.score, aiTone) }));
    if (!bySource.reactome.length) bySource.reactome = pathwayBucket('reactome', genes).map(x => ({ ...x, explanation: explainPathway(x, x.overlap, x.score, aiTone) }));

    const flat = [
      ...bySource.go,
      ...bySource.kegg,
      ...bySource.reactome,
      ...bySource.string
    ].sort((a, b) => b.score - a.score);

    const active = flat[0] || null;

    res.json({
      input: normalizedInput,
      organism,
      organismCode,
      fdr: Number(fdr),
      mode,
      stringNetworkUrl,
      resultsByMode: bySource,
      summary: {
        totalGenes: genes.length,
        totalResults: flat.length,
        topHit: active ? active.title : null,
        topSource: active ? active.mode : null
      },
      active,
      allResults: flat,
      note: gprofilerRows.length
        ? 'g:Profiler results were returned successfully. Curated fallback sets are still available for STRING and for resilience.'
        : 'Using curated fallback results because the external enrichment API was unavailable.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

app.post('/api/pathway-chat', (req, res) => {
  try {
    const {
      question = '',
      pathway = {},
      genes = [],
      mode = 'combined'
    } = req.body || {};

    const trimmed = String(question).trim();
    if (!trimmed) {
      return res.status(400).json({ error: 'Please type a question.' });
    }

    const answer = answerPathwayQuestion({
      pathway,
      question: trimmed,
      genes,
      mode
    });

    res.json({
      answer,
      suggestions: [
        'Why are these genes important?',
        'Is this pathway relevant to NASH?',
        'Which genes are the main drivers?',
        'What should I look at next?'
      ]
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unable to answer the pathway question.' });
  }
});

app.get('/api/download-report', (req, res) => {
  res.status(405).json({ error: 'Use POST /api/analyze and download from the client report button.' });
});

app.listen(PORT, () => {
  console.log(`NASH enrichment app running at http://localhost:${PORT}`);
});
