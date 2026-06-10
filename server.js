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

function similarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function normalizeToken(token) {
  const t = String(token || '').toUpperCase().trim();
  if (!t) return { symbol: null, matchedAs: null, alias: false };

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
    .map(k => ({ key: k, score: similarity(compact, k.replace(/[\s\-_.]/g, '')) }))
    .sort((a, b) => b.score - a.score);

  if (candidates.length && candidates[0].score >= 0.86) {
    const best = candidates[0];
    return { symbol: aliasMap[best.key], matchedAs: best.key, alias: true };
  }

  // Accept gene-like tokens directly so valid symbols such as MS4A1 still pass through.
  if (/^[A-Z0-9][A-Z0-9\-_.]{1,18}$/.test(t)) {
    return { symbol: t.replace(/[_.]/g, ''), matchedAs: t, alias: false };
  }

  return { symbol: null, matchedAs: null, alias: false };
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

  return {
    rawTokens,
    normalized,
    genes: normalized.map(x => x.symbol),
    unmatched
  };
}

function overlapScore(inputGenes, pathwayGenes) {
  const set = new Set(inputGenes);
  const overlap = pathwayGenes.filter(g => set.has(g));

  if (!overlap.length) {
    return { overlap, score: 0 };
  }

  const coverage = overlap.length / Math.max(inputGenes.length, 1);
  const pathwayCoverage = overlap.length / Math.max(pathwayGenes.length, 1);
  const score = Math.round((coverage * 55 + pathwayCoverage * 45) * 100) / 100;

  return { overlap, score: Math.max(1, Math.min(Math.round(score), 99)) };
}

function confidenceLabel(score) {
  if (score >= 70) return 'high';
  if (score >= 35) return 'moderate';
  if (score > 0) return 'low';
  return 'none';
}

function explainPathway(pathway, overlap, score, tone = 'balanced') {
  const shared = overlap.length ? overlap.join(', ') : 'no direct overlaps';
  const base = `The gene list shares ${overlap.length} gene${overlap.length === 1 ? '' : 's'} (${shared}) with ${pathway.title}. `;

  if (tone === 'concise') {
    return base + `Score: ${score}%.`;
  }

  if (tone === 'deep') {
    return base + `${pathway.description} This pattern suggests a coordinated biological program rather than an isolated event. Score: ${score}%.`;
  }

  return base + `${pathway.description} Score: ${score}%.`;
}

function organismToCode(organism) {
  switch (organism) {
    case 'mouse':
      return 'mmusculus';
    case 'rat':
      return 'rnorvegicus';
    default:
      return 'hsapiens';
  }
}

function organismToTaxon(organism) {
  switch (organism) {
    case 'mouse':
      return 10090;
    case 'rat':
      return 10116;
    default:
      return 9606;
  }
}

function buildStringUrl(genes, organism) {
  const identifiers = encodeURIComponent(genes.join('%0d'));
  const species = organismToTaxon(organism);
  const requiredScore = 700;
  return `https://version-12-0.string-db.org/api/image/network?identifiers=${identifiers}&species=${species}&required_score=${requiredScore}&network_flavor=confidence&add_white_nodes=2&caller_identity=nash-enrichment-app`;
}

function extractKeggId(termId) {
  const value = String(termId || '').trim();
  const match = value.match(/(?:KEGG:)?([a-z]{2,4}\d{5})/i);
  return match ? match[1] : null;
}

