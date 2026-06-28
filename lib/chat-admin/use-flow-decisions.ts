import { useState, useEffect, useCallback } from 'react';
import { FlowDecision, FlowDecisionRecord } from '@/types/chat-admin/flow-decision';
import { clearFlowDecisionsCache } from '@/lib/chat-admin/client-cache';
import { logger } from '@/lib/logger'

export function useFlowDecisions(status?: 'suggestion' | 'approved' | 'rejected', customPageSize?: number) {
  const [flowDecisions, setFlowDecisions] = useState<FlowDecisionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Use larger pageSize when no status filter (ALL tab) to avoid pagination cutoff
  const defaultPageSize = status ? 100 : 500;
  const pageSize = customPageSize || defaultPageSize;

  const [pagination, setPagination] = useState({
    page: 1,
    pageSize,
    total: 0,
    totalPages: 0,
    hasMore: false
  });

  const fetchFlowDecisions = useCallback(async (
    page: number = 1,
    pageSize: number = 100,
    append: boolean = false,
    forceClearCache: boolean = false,
    filterStatus?: 'suggestion' | 'approved' | 'rejected'
  ) => {
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }
      setError(null);

      // Clear cache if forced (on initial load)
      if (forceClearCache) {
        logger.info('[useFlowDecisions] Clearing cache before fetch');
        clearFlowDecisionsCache();
      }

      // Use smaller page size for initial load, allow loading more
      // Include status filter if provided (from hook parameter or function parameter)
      const statusToUse = filterStatus || status;
      const statusParam = statusToUse ? `&status=${statusToUse}` : '';
      const url = `/api/flow-decisions?page=${page}&pageSize=${pageSize}${statusParam}`;
      logger.info('[useFlowDecisions] Fetching from:', url, statusToUse ? `(filtered by status: ${statusToUse})` : '(no status filter)');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error('Failed to fetch flow decisions');
      }
      const data = await response.json();
      logger.info('[useFlowDecisions] Received data:', {
        hasItems: !!data.items,
        itemsCount: data.items?.length || 0,
        total: data.total,
        page: data.page
      });

      // Handle both paginated and non-paginated responses for backward compatibility
      if (data.items && Array.isArray(data.items)) {
        if (append) {
          setFlowDecisions(prev => [...prev, ...data.items]);
        } else {
          setFlowDecisions(data.items);
        }

        const hasMore = data.page < data.totalPages;
        setPagination({
          page: data.page || 1,
          pageSize: data.pageSize || pageSize,
          total: data.total || data.items.length,
          totalPages: data.totalPages || 1,
          hasMore
        });
      } else if (Array.isArray(data)) {
        // Legacy format - just an array
        logger.info('[useFlowDecisions] Legacy format, array length:', data.length);
        setFlowDecisions(data);
        setPagination({
          page: 1,
          pageSize: data.length,
          total: data.length,
          totalPages: 1,
          hasMore: false
        });
      } else {
        logger.error('Unexpected response format:', data);
        setFlowDecisions([]);
      }
    } catch (error) {
      logger.error('Error fetching flow decisions:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch flow decisions');
      if (!append) {
        setFlowDecisions([]);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);
  
  const loadMore = useCallback(async () => {
    if (!pagination.hasMore || loadingMore) return;
    await fetchFlowDecisions(pagination.page + 1, pagination.pageSize, true);
  }, [pagination, loadingMore, fetchFlowDecisions]);

  const createFlowDecision = useCallback(async (
    partDescription: string,
    flowDecision: FlowDecision,
    vehicleFilters?: any,
    lambdaTarget?: string
  ) => {
    const response = await fetch('/api/flow-decisions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        partDescription,
        flowDecision,
        vehicleFilters,
        lambdaTarget,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to create flow decision');
    }

    await fetchFlowDecisions();
    return response.json();
  }, [fetchFlowDecisions]);

  const updateFlowDecision = useCallback(async (
    id: string,
    flowDecision: FlowDecision,
    vehicleFilters?: any,
    lambdaTarget?: string,
    partDescription?: string
  ) => {
    const response = await fetch('/api/flow-decisions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        partDescription,
        flowDecision,
        vehicleFilters,
        lambdaTarget,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to update flow decision');
    }

    await fetchFlowDecisions();
    return response.json();
  }, [fetchFlowDecisions]);

  const deleteFlowDecision = useCallback(async (id: string) => {
    const response = await fetch(`/api/flow-decisions/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error('Failed to delete flow decision');
    }

    await fetchFlowDecisions();
  }, [fetchFlowDecisions]);

  const updateFlowDecisionStatus = useCallback(async (
    id: string,
    status: 'approved' | 'rejected' | 'suggestion'
  ) => {
    const response = await fetch(`/api/flow-decisions/${id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      throw new Error('Failed to update flow decision status');
    }

    await fetchFlowDecisions();
  }, [fetchFlowDecisions]);

  useEffect(() => {
    // Clear cache and fetch on initial mount or when status changes
    // Use the computed pageSize (500 for ALL tab, 100 for filtered tabs)
    fetchFlowDecisions(1, pageSize, false, true, status);
  }, [fetchFlowDecisions, status, pageSize]);

  return {
    flowDecisions,
    loading,
    loadingMore,
    error,
    pagination,
    fetchFlowDecisions,
    loadMore,
    createFlowDecision,
    updateFlowDecision,
    deleteFlowDecision,
    updateFlowDecisionStatus,
  };
}