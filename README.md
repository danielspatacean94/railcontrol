# RailControl

RailControl is a small full-stack application for starting, stopping, and monitoring a single Railway service. It provides a responsive React dashboard backed by a NestJS API that communicates with Railway's GraphQL API.

The application is intentionally focused on one configured target service. It does not create projects, environments, or services, and it does not require a database.

## Capabilities

- Read the target service name and latest deployment state.
- Display deployment ID, creation time, and normalized lifecycle status.
- Deploy or redeploy the configured service.
- Remove the latest running or sleeping deployment.
- Poll Railway every eight seconds while the browser tab is visible.
- Handle regular Docker services and Serverless services in `SLEEPING` state.
- Keep Railway credentials exclusively on the server.
- Coalesce concurrent identical actions into one Railway mutation.
- Detect GraphQL errors returned inside successful HTTP responses.
- Emit backend lifecycle and upstream-error logs through NestJS `Logger`.
- Expose a lightweight health endpoint for deployment checks.

## Technology

- React 18, TypeScript, Vite, and Tailwind CSS
- NestJS 10 and Axios
- Jest and ts-jest
- Railway GraphQL API

## Architecture

```text
Browser                  RailControl API                    Railway

React dashboard  ----->  GET  /api/railway/status  ----->  serviceInstance query
                 ----->  POST /api/railway/start   ----->  serviceInstanceDeployV2
                 ----->  POST /api/railway/stop    ----->  deploymentRemove
                               |
                               +-- stores the API token
                               +-- maps deployment states
                               +-- serializes mutations
                               +-- normalizes API errors
```

The browser never calls Railway directly. NestJS acts as a narrow gateway and exposes only the three operations needed by the UI.

### Project structure

```text
server/src/
|-- common/health/
|   |-- health.controller.ts
|   `-- health.module.ts
|-- domain/railway/
|   |-- railway.controller.ts
|   |-- railway.module.ts
|   |-- railway.service.ts
|   |-- railway.service.spec.ts
|   `-- railway.types.ts
|-- app.module.ts
`-- main.ts

ui/src/
|-- pages/dashboard/
|   `-- DashboardPage.tsx
|-- services/
|   |-- api.ts
|   `-- railway.service.ts
|-- App.tsx
|-- index.css
`-- main.tsx
```

## Requirements

- Node.js 20 or newer
- npm
- A Railway account, workspace, or project token
- The target Railway service ID
- The target Railway environment ID

## Configuration

Copy the example environment file:

```powershell
Copy-Item .env.example .env
```

Configure one token type and the target resource IDs:

```env
RAILWAY_API_URL=https://backboard.railway.com/graphql/v2

# Account or workspace token:
RAILWAY_API_TOKEN=

# Project token:
RAILWAY_TOKEN=

TARGET_RAILWAY_SERVICE_ID=
TARGET_RAILWAY_ENVIRONMENT_ID=
```

Configure exactly one token:

- `RAILWAY_API_TOKEN` is used for account and workspace tokens and is sent as an `Authorization: Bearer` header.
- `RAILWAY_TOKEN` is used for project tokens and is sent as a `Project-Access-Token` header.

The `TARGET_` prefix prevents collisions with Railway's automatically injected `RAILWAY_SERVICE_ID` and `RAILWAY_ENVIRONMENT_ID`, which identify the RailControl deployment itself rather than the service being controlled.

To copy the target IDs, open the Railway project, press `Ctrl+K` (`Cmd+K` on macOS), and select **Copy Service ID** or **Copy Environment ID**.

### Complete variable reference

| Variable | Required | Description |
| --- | --- | --- |
| `RAILWAY_API_TOKEN` | Conditional | Account or workspace API token. |
| `RAILWAY_TOKEN` | Conditional | Project token scoped to the target environment. |
| `TARGET_RAILWAY_SERVICE_ID` | Yes | Service controlled by the dashboard. |
| `TARGET_RAILWAY_ENVIRONMENT_ID` | Yes | Environment containing the service instance. |
| `RAILWAY_API_URL` | No | GraphQL endpoint override. |
| `PORT` | No | NestJS port. Defaults to `3000`. |
| `CORS_ORIGIN` | No | Allowed UI origin during development. Defaults to `http://localhost:5173`. |

## Local development

```bash
npm install
npm run dev
```

This starts:

- React at `http://localhost:5173`
- NestJS at `http://localhost:3000`
- A Vite proxy from `/api` to NestJS

### Available commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the UI and backend in watch mode. |
| `npm run server` | Start only NestJS in watch mode. |
| `npm run server:debug` | Start NestJS with the Node inspector. |
| `npm run ui` | Start only the Vite development server. |
| `npm run build` | Build the server and UI for production. |
| `npm start` | Run the compiled production server. |
| `npm test` | Run the Railway service unit tests. |

## HTTP API

### Health

```http
GET /api/health
```

Returns:

```json
{ "status": "ok" }
```

### Service status

