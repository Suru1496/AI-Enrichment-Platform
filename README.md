# AI-Powered Enrichment Analysis Platform

A beginner-friendly web app for gene list enrichment analysis with:

* GO
* KEGG
* Reactome
* STRING
* an interactive AI Pathway Copilot

## What this app does

You can:

1. Paste a gene list or upload a text file
2. Run enrichment analysis
3. Switch between pathway tabs
4. Click a pathway card to read the explanation
5. Ask questions in the chat box beside the explanation

## Before you start

Install **Node.js LTS** from the official website:

https://nodejs.org

Use Node.js version 18 or newer.

## How to install

1. Unzip the project folder
2. Open terminal inside the project folder
3. Run:

```bash
npm install
```

## How to run

```bash
npm start
```

Then open:

```text
http://localhost:3000
```

## How to use

1. Paste your gene list
2. Or click **Load Demo Genes**
3. Choose the analysis mode
4. Click **Run Analysis**
5. Click any pathway card
6. Use **Ask AI** to type a question about that pathway

## Example questions

* Why is this pathway important?
* Is this relevant to specific disease?
* Which genes are the main drivers?
* What therapeutic targets should I look at?
* Explain this in simple terms

## Files

* `server.js` — backend server
* `public/index.html` — page layout
* `public/styles.css` — design
* `public/app.js` — frontend logic
* `data/pathways.json` — fallback pathway definitions
* `data/gene\_aliases.json` — common gene synonym mapping

## Notes

* GO, KEGG, and Reactome are fetched through g:Profiler when available.
* STRING network view is generated from STRING's image API.
* If an external service fails, the app still shows curated fallback pathways.

## Example gene list

```text
PNPLA3
TM6SF2
MBOAT7
TNF
IL6
IL1B
CCL2
STAT3
TGFB1
COL1A1
COL3A1
ACTA2
CTGF
SPP1
TIMP1
MMP2
CASP3
TP53
AKT1
MTOR
```

