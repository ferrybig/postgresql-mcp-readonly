# JOIN Suggestions Example

## Example Usage of `suggest_join_on_expression`

Suppose you have these existing tables in your query:
- `users u` (users table with alias 'u')
- `orders o` (orders table with alias 'o')

And you want to add a new table:
- `order_items oi` (order_items table with alias 'oi')

### MCP Tool Call:
```json
{
  "existing_tables": [
    {
      "table_name": "users",
      "alias": "u"
    },
    {
      "table_name": "orders", 
      "alias": "o"
    }
  ],
  "new_table": {
    "table_name": "order_items",
    "alias": "oi"
  }
}
```

### Expected Response:
The tool will analyze foreign key relationships and suggest:

1. **HIGH confidence** - Based on foreign key constraints:
   ```sql
   INNER JOIN orders o ON oi.order_id = o.id
   LEFT JOIN orders o ON oi.order_id = o.id
   ```

2. **MEDIUM confidence** - Based on naming conventions:
   ```sql  
   LEFT JOIN users u ON oi.user_id = u.id
   ```

3. **LOW confidence** - Based on common column names:
   ```sql
   LEFT JOIN orders o ON oi.created_at = o.created_at
   ```

## Benefits for AI Systems:

- **Intelligent Query Building**: AI can automatically suggest proper JOIN syntax
- **Relationship Discovery**: Understand table relationships without manual analysis  
- **Confidence Levels**: Prioritize suggestions based on likelihood of correctness
- **Multiple JOIN Types**: Provides both INNER and LEFT JOIN options based on use case