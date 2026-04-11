#!/usr/bin/env node

const { startServer } = require('../src/server');

const args = process.argv.slice(2);
const getFlag = (name) => {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  const next = args[idx + 1];
  return next && !next.startsWith('--') ? next : true;
};

const portArg = getFlag('--port');
const port = portArg && portArg !== true ? parseInt(portArg, 10) : 32352;
const dev = args.includes('--dev');

if (isNaN(port) || port < 1 || port > 65535) {
  console.error('Error: Port must be a number between 1 and 65535');
  process.exit(1);
}

async function main() {
  try {
    console.log('Starting EvoNexus terminal server...');
    console.log(`Port: ${port}`);

    await startServer({ port, dev });

    console.log(`\n🚀 Terminal server running at http://localhost:${port}`);
    console.log('Press Ctrl+C to stop\n');
  } catch (error) {
    console.error('Error starting server:', error.message);
    process.exit(1);
  }
}

main();