```http
GET /api/railway/status
```

Example response:

```json
{
  "serviceName": "hello-world",
  "status": "SUCCESS",
  "deploymentId": "b715ddab-6e63-42e2-8827-2a3ec8389169",
  "deployedAt": "2026-10-28T10:18:09.167Z",
  "isRunning": true,
  "canStart": false,
  "canStop": true
}
```

### Start service

```http
POST /api/railway/start
```

The backend first reads the current deployment state. If the service is stopped, failed, completed, crashed, or sleeping, it calls `serviceInstanceDeployV2` and returns the latest normalized state. Requests are rejected with `409 Conflict` when the service is already running or starting.

### Stop service

```http
POST /api/railway/stop
```

The backend reads the latest deployment ID and calls `deploymentRemove`. The UI requires confirmation before sending this request. Requests are rejected with `409 Conflict` when no stoppable deployment exists.

## Deployment state model

Railway deployments are asynchronous. A successful mutation means Railway accepted the operation; it does not mean the container is already available. RailControl continues polling the latest deployment until Railway reports the resulting state.

| Railway status | UI meaning | Start | Stop |
| --- | --- | --- | --- |
| `ACTIVE`, `SUCCESS` | Running | Disabled | Enabled |
| `INITIALIZING`, `BUILDING`, `DEPLOYING` | Starting | Disabled | Disabled |
| `SLEEPING` | Serverless container sleeping | Enabled | Enabled |
| `CRASHED` | Container exited unexpectedly | Enabled | Enabled |
| `REMOVING` | Deployment is stopping | Disabled | Disabled |
| `REMOVED`, `FAILED`, `COMPLETED`, `STOPPED` | Not running | Enabled | Disabled |

For a Docker service with Railway Serverless enabled, `SLEEPING` represents a valid deployment that has scaled down after inactivity. Incoming traffic normally wakes it. RailControl also allows a deliberate redeployment through **Start / wake**, or complete deployment removal through **Stop**.

## Reliability and concurrency

The frontend disables action buttons while an operation is pending. The backend independently protects the Railway mutations:

- Identical simultaneous operations share one in-flight promise.
- Five concurrent start requests result in one Railway mutation.
- An opposite operation received during an active mutation returns `409 Conflict`.
- Current Railway state is checked before every mutation.

The lock is process-local. A multi-replica deployment would require a distributed lock or durable operation record.

If the frontend times out after Railway accepted a mutation, it immediately refreshes status and continues normal polling. It does not blindly repeat a mutation with an unknown outcome.

## Error handling

Railway follows GraphQL error semantics and may return HTTP `200` with an `errors` array. The backend checks `errors` before reading `data` and converts upstream failures into consistent HTTP errors for the UI.

Handled cases include:

- Missing configuration
- Invalid or incorrectly scoped tokens
- GraphQL errors inside HTTP `200`
- Empty GraphQL responses
- Railway rate limiting
- Upstream HTTP and network failures
- Conflicting or duplicate operations

Railway trace IDs are retained in error messages when available.

## Logging

The Railway domain service uses NestJS `Logger` with `RailwayService` as its context:

- Status reads and concurrent request coalescing use `debug`.
- Start and stop requests accepted by Railway use `log`.
- Invalid or conflicting lifecycle requests use `warn`.
- GraphQL and upstream HTTP failures use `error`.

Logs include service, environment, and deployment IDs where relevant. API tokens and authorization headers are never logged.

## Security

Railway credentials are read only by NestJS and never included in the Vite build. The UI can perform only the operations exposed by the backend.

This POC does not include end-user authentication or authorization. Do not expose it publicly without adding access control. A production deployment should use a least-privilege Railway token and add authentication, mutation authorization, audit logging, and any required CSRF protection.

## Cost and cleanup

RailControl operates on one existing service and never creates additional Railway resources. Stopping removes the current deployment, so repeated use does not accumulate services or environments.

There is no automatic shutdown deadline. If automatic cleanup is required, add a maximum runtime, scheduled reconciliation, usage alerts, or workspace spending limits.

## Testing

```bash
npm test
```

The unit suite covers:

- Active and successful deployment mapping
- Sleeping Serverless deployments
- Start and stop GraphQL mutations
- Five-way concurrent start coalescing
- GraphQL errors returned through HTTP `200`
- Project-token authentication headers
- Account/workspace-token authentication headers

## Production build

```bash
npm run build
npm start
```

NestJS serves the compiled React application from `dist/ui`. The included `railway.json` configures:

- Railpack build
- Production start command
- `/api/health` deployment health check
- Restart-on-failure behavior

## VS Code debugging

Open **Run and Debug**, choose **Debug NestJS server**, and press `F5`. The configuration in `.vscode/launch.json` starts the backend in inspector and watch mode.

## Known limitations

- One target service per RailControl deployment
- No end-user authentication
- No persistent audit log
- No automatic stop deadline
- Process-local concurrency lock
- Polling rather than webhook or push-based updates
