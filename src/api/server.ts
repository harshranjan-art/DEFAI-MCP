import express from 'express';
import cors from 'cors';
import { logger } from '../utils/logger';

import authRoutes from './routes/auth';
import portfolioRoutes from './routes/portfolio';
import tradesRoutes from './routes/trades';
import marketsRoutes from './routes/markets';
import alertsRoutes from './routes/alerts';

const app = express();

app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/trades', tradesRoutes);
app.use('/api/markets', marketsRoutes);
app.use('/api/alerts', alertsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'defai-api', chain: 'BSC Testnet (97)' });
});

export function startApiServer(port: number = 3002): void {
  app.listen(port, () => {
    logger.info('REST API server started on port %d', port);
  });
}

export { app };
