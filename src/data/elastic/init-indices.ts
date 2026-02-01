import { elasticInitializeIndex } from "./elastic";
import { ISSUES_INDEX, issuesMappings } from "./models/issue.model";
import { STORY_ARCS_INDEX, storyArcsMappings } from "./models/story-arc.model";

/**
 * Initialize all Elasticsearch indices with their mappings.
 * 
 * This script:
 * - Creates indices if they don't exist
 * - Updates mappings if indices already exist (additive only)
 * - Safe to run multiple times (idempotent)
 * 
 * Run with: npx tsx src/data/elastic/init-indices.ts
 */
export async function initializeAllIndices() {
  console.info("🚀 Initializing Elasticsearch indices...\n");

  try {
    // Initialize issues index
    console.info(`📚 Initializing ${ISSUES_INDEX} index...`);
    await elasticInitializeIndex(ISSUES_INDEX, issuesMappings);
    console.info(`✅ ${ISSUES_INDEX} index ready\n`);

    // Initialize story_arcs index
    console.info(`📖 Initializing ${STORY_ARCS_INDEX} index...`);
    await elasticInitializeIndex(STORY_ARCS_INDEX, storyArcsMappings);
    console.info(`✅ ${STORY_ARCS_INDEX} index ready\n`);

    console.info("✨ All indices initialized successfully!");
  } catch (error) {
    console.error("❌ Error initializing indices:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeAllIndices();
}
