import { ConfigService } from '@nestjs/config';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import axios from 'axios';
import { RailwayService } from './railway.service';

const activeInstance = {
  id: 'instance-id',
  serviceName: 'worker',
  latestDeployment: {
    id: 'deployment-id',
    status: 'ACTIVE',
    createdAt: '2026-10-28T10:00:00.000Z',
  },
};

const stoppedInstance = {
  ...activeInstance,
  latestDeployment: {
    ...activeInstance.latestDeployment,
    status: 'REMOVED',
  },
};

const sleepingInstance = {
  ...activeInstance,
  latestDeployment: {
    ...activeInstance.latestDeployment,
    status: 'SLEEPING',
  },
};

const successfulInstance = {
  ...activeInstance,
  latestDeployment: {
    ...activeInstance.latestDeployment,
    status: 'SUCCESS',
  },
};

const deployingInstance = {
  ...activeInstance,
  latestDeployment: {
    ...activeInstance.latestDeployment,
    status: 'DEPLOYING',
  },
};

describe('RailwayService', () => {
  let service: RailwayService;
  let post: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    service = new RailwayService(
      new ConfigService({
        RAILWAY_TOKEN: 'test-token',
        TARGET_RAILWAY_SERVICE_ID: 'service-id',
        TARGET_RAILWAY_ENVIRONMENT_ID: 'environment-id',
      }),
    );
    post = jest.spyOn(axios, 'post');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps an active deployment to a running service', async () => {
    post.mockResolvedValue({
      data: { data: { serviceInstance: activeInstance } },
    });

    await expect(service.getState()).resolves.toMatchObject({
      serviceName: 'worker',
      status: 'ACTIVE',
      isRunning: true,
      canStart: false,
      canStop: true,
    });
  });

  it('allows a sleeping serverless function to be started or removed', async () => {
    post.mockResolvedValue({
      data: { data: { serviceInstance: sleepingInstance } },
    });

    await expect(service.getState()).resolves.toMatchObject({
      status: 'SLEEPING',
      isRunning: false,
      canStart: true,
      canStop: true,
    });
  });

  it('maps Railway SUCCESS to a running, stoppable container', async () => {
    post.mockResolvedValue({
      data: { data: { serviceInstance: successfulInstance } },
    });

    await expect(service.getState()).resolves.toMatchObject({
      status: 'SUCCESS',
      isRunning: true,
      canStart: false,
      canStop: true,
    });
  });

  it('does not expose Stop while a deployment is starting', async () => {
    post.mockResolvedValue({
      data: { data: { serviceInstance: deployingInstance } },
    });

    await expect(service.getState()).resolves.toMatchObject({
      status: 'DEPLOYING',
      isRunning: true,
      canStart: false,
      canStop: false,
    });
  });

  it('starts a stopped service with serviceInstanceDeployV2', async () => {
    post
      .mockResolvedValueOnce({
        data: { data: { serviceInstance: stoppedInstance } },
      })
      .mockResolvedValueOnce({
        data: { data: { serviceInstanceDeployV2: 'new-deployment-id' } },
      })
      .mockResolvedValueOnce({
        data: { data: { serviceInstance: activeInstance } },
      });

    const result = await service.start();

    expect(post.mock.calls[1][1].query).toContain('serviceInstanceDeployV2');
    expect(result.isRunning).toBe(true);
  });

  it('stops the current deployment with deploymentRemove', async () => {
    post
      .mockResolvedValueOnce({
        data: { data: { serviceInstance: activeInstance } },
      })
      .mockResolvedValueOnce({ data: { data: { deploymentRemove: true } } })
      .mockResolvedValueOnce({
        data: { data: { serviceInstance: stoppedInstance } },
      });

    const result = await service.stop();

    expect(post.mock.calls[1][1].query).toContain('deploymentRemove');
    expect(post.mock.calls[1][1].variables).toEqual({
      deploymentId: 'deployment-id',
    });
    expect(result.canStart).toBe(true);
  });

  it('coalesces concurrent start requests into one Railway mutation', async () => {
    post
      .mockResolvedValueOnce({
        data: { data: { serviceInstance: stoppedInstance } },
      })
      .mockResolvedValueOnce({
        data: { data: { serviceInstanceDeployV2: 'new-deployment-id' } },
      })
      .mockResolvedValueOnce({
        data: { data: { serviceInstance: activeInstance } },
      });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => service.start()),
    );

    expect(post).toHaveBeenCalledTimes(3);
    expect(post.mock.calls[1][1].query).toContain('serviceInstanceDeployV2');
    expect(results.every((result) => result.status === 'ACTIVE')).toBe(true);
  });

  it('surfaces GraphQL errors returned with HTTP 200', async () => {
    post.mockResolvedValue({
      data: {
        errors: [
          { message: 'Forbidden', extensions: { traceId: 'trace-123' } },
        ],
      },
    });

    await expect(service.getState()).rejects.toThrow(
      'Railway API: Forbidden (trace trace-123)',
    );
  });

  it('uses Project-Access-Token for a Railway project token', async () => {
    post.mockResolvedValue({
      data: { data: { serviceInstance: activeInstance } },
    });

    await service.getState();

    expect(post.mock.calls[0][2].headers).toMatchObject({
      'Project-Access-Token': 'test-token',
    });
    expect(post.mock.calls[0][2].headers).not.toHaveProperty('Authorization');
  });

  it('uses a Bearer header for an account or workspace token', async () => {
    service = new RailwayService(
      new ConfigService({
        RAILWAY_API_TOKEN: 'api-token',
        TARGET_RAILWAY_SERVICE_ID: 'service-id',
        TARGET_RAILWAY_ENVIRONMENT_ID: 'environment-id',
      }),
    );
    post.mockResolvedValue({
      data: { data: { serviceInstance: activeInstance } },
    });

    await service.getState();

    expect(post.mock.calls[0][2].headers).toMatchObject({
      Authorization: 'Bearer api-token',
    });
    expect(post.mock.calls[0][2].headers).not.toHaveProperty(
      'Project-Access-Token',
    );
  });
});
