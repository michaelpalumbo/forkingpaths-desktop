CREATE TABLE patch_histories (
    id SERIAL PRIMARY KEY,

    -- Meta-graph: which patch history this one was forked from
    forked_from_id INTEGER REFERENCES patch_histories(id) ON DELETE SET NULL,

    -- Automerge document (entire patch history)
    patch_binary BYTEA NOT NULL,

    -- Metadata for search and display
    authors TEXT[] NOT NULL,
    description TEXT,
    modules TEXT[] NOT NULL,
    synth_template JSONB NOT NULL,

    -- Optional: Automerge.hash(doc) for integrity/reference
    automerge_hash TEXT,

    created_at TIMESTAMP DEFAULT NOW()
);


All descendants of a given patch history:


SELECT * FROM patch_histories
WHERE forked_from_id = 3;



Reconstruct a lineage chain:

-- Recursively walk the ancestry of a patch history
WITH RECURSIVE ancestry AS (
  SELECT * FROM patch_histories WHERE id = 34
  UNION ALL
  SELECT ph.* FROM patch_histories ph
  JOIN ancestry a ON ph.id = a.forked_from_id
)
SELECT * FROM ancestry;
