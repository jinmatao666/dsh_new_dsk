import { describe, expect, it } from 'vitest'
import { productText } from '../src/client/locales/product.ts'

describe('product copy', () => {
  it('preserves existing labels and spacing', () => {
    expect(productText('关闭提示')).toBe('关闭提示')
    expect(productText(' 页')).toBe(' 页')
  })
})
