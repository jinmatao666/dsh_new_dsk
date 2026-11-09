import { describe, expect, it } from 'vitest'
import { withPortalTicket } from '../src/client/ticket.ts'

describe('withPortalTicket', () => {
  it('embeds ticket on hash-router and fragment URLs', () => {
    expect(withPortalTicket('https://land.example/#/home', 'b'.repeat(64)))
      .toBe(`https://land.example/?ticket=${'b'.repeat(64)}#/home`)
    expect(withPortalTicket('https://land.example/', 'c'.repeat(64)))
      .toBe(`https://land.example/#ticket=${'c'.repeat(64)}`)
  })
})
