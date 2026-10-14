-- PRD 20 Q1: full-text search over messages and DMs ('simple' config: no language stemming,
-- works for Portuguese and English alike). The queries use the same expression so the index applies.
CREATE INDEX "messages_content_fts" ON "messages" USING GIN (to_tsvector('simple', "content"));
CREATE INDEX "direct_messages_content_fts" ON "direct_messages" USING GIN (to_tsvector('simple', "content"));
