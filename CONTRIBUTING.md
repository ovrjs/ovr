# Contributing to ovr

ovr is open source with the MIT license. Feel free to create an issue on GitHub if you have an idea for the project to get feedback before working on a pull request.

## Local development

1. Fork the project on GitHub
2. The project requires Node and npm for development
3. Install dependencies from the root directory `npm install`
4. Start the TypeScript and Vite development servers together by running `npm run dev` from the root directory.

### Development

- `npm run dev` - Start TypeScript and Vite development servers
- `npm run check` - Run TypeScript type checking across all packages
- `npm run build` - Build all packages

### Testing

- `npm run test` - Run all tests
- `npm run test:dev` - Run tests in watch mode
- Run a single test: `npm test -- <test-file>` (e.g., `npm test -- packages/ovr/src/app/index.test.ts`)
- The tests include the official [MCP conformance suite](https://github.com/modelcontextprotocol/conformance), run against a small app in `packages/ovr/src/mcp/conformance.test.ts`. The checks ovr does not pass are listed with their reasons in `conformance.<revision>.yml` beside it; a new failure, or a listed check that starts to pass, fails the test. The same file connects the official client libraries, for the current and the earlier protocol, and has them list, call, and read through the endpoint. The suite is pinned to a pre-release, `@modelcontextprotocol/conformance@0.2.0-alpha.12`, since its stable releases, up to 0.1.16, test only the 2025 protocol versions; move to a stable release once one covers 2026-07-28, and expect its exception lists to change when it does.
- The tests that need a real Postgres skip without one. To run them, start a disposable database and set `OVR_TEST_DATABASE_URL`, for example `OVR_TEST_DATABASE_URL=postgres://localhost:5432/ovr_test npm test`. Each run creates its own schema and drops it afterwards, but use a database you can lose.

## Conventions

- Casing - try to match built-in JS methods/casing whenever possible
  - Variables including constants are camelCase
  - Classes and types are PascalCase
  - File names are kebab-case
- Use static methods for utility functions
- Use `Object.assign()` for shallow object merging
- Use private `#` methods for internal class helpers
- Leverage Web standards (Request, Response, Headers, URL)
- Use async generators (`async *`) for streaming APIs
- Use `for await...of` for iterating async iterables

## Project Structure

- Monorepo with apps and packages directories
- Main package: `packages/ovr/` (core framework)
- Documentation app: `apps/docs/`
- Each module in `src/` has its own directory with `index.ts`, and most with `index.test.ts`

## Notes for Agents

- The codebase heavily uses private `#` class syntax - respect this pattern
- Always include `.js` extensions in imports
- Type safety is paramount - use generics and `readonly` appropriately
- The framework is minimal and leverages Web Standards extensively
- Full documentation for ovr in markdown can be found at https://ovrjs.com/llms.txt
