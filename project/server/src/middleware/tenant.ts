import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../utils/AppError';

declare global {
  namespace Express {
    interface Request {
      tenant?: {
        id: string;
        planType: string;
        isActive: boolean;
        companyName: string;
        maxSimpleAccounts: number;
        maxCompositeAccounts: number;
        maxManagerialAccounts: number;
      };
    }
  }
}

export const tenantMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!req.user?.tenantId) {
      throw new AppError('Tenant ID não encontrado', 401);
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: req.user.tenantId },
      select: { 
        id: true,
        isActive: true, 
        expiresAt: true,
        planType: true,
        companyName: true,
        maxSimpleAccounts: true,
        maxCompositeAccounts: true,
        maxManagerialAccounts: true
      }
    });

    if (!tenant) {
      throw new AppError('Empresa não encontrada', 404);
    }

    if (!tenant.isActive) {
      throw new AppError('Empresa inativa', 403);
    }

    if (tenant.expiresAt && tenant.expiresAt < new Date()) {
      throw new AppError('Plano da empresa expirou', 403);
    }

    // Adicionar informações do tenant ao request
    req.tenant = tenant;

    next();
  } catch (error) {
    next(error);
  }
};