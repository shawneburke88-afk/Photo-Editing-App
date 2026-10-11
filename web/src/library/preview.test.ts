import { describe, expect, it, vi } from 'vitest'
import { BitmapCache } from './preview'

const fake = () => ({ bmp: { close: vi.fn() } as unknown as ImageBitmap })

describe('BitmapCache', () => {
  it('shares one load between concurrent requests', async () => {
    const load = vi.fn(async () => fake())
    const cache = new BitmapCache(2, load)
    const [a, b] = await Promise.all([cache.get(1), cache.get(1)])
    expect(a).toBe(b)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('closes the least recently used bitmap when full', async () => {
    const cache = new BitmapCache(2, async () => fake())
    const one = await cache.get(1)
    await cache.get(2)
    cache.peek(1) // 1 is now the most recent
    await cache.get(3)
    expect(one.bmp.close).not.toHaveBeenCalled()
    expect(cache.peek(2)).toBeUndefined()
    expect(cache.peek(1)).toBe(one)
  })

  it('closes everything on dispose and can be opened again', async () => {
    const cache = new BitmapCache(2, async () => fake())
    const one = await cache.get(1)
    cache.dispose()
    expect(one.bmp.close).toHaveBeenCalled()
    await expect(cache.get(2)).rejects.toThrow('cancelled')
    cache.open()
    await expect(cache.get(2)).resolves.toBeTruthy()
  })
})
