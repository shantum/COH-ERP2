# Cleanup Skill

Lightweight code hygiene and knowledge preservation after development sessions.

## When to Run

| Session Type | Trigger |
|--------------|---------|
| Feature work | After 3+ features |
| Bug fixes | After 3+ fixes |
| Refactoring | After major refactor |
| Long session | Before ending (>1hr work) |

## Quick Cleanup Checklist

### Code (2 min)
```bash
# Check modified files for issues
git diff --name-only HEAD~5 | grep -E '\.(ts|tsx|js)$'
```

Look for:
- [ ] Unused imports
- [ ] Leftover console.log/debugger
- [ ] Completed TODOs still marked
- [ ] Commented-out code blocks

### Learnings (3 min)
Capture in appropriate doc:
- **Gotcha**: Non-obvious bug cause -> CLAUDE.md or docs/DOMAINS.md
- **Pattern**: Reusable solution -> relevant domain doc
- **Command**: Useful shell/API -> CLAUDE.md Shell Tips

### Documentation (2 min)
Quick check:
- Did business logic change? -> Update domain
- New integration quirk? -> Add gotcha
- File structure changed? -> Update Key Files

## Skip Cleanup When
- Only minor typo fixes
- Documentation-only changes
- Single quick fix
- No learnings to capture

## Integration
After cleanup, consider running documentation-optimizer agent if significant learnings were captured.
