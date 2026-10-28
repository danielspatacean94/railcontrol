import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { RailwayServiceInstance, RailwayServiceState } from './railway.types';

interface GraphqlError {
  message: string;
  extensions?: { code?: string; traceId?: string };
}

interface GraphqlResponse<T> {
  data?: T;
  errors?: GraphqlError[];
}

const RUNNING_STATUSES = new Set([
  'ACTIVE',
  'SUCCESS',
  'DEPLOYING',
  'INITIALIZING',
  'BUILDING',
]);
const STOPPABLE_STATUSES = new Set([
  'ACTIVE',
  'SUCCESS',
  'CRASHED',
  'SLEEPING',
]);
const STARTING_STATUSES = new Set(['DEPLOYING', 'INITIALIZING', 'BUILDING']);
type Operation = 'start' | 'stop';

@Injectable()
export class RailwayService {
  private readonly logger = new Logger(RailwayService.name);
  private readonly endpoint: string;
  private activeOperation: {
    type: Operation;
    promise: Promise<RailwayServiceState>;
  } | null = null;

  constructor(private readonly config: ConfigService) {
    this.endpoint =
      this.config.get<string>('RAILWAY_API_URL') ??
      'https://backboard.railway.com/graphql/v2';
  }

  async getState(): Promise<RailwayServiceState> {
    const { serviceId, environmentId } = this.getCredentials();
    const query = `
      query ServiceInstance($serviceId: String!, $environmentId: String!) {
        serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
          id
          serviceName
          latestDeployment { id status createdAt }
        }
      }
    `;
    const data = await this.request<{
      serviceInstance: RailwayServiceInstance;
    }>(query, {
      serviceId,
      environmentId,
    });
    const state = this.toState(data.serviceInstance);
    this.logger.debug(
      `Service ${serviceId} status is ${state.status}${state.deploymentId ? ` (deployment ${state.deploymentId})` : ''}`,
    );
    return state;
  }

  start(): Promise<RailwayServiceState> {
    return this.runExclusive('start', () => this.performStart());
  }

  stop(): Promise<RailwayServiceState> {
    return this.runExclusive('stop', () => this.performStop());
  }

  private async performStart(): Promise<RailwayServiceState> {
    const current = await this.getState();
    const { serviceId, environmentId } = this.getCredentials();
    if (current.isRunning) {
      this.logger.warn(
        `Start rejected for service ${serviceId}; current status is ${current.status}`,
      );
      throw new ConflictException(
        STARTING_STATUSES.has(current.status)
          ? 'The service is already starting'
          : 'The service is already running',
      );
    }

    this.logger.log(
      `Starting service ${serviceId} in environment ${environmentId}`,
    );
    const mutation = `
      mutation StartService($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }
    `;
    const result = await this.request<{ serviceInstanceDeployV2: string }>(
      mutation,
      {
        serviceId,
        environmentId,
      },
    );
    this.logger.log(
      `Start accepted for service ${serviceId}; deployment ${result.serviceInstanceDeployV2}`,
    );
    return this.getState();
  }

  private async performStop(): Promise<RailwayServiceState> {
    const current = await this.getState();
    const { serviceId } = this.getCredentials();
    if (!current.deploymentId || !current.canStop) {
      this.logger.warn(
        `Stop rejected for service ${serviceId}; current status is ${current.status}`,
      );
      throw new ConflictException('The service is already stopped');
    }

    this.logger.log(
      `Stopping service ${serviceId}; deployment ${current.deploymentId}`,
    );
    const mutation = `
      mutation StopDeployment($deploymentId: String!) {
        deploymentRemove(id: $deploymentId)
      }
    `;
    await this.request<{ deploymentRemove: boolean }>(mutation, {
      deploymentId: current.deploymentId,
    });
    this.logger.log(
      `Stop accepted for service ${serviceId}; deployment ${current.deploymentId}`,
    );
    return this.getState();
  }

