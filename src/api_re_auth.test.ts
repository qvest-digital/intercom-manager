import fastifyCookie from '@fastify/cookie';
import fastify, { FastifyInstance } from 'fastify';

const ORIGINAL_OSC_ACCESS_TOKEN = process.env.OSC_ACCESS_TOKEN;

// The route reads OSC_ACCESS_TOKEN at module load, so every case needs an
// isolated module registry to pick up the env it wants to exercise. Registering
// only this plugin keeps the cases off the full api() bootstrap.
const buildServer = async (
  oscAccessToken: string | undefined
): Promise<FastifyInstance> => {
  jest.resetModules();
  if (oscAccessToken === undefined) {
    delete process.env.OSC_ACCESS_TOKEN;
  } else {
    process.env.OSC_ACCESS_TOKEN = oscAccessToken;
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const apiReAuth = require('./api_re_auth').default;
  const server = fastify();
  server.register(fastifyCookie);
  server.register(apiReAuth, { prefix: '/api/v1' });
  await server.ready();
  return server;
};

describe('reAuth api', () => {
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  afterAll(() => {
    process.env.OSC_ACCESS_TOKEN = ORIGINAL_OSC_ACCESS_TOKEN;
  });

  test('rejects with 405 and a readable message when no OSC token is configured', async () => {
    const server = await buildServer(undefined);

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth'
    });

    expect(response.statusCode).toBe(405);
    // The reply has to match the declared ErrorResponse schema. Sending any
    // other property makes the serializer throw and replaces the body with
    // '"message" is required!', hiding the actual reason from the client.
    expect(response.json()).toEqual({
      message: 'No OSC_ACCESS_TOKEN set, method not allowed'
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    await server.close();
  });

  test('returns the token and sets the SAT cookie on success', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ token: 'sat-token' })
    } as Response);
    const server = await buildServer('pat-token');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth'
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ token: 'sat-token' });
    expect(response.headers['set-cookie']).toContain(
      'eyevinn-intercom-manager.sat=Bearer%20sat-token'
    );
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await server.close();
  });

  test('retries then fails with 500 and a readable message', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable'
    } as Response);
    const server = await buildServer('pat-token');

    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/reauth'
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      message:
        'ServiceToken Service failed to generate new SAT Token after 3 attempts'
    });
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    await server.close();
  }, 10000);
});
