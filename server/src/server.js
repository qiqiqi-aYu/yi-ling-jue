'use strict';

require('dotenv').config();

const { createApp } = require('./app');
const { closePool } = require('./config/db');

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const app = await createApp();
  const server = app.listen(PORT, () => {
    console.log(`弈灵诀后端已启动：http://localhost:${PORT}/api/v1`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('启动失败：', err.message);
  process.exit(1);
});
