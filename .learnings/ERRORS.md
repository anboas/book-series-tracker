## [ERR-20260901-001] verify-site snapshot expectations

**Logged**: 2026-09-01T20:48:00-04:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary
The verifier expectation for the primary lens bar assumed `Next up` equals the current missing-heavy series count.

### Error
```text
AssertionError [ERR_ASSERTION]: primary lens bar should summarize core reading modes
actual: 'All\n201\nOwned audio\n175\nUnread\n26\nNext up\n5'
expected: /All[\s\S]*201[\s\S]*Owned audio[\s\S]*175[\s\S]*Unread[\s\S]*26[\s\S]*Next up[\s\S]*4/i
```

### Context
- Command attempted: `npm run verify`
- Data change: Defiance of the Fall books 9-14 moved from `unowned` to `owned` on `audiobookshelf`.
- `Next up` is based on attention candidates, not only missing-heavy state counts.

### Suggested Fix
When updating snapshot counts, derive each UI expectation from the UI's actual selector semantics instead of mapping one summary count onto another.

### Metadata
- Reproducible: yes
- Related Files: scripts/verify-site.mjs

### Resolution
- **Resolved**: 2026-09-01T20:48:00-04:00
- **Notes**: Corrected the `Next up` expectation to remain at 5 while missing-heavy series falls to 4.

---
