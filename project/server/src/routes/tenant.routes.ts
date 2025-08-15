import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler, createAuditLog } from '../utils/AppError';
import { checkAccountAccess, checkAccountLimits } from '../middleware/planAccess';

const router = Router();

// Schemas de validação
const createClientSchema = z.object({
  name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  cpf: z.string().optional(),
  rg: z.string().optional(),
  pis: z.string().optional(),
  cei: z.string().optional(),
  inssStatus: z.string().optional(),
  email: z.string().email('Email inválido').optional(),
  phone: z.string().optional(),
  address: z.object({
    street: z.string().optional(),
    number: z.string().optional(),
    complement: z.string().optional(),
    neighborhood: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipCode: z.string().optional(),
    country: z.string().optional()
  }).optional()
});

const createProjectSchema = z.object({
  title: z.string().min(3, 'Título deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
  clientId: z.string().uuid('ID do cliente inválido'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime().optional(),
  budget: z.number().optional(),
  userId: z.string().uuid('ID do usuário inválido')
});

const createTaskSchema = z.object({
  title: z.string().min(3, 'Título deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
  projectId: z.string().uuid('ID do projeto inválido'),
  userId: z.string().uuid('ID do usuário inválido'),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  estimatedHours: z.number().optional(),
  dueDate: z.string().datetime().optional()
});

const createInvoiceSchema = z.object({
  number: z.string().min(1, 'Número da fatura é obrigatório'),
  clientId: z.string().uuid('ID do cliente inválido'),
  projectId: z.string().uuid('ID do projeto inválido'),
  amount: z.number().positive('Valor deve ser positivo'),
  dueDate: z.string().datetime(),
  description: z.string().optional()
});

const createTransactionSchema = z.object({
  type: z.enum(['INCOME', 'EXPENSE']),
  amount: z.number().positive('Valor deve ser positivo'),
  category: z.string().min(1, 'Categoria é obrigatória'),
  description: z.string().optional(),
  date: z.string().datetime(),
  isRecurring: z.boolean().default(false)
});

// ==================== ROTA DE DASHBOARD ====================

/**
 * GET /api/tenant/dashboard
 * Métricas do dashboard da empresa (com controle de acesso por tipo de conta)
 */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const { user } = req;

  console.log('Carregando dashboard para:', { 
    userId: user!.userId, 
    tenantId: user!.tenantId,
    accountType: user!.accountType 
  });

  // Dados básicos disponíveis para todos os tipos de conta
  const [
    totalClients,
    activeProjects,
    pendingTasks,
    pendingInvoices
  ] = await Promise.all([
    prisma.client.count({ 
      where: { tenantId: user!.tenantId } 
    }),
    prisma.project.count({ 
      where: { 
        tenantId: user!.tenantId,
        status: { in: ['NOT_STARTED', 'IN_PROGRESS'] }
      } 
    }),
    prisma.task.count({ 
      where: { 
        tenantId: user!.tenantId, 
        status: { in: ['TODO', 'IN_PROGRESS'] }
      } 
    }),
    prisma.invoice.findMany({
      where: {
        tenantId: user!.tenantId,
        status: { in: ['SENT', 'OVERDUE'] },
        dueDate: {
          gte: new Date()
        }
      },
      select: {
        amount: true
      }
    })
  ]);

  const totalReceivables = pendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);

  // Dados financeiros - APENAS para contas COMPOSITE e MANAGERIAL
  let monthlyIncome = 0;
  let monthlyExpenses = 0;
  let monthlyBalance = 0;
  let transactionCount = 0;

  if (user!.accountType === 'COMPOSITE' || user!.accountType === 'MANAGERIAL') {
    const monthlyTransactions = await prisma.transaction.findMany({
      where: {
        tenantId: user!.tenantId,
        date: {
          gte: new Date(new Date().setMonth(new Date().getMonth() - 1))
        }
      }
    });

    monthlyIncome = monthlyTransactions
      .filter(t => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);
      
    monthlyExpenses = monthlyTransactions
      .filter(t => t.type === 'EXPENSE')
      .reduce((sum, t) => sum + t.amount, 0);

    monthlyBalance = monthlyIncome - monthlyExpenses;
    transactionCount = monthlyTransactions.length;
  }

  // Para contas SIMPLE: valores financeiros sempre 0
  const dashboardData = {
    totalClients,
    activeProjects,
    pendingTasks,
    totalReceivables,
    monthlyBalance: user!.accountType === 'SIMPLE' ? 0 : monthlyBalance,
    monthlyIncome: user!.accountType === 'SIMPLE' ? 0 : monthlyIncome,
    monthlyExpenses: user!.accountType === 'SIMPLE' ? 0 : monthlyExpenses,
    transactionCount: user!.accountType === 'SIMPLE' ? 0 : transactionCount,
    hasFinancialAccess: user!.accountType !== 'SIMPLE'
  };

  console.log('Dashboard carregado:', dashboardData);

  res.json(dashboardData);
}));

