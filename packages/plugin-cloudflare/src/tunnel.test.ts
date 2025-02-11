import {hookStart} from './tunnel.js'
import {describe, vi, expect, test} from 'vitest'
import {exec} from '@shopify/cli-kit/node/system'
import {Writable} from 'stream'

const port = 1234
vi.mock('@shopify/cli-kit/node/system')

describe('hookStart', () => {
  test('returns a url if cloudflare prints a URL and a connection is established', async () => {
    // Given
    vi.mocked(exec).mockImplementationOnce(async (command, args, options) => {
      const writable = options?.stdout as Writable
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF |  https://example.trycloudflare.com`))
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF Connection registered`))
    })

    // When
    const tunnelClient = await hookStart(port)
    const result = tunnelClient.valueOrAbort().getTunnelStatus()

    // Then
    expect(result).toEqual({url: 'https://example.trycloudflare.com', status: 'connected'})
  })

  test('returns a url if cloudflare prints a URL and a connection is established with a different message', async () => {
    // Given
    vi.mocked(exec).mockImplementationOnce(async (command, args, options) => {
      const writable = options?.stdout as Writable
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF |  https://example.trycloudflare.com`))
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF Registered tunnel connection`))
    })

    // When
    const tunnelClient = await hookStart(port)
    const result = tunnelClient.valueOrAbort().getTunnelStatus()

    // Then
    expect(result).toEqual({url: 'https://example.trycloudflare.com', status: 'connected'})
  })

  test('throws if a connection is stablished but we didnt find a URL', async () => {
    // Given
    vi.mocked(exec).mockImplementationOnce(async (command, args, options) => {
      const writable = options?.stdout as Writable
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF |  https://bad_url.com`))
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF Connection registered`))
    })

    // When
    const tunnelClient = await hookStart(port)
    const result = tunnelClient.valueOrAbort().getTunnelStatus()

    // Then
    expect(result).toEqual({status: 'error', message: 'Could not find tunnel url'})
  })

  test('returns starting status if a URL is detected but there is no connection yet', async () => {
    // Given
    vi.mocked(exec).mockImplementationOnce(async (command, args, options) => {
      const writable = options?.stdout as Writable
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF |  https://example.trycloudflare.com`))
    })

    // When
    const tunnelClient = await hookStart(port)
    const result = tunnelClient.valueOrAbort().getTunnelStatus()

    // Then
    expect(result).toEqual({status: 'starting'})
  })

  test('if the process crashes, it retries again', async () => {
    // Given
    vi.mocked(exec).mockImplementationOnce(async (command, args, options) => {
      await options?.externalErrorHandler?.(new Error('Process crashed'))
    })

    vi.mocked(exec).mockImplementationOnce(async (command, args, options) => {
      const writable = options?.stdout as Writable
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF |  https://example.trycloudflare.com`))
      writable.write(Buffer.from(`2023-01-30T15:37:11Z INF Connection registered`))
    })

    // When
    const tunnelClient = await hookStart(port)
    const result = tunnelClient.valueOrAbort().getTunnelStatus()

    // Then
    expect(exec).toBeCalledTimes(2)
    expect(result).toEqual({url: 'https://example.trycloudflare.com', status: 'connected'})
  })

  test('if the process crashes many times, stops retrying', async () => {
    // Given
    vi.mocked(exec).mockImplementation(async (command, args, options) => {
      await options?.externalErrorHandler?.(new Error('Process crashed'))
    })

    // When
    const tunnelClient = (await hookStart(port)).valueOrAbort()
    const result = tunnelClient.getTunnelStatus()

    // Then
    expect(exec).toBeCalledTimes(5)
    expect(result).toEqual({
      status: 'error',
      message: 'Could not start Cloudflare tunnel, max retries reached.',
      tryMessage: expect.anything(),
    })
  })
})