function extractReactomeId(termId) {
  const value = String(termId || '').trim();
  const match = value.match(/(R-(?:HSA|MMU|RNO)-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}

function buildResultLinks(item, genes, organism, stringNetworkUrl) {
  const mode = String(item.mode || '').toLowerCase();
  const source = String(item.source || '').toUpperCase();
  const title = item.title || 'pathway';
  const termId = item.termId || '';

  const pubmed = `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(title)}`;
  let database = pubmed;
  let databaseLabel = 'Search PubMed';

  if (mode === 'string' || source.includes('STRING')) {
    database = stringNetworkUrl || `https://string-db.org/cgi/input?species=${organismToTaxon(organism)}&input_query=${encodeURIComponent(genes.join('%0d'))}`;
    databaseLabel = 'Open STRING network';
  } else if (mode === 'go' || source.includes('GO')) {
    if (/^GO:\d{7}$/i.test(termId)) {
      database = `https://www.ebi.ac.uk/QuickGO/term/${encodeURIComponent(termId)}`;
      databaseLabel = 'Open GO term';
    } else {
      database = `https://www.ebi.ac.uk/QuickGO/search?query=${encodeURIComponent(title)}`;
      databaseLabel = 'Search GO';
    }
  } else if (mode === 'kegg' || source.includes('KEGG')) {
    const id = extractKeggId(termId);
    if (id) {
      database = `https://www.kegg.jp/pathway/${id}`;
      databaseLabel = 'Open KEGG pathway';
    } else {
      database = `https://www.kegg.jp/dbget-bin/www_bfind_sub?mode=bfind&max_hit=1000&dbkey=pathway&keywords=${encodeURIComponent(title)}`;
      databaseLabel = 'Search KEGG';
    }
  } else if (mode === 'reactome' || source.includes('REAC')) {
    const id = extractReactomeId(termId);
    if (id) {
      database = `https://reactome.org/content/detail/${id}`;
      databaseLabel = 'Open Reactome';
    } else {
      database = `https://reactome.org/content/query?q=${encodeURIComponent(title)}`;
      databaseLabel = 'Search Reactome';
    }
  }

  return {
    database,
    databaseLabel,
    pubmed,
    pubmedLabel: 'Open PubMed'
  };
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
      'User-Agent': 'AI-Enrichment-Platform/1.0'
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`g:Profiler request failed (${res.status})`);
  }

  const data = await res.json();
  return Array.isArray(data.result) ? data.result : [];
}

function mapApiRow(row, mode, aiTone) {
  const source = row.source === 'GO:BP' ? 'go' : row.source === 'KEGG' ? 'kegg' : row.source === 'REAC' ? 'reactome' : null;
  if (source !== mode) return null;

  const overlap = Array.isArray(row.intersections)
    ? row.intersections.map(arr => Array.isArray(arr) ? arr[0] : null).filter(Boolean)
    : [];

  const pValue = Number(row.p_value);
  const score = Number.isFinite(pValue)
    ? Math.max(1, Math.min(99, Math.round((1 - Math.min(pValue, 1)) * 100)))
    : 0;

  return {
    mode,
    title: row.name,
    description: row.description || row.name,
    termId: row.native || null,
    score,
    confidence: confidenceLabel(score),
    pValue,
    fdr: Number.isFinite(pValue) ? pValue.toExponential(2) : 'n/a',
    overlap,
    totalGenes: row.term_size || 0,
    querySize: row.query_size || 0,
    source: row.source,
    explanation: explainPathway({ title: row.name, description: row.description || row.name }, overlap, score, aiTone),
    raw: row
  };
}

