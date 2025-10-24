import type pg from "pg";

export interface TableInfo {
	tableName: string;
	schemaName: string;
	columns: ColumnInfo[];
	primaryKeys: string[];
	foreignKeys: ForeignKeyInfo[];
	incomingForeignKeys: IncomingForeignKeyInfo[];
	indexes: IndexInfo[];
}

export interface ColumnInfo {
	name: string;
	type: string;
	nullable: boolean;
	defaultValue: string | null;
	maxLength: number | null;
	comment: string | null;
}

export interface ForeignKeyInfo {
	columnName: string;
	referencedTable: string;
	referencedColumn: string;
	constraintName: string;
}

export interface IncomingForeignKeyInfo {
	fromTable: string;
	fromColumn: string;
	toColumn: string;
	constraintName: string;
}

export interface IndexInfo {
	name: string;
	columns: string[];
	unique: boolean;
	type: string;
}

export interface TableRow {
	[column: string]: unknown;
}

export class DatabaseService {
	constructor(private pool: pg.Pool) {}

	/**
	 * Get detailed information about a specific table
	 */
	async getTableInfo(tableName: string): Promise<TableInfo | null> {
		const client = await this.pool.connect();
		try {
			// Parse schema and table name
			const parts = tableName.split(".");
			const schemaName = parts.length === 2 ? parts[0] : "public";
			const actualTableName = parts.length === 2 ? parts[1] : tableName;

			// Check if table exists
			const tableExistsQuery = `
				SELECT schemaname, tablename
				FROM pg_tables
				WHERE schemaname = $1 AND tablename = $2
			`;
			const tableResult = await client.query(tableExistsQuery, [schemaName, actualTableName]);

			if (tableResult.rows.length === 0) {
				return null;
			}

			// Get column information
			const columnsQuery = `
				SELECT
					c.column_name,
					c.data_type,
					c.is_nullable,
					c.column_default,
					c.character_maximum_length,
					col_description(pgc.oid, c.ordinal_position) as comment
				FROM information_schema.columns c
				LEFT JOIN pg_class pgc ON pgc.relname = c.table_name
				LEFT JOIN pg_namespace pgn ON pgn.oid = pgc.relnamespace AND pgn.nspname = c.table_schema
				WHERE c.table_schema = $1 AND c.table_name = $2
				ORDER BY c.ordinal_position
			`;
			const columnsResult = await client.query(columnsQuery, [schemaName, actualTableName]);

			const columns: ColumnInfo[] = columnsResult.rows.map((row) => ({
				name: row.column_name,
				type: row.data_type,
				nullable: row.is_nullable === "YES",
				defaultValue: row.column_default,
				maxLength: row.character_maximum_length,
				comment: row.comment,
			}));

			// Get primary keys
			const pkQuery = `
				SELECT a.attname
				FROM pg_index i
				JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
				WHERE i.indrelid = $1::regclass AND i.indisprimary
				ORDER BY a.attnum
			`;
			const pkResult = await client.query(pkQuery, [`${schemaName}.${actualTableName}`]);
			const primaryKeys = pkResult.rows.map((row) => row.attname);

			// Get foreign keys
			const fkQuery = `
				SELECT
					kcu.column_name,
					ccu.table_name AS referenced_table,
					ccu.column_name AS referenced_column,
					tc.constraint_name
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
				JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
				WHERE tc.constraint_type = 'FOREIGN KEY'
				AND tc.table_schema = $1
				AND tc.table_name = $2
				ORDER BY kcu.ordinal_position
			`;
			const fkResult = await client.query(fkQuery, [schemaName, actualTableName]);
			const foreignKeys: ForeignKeyInfo[] = fkResult.rows.map((row) => ({
				columnName: row.column_name,
				referencedTable: row.referenced_table,
				referencedColumn: row.referenced_column,
				constraintName: row.constraint_name,
			}));

			// Get incoming foreign keys (tables that reference this table)
			const incomingFkQuery = `
				SELECT
					kcu.table_name AS from_table,
					kcu.column_name AS from_column,
					ccu.column_name AS to_column,
					tc.constraint_name
				FROM information_schema.table_constraints tc
				JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
				JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
				WHERE tc.constraint_type = 'FOREIGN KEY'
				AND ccu.table_schema = $1
				AND ccu.table_name = $2
				ORDER BY kcu.table_name, kcu.ordinal_position
			`;
			const incomingFkResult = await client.query(incomingFkQuery, [
				schemaName,
				actualTableName,
			]);
			const incomingForeignKeys: IncomingForeignKeyInfo[] = incomingFkResult.rows.map(
				(row) => ({
					fromTable: row.from_table,
					fromColumn: row.from_column,
					toColumn: row.to_column,
					constraintName: row.constraint_name,
				})
			);

			// Get indexes
			const indexQuery = `
				SELECT
				i.relname AS index_name,
				array_agg(a.attname ORDER BY a.attnum) AS columns,
				ix.indisunique AS unique,
				am.amname AS type
				FROM pg_class t
				JOIN pg_index ix ON t.oid = ix.indrelid
				JOIN pg_class i ON i.oid = ix.indexrelid
				JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
				JOIN pg_am am ON i.relam = am.oid
				JOIN pg_namespace n ON n.oid = t.relnamespace
				WHERE n.nspname = $1 AND t.relname = $2
				GROUP BY i.relname, ix.indisunique, am.amname
				ORDER BY i.relname
			`;
			const indexResult = await client.query(indexQuery, [schemaName, actualTableName]);
			const indexes: IndexInfo[] = indexResult.rows.map((row) => {
				// Parse PostgreSQL array format {col1,col2} to JavaScript array
				let columns: string[];
				if (Array.isArray(row.columns)) {
					columns = row.columns;
				} else if (typeof row.columns === "string") {
					// Remove braces and split by comma, handling quoted values
					const cleaned = row.columns.replace(/^{|}$/g, "");
					columns = cleaned
						? cleaned.split(",").map((col: string) => col.trim().replace(/^"|"$/g, ""))
						: [];
				} else {
					columns = [];
				}

				return {
					name: row.index_name,
					columns,
					unique: row.unique,
					type: row.type,
				};
			});

			return {
				tableName: actualTableName,
				schemaName,
				columns,
				primaryKeys,
				foreignKeys,
				incomingForeignKeys,
				indexes,
			};
		} finally {
			client.release();
		}
	}

