import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface User {
  id: string;
  email: string;
  name?: string;
  accountType: 'SIMPLE' | 'COMPOSITE' | 'MANAGERIAL';
  tenantId: string;
  tenant: {
    id: string;
    companyName: string;
    planType: 'SIMPLE' | 'COMPOSITE' | 'MANAGERIAL';
    isActive: boolean;
    expiresAt?: string;
    maxSimpleAccounts: number;
    maxCompositeAccounts: number;
    maxManagerialAccounts: number;
  };
}

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface LoginCredentials {
  email: string;
  password: string;
}

interface AdminLoginCredentials {
  email: string;
  password: string;
  adminKey: string;
}

// Configurar base URL da API
const API_BASE_URL = '/api';

export const useAuth = () => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    token: null,
    isLoading: true,
    isAuthenticated: false
  });
  
  const navigate = useNavigate();

  // Configurar interceptor para lidar com tokens expirados
  useEffect(() => {
    const originalFetch = window.fetch;
    
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      
      if (response.status === 401) {
        console.log('Token expirado, fazendo logout...');
        logout();
        navigate('/login');
      }
      
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [navigate]);

  // Carregar dados de autenticação do localStorage na inicialização
  useEffect(() => {
    const loadAuthData = async () => {
      try {
        const token = localStorage.getItem('token');
        const userData = localStorage.getItem('user');
        
        if (token && userData) {
          const user = JSON.parse(userData);
          
          // Verificar se o token não expirou
          try {
            const tokenPayload = JSON.parse(atob(token.split('.')[1]));
            const currentTime = Date.now() / 1000;
            
            if (tokenPayload.exp > currentTime) {
              setAuthState({
                user,
                token,
                isLoading: false,
                isAuthenticated: true
              });
              return;
            }
          } catch (tokenError) {
            console.error('Erro ao decodificar token:', tokenError);
          }
        }
        
        // Se chegou aqui, não há autenticação válida
        setAuthState({
          user: null,
          token: null,
          isLoading: false,
          isAuthenticated: false
        });
      } catch (error) {
        console.error('Erro ao carregar dados de autenticação:', error);
        setAuthState({
          user: null,
          token: null,
          isLoading: false,
          isAuthenticated: false
        });
      }
    };

    loadAuthData();
  }, []);

  // Função de login normal
  const login = useCallback(async (credentials: LoginCredentials) => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true }));
      
      console.log('Tentando login com:', { email: credentials.email });
      
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao fazer login');
      }

      const { token, user } = await response.json();
      
      console.log('Login bem-sucedido:', { user: user.email, tenant: user.tenant.companyName });
      
      // Salvar no localStorage
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      
      setAuthState({
        user,
        token,
        isLoading: false,
        isAuthenticated: true
      });
      
      return { success: true, user, token };
    } catch (error: any) {
      console.error('Erro no login:', error.message);
      setAuthState(prev => ({ ...prev, isLoading: false }));
      
      const errorMessage = error.message || 'Erro ao fazer login';
      return { success: false, error: errorMessage };
    }
  }, []);

  // Função de login administrativo
  const adminLogin = useCallback(async (credentials: AdminLoginCredentials) => {
    try {
      setAuthState(prev => ({ ...prev, isLoading: true }));
      
      console.log('Tentando login administrativo...');
      
      const response = await fetch(`${API_BASE_URL}/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(credentials)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Erro ao fazer login administrativo');
      }

      const { token, user } = await response.json();
      
      console.log('Login administrativo bem-sucedido');
      
      // Salvar no localStorage com prefixo admin
      localStorage.setItem('admin_token', token);
      localStorage.setItem('admin_user', JSON.stringify(user));
      
      setAuthState({
        user: user as User,
        token,
        isLoading: false,
        isAuthenticated: true
      });
      
      return { success: true, user, token };
    } catch (error: any) {
      console.error('Erro no login administrativo:', error.message);
      setAuthState(prev => ({ ...prev, isLoading: false }));
      
      const errorMessage = error.message || 'Erro ao fazer login administrativo';
      return { success: false, error: errorMessage };
    }
  }, []);

  // Função de logout
  const logout = useCallback(async () => {
    try {
      // Tentar fazer logout no servidor
      if (authState.token) {
        await fetch(`${API_BASE_URL}/auth/logout`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${authState.token}`
          }
        });
      }
    } catch (error) {
      console.error('Erro ao fazer logout no servidor:', error);
    } finally {
      // Limpar dados locais independentemente do resultado
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('admin_token');
      localStorage.removeItem('admin_user');
      
      setAuthState({
        user: null,
        token: null,
        isLoading: false,
        isAuthenticated: false
      });
    }
  }, [authState.token]);

  // Função para verificar se o usuário tem uma permissão específica
  const hasPermission = useCallback((permission: string): boolean => {
    if (!authState.user) return false;
    
    // Lógica de permissões baseada no tipo de conta
    switch (authState.user.accountType) {
      case 'MANAGERIAL':
        return true; // Gerencial tem todas as permissões
      case 'COMPOSITE':
        return !['DELETE_TENANT', 'MANAGE_USERS'].includes(permission);
      case 'SIMPLE':
        return ['VIEW_DASHBOARD', 'VIEW_CLIENTS', 'CREATE_CLIENT', 'VIEW_PROJECTS'].includes(permission);
      default:
        return false;
    }
  }, [authState.user]);

  // Função para verificar se o tipo de conta permite acesso a um módulo
  const canAccessModule = useCallback((module: string): boolean => {
    if (!authState.user) return false;
    
    const { accountType } = authState.user;
    
    const accountModules = {
      SIMPLE: ['crm', 'clients', 'projects', 'tasks', 'billing', 'basic_settings'],
      COMPOSITE: ['crm', 'clients', 'projects', 'tasks', 'billing', 'cash_flow', 'transactions', 'dashboard', 'basic_settings'],
      MANAGERIAL: ['crm', 'clients', 'projects', 'tasks', 'billing', 'cash_flow', 'transactions', 'dashboard', 'user_management', 'advanced_settings', 'audit_logs']
    };
    
    return accountModules[accountType]?.includes(module) || false;
  }, [authState.user]);

  // Função para verificar se a conta está ativa e não expirou
  const isAccountValid = useCallback((): boolean => {
    if (!authState.user?.tenant) return false;
    
    const { isActive, expiresAt } = authState.user.tenant;
    
    if (!isActive) return false;
    
    if (expiresAt && new Date() > new Date(expiresAt)) {
      return false;
    }
    
    return true;
  }, [authState.user]);

  // Função para obter informações do tipo de conta atual
  const getAccountInfo = useCallback(() => {
    if (!authState.user) return null;
    
    const { accountType } = authState.user;
    
    const accountInfo = {
      SIMPLE: {
        name: 'Conta Simples',
        features: ['CRM', 'Projetos', 'Tarefas', 'Cobrança', 'Configurações Básicas']
      },
      COMPOSITE: {
        name: 'Conta Composta',
        features: ['Tudo da Simples', 'Dashboard Completo', 'Fluxo de Caixa', 'Transações']
      },
      MANAGERIAL: {
        name: 'Conta Gerencial',
        features: ['Tudo da Composta', 'Gestão de Usuários', 'Configurações Avançadas', 'Auditoria']
      }
    };
    
    return accountInfo[accountType];
  }, [authState.user]);

  return {
    // Estado
    user: authState.user,
    token: authState.token,
    isLoading: authState.isLoading,
    isAuthenticated: authState.isAuthenticated,
    
    // Ações
    login,
    adminLogin,
    logout,
    
    // Verificações
    hasPermission,
    canAccessModule,
    isAccountValid,
    getAccountInfo
  };
};

export default useAuth;