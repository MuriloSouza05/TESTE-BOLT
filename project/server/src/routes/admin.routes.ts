import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler, createAuditLog } from '../utils/AppError';
import { requireAdmin } from '../middleware/auth';

const router = Router();

const adminLoginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  adminKey: z.string().min(1, 'Chave administrativa é obrigatória')
});

const createTenantSchema = z.object({
  companyName: z.string().min(3, 'Nome da empresa deve ter no mínimo 3 caracteres'),
  cnpj: z.string().optional(),
  planType: z.enum(['SIMPLE', 'COMPOSITE', 'MANAGERIAL']),
  expiresAt: z.string().datetime().optional(),
  maxSimpleAccounts: z.number().min(0).default(1),
  maxCompositeAccounts: z.number().min(0).default(1),
  maxManagerialAccounts: z.number().min(0).default(1)
});

const createUserSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  accountType: z.enum(['SIMPLE', 'COMPOSITE', 'MANAGERIAL'])
});

/**
 * POST /api/admin/login
 * Login administrativo do SaaS
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password, adminKey } = adminLoginSchema.parse(req.body);

  console.log('Tentativa de login administrativo:', { email });

  // Verificar chave administrativa
  if (adminKey !== process.env.ADMIN_KEY) {
    console.log('Chave administrativa inválida');
    throw new AppError('Chave administrativa inválida', 401);
  }

  // Verificar credenciais do admin
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@saas.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  if (email !== adminEmail || password !== adminPassword) {
    console.log('Credenciais administrativas inválidas');
    throw new AppError('Credenciais administrativas inválidas', 401);
  }

  // Gerar token administrativo
  const token = jwt.sign(
    { 
      isAdmin: true, 
      email: email,
      adminKey: adminKey 
    },
    process.env.JWT_SECRET || 'your_jwt_secret_key',
    { expiresIn: '8h' }
  );

  console.log('Login administrativo bem-sucedido');

  res.json({ 
    message: 'Login administrativo realizado com sucesso',
    token,
    user: {
      email: email,
      isAdmin: true
    }
  });
}));

// Aplicar middleware de admin para todas as rotas abaixo
router.use(requireAdmin);

/**
 * GET /api/admin/tenants
 * Listar todas as empresas do SaaS
 */
router.get('/tenants', asyncHandler(async (req, res) => {
  const tenants = await prisma.tenant.findMany({
    include: {
      _count: {
        select: {
          users: true,
          clients: true,
          projects: true,
          invoices: true,
          transactions: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  res.json(tenants);
}));

/**
 * POST /api/admin/tenants
 * Criar nova empresa no SaaS
 */
router.post('/tenants', asyncHandler(async (req, res) => {
  const data = createTenantSchema.parse(req.body);

  // Verificar se CNPJ já existe (se fornecido)
  if (data.cnpj) {
    const existingTenant = await prisma.tenant.findUnique({
      where: { cnpj: data.cnpj }
    });

    if (existingTenant) {
      throw new AppError('CNPJ já cadastrado no sistema', 409);
    }
  }

  const tenant = await prisma.tenant.create({
    data: {
      companyName: data.companyName,
      cnpj: data.cnpj,
      planType: data.planType,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      maxSimpleAccounts: data.maxSimpleAccounts,
      maxCompositeAccounts: data.maxCompositeAccounts,
      maxManagerialAccounts: data.maxManagerialAccounts
    }
  });

  console.log('Nova empresa criada:', tenant.companyName);

  res.status(201).json({
    message: 'Empresa criada com sucesso',
    tenant
  });
}));

/**
 * POST /api/admin/tenants/:id/users
 * Criar usuário para uma empresa específica
 */
router.post('/tenants/:id/users', asyncHandler(async (req, res) => {
  const { id: tenantId } = req.params;
  const data = createUserSchema.parse(req.body);

  // Verificar se empresa existe
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      _count: {
        select: {
          users: {
            where: {
              accountType: data.accountType
            }
          }
        }
      }
    }
  });

  if (!tenant) {
    throw new AppError('Empresa não encontrada', 404);
  }

  // Verificar limite de contas por tipo
  const currentCount = tenant._count.users;
  let maxAllowed = 0;

  switch (data.accountType) {
    case 'SIMPLE':
      maxAllowed = tenant.maxSimpleAccounts;
      break;
    case 'COMPOSITE':
      maxAllowed = tenant.maxCompositeAccounts;
      break;
    case 'MANAGERIAL':
      maxAllowed = tenant.maxManagerialAccounts;
      break;
  }

  if (maxAllowed !== -1 && currentCount >= maxAllowed) {
    throw new AppError(
      `Limite de contas ${data.accountType} atingido. Máximo: ${maxAllowed}`,
      403
    );
  }

  // Verificar se email já existe
  const existingUser = await prisma.user.findFirst({
    where: { email: data.email }
  });

  if (existingUser) {
    throw new AppError('Email já está em uso', 409);
  }

  // Hash da senha
  const passwordHash = await bcrypt.hash(data.password, 12);

  // Criar usuário
  const user = await prisma.user.create({
    data: {
      email: data.email,
      passwordHash,
      name: data.name,
      tenantId,
      accountType: data.accountType
    }
  });

  console.log('Novo usuário criado:', { email: user.email, tenant: tenant.companyName });

  res.status(201).json({
    message: 'Usuário criado com sucesso',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      accountType: user.accountType
    }
  });
}));

/**
 * GET /api/admin/metrics
 * Métricas globais do SaaS
 */
router.get('/metrics', asyncHandler(async (req, res) => {
  const [
    totalTenants,
    activeTenants,
    totalUsers,
    totalClients,
    totalProjects,
    recentTransactions
  ] = await Promise.all([
    prisma.tenant.count(),
    prisma.tenant.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.client.count(),
    prisma.project.count(),
    prisma.transaction.findMany({
      where: {
        date: {
          gte: new Date(new Date().setMonth(new Date().getMonth() - 1))
        },
        type: 'INCOME'
      },
      select: {
        amount: true
      }
    })
  ]);

  const monthlyRevenue = recentTransactions.reduce((sum, t) => sum + t.amount, 0);
  const revenueGrowth = 15.5; // Mock - implementar cálculo real

  const metrics = {
    totalTenants,
    activeTenants,
    totalUsers,
    totalClients,
    totalProjects,
    monthlyRevenue,
    revenueGrowth,
    systemHealth: {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      nodeVersion: process.version
    }
  };

  res.json(metrics);
}));

/**
 * PATCH /api/admin/tenants/:id
 * Atualizar empresa (ativar/desativar, alterar limites de contas, etc.)
 */
router.patch('/tenants/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { 
    isActive, 
    expiresAt, 
    planType, 
    maxSimpleAccounts,
    maxCompositeAccounts,
    maxManagerialAccounts
  } = req.body;

  const updateData: any = {};
  
  if (isActive !== undefined) updateData.isActive = isActive;
  if (expiresAt) updateData.expiresAt = new Date(expiresAt);
  if (planType) updateData.planType = planType;
  if (maxSimpleAccounts !== undefined) updateData.maxSimpleAccounts = maxSimpleAccounts;
  if (maxCompositeAccounts !== undefined) updateData.maxCompositeAccounts = maxCompositeAccounts;
  if (maxManagerialAccounts !== undefined) updateData.maxManagerialAccounts = maxManagerialAccounts;

  const tenant = await prisma.tenant.update({
    where: { id },
    data: updateData
  });

  console.log('Empresa atualizada:', tenant.companyName);

  res.json({
    message: 'Empresa atualizada com sucesso',
    tenant
  });
}));

