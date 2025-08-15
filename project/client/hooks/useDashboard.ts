import { useState, useEffect, useCallback } from 'react';
import { useAuthenticatedFetch } from '@/contexts/AuthContext';

interface DashboardData {
  totalClients: number;
  activeProjects: number;
  pendingTasks: number;
  totalReceivables: number;
  monthlyBalance: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  transactionCount: number;
  hasFinancialAccess: boolean;
}

interface DashboardMetrics {
  revenue: number;
  expenses: number;
  balance: number;
  clients: number;
}

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authenticatedFetch = useAuthenticatedFetch();

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        console.log('Carregando dados do dashboard...');

        // Buscar dados do dashboard
        const dashboardResponse = await authenticatedFetch('/api/tenant/dashboard');
        
        if (!dashboardResponse.ok) {
          const errorData = await dashboardResponse.json();
          throw new Error(errorData.message || 'Erro ao carregar dados do dashboard');
        }

        const dashboardData = await dashboardResponse.json();
        console.log('Dados do dashboard carregados:', dashboardData);

        setData(dashboardData);
        setMetrics({
          revenue: dashboardData.monthlyIncome || 0,
          expenses: dashboardData.monthlyExpenses || 0,
          balance: dashboardData.monthlyBalance || 0,
          clients: dashboardData.totalClients || 0
        });
      } catch (err: any) {
        console.error('Erro ao carregar dashboard:', err);
        setError(err.message || 'Erro ao carregar dados');
        
        // Dados de fallback em caso de erro
        setData({
          totalClients: 0,
          activeProjects: 0,
          pendingTasks: 0,
          totalReceivables: 0,
          monthlyBalance: 0,
          monthlyIncome: 0,
          monthlyExpenses: 0,
          transactionCount: 0,
          hasFinancialAccess: false
        });
        setMetrics({
          revenue: 0,
          expenses: 0,
          balance: 0,
          clients: 0
        });
      } finally {
        setIsLoading(false);
      }
    };

    fetchDashboardData();
  }, [authenticatedFetch]);

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      setError(null);

      const dashboardResponse = await authenticatedFetch('/api/tenant/dashboard');
      
      if (!dashboardResponse.ok) {
        const errorData = await dashboardResponse.json();
        throw new Error(errorData.message || 'Erro ao carregar dados do dashboard');
      }

      const dashboardData = await dashboardResponse.json();

      setData(dashboardData);
      setMetrics({
        revenue: dashboardData.monthlyIncome || 0,
        expenses: dashboardData.monthlyExpenses || 0,
        balance: dashboardData.monthlyBalance || 0,
        clients: dashboardData.totalClients || 0
      });
    } catch (err: any) {
      console.error('Erro ao recarregar dashboard:', err);
      setError(err.message || 'Erro ao carregar dados');
    } finally {
      setIsLoading(false);
    }
  }, [authenticatedFetch]);

  return {
    data,
    metrics,
    isLoading,
    error,
    refetch
  };
}