# Evidence data

Kagua does not commit a stale derived DHET index. During `npm run build` and `npm run dev`, `prepare:data` downloads the official DHET 2025-2026 accredited-journals workbook, parses all workbook sheets, normalizes ISSN/eISSN identifiers, and writes a compressed runtime index to `src/lib/kagua/data/dhet-2025-2026.json.gz`.

The build fails closed if the official workbook cannot be retrieved or parsing produces fewer than 10,000 ISSN keys. Source URL, retrieval timestamp, edition and source sheet are preserved for provenance.
