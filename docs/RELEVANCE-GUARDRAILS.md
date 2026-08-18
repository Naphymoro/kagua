# Kagua relevance guardrails

Kagua applies relevance controls before journal prestige or eligibility can influence ranking.

1. Manuscript anchors are extracted from title, abstract and researcher keywords.
2. Candidate journals are discovered from live Crossref/OpenAlex works.
3. Candidate topic/title text must share meaningful anchor terms with the manuscript before enrichment.
4. Scientific & Editorial Fit uses the same anchors and has a 60/100 shortlist floor.
5. DHET recognition, Qx, JIF or APC cannot rescue a journal that fails scientific scope.

This is designed to prevent cross-domain false positives such as clinical/surgical journals appearing for computational catalysis manuscripts.