/**
 * PATCH /api/admin/users/:id
 * Ativar/desativar usuário específico
 */
router.patch('/users/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  const user = await prisma.user.update({
    where: { id },
    data: { isActive },
    include: {
      tenant: {
        select: {
          companyName: true
        }
      }
    }
  });

  console.log('Usuário atualizado:', { 
    email: user.email, 
    isActive: user.isActive,
    tenant: user.tenant.companyName 
  });

  res.json({
    message: 'Usuário atualizado com sucesso',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      isActive: user.isActive
    }
  });
}));

/**
 * DELETE /api/admin/tenants/:id
 * Excluir empresa (operação destrutiva - cuidado)
 */
router.delete('/tenants/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;

  // Verificar se empresa existe
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          users: true,
          clients: true,
          projects: true
        }
      }
    }
  });

  if (!tenant) {
    throw new AppError('Empresa não encontrada', 404);
  }

  // Avisar se há dados associados
  const hasData = tenant._count.users > 0 || tenant._count.clients > 0 || tenant._count.projects > 0;
  
  if (hasData) {
    throw new AppError(
      `Não é possível excluir empresa com dados associados. Usuários: ${tenant._count.users}, Clientes: ${tenant._count.clients}, Projetos: ${tenant._count.projects}`,
      400
    );
  }

  await prisma.tenant.delete({
    where: { id }
  });

  console.log('Empresa excluída:', tenant.companyName);

  res.json({
    message: 'Empresa excluída com sucesso'
  });
}));

/**
 * GET /api/admin/audit-logs
 * Logs de auditoria globais
 */
router.get('/audit-logs', asyncHandler(async (req, res) => {
  const { page = 1, limit = 50, tenantId, action } = req.query;

  const where: any = {};
  if (tenantId) where.tenantId = tenantId as string;
  if (action) where.action = action as string;

  const logs = await prisma.auditLog.findMany({
    where,
    include: {
      user: {
        select: {
          email: true,
          name: true
        }
      },
      tenant: {
        select: {
          companyName: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    skip: (Number(page) - 1) * Number(limit),
    take: Number(limit)
  });

  const total = await prisma.auditLog.count({ where });

  res.json({
    logs,
    pagination: {
      page: Number(page),
      limit: Number(limit),
      total,
      pages: Math.ceil(total / Number(limit))
    }
  });
}));

export { router as adminRoutes };