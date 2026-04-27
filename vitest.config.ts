import { defineConfig } from 'vitest/config'

// Two projects:
// - unit: pure functions next to source (src/**/*.test.ts). No DB, no setup.
// - integration: full Apollo + Prisma + Mongo Docker (test/integration/**/*.test.ts).
//   Loads .env.test so DATABASE_URL points to the local Mongo container, not Atlas.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          env: loadDotEnvTest(),
          // Each integration test wipes the test DB; running serially keeps them isolated
          // (parallel runs would race on the shared `osov_test` database).
          fileParallelism: false,
        },
      },
    ],
  },
})

function loadDotEnvTest(): Record<string, string> {
  // Tiny inline loader — avoids pulling in dotenv just for tests.
  // Reads .env.test (gitignored) and merges into process.env at test start.
  const fs = require('fs')
  const path = require('path')
  const envPath = path.resolve(__dirname, '.env.test')
  if (!fs.existsSync(envPath)) return {}
  const out: Record<string, string> = {}
  const content = fs.readFileSync(envPath, 'utf8') as string
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}
