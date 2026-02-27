// Silent .env loader — used with: node --require ./loadEnv.js <script>
// Parses .env from the project root using __dirname (not process.cwd()).
// Does NOT use the dotenv package because dotenv@17 logs to stdout,
// which corrupts the MCP stdio JSON-RPC stream.
const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Don't override vars already set in the environment
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
