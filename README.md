# AI-Powered Enrichment Analysis Platform (Node.js)

A polished single-page prototype that accepts a gene list, normalizes common aliases, and runs enrichment analysis with:

- GO Biological Process
- KEGG
- Reactome
- STRING network visualization

## What is included

- Express backend
- Responsive dark UI
- Gene alias normalization for common NASH / NAFLD terms
- External enrichment via g:Profiler
- STRING network image URL
- Downloadable JSON report
- Curated fallback pathways so the app still works if the external API is temporarily unavailable
- each pathway card includes buttons to open the source database page and a PubMed search for the selected pathway

## Run locally

```bash
npm install
npm start
```

Then open:

```bash
http://localhost:3000
```

## Notes

- The backend uses the g:Profiler API for GO, KEGG, and Reactome enrichment. g:Profiler documents a POST API at `/gprofiler/api/gost/profile/` and lists `GO:BP`, `KEGG`, and `REAC` as valid sources. citeturn631498view1turn159087view1
- STRING provides a network image API at `https://version-12-0.string-db.org/api/image/network` and supports parameters such as `identifiers`, `species`, and `required_score`. citeturn631498view0
- Reactome describes its Content Service as a REST API and provides pathway analysis tools through its analysis service. citeturn544491search1turn544491search2turn544491search4

## Improve it next

- add real gene ID conversion with Ensembl / HGNC
- add CSV export and PDF export
- add a disease mode for NASH / NAFLD
- add a live STRING embedded network instead of an image


## Better small-gene handling

The app now includes extra curated immune/B-cell pathways so short gene lists such as MS4A1, MS4A2, MS4A4A, and MS4A6A still return useful results.
