import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'

const cjsRequire = createRequire(import.meta.url)
const childProcess = cjsRequire('node:child_process')
const fs = cjsRequire('node:fs/promises')
const config = cjsRequire('../../../config')
const logger = cjsRequire('../../../utils/logger')
const servicePath = cjsRequire.resolve('../../../services/secretsService')
const originalServiceModule = cjsRequire.cache[servicePath]
const originalSops = { ...config.sops }

const context = {
  correlationId: 'cid-encryption-logging',
  target: 'sand',
  appName: 'testapp',
  environment: 'dev',
  bundleId: 'developer',
  secretValue: 'CONTEXT-MUST-NOT-BE-LOGGED'
}
const secretValue = 'SYNTHETIC-VALUE-MUST-NOT-BE-LOGGED'
const exec = vi.fn<(command: string, args: string[]) => Promise<{ stdout: string }>>()
let encrypt: (value: string, context?: Record<string, unknown>) => Promise<string>

describe('SOPS encryption failure logging', () => {
  beforeEach(() => {
    config.sops.keyVaultUrl = 'https://synthetic.vault.azure.net'
    config.sops.keyVersion = 'synthetic-version'
    exec.mockReset().mockResolvedValue({ stdout: 'encrypted-blob' })
    const execFile = vi.spyOn(childProcess, 'execFile')
    Object.defineProperty(execFile, promisify.custom, { value: exec, configurable: true })
    vi.spyOn(fs, 'mkdtemp').mockResolvedValue('/tmp/self-service-logging-test')
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined)
    vi.spyOn(fs, 'rm').mockResolvedValue(undefined)
    vi.spyOn(logger, 'error').mockImplementation(() => logger)
    vi.spyOn(logger, 'warn').mockImplementation(() => logger)
    delete cjsRequire.cache[servicePath]
    encrypt = cjsRequire(servicePath)._internal.encryptValueWithSops
  })

  afterEach(() => {
    Object.assign(config.sops, originalSops)
    vi.restoreAllMocks()
    if (originalServiceModule) cjsRequire.cache[servicePath] = originalServiceModule
    else delete cjsRequire.cache[servicePath]
  })

  it.each([
    ['ENOENT', 'sops_missing', true],
    ['EACCES', 'sops_not_executable', true],
    ['EPERM', 'sops_not_executable', true],
    ['ETIMEDOUT', 'timeout', true],
    ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'output_limit', true],
    [1, 'process_failed', true],
    ['UNTRUSTED-CODE-MUST-NOT-BE-LOGGED', 'process_failed', false]
  ])('classifies %s without logging subprocess content', async (code, category, safeCode) => {
    const error = Object.assign(new Error(secretValue), {
      code, stdout: secretValue, stderr: secretValue, cmd: secretValue, stack: secretValue
    })
    exec.mockRejectedValue(error)

    await expect(encrypt(secretValue, context)).rejects.toBe(error)

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('secret_encryption_failed', {
      correlation_id: context.correlationId,
      target: 'sand',
      appName: 'testapp',
      environment: 'dev',
      bundleId: 'developer',
      event: 'secret_encryption_failed',
      operation: 'sops_encrypt',
      phase: 'sops_encrypt',
      error_code: 'ENCRYPTION_FAILED',
      failure_category: category,
      ...(safeCode ? { process_code: code } : {}),
      duration_ms: expect.any(Number)
    })
    const serialized = JSON.stringify(vi.mocked(logger.error).mock.calls)
    expect(serialized).not.toContain(secretValue)
    expect(serialized).not.toContain(context.secretValue)
    expect(serialized).not.toContain('UNTRUSTED-CODE-MUST-NOT-BE-LOGGED')
    expect(fs.rm).toHaveBeenCalledWith('/tmp/self-service-logging-test', { recursive: true, force: true })
  })

  it.each(['keyVaultUrl', 'keyVersion'])('logs missing %s without launching SOPS', async setting => {
    config.sops[setting] = ''
    await expect(encrypt(secretValue, context)).rejects.toMatchObject({ code: 'SOPS_NOT_CONFIGURED' })
    expect(exec).not.toHaveBeenCalled()
    expect(logger.error).toHaveBeenCalledWith('secret_encryption_failed', expect.objectContaining({
      correlation_id: context.correlationId,
      phase: 'configuration',
      error_code: 'SOPS_NOT_CONFIGURED',
      failure_category: 'configuration_missing'
    }))
    expect(fs.mkdtemp).not.toHaveBeenCalled()
  })

  it('does not mistake a missing temporary directory for a missing SOPS executable', async () => {
    const error = Object.assign(new Error(secretValue), { code: 'ENOENT' })
    vi.mocked(fs.mkdtemp).mockRejectedValue(error)
    await expect(encrypt(secretValue, context)).rejects.toBe(error)
    expect(logger.error).toHaveBeenCalledWith('secret_encryption_failed', expect.objectContaining({
      phase: 'local_io', failure_category: 'local_io_failed', process_code: 'ENOENT'
    }))
    expect(exec).not.toHaveBeenCalled()
    expect(fs.rm).not.toHaveBeenCalled()
  })

  it('logs input-file failures and still cleans up', async () => {
    const error = Object.assign(new Error(secretValue), { code: 'ENOSPC' })
    vi.mocked(fs.writeFile).mockRejectedValue(error)
    await expect(encrypt(secretValue, context)).rejects.toBe(error)
    expect(logger.error).toHaveBeenCalledWith('secret_encryption_failed', expect.objectContaining({
      phase: 'local_io', failure_category: 'local_io_failed', process_code: 'ENOSPC'
    }))
    expect(exec).not.toHaveBeenCalled()
    expect(fs.rm).toHaveBeenCalledOnce()
  })

  it('preserves successful encryption, restrictive file mode, and cleanup without success-log noise', async () => {
    await expect(encrypt(secretValue, context)).resolves.toBe('encrypted-blob')
    expect(fs.writeFile).toHaveBeenCalledWith(
      '/tmp/self-service-logging-test/value.json', JSON.stringify({ value: secretValue }), { mode: 0o600 }
    )
    expect(exec).toHaveBeenCalledWith('sops', expect.arrayContaining(['--encrypt', '--azure-kv']))
    expect(fs.rm).toHaveBeenCalledOnce()
    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('reports cleanup failure without masking the encryption error or logging raw errors', async () => {
    const error = Object.assign(new Error(secretValue), { code: 1 })
    exec.mockRejectedValue(error)
    vi.mocked(fs.rm).mockRejectedValue(new Error(secretValue))
    await expect(encrypt(secretValue, context)).rejects.toBe(error)
    expect(logger.warn).toHaveBeenCalledWith('secret_encryption_cleanup_failed', expect.objectContaining({
      event: 'secret_encryption_cleanup_failed', correlation_id: context.correlationId
    }))
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(secretValue)
  })
})

it('logMetric honors failure severity and keeps the structured correlation ID', () => {
  const log = vi.spyOn(logger, 'log').mockReturnValue(logger)
  try {
    logger.logMetric('secret_create_submitted', {
      level: 'error', correlationId: context.correlationId, outcome: 'error'
    })
    expect(log).toHaveBeenCalledExactlyOnceWith('error', 'secret_create_submitted', {
      event: 'secret_create_submitted', correlation_id: context.correlationId, outcome: 'error'
    })
    log.mockClear()
    logger.logMetric('secret_create_submitted', { correlationId: context.correlationId, outcome: 'success' })
    expect(log).toHaveBeenCalledWith('info', 'secret_create_submitted', expect.objectContaining({ outcome: 'success' }))
  } finally {
    log.mockRestore()
  }
})
