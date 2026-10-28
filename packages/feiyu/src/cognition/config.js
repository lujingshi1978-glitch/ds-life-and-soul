import path from 'node:path';

export const DEFAULT_COGNITION_VERSION = 3;
export const MIN_COGNITION_VERSION = 3;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 400;
  throw error;
}

function directory(value, base, name) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    fail('COGNITION_CONFIG_INVALID', `${name} must be a non-empty local directory path`);
  }
  return base ? path.resolve(base, value) : path.resolve(value);
}

/**
 * Normalize the socialV2.mind section without opening stores or migrating data.
 * v2Root keeps its historical name because V3 uses the same database directory.
 */
export function normalizeCognitionConfig(input, { root, stateDir } = {}) {
  const mind = input ?? {};
  if (typeof mind !== 'object' || Array.isArray(mind) || ![Object.prototype, null].includes(Object.getPrototypeOf(mind))) {
    fail('COGNITION_CONFIG_INVALID', 'socialV2.mind must be an object');
  }
  if (mind.enabled !== undefined && typeof mind.enabled !== 'boolean') {
    fail('COGNITION_CONFIG_INVALID', 'socialV2.mind.enabled must be a boolean');
  }

  const previousVersion = mind.version === undefined ? null
    : typeof mind.version === 'number' ? mind.version
    : typeof mind.version === 'string' && /^[1-9]\d*$/.test(mind.version) ? Number(mind.version) : NaN;
  if (previousVersion !== null && (!Number.isSafeInteger(previousVersion) || previousVersion < 1)) {
    fail('COGNITION_CONFIG_INVALID', 'socialV2.mind.version must be a positive integer');
  }
  if (previousVersion !== null && previousVersion > DEFAULT_COGNITION_VERSION) {
    fail('COGNITION_VERSION_UNSUPPORTED', `Cognition version ${previousVersion} is newer than supported version ${DEFAULT_COGNITION_VERSION}`);
  }

  if (root === undefined && stateDir === undefined) {
    fail('COGNITION_ROOT_REQUIRED', 'An explicit project root or state directory is required');
  }
  const projectRoot = root === undefined ? path.dirname(directory(stateDir, undefined, 'stateDir')) : directory(root, undefined, 'root');
  const stateRoot = stateDir === undefined ? path.join(projectRoot, 'state') : directory(stateDir, projectRoot, 'stateDir');
  const config = {
    ...mind,
    enabled: mind.enabled ?? true,
    version: DEFAULT_COGNITION_VERSION,
    v2Root: mind.v2Root === undefined ? path.join(path.dirname(stateRoot), 'cognition-v3') : directory(mind.v2Root, projectRoot, 'v2Root'),
  };
  if (mind.embeddingRuntime !== undefined && mind.embeddingRuntime !== null && mind.embeddingRuntime !== false) {
    config.embeddingRuntime = directory(mind.embeddingRuntime, projectRoot, 'embeddingRuntime');
  }
  return { config, previousVersion, upgradeNeeded: previousVersion === null || previousVersion < MIN_COGNITION_VERSION };
}
