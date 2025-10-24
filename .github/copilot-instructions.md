# PostgreSQL MCP Server - Development Guidelines

This project implements a Model Context Protocol (MCP) server for readonly PostgreSQL database access using TypeScript and npm.

## Project Structure
- `src/index.ts` - Main server entry point with CLI argument parsing and database connection setup
- `src/database.ts` - Database service layer with readonly PostgreSQL operations
- `src/tools.ts` - MCP tools configuration for database introspection and data access
- `.vscode/mcp.json` - MCP server configuration for VS Code integration

## Key Features
- **Readonly Database Access**: All operations are strictly readonly to prevent data modification
- **Table Introspection**: Get detailed table schemas, columns, constraints, and relationships
- **Safe Data Fetching**: Text truncation (128 chars) and blob limits (32 bytes) for safety
- **Extended Data Access**: Retrieve larger fields up to 8KB when needed
- **Search Capabilities**: Regex-based table search with fuzzy matching
- **PostgreSQL Integration**: Native pg driver with connection pooling

## Development Commands
- `npm run build` - Compile TypeScript and make executable
- `npm run dev` - Run in development mode with tsx
- `npm start` - Run compiled server

## Database Connection
The server accepts connection details via environment variables or CLI arguments:
- Environment: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DATABASE`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_SSL`
- CLI: `--host`, `--port`, `--database`, `--user`, `--password`, `--ssl`

## MCP Tools Available
1. `get_table_info` - Detailed table schema and constraints
2. `list_tables` - Enumerate all accessible tables
3. `search_tables` - Find tables using regex patterns
4. `fetch_table_data` - Query table data with safety limits
5. `fetch_extended_data` - Get full content of specific fields

## Safety Features
- Connection pooling with timeouts
- Readonly database user recommended
- Data truncation for large fields
- No arbitrary SQL execution
- Input validation and error handling

When working on this project, maintain the readonly safety guarantees and follow the established patterns for database access and MCP tool implementations.