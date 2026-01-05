# AGENTS.md

This file guides agentic coding agents working in this repository.

## Build, Lint, and Test Commands

### Development

- `npm run dev` - Start TypeScript and Vite development servers
- `npm run check` - Run TypeScript type checking across all packages
- `npm run build` - Build all packages

### Testing

- `npm run test` - Run all tests
- `npm run test:dev` - Run tests in watch mode
- `npm run bench` - Run benchmarks
- Run a single test: `npm test -- <test-file>` (e.g., `npm test -- packages/ovr/src/app/index.test.ts`)

### Code Quality

- `npm run format` - Format code with Prettier
- Format before committing changes

## Code Style Guidelines

### Imports

- Always use `.js` extensions for imports (ES modules required)
- Example: `import { App } from "../app/index.js"`
- Use relative paths with `../` for sibling/parent directories

### Formatting

- Uses Prettier with `@robino/prettier` config
- Includes `prettier-plugin-tailwindcss` for CSS class sorting
- Run `npm run format` before committing

### Types

- TypeScript with strict type checking
- Use `@robino/tsconfig/tsc.json` configuration
- Namespace pattern: `export namespace Module { export type Type }`
- Export types from namespaces: `export type X = Module.X`
- Private class members: Use `#` prefix (e.g., `#options`)
- Use `readonly` for immutable properties and parameters
- Leverage generic type parameters for reusability
- Use `InstanceType<typeof Class>` for typing class instances

### Naming Conventions

- Variables (including constants): `camelCase`
- Classes and types: `PascalCase`
- File names: `kebab-case`
- Private class members: `#propertyName`
- Static readonly constants: `PascalCase`
- Async generators: Use `async *` and `yield*` appropriately

### Error Handling

- Throw `TypeError` for invalid input or configuration errors
- Throw `RangeError` for value out of range or size limit errors
- Use try/finally for cleanup operations
- Catch specific error types when appropriate

### Coding Patterns

- Prefer arrow functions over `function` keyword
- Use static methods for utility functions
- Use `Object.assign()` for shallow object merging
- Use private `#` methods for internal class helpers
- Leverage Web standards (Request, Response, Headers, URL)
- Use async generators (`async *`) for streaming APIs
- Use `for await...of` for iterating async iterables
- Use `Symbol.asyncIterator` for custom async iterables

### Testing

- Use Vitest as the test framework
- Import: `import { describe, test, expect } from "vitest"`
- Test organization: Use `describe` blocks for grouping related tests
- Test naming: Should describe what is being tested (e.g., "handles boundary split")
- Prefer `test` over `it` for test cases
- Use descriptive test names that read as assertions
- For streaming tests, simulate network packets with `ReadableStream`

### Project Structure

- Monorepo with apps and packages directories
- Main package: `packages/ovr/` (core framework)
- Documentation app: `apps/docs/`
- Each module in `src/` has its own directory with `index.ts` and `index.test.ts`

### JSX/Rendering

- JSX runtime provided by `ovr/jsx-runtime` or `ovr/jsx-dev-runtime`
- Use `Render.stream()` for streaming HTML responses
- Use `Render.html()` for raw, unescaped HTML (dangerous)
- Auto-escaping is enabled by default for security

### HTTP Patterns

- Use standard HTTP status codes
- Leverage `c.json()`, `c.text()`, `c.html()` for responses
- Use `c.redirect()` for redirects with appropriate status codes
- Implement ETag support with `c.etag()` for caching
- Always set appropriate `Content-Type` headers

### Security

- CSRF protection enabled by default
- HTML escaping is automatic (use `Render.html()` to bypass)
- Use `HttpOnly` and `Secure` flags for cookies in production
- Validate multipart request sizes with `memory` and `payload` limits

### Performance

- Leverage streaming for large responses
- Use parallel rendering for multiple children (built-in)
- Avoid buffering entire responses when streaming
- Use `ReadableStream` with `type: "bytes"` for binary data
- Set appropriate `highWaterMark` for streams (default: 2048 bytes)

### Documentation

- Use JSDoc comments for exported functions, classes, and types
- Include @param, @returns, and @throws annotations
- Reference MDN documentation for Web APIs
- Include usage examples in JSDoc when helpful
- Keep comments concise and focused on intent

## Notes for Agents

- This is a streaming-first web framework - prioritize streaming over buffering
- The codebase heavily uses private `#` class syntax - respect this pattern
- Always include `.js` extensions in imports
- Type safety is paramount - use generics and `readonly` appropriately
- Tests are comprehensive - follow existing patterns when adding new tests
- The framework is minimal and leverages Web Standards extensively
