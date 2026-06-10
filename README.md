# LeadAPI - CRM Backend

Fastify-based REST API for CodeFirstSystem's Lead CRM platform. Handles lead management, integrations (WhatsApp, Meta, Google), webhooks, and multi-tenant operations.

## Features

- **Multi-Tenant Architecture**: Separate workspaces with role-based access (Agent, Admin, Super Admin)
- **Lead Management**: Create, update, and track leads across multiple channels
- **Integrations**:
  - WhatsApp Business API with OAuth flow
  - Meta/Facebook Ads with lead sync
  - Google with contact synchronization
  - Web Forms with embedded script
- **Campaign Management**: WhatsApp, SMS, and Phone AI campaigns
- **Webhooks**: Auto-lead creation from external sources
- **Database**: MySQL with Kysely ORM for type-safe queries
- **Job Queue**: Background workers for async tasks (email, SMS, webhook delivery)
- **PM2 Process Management**: Multiple worker processes for scalability

## Tech Stack

- **Framework**: Fastify
- **Language**: TypeScript
- **Database**: MySQL + Kysely ORM
- **Process Manager**: PM2
- **Job Queue**: Bull (Redis-backed)
- **Authentication**: JWT + HTTP-only Cookies
- **API Gateway**: Secure CORS with origin validation

## Quick Start

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build
npm run build

# Start production
npm start

# Run workers
npm run workers:start
```

## Environment Variables

See `.env.example` for all available configuration options.

## API Endpoints

- `/api/users` - User authentication and account management
- `/api/leads` - Lead CRUD operations
- `/api/whatsapp` - WhatsApp integration with OAuth
- `/api/meta` - Meta/Facebook Ads integration
- `/api/google` - Google integration
- `/api/forms` - Web Forms with embeddable script
- `/api/webhook` - Inbound webhooks from external services
- `/api/billing` - Billing and subscription management

## Database Migrations

Migrations are stored in the `migrations/` directory as SQL files.

## Project Structure

```
src/
├── modules/          # Feature modules
├── plugins/          # Fastify plugins
├── utils/            # Utility functions
├── models/           # Database models
├── Middleware/       # Auth middleware
└── server.ts         # Entry point
```

## Contributors

CodeFirstSystem Team
