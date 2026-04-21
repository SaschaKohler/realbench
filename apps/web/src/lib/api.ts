import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/clerk-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

async function fetchWithAuth(url: string, token: string | null, options?: RequestInit) {
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options?.headers,
  };

  const response = await fetch(`${API_URL}${url}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  return response.json();
}

export function useProjects() {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth('/api/v1/projects', token);
    },
  });
}

export function useCreateProject() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { name: string; language: string }) => {
      const token = await getToken();
      return fetchWithAuth('/api/v1/projects', token, {
        method: 'POST',
        body: JSON.stringify(data),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useProject(projectId: string) {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['projects', projectId],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth(`/api/v1/projects/${projectId}`, token);
    },
    enabled: !!projectId,
  });
}

export function useUpdateProject() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ projectId, name }: { projectId: string; name: string }) => {
      const token = await getToken();
      return fetchWithAuth(`/api/v1/projects/${projectId}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId] });
    },
  });
}

export function useDeleteProject() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const token = await getToken();
      return fetchWithAuth(`/api/v1/projects/${projectId}`, token, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export function useProjectRuns(projectId: string) {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['projects', projectId, 'runs'],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth(`/api/v1/projects/${projectId}/runs`, token);
    },
    enabled: !!projectId,
    refetchInterval: (query) => {
      const runs: any[] = query.state.data?.runs ?? [];
      const hasActive = runs.some((r) => r.status === 'pending' || r.status === 'processing');
      return hasActive ? 3000 : false;
    },
  });
}

export function useRun(runId: string) {
  const { getToken } = useAuth();

  return useQuery({
    queryKey: ['runs', runId],
    queryFn: async () => {
      const token = await getToken();
      return fetchWithAuth(`/api/v1/runs/${runId}`, token);
    },
    enabled: !!runId,
    refetchInterval: (query) => {
      const status = query.state.data?.run?.status;
      return status === 'pending' || status === 'processing' ? 3000 : false;
    },
  });
}

export function useDeleteRun() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (runId: string) => {
      const token = await getToken();
      return fetchWithAuth(`/api/v1/runs/${runId}`, token, {
        method: 'DELETE',
      });
    },
    onSuccess: () => {
      // Invalidate all project runs queries
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

export interface ProfilingOptionsInput {
  mode?: 'sampling' | 'stat';
  statDetailed?: boolean;
  hwCounters?: {
    cycles?: boolean;
    instructions?: boolean;
    cacheReferences?: boolean;
    cacheMisses?: boolean;
    branchInstructions?: boolean;
    branchMisses?: boolean;
    stalledCyclesFrontend?: boolean;
    stalledCyclesBackend?: boolean;
    contextSwitches?: boolean;
    cpuMigrations?: boolean;
    pageFaults?: boolean;
    l1DcacheLoads?: boolean;
    l1DcacheLoadMisses?: boolean;
    l1DcacheStores?: boolean;
    l1DcacheStoreMisses?: boolean;
    l1IcacheLoads?: boolean;
    l1IcacheLoadMisses?: boolean;
    llcLoads?: boolean;
    llcLoadMisses?: boolean;
    llcStores?: boolean;
    llcStoreMisses?: boolean;
    dtlbLoads?: boolean;
    dtlbLoadMisses?: boolean;
    dtlbStores?: boolean;
    dtlbStoreMisses?: boolean;
    itlbLoads?: boolean;
    itlbLoadMisses?: boolean;
    custom?: string[];
  };
  traceContextSwitches?: boolean;
  durationSeconds?: number;
  frequencyHz?: number;
  includeKernel?: boolean;
}

export function useProfileBinary() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      projectId: string;
      commitSha: string;
      branch: string;
      buildType: string;
      binary: File;
      profilingOptions?: ProfilingOptionsInput;
    }) => {
      const token = await getToken();
      const formData = new FormData();
      formData.append('binary', data.binary);
      formData.append('projectId', data.projectId);
      formData.append('commitSha', data.commitSha);
      formData.append('branch', data.branch);
      formData.append('buildType', data.buildType);
      formData.append('binaryName', data.binary.name);
      
      // P0/P1/P1b: Add profiling options if provided
      if (data.profilingOptions) {
        formData.append('profilingOptions', JSON.stringify(data.profilingOptions));
      }

      return fetch(`${API_URL}/api/v1/profile`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      }).then((res) => {
        if (!res.ok) throw new Error('Upload failed');
        return res.json();
      });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects', variables.projectId, 'runs'] });
    },
  });
}
