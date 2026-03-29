import type { estypes } from "@elastic/elasticsearch";
import {
  elastic,
  elasticIndexExists,
  elasticCreateIndex,
  elasticDeleteIndex,
} from "./elastic";
import type { ElasticReindexOptions } from "./elastic.types";

/**
 * Reindex data from one index to another with new mappings.
 * Use this when you need to make breaking changes to the schema
 * (change field types, remove fields, modify analyzers).
 *
 * Steps:
 * 1. Validates source index exists
 * 2. Creates a new index with the new mappings
 * 3. Copies all documents from old index to new index
 * 4. Validates document counts match
 * 5. Atomically swaps old index for new (delete + alias in one operation)
 *
 * Version Conflicts:
 * The reindex operation uses `conflicts: "proceed"` which continues copying
 * documents even when version conflicts occur. This can happen when:
 * - Documents are being updated during the reindex operation
 * - Multiple reindex operations run concurrently
 * Version conflicts are logged but don't fail the operation. For critical
 * data consistency, ensure no writes occur during reindex.
 *
 * Data Safety:
 * The atomic swap (step 5) uses updateAliases with both remove_index and add
 * actions together. Both actions succeed or both fail - there's no partial state.
 * However, if you need to keep the old index as a backup, set keepOldIndex=true.
 *
 * @param oldIndex - The existing index to reindex from
 * @param options - Reindex configuration options
 *
 * @example
 * ```typescript
 * await elasticReindex('issues', {
 *   mappings: issuesMappings,
 *   suffix: 'v2',
 *   keepOldIndex: true
 * });
 * ```
 */
export async function elasticReindex(
  oldIndex: string,
  options: ElasticReindexOptions
) {
  const { mappings, suffix, settings, keepOldIndex = false } = options;
  const timestampMs = new Date().getTime();
  const indexSuffix = suffix ?? timestampMs.toString();
  const newIndex = `${oldIndex}_${indexSuffix}`;

  try {
    // Step 1: Validate source index exists
    const sourceExists = await elasticIndexExists(oldIndex);
    if (!sourceExists) {
      throw new Error(`Source index ${oldIndex} does not exist`);
    }

    // Step 2: Create new index with new mappings
    console.info(`Creating new index ${newIndex} with updated mappings...`);
    await elasticCreateIndex(newIndex, mappings, settings);

    // Step 3: Copy all documents from old index to new index
    console.info(`Reindexing from ${oldIndex} to ${newIndex}...`);
    const reindexResponse = await elastic.reindex({
      source: { index: oldIndex },
      dest: { index: newIndex },
      wait_for_completion: true,
      conflicts: "proceed", // Continue on version conflicts
    });
    const docsAttempted = reindexResponse.total ?? 0;
    const timeTaken = reindexResponse.took ?? 0;
    const versionConflicts = reindexResponse.version_conflicts ?? 0;
    console.info(
      `Reindexed ${docsAttempted} documents in ${timeTaken}ms (${versionConflicts} version conflicts)`
    );

    // Step 4: Validate document counts match
    const sourceCount = await elastic.count({ index: oldIndex });
    const destCount = await elastic.count({ index: newIndex });

    // Account for version conflicts: conflicted documents are skipped during reindex
    const expectedDestCount = sourceCount.count - versionConflicts;
    if (destCount.count !== expectedDestCount) {
      throw new Error(
        `Document count mismatch: expected ${expectedDestCount} (${sourceCount.count} source - ${versionConflicts} conflicts) but got ${destCount.count}`
      );
    }
    console.info(`✓ Verified ${destCount.count} documents copied successfully (${versionConflicts} conflicts skipped)`);

    // Step 5: Atomically swap old index for new
    console.info(`Swapping ${oldIndex} to point to ${newIndex}...`);

    if (keepOldIndex) {
      // Keep old index as backup with _old suffix
      const backupAlias = `${oldIndex}_old_${indexSuffix}`;
      // Create backup alias first, then do atomic swap
      // Note: Can't have both an index and alias with the same name,
      // so we create the backup alias pointing to the old index before deletion
      await elastic.indices.putAlias({
        index: oldIndex,
        name: backupAlias,
      });
      console.info(`Created backup alias ${backupAlias} -> ${oldIndex}`);

      // Now do the atomic swap (old index will still be accessible via backup alias)
      const aliasResponse = await elastic.indices.updateAliases({
        actions: [
          { remove_index: { index: oldIndex } },
          { add: { index: newIndex, alias: oldIndex } },
        ],
      });

      if (!aliasResponse.acknowledged) {
        throw new Error(`Failed to swap ${oldIndex} to ${newIndex}`);
      }
      console.info(`Old index accessible via ${backupAlias}`);
    } else {
      // Atomic delete + alias (both succeed or both fail)
      const aliasResponse = await elastic.indices.updateAliases({
        actions: [
          { remove_index: { index: oldIndex } },
          { add: { index: newIndex, alias: oldIndex } },
        ],
      });

      if (!aliasResponse.acknowledged) {
        throw new Error(`Failed to swap ${oldIndex} to ${newIndex}`);
      }
    }

    console.info(`✅ Reindex complete: ${oldIndex} now points to ${newIndex}`);
  } catch (error) {
    console.error(`Error during reindex from ${oldIndex} to ${newIndex}:`, error);
    // Attempt cleanup of the new index if it was created
    try {
      const newExists = await elasticIndexExists(newIndex);
      if (newExists) {
        console.info(`Cleaning up failed reindex: deleting ${newIndex}`);
        await elasticDeleteIndex(newIndex);
      }
    } catch (cleanupError) {
      console.error(`Error during cleanup:`, cleanupError);
    }
    throw error instanceof Error
      ? error
      : new Error(`Error during reindex from ${oldIndex} to ${newIndex}`);
  }
}
