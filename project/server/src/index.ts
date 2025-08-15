import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { rateLimit } from 'express-rate-limit';

import { authRoutes } from './routes/auth.routes';
import { adminRoutes } from './routes/admin.routes';
import { tenantRoutes } from './routes/tenant.routes';
import { uploadRoutes } from './routes/upload.routes';
import { errorHandler } from './middleware/errorHandler';
import { authenticateToken } from './middleware/auth';
import { tenantMiddleware } from './middleware/tenant';
import { connectDatabase, disconnectDatabase } from './lib/prisma';

const app = express();

// Conectar ao banco de dados
connectDatabase();

// Configurações básicas de segurança
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// CORS configurado para produção
const corsOrigins = process.env.CORS_ORIGINS?.split(',') || [
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key']
}));

app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting para produção
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'), // 15 minutos
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: {
    error: 'Muitas requisições. Tente novamente em alguns minutos.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// Health check para monitoramento
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    database: 'connected'
  });
});

// Rotas públicas (sem autenticação)
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);

// Middleware de autenticação para rotas protegidas
app.use('/api/tenant', authenticateToken);
app.use('/api/upload', authenticateToken);

// Middleware de tenant para isolamento de dados
app.use('/api/tenant', tenantMiddleware);
app.use('/api/upload', tenantMiddleware);

// Rotas protegidas por tenant
app.use('/api/tenant', tenantRoutes);
app.use('/api/upload', uploadRoutes);

// Middleware de tratamento de erros (deve ser o último)
app.use(errorHandler);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: `Rota ${req.method} ${req.originalUrl} não encontrada`
  });
});

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`🚀 SaaS Legal Backend rodando na porta ${PORT}`);
  console.log(`📱 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔧 API: http://localhost:${PORT}/api`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`🗄️ Database: PostgreSQL conectado`);
});

// Graceful shutdown para produção
const gracefulShutdown = async (signal: string) => {
  console.log(`\n🛑 Recebido ${signal}, encerrando servidor graciosamente...`);
  
  server.close(async () => {
    console.log('🔌 Servidor HTTP fechado');
    
    try {
      await disconnectDatabase();
      console.log('✅ Desconectado do banco de dados');
      process.exit(0);
    } catch (error) {
      console.error('❌ Erro ao desconectar do banco:', error);
      process.exit(1);
    }
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.log('⚠️ Forçando encerramento...');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default app;