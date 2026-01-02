#!/bin/bash

# Script to create GitHub issues from PR #95 review comments
# This script requires GitHub CLI (gh) to be installed and authenticated
# Run with: ./create_issues.sh

REPO="sardinedev/comics"

echo "Creating issues for PR #95 review comments..."
echo "Repository: $REPO"
echo ""

# Issue 1: Performance - Cover extraction during sync
gh issue create \
  --repo "$REPO" \
  --title "Performance: Cover extraction during sync operations is too slow for large libraries" \
  --label "performance,enhancement" \
  --body "The sync operations (\`seedElastic\` and \`syncMylarWithElastic\`) call \`ensureCoverCached\` for every downloaded issue during sync. This could be extremely slow for large libraries, as each call downloads the full CBZ file from Mylar, extracts the cover, and writes it to disk. For a library with hundreds or thousands of downloaded issues, this could make the sync process take hours.

**Affected Files:**
- \`src/util/sync.ts\` (lines 69, 112)

**Suggested Solutions:**
- Consider batching cover extraction
- Run cover extraction asynchronously in the background
- Make cover extraction opt-in rather than automatic during every sync
- Implement a queue-based system for cover extraction

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658487963
- https://github.com/sardinedev/comics/pull/95#discussion_r2658487967

**References:** PR #95"

echo "✓ Created Issue 1: Performance - Cover extraction during sync"

# Issue 2: Security - Backfill API endpoint lacks authentication
gh issue create \
  --repo "$REPO" \
  --title "Security: Backfill API endpoint lacks authentication" \
  --label "security,bug" \
  --body "The backfill POST endpoint has no authentication or authorization. Anyone who can reach the API can trigger a potentially expensive operation that downloads hundreds of CBZ files, extracts covers, and updates Elasticsearch. This could be used for denial-of-service attacks or to exhaust server resources.

**Affected Files:**
- \`src/pages/api/covers/backfill.ts\` (line 32)

**Suggested Solutions:**
- Add authentication (API key, session check, etc.)
- Implement rate limiting to protect this endpoint
- Add IP-based access controls
- Consider making this an admin-only endpoint

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658487969

**References:** PR #95"

echo "✓ Created Issue 2: Security - Backfill API endpoint lacks authentication"

# Issue 3: Security - Path traversal vulnerability
gh issue create \
  --repo "$REPO" \
  --title "Security: Path traversal vulnerability in covers route" \
  --label "security,bug" \
  --body "The route extracts the issue ID by removing the file extension (\`path.replace(/\\.[^.]+$/,\"\")\`), but doesn't validate the resulting ID or sanitize the path. A malicious request like \`/covers/../../etc/passwd.jpg\` could potentially be used for path traversal. While \`readCover\` uses \`getCoverFilePath\` which joins with \`process.cwd()\` and \`COVERS_DIR\`, the \`issueId\` should still be validated.

**Affected Files:**
- \`src/pages/covers/[...path].ts\` (line 17)

**Suggested Solutions:**
- Validate that the \`issueId\` contains only alphanumeric characters and doesn't include path separators or special characters
- Add input sanitization before file system operations
- Consider using a whitelist approach for allowed characters
- Add security tests for path traversal attempts

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658488011

**References:** PR #95"

echo "✓ Created Issue 3: Security - Path traversal vulnerability"

# Issue 4: Performance - Memory exhaustion risk
gh issue create \
  --repo "$REPO" \
  --title "Performance: Memory exhaustion risk in cover extraction" \
  --label "performance,bug" \
  --body "The \`mylarDownloadIssue\` function downloads the entire CBZ file into memory as a \`Uint8Array\`. Comic book archives are typically 20-100+ MB each. When processing multiple issues (e.g., during sync or backfill), this could easily exhaust available memory. For a backfill of 100 issues averaging 50MB each, this would require 5GB of memory.

**Affected Files:**
- \`src/util/mylar.ts\` (line 146)

**Suggested Solutions:**
- Use streaming to avoid loading entire files into memory
- Implement resource limits and backpressure mechanisms
- Process covers in smaller batches with memory management
- Consider streaming directly to the unzipper without buffering

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658488013

**References:** PR #95"

echo "✓ Created Issue 4: Performance - Memory exhaustion risk"

# Issue 5: Performance - Inefficient backfill status endpoint
gh issue create \
  --repo "$REPO" \
  --title "Performance: Inefficient backfill status endpoint" \
  --label "performance,enhancement" \
  --body "The GET endpoint fetches all issues from Elasticsearch with \`size: 10000\`, then iterates through all of them calling \`coverExists\` (a file system check) for each downloaded issue. For large libraries, this could be extremely slow and resource-intensive. The 10000 limit is also arbitrary - if a library has more than 10000 issues, the status will be incomplete.

**Affected Files:**
- \`src/pages/api/covers/backfill.ts\` (line 178)

**Suggested Solutions:**
- Use Elasticsearch aggregations to count statuses server-side
- Implement pagination/streaming for the file existence checks
- Cache the status results to avoid repeated file system scans
- Consider storing cover existence as metadata in Elasticsearch

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658487975

**References:** PR #95"

echo "✓ Created Issue 5: Performance - Inefficient backfill status endpoint"

# Issue 6: Code Quality - DRY violation
gh issue create \
  --repo "$REPO" \
  --title "Code Quality: DRY violation in cover extraction code" \
  --label "refactoring,code-quality" \
  --body "The code for extracting covers from downloaded issues is duplicated in both \`seedElastic()\` and \`syncMylarWithElastic()\` functions. This violates the DRY principle and makes maintenance harder.

**Affected Files:**
- \`src/util/sync.ts\` (line 70)

**Suggested Solutions:**
- Extract this logic into a separate helper function in \`src/util/formatter.ts\` or \`src/util/covers.ts\` that can be called from both locations
- Create a shared utility function that handles the cover extraction workflow

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385209

**References:** PR #95"

echo "✓ Created Issue 6: Code Quality - DRY violation"

# Issue 7: Bug - Stream error handling missing
gh issue create \
  --repo "$REPO" \
  --title "Bug: Stream error handling missing in cover extraction" \
  --label "bug,reliability" \
  --body "Stream pipe without error handling on the source stream. Errors won't propagate downstream and may be silently dropped. When an error occurs in the readable stream created from the buffer, it won't be properly handled.

**Affected Files:**
- \`src/util/covers.ts\` (line 225)

**Suggested Solutions:**
- Add error event handler on the readable stream
- Ensure errors propagate to the unzipper stream
- Add proper cleanup on error conditions

**Example fix:**
\`\`\`typescript
const readable = Readable.from(Buffer.from(archiveData));
readable.on(\"error\", (err) => {
  if (resolved) return;
  resolved = true;
  console.error(\"Error reading CBZ data stream:\", err);
  stream.destroy(err);
  resolve(null);
});
\`\`\`

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385306

**References:** PR #95"

echo "✓ Created Issue 7: Bug - Stream error handling missing"

# Issue 8: Bug - Race condition in cover extraction
gh issue create \
  --repo "$REPO" \
  --title "Bug: Race condition in cover extraction stream handling" \
  --label "bug,reliability" \
  --body "The \`extractCoverFromCbz\` function uses a streaming approach with the unzipper library but has a potential race condition. When an entry's data is collected, the entry 'end' event handler pushes to the \`chunks\` array, but this happens asynchronously. If the stream 'close' event fires before all entry 'end' events complete, the chunks array may be incomplete, causing the wrong cover to be selected or no cover to be found.

**Affected Files:**
- \`src/util/covers.ts\` (line 217)

**Suggested Solutions:**
- Wait for all entries to complete before processing in the 'close' handler
- Use a counter/promise-based approach to track pending entries
- Ensure proper synchronization between entry processing and stream closure

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658488017

**References:** PR #95"

echo "✓ Created Issue 8: Bug - Race condition in cover extraction"

# Issue 9: Bug - Race condition in resolved flag
gh issue create \
  --repo "$REPO" \
  --title "Bug: Race condition in resolved flag pattern" \
  --label "bug,reliability" \
  --body "The \`resolved\` flag pattern used in cover extraction is prone to race conditions if the stream events fire in unexpected orders. While the current implementation checks \`if (resolved) return;\` in each handler, a more robust approach would be to ensure the promise can only be resolved once using a wrapper.

**Affected Files:**
- \`src/util/covers.ts\` (line 222)

**Suggested Solutions:**
- Use a helper function or ensure that the stream cleanup happens consistently
- Implement a more robust promise resolution mechanism
- Consider using a promise library that provides this functionality

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385232

**References:** PR #95"

echo "✓ Created Issue 9: Bug - Race condition in resolved flag"

# Issue 10: Code Quality - Type assertions
gh issue create \
  --repo "$REPO" \
  --title "Code Quality: Type assertions should be avoided or documented" \
  --label "code-quality,typescript" \
  --body "The cast \`as unknown as BodyInit\` is used to bypass TypeScript's type checking in multiple places. While Uint8Array should be compatible with BodyInit in modern environments, this type assertion could hide potential runtime issues.

**Affected Files:**
- \`src/pages/covers/[...path].ts\` (multiple locations)

**Suggested Solutions:**
- Use \`Buffer.from(coverData)\` instead
- Verify that the Response constructor accepts Uint8Array directly in your target environment
- Add runtime type checking to ensure compatibility
- Document why the type assertion is necessary

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385171
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385261

**References:** PR #95"

echo "✓ Created Issue 10: Code Quality - Type assertions"

# Issue 11: Code Quality - Unnecessary type conversions
gh issue create \
  --repo "$REPO" \
  --title "Code Quality: Unnecessary type conversions in new.astro" \
  --label "code-quality,typescript" \
  --body "Type conversions added (\`Number()\` and \`String()\`) appear to be unnecessary type coercions. The ComicVine API types should already provide the correct types. If the upstream types are incorrect, they should be fixed at the source (\`comicvine.types.ts\`) rather than applying runtime conversions. These conversions also don't handle edge cases - \`Number(\"abc\")\` returns \`NaN\`, and this could cause runtime issues if the API returns unexpected data.

**Affected Files:**
- \`src/pages/new.astro\` (line 21)

**Suggested Solutions:**
- Remove unnecessary type conversions if types are correct
- Fix upstream types in \`comicvine.types.ts\` if they're incorrect
- Add proper validation if type conversions are needed

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658487999

**References:** PR #95"

echo "✓ Created Issue 11: Code Quality - Unnecessary type conversions"

# Issue 12: Bug - Input validation missing
gh issue create \
  --repo "$REPO" \
  --title "Bug: Input validation missing for limit parameter" \
  --label "bug,validation" \
  --body "The \`limit\` parameter from query string is parsed with \`parseInt\` but doesn't validate the result. If the user provides a non-numeric value, \`parseInt\` returns \`NaN\`, which would cause \`Math.min(NaN * 2, 2000)\` to return \`NaN\` and break the Elasticsearch query.

**Affected Files:**
- \`src/pages/api/covers/backfill.ts\` (line 52)

**Suggested Solutions:**
- Add validation to ensure \`limit\` is a positive integer within a reasonable range (e.g., 1-1000)
- Provide a default value when parsing fails
- Return an error response for invalid input

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658487982

**References:** PR #95"

echo "✓ Created Issue 12: Bug - Input validation missing"

# Issue 13: Code Quality - Hard-coded ELASTIC_INDEX
gh issue create \
  --repo "$REPO" \
  --title "Code Quality: Hard-coded ELASTIC_INDEX value" \
  --label "configuration,code-quality" \
  --body "The ELASTIC_INDEX is hard-coded as \"issues\" instead of using the \`ELASTIC_INDEX\` environment variable that's declared in \`src/env.d.ts\`. This creates an inconsistency with other parts of the codebase and makes the index name non-configurable.

**Affected Files:**
- \`src/pages/api/covers/backfill.ts\`

**Suggested Solutions:**
- Import and use the environment variable: \`const ELASTIC_INDEX = import.meta.env.ELASTIC_INDEX ?? \"issues\";\`
- Use the existing \`getElasticClient\` configuration

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385183

**References:** PR #95"

echo "✓ Created Issue 13: Code Quality - Hard-coded ELASTIC_INDEX"

# Issue 14: Code Quality - Unused variable
gh issue create \
  --repo "$REPO" \
  --title "Code Quality: Unused variable should be removed" \
  --label "code-quality,cleanup" \
  --body "Unused variable \`series_id\` in backfill.ts should be removed to keep the code clean.

**Affected Files:**
- \`src/pages/api/covers/backfill.ts\`

**Suggested Solutions:**
- Remove the unused variable declaration
- Or use it if it was intended for a specific purpose

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385293

**References:** PR #95"

echo "✓ Created Issue 14: Code Quality - Unused variable"

# Issue 15: Code Quality - Dead code branches
gh issue create \
  --repo "$REPO" \
  --title "Code Quality: Dead code branches for PNG/WebP formats" \
  --label "code-quality,cleanup" \
  --body "The cover serving route determines content type from the file extension in the requested path, but all covers are saved with \`.jpg\` extension (see \`getCoverFilePath\` and \`getCoverUrl\`). This means the \`ext === \"png\"\` and \`ext === \"webp\"\` branches will never be reached, as all paths will end with \`.jpg\`.

**Affected Files:**
- \`src/pages/covers/[...path].ts\` (line 29)

**Suggested Solutions:**
- Remove these dead code branches
- Or allow covers to be saved in their original format and determine the content type from the actual file data rather than the request path

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658488009

**References:** PR #95"

echo "✓ Created Issue 15: Code Quality - Dead code branches"

# Issue 16: Bug - Formatter assumes cover exists
gh issue create \
  --repo "$REPO" \
  --title "Bug: Formatter assumes cover exists without verification" \
  --label "bug,reliability" \
  --body "The formatter optimistically sets the cover URL to the local path for downloaded issues, but doesn't check if the cover actually exists on disk. If a cover extraction fails or hasn't been run yet, this will result in broken image links. The comment at line 12 says \"cover will be extracted from CBZ\" but this is misleading - the formatter doesn't extract anything, it just assumes the cover exists. This creates a timing/ordering dependency where covers must be extracted before the issue is formatted, which isn't enforced.

**Affected Files:**
- \`src/util/formatter.ts\` (line 23)

**Suggested Solutions:**
- Check if the cover exists before setting the local path
- Fall back to ComicVine URL if local cover doesn't exist
- Add a flag or metadata to track cover extraction status
- Ensure covers are extracted before formatting or handle missing covers gracefully

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658487988

**References:** PR #95"

echo "✓ Created Issue 16: Bug - Formatter assumes cover exists"

# Issue 17: Enhancement - Optimize Elasticsearch query
gh issue create \
  --repo "$REPO" \
  --title "Enhancement: Optimize Elasticsearch query for downloaded issues" \
  --label "performance,enhancement" \
  --body "The backfill endpoint fetches \`limit * 2\` (up to 2000) issues from Elasticsearch but may process significantly fewer if many are non-downloaded. This could lead to inefficient queries.

**Affected Files:**
- \`src/pages/api/covers/backfill.ts\`

**Suggested Solutions:**
- Add a query filter to only fetch issues with \`issue_status: \"Downloaded\"\` to reduce the data transfer and improve performance:
\`\`\`typescript
bool: {
  filter: [
    { term: { issue_status: \"Downloaded\" } },
  ],
},
\`\`\`

**Related PR Review Comments:**
- https://github.com/sardinedev/comics/pull/95#discussion_r2658385243

**References:** PR #95"

echo "✓ Created Issue 17: Enhancement - Optimize Elasticsearch query"

echo ""
echo "All 17 issues created successfully!"
echo ""
echo "Summary:"
echo "- Critical Security: 2"
echo "- High Priority (Performance/Reliability): 4"
echo "- Medium Priority (Bugs/Enhancements): 6"
echo "- Low Priority (Code Quality): 5"
