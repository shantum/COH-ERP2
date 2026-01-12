# Documentation Update Guide

> Methodology for maintaining documentation in an AI-assisted codebase.

## Three-Tier Structure

```
CLAUDE.md (~150 lines)          ← Always loaded by agents, app-wide patterns
    ↓
docs/DOMAINS.md (~140 lines)    ← Routing index, cross-domain relationships
    ↓
docs/domains/*.md (~50-150 each) ← Deep domain-specific reference
```

**Agent workflow**: Agents read CLAUDE.md first (always), then consult DOMAINS.md index, then fetch specific domain files as needed.

---

## When to Update Documentation

### After Code Changes

| Change Type | Update Required |
|-------------|-----------------|
| New endpoint | Add to relevant domain file's "Key Endpoints" |
| New business rule | Add to "Business Rules" section |
| Bug fix for gotcha | Add to "Gotchas" section |
| Cross-domain interaction | Update both domain files + DOMAINS.md matrix |
| New domain | Create new file in `docs/domains/`, add to DOMAINS.md |

### Periodic Maintenance

- **After 3+ features**: Run doc-optimizer agent
- **Before major releases**: Audit all domain files
- **When docs feel stale**: Use codebase-steward agent

---

## Domain File Template

```markdown
# {Domain} Domain

> One-line scope description

## Quick Reference

| Aspect | Value |
|--------|-------|
| Routes | `server/src/routes/...` |
| Key Files | List critical files |
| Related | Other domains this touches |

## [Core Concept]
State machine, data model, or architecture specific to domain.

## Business Rules
1. Rule that would cause bugs if violated
2. ...

## Key Endpoints
| Path | Purpose |
|------|---------|
| Only non-obvious endpoints |

## Cross-Domain
- **→ Domain**: What this domain sends/creates
- **← Domain**: What this domain receives

## Gotchas
1. Trap that wastes debugging time
2. ...
```

---

## Content Principles

### What to Include (Essential)

- **State machines / flows**: Valid transitions that agents must understand
- **Business rules**: Rules that cause bugs if violated
- **Cross-domain interactions**: Where data flows between domains
- **Cascade logic**: Cost, permissions, inventory fallbacks
- **Gotchas from real bugs**: Issues that have caused debugging time
- **Non-obvious endpoint behavior**: Things that aren't self-documenting

### What to Exclude (Useless)

- **File sizes**: Obvious from disk
- **Generic CRUD descriptions**: `GET /`, `POST /`, `DELETE /`
- **Obvious field descriptions**: "orderNumber - the order number"
- **Schema details**: Refer to Prisma schema instead
- **Detailed curl examples**: Only for complex interactions
- **Duplicate information**: Don't repeat between CLAUDE.md and domain files

### Compression Guidelines

- **Tables over prose**: Easier to scan
- **One-line diagrams over ASCII art**: `A → B → C` over multi-line boxes
- **Numbered lists over paragraphs**: Faster to reference
- **Code blocks only for non-obvious logic**: Don't document obvious patterns

---

## File Responsibilities

### CLAUDE.md (App-Wide)

**Contains**:
- Quick start commands
- Tech stack overview
- Core flows (2-line summaries)
- Key files table
- App-wide gotchas (not domain-specific)
- Recommended agents
- Shell tips

**Does NOT contain**:
- Detailed endpoint documentation (→ domain files)
- Domain-specific gotchas (→ domain files)
- Business rules (→ domain files)

### DOMAINS.md (Routing)

**Contains**:
- Routing table ("Working on X → read Y")
- Domain cards (3-4 lines each: scope, files, touches)
- Cross-domain matrix
- Quick reference formulas

**Does NOT contain**:
- Detailed documentation (→ domain files)
- Code examples (→ domain files)
- Gotchas (→ domain files)

### Domain Files (Deep)

**Contains**:
- Everything specific to that domain
- Self-contained reference
- Cross-domain section showing interactions

---

## Update Workflow

### Adding a Gotcha

1. Identify which domain owns the gotcha
2. Add to that domain's "Gotchas" section
3. If app-wide (affects multiple domains), add to CLAUDE.md instead

### Adding a New Endpoint

1. Add to relevant domain file's "Key Endpoints" table
2. Only include if behavior is non-obvious
3. Skip generic CRUD endpoints

### Creating a New Domain

1. Create `docs/domains/{domain}.md` using template
2. Add domain card to `docs/DOMAINS.md`
3. Add routing entry to routing table
4. Update cross-domain matrix if applicable

### Major Refactor

1. Update affected domain files
2. Verify cross-domain matrix is accurate
3. Run doc-optimizer agent to catch missed updates

---

## Quality Checklist

Before committing documentation changes:

- [ ] No duplicate information between CLAUDE.md and domain files
- [ ] No obvious/generic descriptions
- [ ] Gotchas are domain-specific (or clearly app-wide in CLAUDE.md)
- [ ] Cross-domain section lists both inbound and outbound
- [ ] Tables used where possible (not prose)
- [ ] Line count reasonable (~50-150 lines per domain file)

---

## Agent Recommendations

| Task | Agent |
|------|-------|
| After 3+ features | `doc-optimizer` |
| Audit all docs | `codebase-steward` |
| Verify accuracy | `logic-auditor` |
| Find stale docs | `code-cleanup-auditor` |

---

## Example: Good vs Bad Documentation

### Bad (Useless)

```markdown
## Endpoints
- GET /orders - Gets all orders
- POST /orders - Creates an order
- PUT /orders/:id - Updates an order
- DELETE /orders/:id - Deletes an order

## Fields
- orderNumber: The order number
- customerName: The customer's name
- totalAmount: The total amount
```

### Good (Essential)

```markdown
## Business Rules
1. **FIFO processing**: Open orders sorted by orderDate ASC
2. **Shipped view exclusions**: Excludes RTO and unpaid COD (separate views)

## Key Endpoints
| Path | Purpose |
|------|---------|
| `GET /orders?view=` | Unified views API (replaces 5 endpoints) |
| `POST /:id/ship` | Requires all lines packed |

## Gotchas
1. **Router order matters**: Specific routes before parameterized (`:id`)
```

---

## Maintaining Line Counts

Target sizes:
- `CLAUDE.md`: ~150 lines
- `DOMAINS.md`: ~140 lines
- Domain files: 50-150 lines each

If a domain file exceeds 150 lines:
1. Check for duplicate content
2. Remove obvious descriptions
3. Consider splitting into sub-domains
4. Move detailed examples to separate file
