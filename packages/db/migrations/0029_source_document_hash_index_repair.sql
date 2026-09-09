-- Repair observed drift from 0008: production retained the unique raw-hash
-- index although document_key is the canonical document identity. Redirected
-- URLs may legitimately yield different document keys with the same raw hash.
-- Preserve all documents, event references and the unique document-key index.
DROP INDEX IF EXISTS `source_documents_raw_hash_idx`;
--> statement-breakpoint
CREATE INDEX `source_documents_raw_hash_idx` ON `source_documents` (`raw_hash`);
