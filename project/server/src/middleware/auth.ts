import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';

interface TokenPayload {
  userId: string;
  tenantId: string;
  accountType: string;
  iat?: number;
  exp?: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export const authenticateToken = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      throw new AppError('Token de autenticação não fornecido', 401);
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'your_jwt_secret_key'
    ) as TokenPayload;

    // Verificar se o usuário ainda existe e está ativo
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        tenant: {
          select: {
            id: true,
            isActive: true,
            expiresAt: true,
            planType: true,
            companyName: true
          }
        }
      }
    });

    if (!user || !user.isActive) {
      throw new AppError('Usuário não encontrado ou inativo', 401);
    }

    if (!user.tenant.isActive) {
      throw new AppError('Empresa inativa', 403);
    }

    if (user.tenant.expiresAt && user.tenant.expiresAt < new Date()) {
      throw new AppError('Plano da empresa expirou', 403);
    }

    req.user = {
      userId: user.id,
      tenantId: user.tenantId,
      accountType: user.accountType
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new AppError('Token inválido', 401));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new AppError('Token expirado', 401));
    } else {
      next(error);
    }
  }
};

export const requireAdmin = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const adminKey = req.headers['x-admin-key'];

    if (!adminKey || adminKey !== process.env.ADMIN_KEY) {
      throw new AppError('Acesso administrativo não autorizado', 403);
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const checkAccountType = (requiredAccountTypes: string[]) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError('Usuário não autenticado', 401);
      }

      if (!requiredAccountTypes.includes(req.user.accountType)) {
        throw new AppError(
          `Permissão insuficiente. Requer: ${requiredAccountTypes.join(' ou ')}`,
          403
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};