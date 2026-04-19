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
    }) => {
      const token = await getToken();
      const formData = new FormData();
      formData.append('binary', data.binary);
      formData.append('projectId', data.projectId);
      formData.append('commitSha', data.commitSha);
      formData.append('branch', data.branch);
      formData.append('buildType', data.buildType);
      formData.append('binaryName', data.binary.name);

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
