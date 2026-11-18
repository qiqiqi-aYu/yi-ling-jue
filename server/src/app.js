'use strict';

const express = require('express');
const { getServices } = require('./services');
const { createRoutes } = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const { requestId } = require('./utils/id');

/**
 * 构建 Express 应用。
 * @param {{services?:Object}} [options] 可注入 services（集成测试用）
 * @returns {Promise<Object>} Express app
 */
async function createApp(options = {}) {
  const services = options.services || (await getServices());
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.locals.requestId = req.headers['x-request-id'] || requestId();
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));
  app.use('/api/v1', createRoutes(services));

  app.locals.services = services;
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