	/**
	 * List all accessible tables
	 */
	async listTables(): Promise<string[]> {
		const client = await this.pool.connect();
		try {
			const query = `
				SELECT schemaname, tablename
				FROM pg_tables
				WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
				ORDER BY schemaname, tablename
			`;
			const result = await client.query(query);

			return result.rows.map((row) =>
				row.schemaname === "public" ? row.tablename : `${row.schemaname}.${row.tablename}`
			);
		} finally {
			client.release();
		}
	}

	/**
	 * Search tables by pattern (supports regex)
	 */
	async searchTables(pattern: string): Promise<string[]> {
		const client = await this.pool.connect();
		try {
			const query = `
				SELECT schemaname, tablename
				FROM pg_tables
				WHERE schemaname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
				AND (tablename ~ $1 OR schemaname ~ $1)
				ORDER BY
				CASE
					WHEN tablename = $1 THEN 1
					WHEN tablename ILIKE $1 || '%' THEN 2
					WHEN tablename ILIKE '%' || $1 || '%' THEN 3
					ELSE 4
				END,
				schemaname, tablename
			`;
			const result = await client.query(query, [pattern]);

			return result.rows.map((row) =>
				row.schemaname === "public" ? row.tablename : `${row.schemaname}.${row.tablename}`
			);
		} finally {
			client.release();
		}
	}

