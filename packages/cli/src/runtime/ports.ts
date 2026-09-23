import net from 'node:net';

/**
 * Loopback-only port selection for the Seevee dashboard server.
 *
 * Per `.dev/specs/CLI_INSTALLER.md` §11:
 *   1. explicit `--port`
 *   2. healthy persisted runtime for same workspace
 *   3. configured preferred port
 *   4. first available loopback port from a defined range
 *
 * Never bind to `0.0.0.0` unless the user explicitly opts in (handled at the
 * command boundary, not here).
 */

export const DEFAULT_PREFERRED_PORT = 43127;
export const PORT_SEARCH_RANGE_START = 43127;
export const PORT_SEARCH_RANGE_END = 43227;

export class PortUnavailableError extends Error {
  public override readonly name = 'PortUnavailableError';
  constructor(message: string) {
    super(message);
  }
}

function tryListen(host: string, port: number): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = net.createServer();
  server.once('error', (err) => {
    server.removeAllListeners();
    reject(err);
  });
  server.once('listening', () => {
    const address = server.address();
    server.removeAllListeners();
    server.close(() => {
      if (address && typeof address === 'object') {
        resolve(address.port);
      } else {
        reject(new Error(`server bound to non-port address: ${String(address)}`));
      }
    });
  });
  server.listen(port, host);
  return promise;
}

/**
 * Verify a specific port is free on the given loopback host.
 */
export async function isPortAvailable(host: string, port: number): Promise<boolean> {
  try {
    await tryListen(host, port);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find an available loopback port. Honours `preferred` first, then scans the
 * configured range. Rejects with `PortUnavailableError` when no port works.
 *
 * `host` must be a loopback address. Non-loopback callers should run their own
 * security check before invoking this helper.
 */
export async function findAvailablePort(
  host: string,
  preferred: number = DEFAULT_PREFERRED_PORT,
  rangeStart: number = PORT_SEARCH_RANGE_START,
  rangeEnd: number = PORT_SEARCH_RANGE_END,
): Promise<number> {
  if (!Number.isInteger(preferred) || preferred < 1 || preferred > 65535) {
    throw new PortUnavailableError(`preferred port out of range: ${preferred}`);
  }
  if (preferred >= rangeStart && preferred <= rangeEnd) {
    if (await isPortAvailable(host, preferred)) {
      return preferred;
    }
  }
  for (let port = rangeStart; port <= rangeEnd; port += 1) {
    if (port === preferred) {
      continue;
    }
    if (await isPortAvailable(host, port)) {
      return port;
    }
  }
  throw new PortUnavailableError(
    `no available loopback port on ${host} in [${rangeStart}, ${rangeEnd}]`,
  );
}
