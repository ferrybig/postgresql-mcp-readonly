# PostgreSQL MCP Server

A Model Context Protocol (MCP) server for readonly PostgreSQL database access. This server provides AI systems with safe, readonly access to PostgreSQL databases for schema introspection and data querying.

## Features

- **Table Information**: Get detailed information about tables including columns, types, nullable status, outgoing and incoming foreign key relationships
- **List Tables**: Enumerate all accessible tables in the database
- **Search Tables**: Search for tables using regex patterns with fuzzy matching support
- **Data Fetching**: Query table data with configurable limits and text truncation for large fields
- **Extended Data Access**: Retrieve larger text/blob fields up to 8KB with continuation support
- **JOIN Suggestions**: Intelligent JOIN expression suggestions based on foreign key relationships and naming patterns
- **Readonly Safety**: All operations are readonly to prevent accidental data modification
- **Smart Data Limits**: Text fields truncated to 128 characters, binary data limited to 32 bytes by default
- **Connection Pooling**: Efficient database connection management with timeouts

## Installation

```bash
npm install
npm run build
```

## Usage

The server requires PostgreSQL connection details. You can provide these via:

1. **Environment variables:**

   ```bash
   export POSTGRES_HOST=localhost
   export POSTGRES_PORT=5432
   export POSTGRES_DATABASE=your_db
   export POSTGRES_USER=your_user
   export POSTGRES_PASSWORD=your_password
   npm start
   ```

2. **Command line arguments:**

   ```bash
   npm start -- --host localhost --port 5432 --database your_db --user your_user --password your_password
   ```

3. **Direct node execution:**

   ```bash
   node build/index.js --database your_db --user your_user --password your_password
   ```

4. **Testing with MCP Inspector:**

   ```bash
   npx @modelcontextprotocol/inspector node build/index.js --database your_db --user your_user --password your_password
   ```

## MCP Tools

### `get_table_info`

Get comprehensive information about a specific table.

- **Parameters**: `table_name` (string)
- **Returns**: Table schema, column details, constraints, outgoing and incoming foreign key relationships

### `list_tables`

List all accessible tables in the database.

- **Returns**: Array of table names with optional schema information

### `search_tables`

Search for tables using regex patterns.

- **Parameters**: `pattern` (string) - regex pattern to match table names
- **Returns**: Matching table names with relevance scoring

### `fetch_table_data`

Fetch data from a table with safety limits.

- **Parameters**: 
  - `table_name` (string)
  - `limit` (number, default: 100) - maximum rows to return
  - `offset` (number, default: 0) - number of rows to skip
- **Returns**: Table data with text fields limited to 128 chars, blobs to 32 bytes

### `fetch_extended_data`

Fetch larger text/blob fields up to 8KB.

- **Parameters**:
  - `table_name` (string)
  - `row_id` (string|number) - primary key value
  - `column_name` (string) - column to fetch extended data from
- **Returns**: Extended field data up to 8KB

### `suggest_join_on_expression`

Suggest JOIN expressions based on comprehensive foreign key analysis between tables. Uses advanced SQL-based analysis to find direct relationships, reverse relationships, and joins through shared references.

- **Parameters**:
  - `existing_tables` (array) - List of tables already in the query with their aliases
    - `table_name` (string) - Name of an existing table
    - `alias` (string) - Alias used for this table
  - `new_table` (object) - The new table to suggest JOIN expressions for
    - `table_name` (string) - Name of the new table to join
    - `alias` (string) - Alias to use for the new table
- **Returns**: Suggested JOIN expressions with numeric scores (0-100):
  - **Score 95-100**: Direct foreign key relationships
  - **Score 85-94**: Joins through shared table references
  - **Score 70-84**: Naming convention matches (e.g., user_id → users.id)
  - **Score 50-69**: Partial naming matches
  - **Score < 50**: Common column names

## Development

### Formatting and Linting

This project uses [Biome](https://biomejs.dev/) for code formatting and linting:

```bash
# Format code
npm run format

# Check formatting (without fixing)
npm run format:check

# Run linter
npm run lint

# Fix linting issues automatically
npm run lint:fix

# Run both formatting and linting checks
npm run check

# Fix all issues automatically
npm run check:fix
```

### Building

```bash
npm run build    # Compile TypeScript
npm run dev      # Run in development mode
npm start        # Run compiled server
```

## Configuration

Create a `.env` file in the project root:

```env
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DATABASE=your_database
POSTGRES_USER=your_user
POSTGRES_PASSWORD=your_password
POSTGRES_SSL=false
```

## Security

- All database operations are readonly
- No DDL/DML operations are permitted
- Connection uses least-privilege principles
- Text and blob data is truncated by default for safety
- No arbitrary SQL execution - only predefined safe queries

## License

MIT
