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
- `npm run bench` - Run benchmarks
- Run a single test: `npm test -- <test-file>` (e.g., `npm test -- packages/ovr/src/app/index.test.ts`)

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
- Each module in `src/` has its own directory with `index.ts` and `index.test.ts`

## Notes for Agents

- This is a streaming-first web framework - prioritize streaming over buffering
- The codebase heavily uses private `#` class syntax - respect this pattern
- Always include `.js` extensions in imports
- Type safety is paramount - use generics and `readonly` appropriately
- Tests are comprehensive - follow existing patterns when adding new tests
- The framework is minimal and leverages Web Standards extensively
