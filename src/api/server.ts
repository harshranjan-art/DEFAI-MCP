import express from 'express';
import cors from 'cors';
import path from 'path';
import { logger } from '../utils/logger';

import authRoutes from './routes/auth';
import portfolioRoutes from './routes/portfolio';
import tradesRoutes from './routes/trades';
import marketsRoutes from './routes/markets';
import alertsRoutes from './routes/alerts';
import arbRoutes from './routes/arb';
import transactionsRoutes from './routes/transactions';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/arb', arbRoutes);
app.use('/api/transactions', transactionsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'defai-api',
    version: '1.0.0',
    chain: 'BSC Testnet (97)',
    uptime: Math.floor(process.uptime()),
  });
});

// In production, serve the built dashboard as static files
if (process.env.NODE_ENV === 'production') {
  const dashboardPath = path.join(__dirname, '..', 'dashboard', 'dist');
  app.use(express.static(dashboardPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(dashboardPath, 'index.html'));
    }
  });
}

export function startApiServer(port: number = 3002): void {
  app.listen(port, () => {
    logger.info('REST API server started on port %d', port);
  });
}

export { app };
