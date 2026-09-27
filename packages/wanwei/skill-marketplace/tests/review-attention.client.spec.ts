import { describe, expect, it } from 'vitest'
import { clearSeenReviews, observeReviews } from '../src/client/review-attention.ts'

describe('personal skill review attention', () => {
  it('does not notify on first observation, then tracks changed review results', () => {
    const pending = [{ id: 7, owner: 'alice', version: '1', review_status: 'pending', submitted_at: 't1' }]
    const baseline = observeReviews(null, pending)
    expect(baseline.unread).toEqual({})
    const approved = observeReviews(baseline, [{ ...pending[0], review_status: 'approved', reviewed_at: 't2' }])
    expect(Object.values(approved.unread)).toEqual(['approved'])
    expect(clearSeenReviews(approved, 'approved').unread).toEqual({})
    const anotherVersion = observeReviews(clearSeenReviews(approved, 'approved'), [{
      ...pending[0], version: '2', review_status: 'rejected', reviewed_at: 't3',
    }])
    expect(Object.values(anotherVersion.unread)).toEqual(['rejected'])
  })
})