// ==================== ROTAS DE CLIENTES ====================

/**
 * GET /api/tenant/clients
 * Listar clientes da empresa
 */
router.get('/clients', checkAccountAccess('clients'), asyncHandler(async (req, res) => {
  const { user } = req;
  
  const clients = await prisma.client.findMany({
    where: { tenantId: user!.tenantId },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log(`Clientes carregados: ${clients.length} para tenant ${user!.tenantId}`);
  res.json(clients);
}));

/**
 * POST /api/tenant/clients
 * Criar novo cliente
 */
router.post('/clients', checkAccountAccess('clients'), checkAccountLimits('clients'), asyncHandler(async (req, res) => {
  const data = createClientSchema.parse(req.body);
  const { user } = req;

  const client = await prisma.client.create({
    data: {
      ...data,
      tenantId: user!.tenantId
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'CREATE',
    'CLIENT',
    client.id,
    { clientName: client.name }
  );

  console.log('Cliente criado:', client.name);

  res.status(201).json({
    message: 'Cliente criado com sucesso',
    client
  });
}));

// ==================== ROTAS DE PROJETOS ====================

/**
 * GET /api/tenant/projects
 * Listar projetos da empresa
 */
router.get('/projects', checkAccountAccess('projects'), asyncHandler(async (req, res) => {
  const { user } = req;
  
  const projects = await prisma.project.findMany({
    where: { tenantId: user!.tenantId },
    include: {
      client: { 
        select: { 
          id: true,
          name: true 
        } 
      },
      assignedTo: { 
        select: { 
          id: true,
          name: true,
          email: true 
        } 
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log(`Projetos carregados: ${projects.length} para tenant ${user!.tenantId}`);
  res.json(projects);
}));

/**
 * POST /api/tenant/projects
 * Criar novo projeto
 */
router.post('/projects', checkAccountAccess('projects'), checkAccountLimits('projects'), asyncHandler(async (req, res) => {
  const data = createProjectSchema.parse(req.body);
  const { user } = req;

  const project = await prisma.project.create({
    data: {
      ...data,
      tenantId: user!.tenantId,
      status: 'NOT_STARTED',
      startDate: new Date(data.startDate),
      endDate: data.endDate ? new Date(data.endDate) : null
    },
    include: {
      client: { select: { name: true } },
      assignedTo: { select: { name: true, email: true } }
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'CREATE',
    'PROJECT',
    project.id,
    { projectTitle: project.title }
  );

  console.log('Projeto criado:', project.title);

  res.status(201).json({
    message: 'Projeto criado com sucesso',
    project
  });
}));

// ==================== ROTAS DE TAREFAS ====================

/**
 * GET /api/tenant/tasks
 * Listar tarefas da empresa
 */
router.get('/tasks', checkAccountAccess('tasks'), asyncHandler(async (req, res) => {
  const { user } = req;
  
  const tasks = await prisma.task.findMany({
    where: { tenantId: user!.tenantId },
    include: {
      project: { 
        select: { 
          id: true,
          title: true 
        } 
      },
      assignedTo: { 
        select: { 
          id: true,
          name: true,
          email: true 
        } 
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log(`Tarefas carregadas: ${tasks.length} para tenant ${user!.tenantId}`);
  res.json(tasks);
}));

/**
 * POST /api/tenant/tasks
 * Criar nova tarefa
 */
router.post('/tasks', checkAccountAccess('tasks'), asyncHandler(async (req, res) => {
  const data = createTaskSchema.parse(req.body);
  const { user } = req;

  const task = await prisma.task.create({
    data: {
      ...data,
      tenantId: user!.tenantId,
      status: 'TODO',
      dueDate: data.dueDate ? new Date(data.dueDate) : null
    },
    include: {
      project: { select: { title: true } },
      assignedTo: { select: { name: true, email: true } }
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'CREATE',
    'TASK',
    task.id,
    { taskTitle: task.title }
  );

  console.log('Tarefa criada:', task.title);

  res.status(201).json({
    message: 'Tarefa criada com sucesso',
    task
  });
}));

// ==================== ROTAS DE FATURAMENTO ====================

/**
 * GET /api/tenant/invoices
 * Listar faturas da empresa
 */
router.get('/invoices', checkAccountAccess('billing'), asyncHandler(async (req, res) => {
  const { user } = req;
  
  const invoices = await prisma.invoice.findMany({
    where: { tenantId: user!.tenantId },
    include: {
      client: { 
        select: { 
          id: true,
          name: true 
        } 
      },
      project: { 
        select: { 
          id: true,
          title: true 
        } 
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  console.log(`Faturas carregadas: ${invoices.length} para tenant ${user!.tenantId}`);
  res.json(invoices);
}));

/**
 * POST /api/tenant/invoices
 * Criar nova fatura
 */
router.post('/invoices', checkAccountAccess('billing'), asyncHandler(async (req, res) => {
  const data = createInvoiceSchema.parse(req.body);
  const { user } = req;

  const invoice = await prisma.invoice.create({
    data: {
      ...data,
      tenantId: user!.tenantId,
      status: 'DRAFT',
      dueDate: new Date(data.dueDate)
    },
    include: {
      client: { select: { name: true } },
      project: { select: { title: true } }
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'CREATE',
    'INVOICE',
    invoice.id,
    { invoiceNumber: invoice.number, amount: invoice.amount }
  );

  console.log('Fatura criada:', invoice.number);

  res.status(201).json({
    message: 'Fatura criada com sucesso',
    invoice
  });
}));

// ==================== ROTAS DE FLUXO DE CAIXA ====================

/**
 * GET /api/tenant/transactions
 * Listar transações da empresa (apenas contas COMPOSITE e MANAGERIAL)
 */
router.get('/transactions', checkAccountAccess('cash_flow'), asyncHandler(async (req, res) => {
  const { user } = req;
  
  const transactions = await prisma.transaction.findMany({
    where: { tenantId: user!.tenantId },
    orderBy: { date: 'desc' }
  });
  
  console.log(`Transações carregadas: ${transactions.length} para tenant ${user!.tenantId}`);
  res.json(transactions);
}));

/**
 * POST /api/tenant/transactions
 * Criar nova transação (apenas contas COMPOSITE e MANAGERIAL)
 */
router.post('/transactions', checkAccountAccess('cash_flow'), asyncHandler(async (req, res) => {
  const data = createTransactionSchema.parse(req.body);
  const { user } = req;

  const transaction = await prisma.transaction.create({
    data: {
      ...data,
      tenantId: user!.tenantId,
      date: new Date(data.date)
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'CREATE',
    'TRANSACTION',
    transaction.id,
    { 
      type: transaction.type, 
      amount: transaction.amount,
      category: transaction.category 
    }
  );

  console.log('Transação criada:', { 
    type: transaction.type, 
    amount: transaction.amount,
    category: transaction.category 
  });

  res.status(201).json({
    message: 'Transação criada com sucesso',
    transaction
  });
}));

// ==================== ROTAS GENÉRICAS DE CRUD ====================

/**
 * PUT /api/tenant/clients/:id
 * Atualizar cliente
 */
router.put('/clients/:id', checkAccountAccess('clients'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = createClientSchema.parse(req.body);
  const { user } = req;

  const client = await prisma.client.update({
    where: { 
      id,
      tenantId: user!.tenantId 
    },
    data
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'UPDATE',
    'CLIENT',
    client.id,
    { clientName: client.name }
  );

  res.json({
    message: 'Cliente atualizado com sucesso',
    client
  });
}));

/**
 * DELETE /api/tenant/clients/:id
 * Excluir cliente
 */
router.delete('/clients/:id', checkAccountAccess('clients'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { user } = req;

  // Verificar se cliente tem projetos associados
  const projectCount = await prisma.project.count({
    where: { 
      clientId: id,
      tenantId: user!.tenantId 
    }
  });

  if (projectCount > 0) {
    throw new AppError('Não é possível excluir cliente com projetos associados', 400);
  }

  await prisma.client.delete({
    where: { 
      id,
      tenantId: user!.tenantId 
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'DELETE',
    'CLIENT',
    id
  );

  res.json({
    message: 'Cliente excluído com sucesso'
  });
}));

/**
 * PUT /api/tenant/projects/:id
 * Atualizar projeto
 */
router.put('/projects/:id', checkAccountAccess('projects'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = createProjectSchema.partial().parse(req.body);
  const { user } = req;

  const updateData: any = { ...data };
  if (data.startDate) updateData.startDate = new Date(data.startDate);
  if (data.endDate) updateData.endDate = new Date(data.endDate);

  const project = await prisma.project.update({
    where: { 
      id,
      tenantId: user!.tenantId 
    },
    data: updateData,
    include: {
      client: { select: { name: true } },
      assignedTo: { select: { name: true, email: true } }
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'UPDATE',
    'PROJECT',
    project.id,
    { projectTitle: project.title }
  );

  res.json({
    message: 'Projeto atualizado com sucesso',
    project
  });
}));

/**
 * DELETE /api/tenant/projects/:id
 * Excluir projeto
 */
router.delete('/projects/:id', checkAccountAccess('projects'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { user } = req;

  // Verificar se projeto tem tarefas associadas
  const taskCount = await prisma.task.count({
    where: { 
      projectId: id,
      tenantId: user!.tenantId 
    }
  });

  if (taskCount > 0) {
    throw new AppError('Não é possível excluir projeto com tarefas associadas', 400);
  }

  await prisma.project.delete({
    where: { 
      id,
      tenantId: user!.tenantId 
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'DELETE',
    'PROJECT',
    id
  );

  res.json({
    message: 'Projeto excluído com sucesso'
  });
}));

/**
 * PUT /api/tenant/transactions/:id
 * Atualizar transação (apenas contas COMPOSITE e MANAGERIAL)
 */
router.put('/transactions/:id', checkAccountAccess('cash_flow'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = createTransactionSchema.partial().parse(req.body);
  const { user } = req;

  const updateData: any = { ...data };
  if (data.date) updateData.date = new Date(data.date);

  const transaction = await prisma.transaction.update({
    where: { 
      id,
      tenantId: user!.tenantId 
    },
    data: updateData
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'UPDATE',
    'TRANSACTION',
    transaction.id,
    { 
      type: transaction.type, 
      amount: transaction.amount 
    }
  );

  res.json({
    message: 'Transação atualizada com sucesso',
    transaction
  });
}));

/**
 * DELETE /api/tenant/transactions/:id
 * Excluir transação (apenas contas COMPOSITE e MANAGERIAL)
 */
router.delete('/transactions/:id', checkAccountAccess('cash_flow'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { user } = req;

  await prisma.transaction.delete({
    where: { 
      id,
      tenantId: user!.tenantId 
    }
  });

  await createAuditLog(
    prisma,
    user!.userId,
    user!.tenantId,
    'DELETE',
    'TRANSACTION',
    id
  );

  res.json({
    message: 'Transação excluída com sucesso'
  });
}));

export { router as tenantRoutes };