function buildCuratedResults(mode, genes, aiTone) {
  const rows = curatedPathways[mode] || [];
  return rows
    .map(p => {
      const { overlap, score } = overlapScore(genes, p.genes);
      return {
        mode,
        title: p.title,
        description: p.description,
        termId: `CURATED:${mode.toUpperCase()}:${p.title}`,
        score,
        confidence: confidenceLabel(score),
        pValue: null,
        fdr: score ? (Math.max(0.001, (100 - score) / 1000)).toFixed(4) : 'n/a',
        overlap,
        totalGenes: p.genes.length,
        querySize: genes.length,
        source: `CURATED_${mode.toUpperCase()}`,
        explanation: explainPathway(
          { title: p.title, description: p.description },
          overlap,
          score,
          aiTone
        )
      };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

function buildSyntheticNoHit(mode, genes, aiTone) {
  const title = `${mode.toUpperCase()} search did not find a direct hit`;
  const description = `No direct ${mode.toUpperCase()} enrichment matched the current gene set. This is not unusual for small or very specific inputs. Try a larger list, valid symbols, or another species.`;
  return {
    mode,
    title,
    description,
    termId: null,
    score: 0,
    confidence: 'none',
    pValue: null,
    fdr: 'n/a',
    overlap: [],
    totalGenes: 0,
    querySize: genes.length,
    source: 'SYSTEM',
    explanation: explainPathway(
      { title, description },
      [],
      0,
      aiTone
    )
  };
}

function mergeResults(primary, fallback, limit = 8) {
  const merged = [];
  const seen = new Set();

  for (const item of [...primary, ...fallback]) {
    const key = `${item.mode}::${item.termId || item.title}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  merged.sort((a, b) => (b.score || 0) - (a.score || 0));
  return merged.slice(0, limit);
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
    const {
      genesText = '',
      organism = 'human',
      mode = 'combined',
      fdr = 0.05,
      aiTone = 'balanced'
    } = req.body || {};

    const normalizedInput = normalizeGenes(genesText);
    const genes = normalizedInput.genes;

    if (!genes.length) {
      return res.status(400).json({ error: 'Please provide at least one gene symbol.' });
    }

    const organismCode = organismToCode(organism);
    const stringNetworkUrl = buildStringUrl(genes, organism);

    const decorateResult = (item) => ({
      ...item,
      links: buildResultLinks(item, genes, organism, stringNetworkUrl)
    });

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
      const mapped = mapApiRow(row, row.source === 'GO:BP' ? 'go' : row.source === 'KEGG' ? 'kegg' : row.source === 'REAC' ? 'reactome' : null, aiTone);
      if (!mapped) continue;
      bySource[mapped.mode].push(mapped);
    }

    for (const source of ['go', 'kegg', 'reactome']) {
      const curated = buildCuratedResults(source, genes, aiTone);
      bySource[source] = mergeResults(bySource[source], curated, 8);

      if (!bySource[source].length) {
        bySource[source] = [buildSyntheticNoHit(source, genes, aiTone)];
      }
    }

    bySource.string = buildCuratedResults('string', genes, aiTone);
    if (!bySource.string.length) {
      bySource.string = [buildSyntheticNoHit('string', genes, aiTone)];
    }

    for (const key of ['go', 'kegg', 'reactome', 'string']) {
      bySource[key] = bySource[key].map(decorateResult);
    }

    const realFlat = [
      ...bySource.go,
      ...bySource.kegg,
      ...bySource.reactome,
      ...bySource.string
    ].filter(item => item.source !== 'SYSTEM');

    const allResults = realFlat.length
      ? [...realFlat].sort((a, b) => (b.score || 0) - (a.score || 0))
      : [buildSyntheticNoHit('combined', genes, aiTone)];

    const active = allResults[0] || null;

    const aliasCount = normalizedInput.normalized.filter(x => x.alias).length;
    const warnings = [];

    if (genes.length < 8) {
      warnings.push('Small gene set detected. Enrichment will rely more on overlaps and curated fallback pathways.');
    }

    if (normalizedInput.unmatched.length) {
      warnings.push(`${normalizedInput.unmatched.length} input entr${normalizedInput.unmatched.length === 1 ? 'y was' : 'ies were'} not recognized and were ignored.`);
    }

    const note = gprofilerRows.length
      ? 'g:Profiler results were returned successfully. Curated fallback pathways are merged in when they improve coverage.'
      : 'Using curated fallback pathways because the external enrichment service did not return results for this input.';

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
        totalResults: allResults.length,
        topHit: active ? active.title : null,
        topSource: active ? active.mode : null,
        aliasCount,
        unmatchedCount: normalizedInput.unmatched.length
      },
      diagnostics: {
        aliasCount,
        unmatchedCount: normalizedInput.unmatched.length,
        warnings
      },
      active,
      allResults,
      note
    });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

app.get('/api/download-report', (req, res) => {
  res.status(405).json({ error: 'Use POST /api/analyze and download from the client report button.' });
});

app.listen(PORT, () => {
  console.log(`NASH enrichment app running at http://localhost:${PORT}`);
});
