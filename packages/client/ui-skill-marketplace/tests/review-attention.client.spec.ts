import { describe, expect, it } from 'vitest'
import { clearSeenReviews, observeReviews } from '../src/client/review-attention.ts'

const pending = { id: 12, owner: 'test1', name: 'sample', version: '1.0', review_status: 'pending', submitted_at: '2026-09-20' }
const approved = { ...pending, review_status: 'approved', reviewed_at: '2026-09-21' }
const rejected = { ...pending, review_status: 'rejected', reviewed_at: '2026-09-22' }

describe('review attention', () => {
  it('treats the first successful list as already known', () => {
    expect(observeReviews(null, [approved]).unread).toEqual({})
  })

  it('alerts for completed transitions but not pending submissions', () => {
    const initial = observeReviews(null, [pending])
    expect(observeReviews(initial, [pending]).unread).toEqual({})
    const completed = observeReviews(initial, [approved])
    expect(Object.values(completed.unread)).toEqual(['approved'])
    expect(observeReviews(completed, [approved]).unread).toEqual(completed.unread)
  })

  it('clears only the category viewed and alerts for a later result change', () => {
    const baseline = observeReviews(null, [pending, { ...pending, id: 13 }])
    const both = observeReviews(baseline, [approved, { ...rejected, id: 13 }])
    expect(Object.values(both.unread).sort()).toEqual(['approved', 'rejected'])
    const afterApproved = clearSeenReviews(both, 'approved')
    expect(Object.values(afterApproved.unread)).toEqual(['rejected'])
    const resubmitted = observeReviews(afterApproved, [pending, { ...rejected, id: 13 }])
    expect(Object.values(resubmitted.unread)).toEqual(['rejected'])
    const nextApproval = observeReviews(resubmitted, [{ ...approved, version: '2.0' }, { ...rejected, id: 13 }])
    expect(Object.values(nextApproval.unread).sort()).toEqual(['approved', 'rejected'])
  })
})
