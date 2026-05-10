# SparkyFitness MCP Server

A multi-user, OAuth 2.1-secured [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server that enables SparkyFitness users to interact with their fitness data through AI assistants like Claude. Built with the MCP SDK v1.x Streamable HTTP transport, Express, and PostgreSQL with Row-Level Security (RLS) for data isolation.

## Features

- **Full MCP compliance** — Streamable HTTP transport, tool annotations, Zod-validated schemas
- **OAuth 2.1 with PKCE** — Secure authorization code flow for AI assistant integration
- **Multi-user with RLS** — PostgreSQL Row-Level Security ensures complete data isolation
- **Action-dispatch pattern** — Domain tools use discriminated unions to multiplex operations
- **Vision capabilities** — Analyze food photos and scan nutrition labels (optional, requires API key)
- **Engagement tracking** — Logging streaks, contextual nudges, and activity pattern analysis

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (with existing [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness) database)
- npm or pnpm

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database credentials and secrets

# Run database migration (creates OAuth tables)
psql -h localhost -U sparkyapp -d sparkyfitness -f src/db/migration.sql

# Build
npm run build

# Start
npm start
```

## Environment Variables

See [`.env.example`](.env.example) for all available configuration options.

| Variable | Description | Required |
|----------|-------------|----------|
| `SPARKY_FITNESS_DB_HOST` | PostgreSQL host | Yes |
| `SPARKY_FITNESS_DB_NAME` | Database name | Yes |
| `SPARKY_FITNESS_DB_USER` | App database user (RLS-aware) | Yes |
| `SPARKY_FITNESS_DB_PASSWORD` | App database password | Yes |
| `SPARKY_FITNESS_DB_OWNER_USER` | Owner user (for migrations) | Yes |
| `SPARKY_FITNESS_DB_OWNER_PASSWORD` | Owner password | Yes |
| `MCP_OAUTH_ISSUER` | Public URL of this server | Yes |
| `MCP_OAUTH_JWT_SECRET` | JWT signing secret (min 256-bit) | Yes |
| `VISION_API_KEY` | Gemini or OpenAI API key | No |
| `VISION_API_PROVIDER` | `gemini` or `openai` | No |
| `DEV_TOOLS_ENABLED` | Enable admin dev tools | No |

## Available MCP Tools

### Nutrition (`sparky_manage_food`)

Search food, log meals, create custom foods, manage diary entries, copy meals between days, and save meal templates.

**Actions:** `search_food`, `log_food`, `create_food`, `search_meal`, `log_meal`, `list_diary`, `delete_entry`, `update_entry`, `copy_from_yesterday`, `save_as_meal_template`, `delete_food`

### Fitness (`sparky_manage_exercise`)

Search exercises, log workouts with multi-set support, manage workout presets, and view exercise history.

**Actions:** `search_exercises`, `create_exercise`, `log_exercise`, `list_exercise_diary`, `get_workout_presets`, `log_workout_preset`, `delete_exercise_entry`

### Health Check-ins (`sparky_manage_checkin`)

Log biometrics (weight, body measurements), mood, sleep, fasting, and custom metrics.

**Actions:** `log_biometrics`, `log_mood`, `log_sleep`, `log_fasting`, `log_custom_metric`, `create_category`, `list_categories`, `list_checkin_diary`

### Coach Tools

| Tool | Description |
|------|-------------|
| `sparky_get_health_summary` | Daily/weekly health summary with macros, exercise, and biometrics |
| `sparky_analyze_trends` | Weight vs calorie trend analysis to identify plateaus or progress |
| `sparky_get_30_day_trends` | Comprehensive 30-day rolling trends across all categories |

### Engagement Tools

| Tool | Description |
|------|-------------|
| `sparky_check_engagement` | Scan for moments requiring proactive nudges |
| `sparky_get_logging_streak` | Current consecutive logging streak |
| `sparky_get_contextual_nudge` | Context-aware nudge based on recent activity |

### Vision Tools

| Tool | Description |
|------|-------------|
| `sparky_analyze_food_image` | Analyze food photos to estimate nutritional content |
| `sparky_scan_label` | OCR scan of nutrition labels |

### Dev Tools (admin only)

| Tool | Description |
|------|-------------|
| `sparky_inspect_schema` | Inspect database table schemas |
| `sparky_get_user_info` | Get authenticated user info |
| `sparky_get_db_stats` | Connection pool statistics |

> Dev tools require `DEV_TOOLS_ENABLED=true` and admin role.

## Architecture

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│  AI Client  │────▶│  Express HTTP Server (port 3001)         │
│ (claude.ai) │     │                                          │
└─────────────┘     │  ┌─────────────┐  ┌───────────────────┐  │
                    │  │ OAuth 2.1   │  │ Auth Middleware    │  │
                    │  │ (PKCE)      │  │ (JWT validation)  │  │
                    │  └─────────────┘  └───────────────────┘  │
                    │                                          │
                    │  ┌──────────────────────────────────────┐│
                    │  │ MCP Server (Streamable HTTP)         ││
                    │  │  Tools → Services → DB (RLS)        ││
                    │  └──────────────────────────────────────┘│
                    └──────────────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────────┐
                    │  PostgreSQL (RLS per-user isolation)     │
                    └──────────────────────────────────────────┘
```

- **Stateless per-request** — Each MCP request creates a fresh server + transport instance
- **RLS data isolation** — Every query runs with `set_app_context(user_id)`
- **Action-dispatch pattern** — Domain tools use Zod discriminated unions
- **Zod validation** — All inputs validated before reaching the database

## Deployment Requirements

This MCP server connects directly to the SparkyFitness PostgreSQL database. It needs to be deployed where it can reach the database — typically on the same server or Docker network as your SparkyFitness instance. The included `docker-compose.yml` joins the `sparkyfitness_internal` network for this purpose.

## Docker Deployment

```bash
# Build
docker build -t sparkyfitness-mcp-server:latest .

# Run with docker-compose
cp .env.example .env
docker compose up -d
```

The container includes a health check at `GET /health`.

## Development

```bash
# Hot reload
npm run dev

# Type check
npx tsc --noEmit

# Build
npm run build
```

## Security

- OAuth 2.1 with PKCE authorization code flow
- JWT access tokens (1-hour expiry, HS256)
- Refresh token rotation (30-day, SHA-256 hashed)
- Row-Level Security for per-user data isolation
- Rate limiting on OAuth endpoints
- Helmet security headers
- Parameterized SQL queries (no string interpolation)
- Zod `.strict()` rejects unknown fields
- Graceful shutdown with connection draining

## API Documentation

Detailed tool documentation is available in the [`reference-docs/`](reference-docs/) directory:

- [Food & Nutrition](reference-docs/food.md)
- [Exercise & Fitness](reference-docs/exercise.md)
- [Health Check-ins](reference-docs/health-checkin.md)
- [Coach & Trends](reference-docs/coach.md)
- [Engagement](reference-docs/engagement.md)
- [Vision](reference-docs/vision.md)
- [Dev Tools](reference-docs/development-debugging.md)

## Related Projects

- [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness) — The main SparkyFitness application (server, frontend, mobile)

## Origin

This is a community-built MCP server for the [SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness) platform. It connects to an existing SparkyFitness database and exposes fitness/nutrition data through the Model Context Protocol.

## License

MIT
