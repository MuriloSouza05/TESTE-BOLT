import { Request, Response, NextFunction } from 'express';
import { PrismaClient, PlanType } from '@prisma/client';

const prisma = new PrismaClient();

// Módulos disponíveis por tipo de conta
const ACCOUNT_MODULES = {
  SIMPLE: [
    'crm',
    'clients', 
    'projects',
    'tasks',
    'billing',
    'basic_settings'
  ],
  COMPOSITE: [
    'crm',
    'clients',
    'projects', 
    'tasks',
    'billing',
    'cash_flow',
    'transactions',
    'dashboard',
    'basic_settings'
  ],
  MANAGERIAL: [
    'crm',
    'clients',
    'projects',
    'tasks', 
    'billing',
    'cash_flow',
    'transactions',
    'dashboard',
    'user_management',
    'advanced_settings',
    'audit_logs'
  ]
};

// Limites por tipo de conta
const ACCOUNT_LIMITS = {
  SIMPLE: {
    maxClients: 50,
    maxProjects: 25,
    maxStorage: 1024 * 1024 * 100, // 100MB
    features: {
      dashboard_financial: false,
      cash_flow: false,
      user_management: false,
      advanced_reports: false
    }
  },
  COMPOSITE: {
    maxClients: 200,
    maxProjects: 100,
    maxStorage: 1024 * 1024 * 500, // 500MB
    features: {
      dashboard_financial: true,
      cash_flow: true,
      user_management: false,
      advanced_reports: false
    }
  },
  MANAGERIAL: {
    maxClients: -1, // Ilimitado
    maxProjects: -1, // Ilimitado
    maxStorage: 1024 * 1024 * 1024 * 5, // 5GB
    features: {
      dashboard_financial: true,
      cash_flow: true,
      user_management: true,
      advanced_reports: true
    }
  }
};

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    tenantId: string;
    accountType: string;
  };
  tenant?: {
    id: string;
    planType: PlanType;
    isActive: boolean;
    companyName: string;
  };
}

/**
 * Middleware para verificar se o tipo de conta permite acesso a um módulo específico
 */
export const checkAccountAccess = (requiredModule: string) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ 
          error: 'Usuário não autenticado',
          code: 'USER_NOT_AUTHENTICATED'
        });
      }

      // Verificar se o tipo de conta permite acesso ao módulo
      const allowedModules = ACCOUNT_MODULES[req.user.accountType as keyof typeof ACCOUNT_MODULES];
      if (!allowedModules.includes(requiredModule)) {
        return res.status(403).json({ 
          error: `Acesso negado. Sua conta ${req.user.accountType} não inclui o módulo '${requiredModule}'`,
          code: 'ACCOUNT_ACCESS_DENIED',
          currentAccount: req.user.accountType,
          requiredModule,
          allowedModules,
          suggestedAccounts: getSuggestedAccounts(requiredModule)
        });
      }

      next();
    } catch (error) {
      console.error('Erro no middleware de controle de conta:', error);
      res.status(500).json({ 
        error: 'Erro interno do servidor',
        code: 'INTERNAL_ERROR'
      });
    }
  };
};

/**
 * Middleware para verificar limites do tipo de conta
 */
export const checkAccountLimits = (resourceType: 'clients' | 'projects' | 'storage') => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const tenantId = req.user?.tenantId;
      const accountType = req.user?.accountType;
      
      if (!tenantId || !accountType) {
        return res.status(401).json({ 
          error: 'Informações de autenticação inválidas',
          code: 'INVALID_AUTH'
        });
      }

      const limits = ACCOUNT_LIMITS[accountType as keyof typeof ACCOUNT_LIMITS];
      let currentCount = 0;
      let maxAllowed = 0;

      switch (resourceType) {
        case 'clients':
          currentCount = await prisma.client.count({ where: { tenantId } });
          maxAllowed = limits.maxClients;
          break;
        case 'projects':
          currentCount = await prisma.project.count({ where: { tenantId } });
          maxAllowed = limits.maxProjects;
          break;
        case 'storage':
          const files = await prisma.file.findMany({ 
            where: { tenantId },
            select: { size: true }
          });
          currentCount = files.reduce((total, file) => total + (file.size || 0), 0);
          maxAllowed = limits.maxStorage;
          break;
      }

      // -1 significa ilimitado
      if (maxAllowed !== -1 && currentCount >= maxAllowed) {
        return res.status(403).json({ 
          error: `Limite da conta atingido para ${resourceType}`,
          code: 'ACCOUNT_LIMIT_EXCEEDED',
          currentAccount: accountType,
          resourceType,
          currentCount,
          maxAllowed,
          suggestedAccounts: getSuggestedAccountsForLimit(resourceType, accountType)
        });
      }

      next();
    } catch (error) {
      console.error('Erro no middleware de limite de conta:', error);
      res.status(500).json({ 
        error: 'Erro interno do servidor',
        code: 'INTERNAL_ERROR'
      });
    }
  };
};

/**
 * Função para obter tipos de conta sugeridos que incluem um módulo específico
 */
function getSuggestedAccounts(requiredModule: string): string[] {
  const suggestions: string[] = [];
  
  Object.entries(ACCOUNT_MODULES).forEach(([accountType, modules]) => {
    if (modules.includes(requiredModule)) {
      suggestions.push(accountType);
    }
  });
  
  return suggestions;
}

/**
 * Função para obter tipos de conta sugeridos baseado em limites
 */
function getSuggestedAccountsForLimit(resourceType: string, currentAccount: string): string[] {
  const accountLevels = { SIMPLE: 1, COMPOSITE: 2, MANAGERIAL: 3 };
  const currentLevel = accountLevels[currentAccount as keyof typeof accountLevels];
  const suggestions: string[] = [];
  
  Object.entries(accountLevels).forEach(([accountType, level]) => {
    if (level > currentLevel) {
      suggestions.push(accountType);
    }
  });
  
  return suggestions;
}

export { ACCOUNT_MODULES, ACCOUNT_LIMITS };