	/**
	 * Fetch table data with limits and truncation for safety
	 */
	async fetchTableData(
		tableName: string,
		limit: number = 100,
		offset: number = 0
	): Promise<{ rows: TableRow[]; totalCount: number; hasMore: boolean }> {
		const client = await this.pool.connect();
		try {
			// Parse schema and table name
			const parts = tableName.split(".");
			const schemaName = parts.length === 2 ? parts[0] : "public";
			const actualTableName = parts.length === 2 ? parts[1] : tableName;
			const fullTableName = `${schemaName}.${actualTableName}`;

			// Get column information to handle text/blob truncation
			const columnsInfo = await this.getTableInfo(tableName);
			if (!columnsInfo) {
				throw new Error(`Table ${tableName} not found`);
			}

			// Build select clause with truncation for large fields
			const selectClauses = columnsInfo.columns
				.map((col) => {
					if (col.type.includes("text") || col.type.includes("varchar")) {
						// Truncate text fields to 128 characters
						return `CASE WHEN LENGTH(${col.name}::text) > 128 THEN LEFT(${col.name}::text, 128) || '...[truncated]' ELSE ${col.name}::text END AS ${col.name}`;
					} else if (col.type.includes("bytea")) {
						// Truncate binary data to 32 bytes and encode as hex
						return `CASE WHEN LENGTH(${col.name}) > 32 THEN encode(substring(${col.name} from 1 for 32), 'hex') || '...[truncated]' ELSE encode(${col.name}, 'hex') END AS ${col.name}`;
					} else {
						return col.name;
					}
				})
				.join(", ");

			// Get total count
			const countQuery = `SELECT COUNT(*) as count FROM ${fullTableName}`;
			const countResult = await client.query(countQuery);
			const totalCount = parseInt(countResult.rows[0].count, 10);

			// Get data with limit and offset
			const dataQuery = `
				SELECT ${selectClauses}
				FROM ${fullTableName}
				ORDER BY ${columnsInfo.primaryKeys.length > 0 ? columnsInfo.primaryKeys.join(", ") : "1"}
				LIMIT $1 OFFSET $2
			`;
			const dataResult = await client.query(dataQuery, [limit, offset]);

			return {
				rows: dataResult.rows,
				totalCount,
				hasMore: offset + limit < totalCount,
			};
		} finally {
			client.release();
		}
	}

	/**
	 * Fetch extended data for a specific field (up to 8KB)
	 */
	async fetchExtendedData(
		tableName: string,
		rowId: string | number,
		columnName: string
	): Promise<{ data: string; truncated: boolean }> {
		const client = await this.pool.connect();
		try {
			// Parse schema and table name
			const parts = tableName.split(".");
			const schemaName = parts.length === 2 ? parts[0] : "public";
			const actualTableName = parts.length === 2 ? parts[1] : tableName;
			const fullTableName = `${schemaName}.${actualTableName}`;

			// Get table info to find primary key
			const tableInfo = await this.getTableInfo(tableName);
			if (!tableInfo) {
				throw new Error(`Table ${tableName} not found`);
			}

			if (tableInfo.primaryKeys.length === 0) {
				throw new Error(`Table ${tableName} has no primary key`);
			}

			// Use first primary key column for lookup
			const pkColumn = tableInfo.primaryKeys[0];

			// Get column info to determine data type
			const column = tableInfo.columns.find((c) => c.name === columnName);
			if (!column) {
				throw new Error(`Column ${columnName} not found in table ${tableName}`);
			}

			let selectClause: string;
			const maxSize = 8192; // 8KB

			if (column.type.includes("text") || column.type.includes("varchar")) {
				selectClause = `
					CASE
						WHEN LENGTH(${columnName}::text) > ${maxSize}
						THEN LEFT(${columnName}::text, ${maxSize})
						ELSE ${columnName}::text
					END AS data,
					LENGTH(${columnName}::text) > ${maxSize} AS truncated
				`;
			} else if (column.type.includes("bytea")) {
				selectClause = `
					CASE
						WHEN LENGTH(${columnName}) > ${maxSize}
						THEN encode(substring(${columnName} from 1 for ${maxSize}), 'hex')
						ELSE encode(${columnName}, 'hex')
					END AS data,
					LENGTH(${columnName}) > ${maxSize} AS truncated
				`;
			} else {
				selectClause = `${columnName}::text AS data, false AS truncated`;
			}

			const query = `
				SELECT ${selectClause}
				FROM ${fullTableName}
				WHERE ${pkColumn} = $1
			`;

			const result = await client.query(query, [rowId]);

			if (result.rows.length === 0) {
				throw new Error(`Row with ${pkColumn} = ${rowId} not found`);
			}

			return {
				data: result.rows[0].data,
				truncated: result.rows[0].truncated,
			};
		} finally {
			client.release();
		}
	}