  private getCredentials() {
    const apiToken = this.config.get<string>('RAILWAY_API_TOKEN');
    const projectToken = this.config.get<string>('RAILWAY_TOKEN');
    const serviceId = this.config.get<string>('TARGET_RAILWAY_SERVICE_ID');
    const environmentId = this.config.get<string>(
      'TARGET_RAILWAY_ENVIRONMENT_ID',
    );
    if (apiToken && projectToken) {
      throw new ServiceUnavailableException(
        'Configure only one Railway token: RAILWAY_API_TOKEN or RAILWAY_TOKEN',
      );
    }

    const missing = [
      !apiToken && !projectToken && 'RAILWAY_API_TOKEN or RAILWAY_TOKEN',
      !serviceId && 'TARGET_RAILWAY_SERVICE_ID',
      !environmentId && 'TARGET_RAILWAY_ENVIRONMENT_ID',
    ].filter(Boolean);

    if (missing.length) {
      throw new ServiceUnavailableException(
        `Railway integration is not configured. Missing: ${missing.join(', ')}`,
      );
    }
    const authHeaders = apiToken
      ? { Authorization: `Bearer ${apiToken}` }
      : { 'Project-Access-Token': projectToken! };

    return {
      authHeaders,
      serviceId: serviceId!,
      environmentId: environmentId!,
    };
  }

  private runExclusive(
    type: Operation,
    operation: () => Promise<RailwayServiceState>,
  ): Promise<RailwayServiceState> {
    if (this.activeOperation) {
      if (this.activeOperation.type === type) {
        this.logger.debug(
          `Coalescing concurrent ${type} request with the active operation`,
        );
        return this.activeOperation.promise;
      }
      this.logger.warn(
        `Rejecting ${type} request while ${this.activeOperation.type} is in progress`,
      );
      throw new ConflictException(
        `Cannot ${type} the service while a ${this.activeOperation.type} operation is in progress`,
      );
    }

    const promise = operation().finally(() => {
      if (this.activeOperation?.promise === promise) {
        this.activeOperation = null;
      }
    });
    this.activeOperation = { type, promise };
    return promise;
  }

  private async request<T>(
    query: string,
    variables: Record<string, string>,
  ): Promise<T> {
    const { authHeaders } = this.getCredentials();
    try {
      const response = await axios.post<GraphqlResponse<T>>(
        this.endpoint,
        { query, variables },
        {
          headers: {
            ...authHeaders,
            'Content-Type': 'application/json',
          },
          timeout: 15_000,
        },
      );

      if (response.data.errors?.length) {
        const error = response.data.errors[0];
        const trace = error.extensions?.traceId
          ? ` (trace ${error.extensions.traceId})`
          : '';
        this.logger.error(
          `Railway GraphQL error${error.extensions?.code ? ` [${error.extensions.code}]` : ''}: ${error.message}${trace}`,
        );
        if (error.message === 'Not Authorized') {
          throw new BadGatewayException(
            `Railway rejected the configured token. Verify its type and access to the target environment${trace}`,
          );
        }
        throw new BadGatewayException(`Railway API: ${error.message}${trace}`);
      }
      if (!response.data.data) {
        throw new BadGatewayException('Railway API returned no data');
      }
      return response.data.data;
    } catch (error: unknown) {
      if (error instanceof BadGatewayException) throw error;
      if (error instanceof AxiosError) {
        const status = error.response?.status;
        this.logger.error(
          `Railway HTTP request failed${status ? ` with status ${status}` : ''}: ${error.message}`,
        );
        throw new BadGatewayException(
          status === 429
            ? 'Railway API rate limit reached. Please try again shortly.'
            : `Unable to reach Railway API${status ? ` (HTTP ${status})` : ''}`,
        );
      }
      throw error;
    }
  }

  private toState(instance: RailwayServiceInstance): RailwayServiceState {
    const deployment = instance.latestDeployment;
    const status = deployment?.status?.toUpperCase() ?? 'STOPPED';
    const stopped = [
      'REMOVED',
      'FAILED',
      'COMPLETED',
      'STOPPED',
      'SLEEPING',
    ].includes(status);
    return {
      serviceName: instance.serviceName,
      status,
      deploymentId: deployment?.id ?? null,
      deployedAt: deployment?.createdAt ?? null,
      isRunning: RUNNING_STATUSES.has(status),
      canStart: stopped || status === 'CRASHED',
      canStop: STOPPABLE_STATUSES.has(status),
    };
  }
}
