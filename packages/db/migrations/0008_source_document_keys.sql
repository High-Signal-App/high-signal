-- Make source documents document-centric instead of event-hash-centric.
-- The canonical identity is source + canonical_url; raw_hash remains useful for
-- change detection but should not create a new document row on every refetch.

ALTER TABLE `source_documents` ADD COLUMN `document_key` text;
--> statement-breakpoint
UPDATE `source_documents`
SET `document_key` = lower(`source` || ':' || `canonical_url`)
WHERE `document_key` IS NULL;
--> statement-breakpoint
UPDATE `events`
SET `source_document_id` = (
  SELECT survivor.id
  FROM `source_documents` current_doc
  JOIN (
    SELECT `document_key`, min(`id`) AS id
    FROM `source_documents`
    GROUP BY `document_key`
  ) survivor ON survivor.`document_key` = current_doc.`document_key`
  WHERE current_doc.`id` = `events`.`source_document_id`
)
WHERE `source_document_id` IN (
  SELECT `id`
  FROM `source_documents`
  WHERE `document_key` IN (
    SELECT `document_key`
    FROM `source_documents`
    GROUP BY `document_key`
    HAVING count(*) > 1
  )
);
--> statement-breakpoint
DELETE FROM `source_documents`
WHERE `id` NOT IN (
  SELECT min(`id`)
  FROM `source_documents`
  GROUP BY `document_key`
);
--> statement-breakpoint
DROP INDEX IF EXISTS `source_documents_raw_hash_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `source_documents_document_key_idx` ON `source_documents` (`document_key`);
--> statement-breakpoint
CREATE INDEX `source_documents_raw_hash_idx` ON `source_documents` (`raw_hash`);
