#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pg from "pg";
import { DatabaseService } from "./database.ts";
import { configureTools } from "./tools.ts";

// Parse command line arguments
interface ParsedConfig {
	host?: string;
	port?: number;
	database?: string;
	user?: string;
	password?: string;
	ssl?: boolean;
}

function parseArgs(): ParsedConfig {
	const args = process.argv.slice(2);
	const config: ParsedConfig = {};

	for (let i = 0; i < args.length; i += 2) {
		const key = args[i];
		const value = args[i + 1];

		switch (key) {
			case "--host":
				config.host = value;
				break;
			case "--port":
				config.port = parseInt(value, 10);
				break;
			case "--database":
				config.database = value;
				break;
			case "--user":
				config.user = value;
				break;
			case "--password":
				config.password = value;
				break;
			case "--ssl":
				config.ssl = value.toLowerCase() === "true";
				break;
			default:
				console.error(`Unknown argument: ${key}`);
		}
	}

	return config;
}

// Get configuration from environment variables and command line arguments
function getConfig() {
	const args = parseArgs();

	return {
		host: args.host ?? process.env.POSTGRES_HOST ?? "localhost",
		port:
			args.port ??
			(process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 5432),
		database: args.database ?? process.env.POSTGRES_DATABASE,
		user: args.user ?? process.env.POSTGRES_USER,
		password: args.password ?? process.env.POSTGRES_PASSWORD,
		ssl: args.ssl ?? process.env.POSTGRES_SSL === "true",
	};
}

async function main() {
	const config = getConfig();
	if (
		config.database === undefined ||
		config.user === undefined ||
		config.password === undefined
	) {
		console.error("Missing required database configuration. Please provide:");
		console.error("- Database: --database or POSTGRES_DATABASE");
		console.error("- User: --user or POSTGRES_USER");
		console.error("- Password: --password or POSTGRES_PASSWORD");
		process.exit(1);
	}

	// Create PostgreSQL connection pool
	const pool = new pg.Pool({
		host: config.host,
		port: config.port,
		database: config.database,
		user: config.user,
		password: config.password,
		ssl: config.ssl,
		max: 5, // Maximum number of connections
		idleTimeoutMillis: 30000,
		connectionTimeoutMillis: 2000,
	});

	// Set application name for each new connection
	pool.on("connect", async (client) => {
		await client.query("SET application_name = 'postgresql-mcp-readonly'");
		await client.query("SET default_transaction_read_only = 'on'");
		// await client.query("create table oops (id serial primary key)");
	});

	// Test database connection
	try {
		const client = await pool.connect();
		console.error("Connected to PostgreSQL database successfully");
		client.release();
	} catch (error) {
		console.error("Failed to connect to PostgreSQL:", error);
		process.exit(1);
	}

	// Create database service
	const dbService = new DatabaseService(pool);

	// Create MCP server
	const server = new McpServer({
		name: "postgresql-mcp-readonly",
		version: "1.0.0",
	});

	// Configure all tools
	configureTools(server, dbService);

	// Set up transport and start server
	const transport = new StdioServerTransport();
	await server.connect(transport);

	console.error("PostgreSQL MCP Server running on stdio");

	// Graceful shutdown
	process.on("SIGINT", async () => {
		console.error("Received SIGINT, shutting down gracefully...");
		await pool.end();
		process.exit(0);
	});

	process.on("SIGTERM", async () => {
		console.error("Received SIGTERM, shutting down gracefully...");
		await pool.end();
		process.exit(0);
	});
}

main().catch((error) => {
	console.error("Fatal error in main():", error);
	process.exit(1);
});
