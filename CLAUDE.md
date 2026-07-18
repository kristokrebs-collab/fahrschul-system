# Claude Code Configuration

## MCP Servers

Configure MCP (Model Context Protocol) servers for enhanced AI capabilities.

### 21st Dev MCP Server

The 21st Dev MCP Server provides access to advanced development tools and APIs.

```json
{
  "mcpServers": {
    "21st": {
      "type": "sse",
      "url": "https://21st.dev/api/mcp",
      "headers": {
        "x-api-key": "21st_sk_5b8bbd640d8a856909ddfdc715324c17a6303bf63cbc42f54b735e04b74406b0"
      }
    }
  }
}
```

This configuration enables Claude to:
- Access 21st Dev's tools and resources via MCP
- Provide enhanced development assistance
- Leverage additional context and capabilities

## Transport Details

- **Type**: Server-Sent Events (SSE) / HTTP
- **Endpoint**: `https://21st.dev/api/mcp`
- **Authentication**: API key via header