	/**
	 * Suggest JOIN expressions based on foreign key relationships using comprehensive SQL analysis
	 */
	async suggestJoinExpressions(
		existingTables: Array<{ tableName: string; alias: string }>,
		newTable: { tableName: string; alias: string }
	): Promise<
		Array<{
			joinType: "INNER JOIN" | "LEFT JOIN";
			expression: string;
			description: string;
			score: number;
		}>
	> {
		const suggestions: Array<{
			joinType: "INNER JOIN" | "LEFT JOIN";
			expression: string;
			description: string;
			score: number;
		}> = [];

		// For each existing table, find all possible joins with the new table
		for (const existingTable of existingTables) {
			const tableSuggestions = await this.findJoinsBetweenTables(
				existingTable,
				newTable
			);
			suggestions.push(...tableSuggestions);
		}

		// Remove duplicates and sort by score (highest first)
		const uniqueSuggestions = suggestions
			.sort((a, b) => b.score - a.score)
			.filter(
				(suggestion, index, self) =>
					index === self.findIndex((s) => s.expression === suggestion.expression)
			);

		return uniqueSuggestions;
	}

	/**
	 * Find all possible joins between two specific tables using SQL-based analysis
	 */
	private async findJoinsBetweenTables(
		leftTable: { tableName: string; alias: string },
		rightTable: { tableName: string; alias: string }
	): Promise<
		Array<{
			joinType: "INNER JOIN" | "LEFT JOIN";
			expression: string;
			description: string;
			score: number;
		}>
	> {
		const client = await this.pool.connect();
		try {
			// Parse schema and table names
			const leftParts = leftTable.tableName.split(".");
			const leftSchema = leftParts.length === 2 ? leftParts[0] : "public";
			const leftTableName = leftParts.length === 2 ? leftParts[1] : leftTable.tableName;

			const rightParts = rightTable.tableName.split(".");
			const rightSchema = rightParts.length === 2 ? rightParts[0] : "public";
			const rightTableName = rightParts.length === 2 ? rightParts[1] : rightTable.tableName;

			// SQL query based on your provided logic
			const query = `
				WITH inputs AS (
					SELECT
						$1::text AS left_schema,
						$2::text AS left_table,
						$3::text AS left_alias,
						$4::text AS right_schema,
						$5::text AS right_table,
						$6::text AS right_alias
				),
				l AS (
					SELECT
						tc.table_schema,
						tc.table_name,
						kcu.column_name,
						ccu.table_schema AS referenced_schema,
						ccu.table_name AS referenced_table,
						ccu.column_name AS referenced_column,
						tc.constraint_name
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
					JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
					CROSS JOIN inputs
					WHERE
						tc.constraint_type = 'FOREIGN KEY'
						AND tc.table_schema = inputs.left_schema
						AND tc.table_name = inputs.left_table
				),
				r AS (
					SELECT
						tc.table_schema,
						tc.table_name,
						kcu.column_name,
						ccu.table_schema AS referenced_schema,
						ccu.table_name AS referenced_table,
						ccu.column_name AS referenced_column,
						tc.constraint_name
					FROM information_schema.table_constraints tc
					JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
					JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
					CROSS JOIN inputs
					WHERE
						tc.constraint_type = 'FOREIGN KEY'
						AND tc.table_schema = inputs.right_schema
						AND tc.table_name = inputs.right_table
				)
				SELECT
					generated_sql,
					priority,
					join_type,
					description
				FROM (
					-- Case 1: Both tables reference the same table (join through shared reference)
					SELECT
						'LEFT JOIN ' ||
						CASE WHEN r.table_schema = 'public' THEN '' ELSE r.table_schema || '.' END ||
						r.table_name ||
						CASE WHEN r.table_name = inputs.right_alias THEN '' ELSE ' ' || inputs.right_alias END ||
						' ON ' ||
						inputs.left_alias || '.' || l.column_name ||
						' = ' ||
						inputs.right_alias || '.' || r.column_name AS generated_sql,
						GREATEST(
							CASE WHEN POSITION(inputs.right_alias IN r.column_name) > 0 THEN 90 ELSE 0 END,
							CASE WHEN POSITION(inputs.left_alias IN l.column_name) > 0 THEN 90 ELSE 0 END,
							85
						) AS priority,
						'LEFT JOIN' AS join_type,
						'Join through shared reference to ' || l.referenced_table || ' (FK: ' || l.constraint_name || ', ' || r.constraint_name || ')' AS description
					FROM l, r, inputs
					WHERE l.referenced_schema = r.referenced_schema
					AND l.referenced_table = r.referenced_table
					AND l.referenced_column = r.referenced_column

					UNION ALL

					-- Case 2: Left table references right table directly
					SELECT
						'LEFT JOIN ' ||
						CASE WHEN l.referenced_schema = 'public' THEN '' ELSE l.referenced_schema || '.' END ||
						l.referenced_table ||
						CASE WHEN l.referenced_table = inputs.right_alias THEN '' ELSE ' ' || inputs.right_alias END ||
						' ON ' ||
						inputs.left_alias || '.' || l.column_name ||
						' = ' ||
						inputs.right_alias || '.' || l.referenced_column AS generated_sql,
						GREATEST(
							CASE WHEN POSITION(inputs.right_alias IN l.column_name) > 0 THEN 100 ELSE 95 END,
							95
						) AS priority,
						'LEFT JOIN' AS join_type,
						'Direct foreign key relationship from ' || inputs.left_table || ' to ' || inputs.right_table || ' (FK: ' || l.constraint_name || ')' AS description
					FROM l, inputs
					WHERE l.referenced_schema = inputs.right_schema
					AND l.referenced_table = inputs.right_table

					UNION ALL

					-- Case 3: Right table references left table directly
					SELECT
						'LEFT JOIN ' ||
						CASE WHEN r.referenced_schema = 'public' THEN '' ELSE r.referenced_schema || '.' END ||
						r.table_name ||
						CASE WHEN r.table_name = inputs.left_alias THEN '' ELSE ' ' || inputs.left_alias END ||
						' ON ' ||
						inputs.right_alias || '.' || r.column_name ||
						' = ' ||
						inputs.left_alias || '.' || r.referenced_column AS generated_sql,
						GREATEST(
							CASE WHEN POSITION(inputs.left_alias IN r.column_name) > 0 THEN 100 ELSE 95 END,
							95
						) AS priority,
						'LEFT JOIN' AS join_type,
						'Reverse foreign key relationship from ' || inputs.right_table || ' to ' || inputs.left_table || ' (FK: ' || r.constraint_name || ')' AS description
					FROM r, inputs
					WHERE r.referenced_schema = inputs.left_schema
					AND r.referenced_table = inputs.left_table
				) o
				ORDER BY priority DESC
			`;

			const result = await client.query(query, [
				leftSchema,
				leftTableName,
				leftTable.alias,
				rightSchema,
				rightTableName,
				rightTable.alias,
			]);

			const suggestions: Array<{
				joinType: "INNER JOIN" | "LEFT JOIN";
				expression: string;
				description: string;
				score: number;
			}> = [];

			for (const row of result.rows) {
				const joinSQL = row.generated_sql as string;
				const score = parseInt(row.priority as string, 10);
				const description = row.description as string;

				// Add LEFT JOIN suggestion
				suggestions.push({
					joinType: "LEFT JOIN",
					expression: joinSQL,
					description: description,
					score: score,
				});

				// Also add INNER JOIN variant for high-confidence matches
				if (score >= 90) {
					const innerJoinSQL = joinSQL.replace("LEFT JOIN", "INNER JOIN");
					suggestions.push({
						joinType: "INNER JOIN",
						expression: innerJoinSQL,
						description: description.replace("Left join", "Inner join"),
						score: score + 5, // Slightly higher score for INNER JOIN
					});
				}
			}

			return suggestions;
		} finally {
			client.release();
		}
	}
}
