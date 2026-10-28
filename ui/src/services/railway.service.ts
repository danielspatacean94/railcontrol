import { apiClient } from './api';

export interface RailwayServiceState {
  serviceName: string;
  status: string;
  deploymentId: string | null;
  deployedAt: string | null;
  isRunning: boolean;
  canStart: boolean;
  canStop: boolean;
}

export const railwayService = {
  status: () => apiClient.get<RailwayServiceState>('/railway/status'),
  start: () => apiClient.post<RailwayServiceState>('/railway/start'),
  stop: () => apiClient.post<RailwayServiceState>('/railway/stop'),
};
