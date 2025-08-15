import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { AppError, asyncHandler, createAuditLog } from '../utils/AppError';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
});

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'Senha deve ter no mínimo 6 caracteres'),
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres'),
  tenantId: z.string().uuid('ID da empresa inválido'),
  accountType: z.enum(['SIMPLE', 'COMPOSITE', 'MANAGERIAL'])
});

/**
 * POST /api/auth/login
 * Login de usuários das empresas
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);

  console.log('Tentativa de login:', { email });

  // Buscar usuário com informações da empresa
  const user = await prisma.user.findFirst({
    where: {
      email,
      isActive: true
    },
    include: {
      tenant: {
        select: {
          id: true,
          companyName: true,
          planType: true,
          isActive: true,
          expiresAt: true,
          maxSimpleAccounts: true,
          maxCompositeAccounts: true,
          maxManagerialAccounts: true
        }
      }
    }
  });

  if (!user) {
    console.log('Usuário não encontrado:', email);
    throw new AppError('Credenciais inválidas', 401);
  }

  if (!user.tenant.isActive) {
    console.log('Empresa inativa:', user.tenant.companyName);
    throw new AppError('Empresa inativa. Entre em contato com o suporte.', 403);
  }

  if (user.tenant.expiresAt && user.tenant.expiresAt < new Date()) {
    console.log('Plano expirado:', user.tenant.companyName);
    throw new AppError('Plano da empresa expirou. Renove sua assinatura.', 403);
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);

  if (!isValidPassword) {
    console.log('Senha inválida para:', email);
    throw new AppError('Credenciais inválidas', 401);
  }

  // Gerar tokens JWT
  const accessToken = jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      accountType: user.accountType
    },
    process.env.JWT_SECRET || 'your_jwt_secret_key',
    { expiresIn: '24h' }
  );

  const refreshToken = jwt.sign(
    {
      userId: user.id,
      tenantId: user.tenantId,
      type: 'refresh'
    },
    process.env.JWT_REFRESH_SECRET || 'your_refresh_secret_key_super_secure_2024_production',
    { expiresIn: '30d' }
  );

  // Atualizar último login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() }
  });

  // Log de auditoria
  await createAuditLog(
    prisma,
    user.id,
    user.tenantId,
    'LOGIN',
    'USER',
    user.id,
    { email: user.email, ip: req.ip }
  );

  console.log('Login bem-sucedido:', { 
    user: user.email, 
    tenant: user.tenant.companyName,
    accountType: user.accountType 
  });

  res.json({
    message: 'Login realizado com sucesso',
    token: accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      accountType: user.accountType,
      tenantId: user.tenantId,
      tenant: user.tenant
    }
  });
}));

/**
 * POST /api/auth/register
 * Registro de novos usuários (apenas para empresas existentes)
 */
router.post('/register', asyncHandler(async (req, res) => {
  const { email, password, name, tenantId, accountType } = registerSchema.parse(req.body);

  // Verificar se usuário já existe
  const existingUser = await prisma.user.findFirst({
    where: { email }
  });

  if (existingUser) {
    throw new AppError('Email já está em uso', 409);
  }

  // Verificar se a empresa existe e está ativa
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      _count: {
        select: {
          users: {
            where: {
              accountType: accountType
            }
          }
        }
      }
    }
  });

  if (!tenant) {
    throw new AppError('Empresa não encontrada', 404);
  }

  if (!tenant.isActive) {
    throw new AppError('Empresa inativa', 403);
  }

  // Verificar limite de contas por tipo
  const currentCount = tenant._count.users;
  let maxAllowed = 0;

  switch (accountType) {
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
      `Limite de contas ${accountType} atingido para esta empresa. Máximo: ${maxAllowed}`,
      403
    );
  }

  // Hash da senha
  const passwordHash = await bcrypt.hash(password, 12);

  // Criar usuário
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name,
      tenantId,
      accountType
    }
  });

  // Log de auditoria
  await createAuditLog(
    prisma,
    user.id,
    tenantId,
    'REGISTER',
    'USER',
    user.id,
    { email: user.email, accountType }
  );

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
 * POST /api/auth/refresh
 * Renovar token de acesso usando refresh token
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    throw new AppError('Refresh token não fornecido', 401);
  }

  try {
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || 'your_refresh_secret_key_super_secure_2024_production'
    ) as any;

    if (decoded.type !== 'refresh') {
      throw new AppError('Token inválido', 401);
    }

    // Verificar se usuário ainda existe e está ativo
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        tenant: {
          select: {
            id: true,
            isActive: true,
            expiresAt: true
          }
        }
      }
    });

    if (!user || !user.isActive || !user.tenant.isActive) {
      throw new AppError('Usuário ou empresa inativo', 401);
    }

    // Gerar novo access token
    const accessToken = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenantId,
        accountType: user.accountType
      },
      process.env.JWT_SECRET || 'your_jwt_secret_key',
      { expiresIn: '24h' }
    );

    res.json({
      token: accessToken
    });
  } catch (error) {
    throw new AppError('Refresh token inválido', 401);
  }
}));

/**
 * POST /api/auth/logout
 * Logout (em sistema JWT stateless, apenas confirma logout)
 */
router.post('/logout', asyncHandler(async (req, res) => {
  res.json({
    message: 'Logout realizado com sucesso'
  });
}));

export { router as authRoutes };