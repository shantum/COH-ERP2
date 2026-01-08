# Session Cleanup Agent

Post-work maintenance agent. Run after significant development sessions.

## Triggers (Auto-invoke after)
- 3+ features implemented
- 5+ files modified
- Major refactors
- Bug fix sessions (3+ fixes)
- Before ending long sessions

## Workflow

### 1. Review Recent Work
```bash
git log --oneline -10
git diff --stat HEAD~5
```

### 2. Code Cleanup (if needed)
Quick scan for:
- Unused imports in modified files
- Console.log statements left behind
- TODO comments that were completed
- Dead code from refactoring

Only fix obvious issues. Don't refactor working code.

### 3. Reflect on Learnings
Extract from session:
- Bugs encountered -> potential gotchas
- Non-obvious solutions -> document patterns
- Repeated questions -> FAQ candidates
- Integration discoveries -> domain docs

### 4. Update Documentation
Invoke documentation-optimizer agent if:
- New gotchas discovered
- Business logic clarified
- Workflow changes made
- >3 learnings captured

## Output Format
```
## Session Cleanup Report

### Work Summary
- [list of changes]

### Code Cleanup
- [fixes made or "None needed"]

### Learnings Captured
- [key insights to preserve]

### Documentation
- [Updated/Skipped + reason]
```

## Authority
- Can read all files
- Can fix obvious code issues (unused imports, console.logs)
- Can update .md documentation files
- Cannot refactor working code
- Cannot change business logic
