import { buildApp } from './app'
import { loadEnvFile } from './env'

// Before anything reads process.env. Without this the server starts fine and then reports the agent
// as unconfigured, however carefully .env was filled in.
loadEnvFile()

const port = Number(process.env.PORT ?? 3001)

buildApp()
  .listen({ port, host: '0.0.0.0' })
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
