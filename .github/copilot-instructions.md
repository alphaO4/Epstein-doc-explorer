# Copilot Instructions for Epstein Document Network Explorer

## Architecture Overview

This project has **two distinct components** that communicate via REST API:

1. **Analysis Pipeline** (root + `analysis_pipeline/`) - TypeScript scripts using configurable LLM backend to extract RDF triples from documents into SQLite
2. **Visualization Interface** (`network-ui/`) - React/Vite frontend with force-directed graph visualization

**Database:** Single SQLite file `document_analysis.db` with tables:
- `documents` - source documents with AI-generated summaries
- `rdf_triples` - subject-action-object relationships with `top_cluster_ids` (materialized JSON array)
- `entity_aliases` - canonical name mappings with `hop_distance_from_principal` (distance from Jeffrey Epstein)
- `canonical_entities` - deduplicated entity reference table

## Development Workflow

```bash
# Start API server (serves both API and built frontend)
npx tsx api_server.ts

# Frontend development (separate terminal, proxies to API)
cd network-ui && npm run dev

# Full production build
./build.sh
```

**Ports:** API runs on 3001, Vite dev server on 5173.

## Key Code Patterns

### API Endpoints (api_server.ts)
- All endpoints return `{ data, totalBeforeLimit?, totalBeforeFilter? }` for pagination context
- Entity aliases resolved via LEFT JOIN: `COALESCE(ea.canonical_name, rt.actor)`
- Cluster filtering uses materialized `top_cluster_ids` column, not runtime tag lookup

### Frontend State (network-ui/src/App.tsx)
- Global state via useState hooks, not external state library
- Filtering params: `enabledClusterIds`, `yearRange`, `maxHops`, `keywords`, `categories`
- Mobile detection triggers different default limits (5k vs 15k relationships)

### Analysis Scripts
- Use unified `llm_client.ts` module for LLM interactions
- Configurable via environment variables: `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`
- Supports: local endpoints (Ollama, LM Studio, vLLM), OpenRouter, OpenAI, Anthropic
- Default: local Ollama endpoint with llama3.2 model
- All scripts use `better-sqlite3` synchronous API, not async

## Database Migrations

Migration scripts are standalone TypeScript files at root level:
- `add_hop_distance_column.ts` - BFS calculation from Jeffrey Epstein
- `add_tag_embeddings.ts` - Vector embeddings for tags
- `fix_hop_distances.ts` - Recalculates hop distances
- `create_canonical_entities_table.ts` - Dedupe support table

Run migrations: `npx tsx <migration_file>.ts`

## Tag Clustering System

`tag_clusters.json` contains 30 semantic clusters. Each triple has `top_cluster_ids` (top 3 clusters).

**Related scripts:**
- `analysis_pipeline/cluster_tags.ts` - K-means clustering with embeddings
- `analysis_pipeline/assign_new_tags_to_clusters.ts` - Assign new tags to existing clusters
- `analysis_pipeline/update_top_clusters.ts` - Materialize cluster assignments to DB

## File Conventions

- Root `.ts` files: One-off scripts and API server
- `analysis_pipeline/`: Document processing and AI extraction scripts
- `network-ui/src/components/`: React components (Sidebar, NetworkGraph, DocumentModal, etc.)
- `network-ui/src/api.ts`: All fetch calls with consistent error handling
- `data/`: Raw and processed document files (split into chunks for large docs)

## Environment Variables

- `PORT` - API server port (default: 3001)
- `DB_PATH` - SQLite database path (default: `document_analysis.db`)
- `ALLOWED_ORIGINS` - CORS whitelist (comma-separated)
- `VITE_API_BASE_URL` - Frontend API base URL override

## Common Tasks

**Add new API endpoint:** Edit [api_server.ts](../api_server.ts), follow existing pattern with prepared statements and alias resolution.

**Add UI filter:** Update [types.ts](../network-ui/src/types.ts), [api.ts](../network-ui/src/api.ts), and relevant components.

**Process new documents:** Run `npx tsx analysis_pipeline/analyze_documents.ts` then `npx tsx analysis_pipeline/update_top_clusters.ts`.
