import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DatabaseService } from "./database.ts";

export function configureTools(server: McpServer, dbService: DatabaseService) {
	// Tool: get_table_info
	server.registerTool(
		"get_table_info",
		{
			description:
				"Get detailed information about a database table including columns, types, constraints, and foreign keys",
			inputSchema: {
				table_name: z
					.string()
					.describe("Name of the table to inspect (can include schema: schema.table)"),
			},
		},
		async (params) => {
			const { table_name } = params;

			try {
				const tableInfo = await dbService.getTableInfo(table_name);

				if (!tableInfo) {
					return {
						content: [
							{
								type: "text",
								text: `Table '${table_name}' not found`,
							},
						],
					};
				}

				// Format the response as a readable summary
				let response = `# Table: ${tableInfo.schemaName}.${tableInfo.tableName}\n\n`;

				response += "## Columns\n";
				tableInfo.columns.forEach((col) => {
					response += `- **${col.name}** (${col.type})`;
					if (!col.nullable) response += " NOT NULL";
					if (col.defaultValue) response += ` DEFAULT ${col.defaultValue}`;
					if (col.maxLength) response += ` [max: ${col.maxLength}]`;
					if (col.comment) response += ` - ${col.comment}`;
					response += "\n";
				});

				if (tableInfo.primaryKeys.length > 0) {
					response += `\n## Primary Keys\n`;
					response += `${tableInfo.primaryKeys.map((pk) => `- ${pk}`).join("\n")}\n`;
				}

				if (tableInfo.foreignKeys.length > 0) {
					response += `\n## Foreign Keys (Outgoing)\n`;
					tableInfo.foreignKeys.forEach((fk) => {
						response += `- ${fk.columnName} → ${fk.referencedTable}.${fk.referencedColumn} (${fk.constraintName})\n`;
					});
				}

				if (tableInfo.incomingForeignKeys.length > 0) {
					response += `\n## Foreign Keys (Incoming)\n`;
					tableInfo.incomingForeignKeys.forEach((ifk) => {
						response += `- ${ifk.fromTable}.${ifk.fromColumn} → ${ifk.toColumn} (${ifk.constraintName})\n`;
					});
				}

				if (tableInfo.indexes.length > 0) {
					response += `\n## Indexes\n`;
					tableInfo.indexes.forEach((idx) => {
						const unique = idx.unique ? " (UNIQUE)" : "";
						response += `- ${idx.name} on (${idx.columns.join(", ")}) [${idx.type}]${unique}\n`;
					});
				}

				return {
					content: [
						{
							type: "text",
							text: response,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error getting table info: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		}
	);

	// Tool: list_tables
	server.registerTool(
		"list_tables",
		{
			description: "List all accessible tables in the database",
			inputSchema: {},
		},
		async () => {
			try {
				const tables = await dbService.listTables();

				let response = `# Database Tables (${tables.length} found)\n\n`;

				if (tables.length === 0) {
					response += "No tables found or accessible.\n";
				} else {
					// Group by schema
					const bySchema: Record<string, string[]> = {};
					tables.forEach((table) => {
						const parts = table.split(".");
						const schema = parts.length === 2 ? parts[0] : "public";
						const tableName = parts.length === 2 ? parts[1] : table;

						if (!bySchema[schema]) {
							bySchema[schema] = [];
						}
						bySchema[schema].push(tableName);
					});

					Object.keys(bySchema)
						.sort()
						.forEach((schema) => {
							if (Object.keys(bySchema).length > 1) {
								response += `## Schema: ${schema}\n`;
							}
							bySchema[schema].sort().forEach((table) => {
								response += `- ${table}\n`;
							});
							response += "\n";
						});
				}

				return {
					content: [
						{
							type: "text",
							text: response,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error listing tables: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		}
	);

	// Tool: search_tables
	server.registerTool(
		"search_tables",
		{
			description:
				"Search for tables using a regex pattern. Helps find tables when you're not sure of the exact name",
			inputSchema: {
				pattern: z
					.string()
					.describe("Regex pattern to search for in table names (case-sensitive)"),
			},
		},
		async (params) => {
			const { pattern } = params;

			try {
				const tables = await dbService.searchTables(pattern);

				let response = `# Table Search Results for pattern: "${pattern}"\n\n`;

				if (tables.length === 0) {
					response += "No tables found matching the pattern.\n";
					response += "\n**Tips:**\n";
					response += "- Pattern is case-sensitive\n";
					response += "- Use .* for wildcard matching\n";
					response +=
						"- Try partial matches like 'user' to find 'users', 'user_profiles', etc.\n";
				} else {
					response += `Found ${tables.length} matching table(s):\n\n`;

					// Group by schema
					const bySchema: Record<string, string[]> = {};
					tables.forEach((table) => {
						const parts = table.split(".");
						const schema = parts.length === 2 ? parts[0] : "public";
						const tableName = parts.length === 2 ? parts[1] : table;

						if (!bySchema[schema]) {
							bySchema[schema] = [];
						}
						bySchema[schema].push(tableName);
					});

					Object.keys(bySchema)
						.sort()
						.forEach((schema) => {
							if (Object.keys(bySchema).length > 1) {
								response += `## Schema: ${schema}\n`;
							}
							bySchema[schema].forEach((table) => {
								response += `- ${table}\n`;
							});
							response += "\n";
						});
				}

				return {
					content: [
						{
							type: "text",
							text: response,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error searching tables: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		}
	);

	// Tool: fetch_table_data
	server.registerTool(
		"fetch_table_data",
		{
			description:
				"Fetch data from a table with safety limits. Text fields are limited to 128 chars, binary data to 32 bytes",
			inputSchema: {
				table_name: z.string().describe("Name of the table to fetch data from"),
				limit: z
					.number()
					.min(1)
					.max(1000)
					.optional()
					.describe("Maximum number of rows to return (default: 100, max: 1000)"),
				offset: z
					.number()
					.min(0)
					.optional()
					.describe("Number of rows to skip (default: 0)"),
			},
		},
		async (params) => {
			const { table_name, limit = 100, offset = 0 } = params;

			// Enforce maximum limit
			const safeLimit = Math.min(limit, 1000);

			try {
				const result = await dbService.fetchTableData(table_name, safeLimit, offset);

				let response = `# Data from table: ${table_name}\n\n`;
				response += `**Showing ${result.rows.length} rows** `;

				if (offset > 0) {
					response += `(starting from row ${offset + 1}) `;
				}

				response += `of ${result.totalCount} total rows\n`;

				if (result.hasMore) {
					response += `\n*More data available. Use offset=${offset + safeLimit} to get next page.*\n`;
				}

				if (result.rows.length === 0) {
					response += "\nNo data found.\n";
				} else {
					response += "\n## Data\n\n";

					// Format as a simple table
					const columns = Object.keys(result.rows[0]);

					// Table header
					response += `| ${columns.join(" | ")} |\n`;
					response += `| ${columns.map(() => "---").join(" | ")} |\n`;

					// Table rows
					result.rows.forEach((row) => {
						const values = columns.map((col) => {
							const value = row[col];
							if (value === null) return "NULL";
							if (value === undefined) return "";

							// Convert to string and escape pipes
							let str = String(value).replace(/\|/g, "\\|").replace(/\n/g, "\\n");

							// Truncate very long values for display
							if (str.length > 100) {
								str = `${str.substring(0, 100)}...`;
							}

							return str;
						});

						response += `| ${values.join(" | ")} |\n`;
					});

					response += "\n**Note:** Text and binary fields are truncated for safety. ";
					response +=
						"Use `fetch_extended_data` to get full content of specific fields.\n";
				}

				return {
					content: [
						{
							type: "text",
							text: response,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error fetching table data: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		}
	);

	// Tool: fetch_extended_data
	server.registerTool(
		"fetch_extended_data",
		{
			description:
				"Fetch extended data for a specific field (up to 8KB) when you need the full content of text or binary fields",
			inputSchema: {
				table_name: z.string().describe("Name of the table"),
				row_id: z.union([z.string(), z.number()]).describe("Primary key value of the row"),
				column_name: z.string().describe("Name of the column to fetch extended data from"),
			},
		},
		async (params) => {
			const { table_name, row_id, column_name } = params;

			try {
				const result = await dbService.fetchExtendedData(table_name, row_id, column_name);

				let response = `# Extended data for ${table_name}.${column_name}\n\n`;
				response += `**Row ID:** ${row_id}\n`;
				response += `**Column:** ${column_name}\n`;
				response += `**Size:** ${result.data.length} characters\n`;

				if (result.truncated) {
					response += `**Status:** Truncated to 8KB limit\n`;
				} else {
					response += `**Status:** Complete data\n`;
				}

				response += `\n## Content\n\n`;
				response += `\`\`\`\n${result.data}\n\`\`\`\n`;

				if (result.truncated) {
					response +=
						"\n*Note: Content was truncated to 8KB. Original data is larger.*\n";
				}

				return {
					content: [
						{
							type: "text",
							text: response,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error fetching extended data: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		}
	);

	// Tool: suggest_join_on_expression
	server.registerTool(
		"suggest_join_on_expression",
		{
			description:
				"Suggest JOIN expressions based on foreign key relationships between tables. Helps AI systems understand how to join a new table to existing tables in a query.",
			inputSchema: {
				existing_tables: z
					.array(
						z.object({
							table_name: z
								.string()
								.describe("Name of an existing table in the query"),
							alias: z.string().describe("Alias used for this table in the query"),
						})
					)
					.describe("List of tables already in the query with their aliases"),
				new_table: z
					.object({
						table_name: z.string().describe("Name of the new table to join"),
						alias: z.string().describe("Alias to use for the new table"),
					})
					.describe("The new table to suggest JOIN expressions for"),
			},
		},
		async (params) => {
			const { existing_tables, new_table } = params;

			try {
				const existingTables = existing_tables.map((table) => ({
					tableName: table.table_name,
					alias: table.alias,
				}));

				const newTable = {
					tableName: new_table.table_name,
					alias: new_table.alias,
				};

				const suggestions = await dbService.suggestJoinExpressions(
					existingTables,
					newTable
				);

				let response = `# JOIN Suggestions for ${new_table.table_name} (${new_table.alias})\n\n`;

				if (suggestions.length === 0) {
					response +=
						"No JOIN suggestions found based on foreign key relationships or naming patterns.\n";
				} else {
					response += `Found ${suggestions.length} potential JOIN expressions:\n\n`;

					suggestions.forEach((suggestion, index) => {
						const confidenceLabel =
							suggestion.score >= 90 ? "HIGH" :
							suggestion.score >= 70 ? "MEDIUM" :
							suggestion.score >= 50 ? "LOW" : "VERY LOW";

						response += `## ${index + 1}. ${suggestion.joinType} (Score: ${suggestion.score}, ${confidenceLabel} confidence)\n`;
						response += `\`\`\`sql\n${suggestion.joinType} ${suggestion.expression}\n\`\`\`\n`;
						response += `**Description:** ${suggestion.description}\n\n`;
					});

					response += "\n## Usage Notes\n";
					response += "- **Score 90-100**: Based on actual foreign key constraints\n";
					response +=
						"- **Score 70-89**: Based on naming conventions (e.g., user_id → users.id)\n";
					response += "- **Score 50-69**: Based on partial naming matches\n";
					response += "- **Score < 50**: Based on common column names\n";
					response += "- Use INNER JOIN when you only want matching rows\n";
					response +=
						"- Use LEFT JOIN when you want to include unmatched rows from the main table\n";
				}

				return {
					content: [
						{
							type: "text",
							text: response,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: "text",
							text: `Error generating JOIN suggestions: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
				};
			}
		}
	);
}
