# Testing

This project uses Vitest for unit testing.

## Running tests

```bash
# Run all tests
npx vitest run

# Run tests in watch mode
npx vitest

# Run tests with coverage
npx vitest run --coverage
```

## Test organization

- **Test runner**: Vitest
- **Location**: Colocate tests as `*.test.ts` next to the module under test
- **Mocks**: Upstream fixtures go in `src/util/mocks/`

## Writing tests

Tests should be placed next to the code they're testing with a `.test.ts` extension. For example:

```
src/util/formatter.ts
src/util/formatter.test.ts
```

### Mock data

Mock data for external APIs (Mylar, Comic Vine) should be placed in `src/util/mocks/` for reuse across tests.

Existing mocks:
- `comicvineIssues.mock.ts`: Sample Comic Vine issue data
- `comicvineVolume.mock.ts`: Sample Comic Vine volume data

## Current test coverage

Test files in the codebase:
- `src/data/comicvine/comicvine.test.ts`
- `src/data/elastic/elastic.test.ts`
- `src/util/formatter.test.ts`
