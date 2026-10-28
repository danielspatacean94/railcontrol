export interface RailwayDeployment {
  id: string;
  status: string;
  createdAt: string;
}

export interface RailwayServiceInstance {
  id: string;
  serviceName: string;
  latestDeployment: RailwayDeployment | null;
}

export interface RailwayServiceState {
  serviceName: string;
  status: string;
  deploymentId: string | null;
  deployedAt: string | null;
  isRunning: boolean;
  canStart: boolean;
  canStop: boolean;
}
