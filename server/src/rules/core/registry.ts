/**
 * Rules Registry
 * Singleton registry for managing and looking up business rules
 */

import type {
    RuleDefinition,
    RuleCategory,
    RuleOperation,
    GetRulesOptions,
    RuleDocumentation,
} from './types.js';

/**
 * Rules Registry - singleton that holds all registered rules
 */
class RuleRegistry {
    /** All registered rules by ID */
    private rules: Map<string, RuleDefinition<unknown>> = new Map();

    /** Rules indexed by operation for fast lookup */
    private rulesByOperation: Map<RuleOperation, Set<string>> = new Map();

    /** Rules indexed by category */
    private rulesByCategory: Map<RuleCategory, Set<string>> = new Map();

    /**
     * Register a rule with the registry
     * @throws Error if rule ID already exists
     */
    register<TData>(rule: RuleDefinition<TData>): void {
        if (this.rules.has(rule.id)) {
            throw new Error(`Rule with ID '${rule.id}' is already registered`);
        }

        // Store the rule
        this.rules.set(rule.id, rule as RuleDefinition<unknown>);

        // Index by operations
        for (const operation of rule.operations) {
            if (!this.rulesByOperation.has(operation)) {
                this.rulesByOperation.set(operation, new Set());
            }
            this.rulesByOperation.get(operation)!.add(rule.id);
        }

        // Index by category
        if (!this.rulesByCategory.has(rule.category)) {
            this.rulesByCategory.set(rule.category, new Set());
        }
        this.rulesByCategory.get(rule.category)!.add(rule.id);
    }

    /**
     * Register multiple rules at once
     */
    registerAll(rules: RuleDefinition<unknown>[]): void {
        for (const rule of rules) {
            this.register(rule);
        }
    }

    /**
     * Get a rule by ID
     */
    get<TData = unknown>(id: string): RuleDefinition<TData> | undefined {
        return this.rules.get(id) as RuleDefinition<TData> | undefined;
    }

    /**
     * Get all rules for an operation
     */
    getForOperation<TData = unknown>(operation: RuleOperation): RuleDefinition<TData>[] {
        const ruleIds = this.rulesByOperation.get(operation);
        if (!ruleIds) return [];

        return Array.from(ruleIds)
            .map(id => this.rules.get(id) as RuleDefinition<TData>)
            .filter(Boolean);
    }

    /**
     * Get all rules for a category
     */
    getForCategory<TData = unknown>(category: RuleCategory): RuleDefinition<TData>[] {
        const ruleIds = this.rulesByCategory.get(category);
        if (!ruleIds) return [];

        return Array.from(ruleIds)
            .map(id => this.rules.get(id) as RuleDefinition<TData>)
            .filter(Boolean);
    }

    /**
     * Get rules with filtering options
     */
    getRules<TData = unknown>(options: GetRulesOptions = {}): RuleDefinition<TData>[] {
        let rules: RuleDefinition<unknown>[];

        // Start with operation filter if provided (most selective)
        if (options.operation) {
            rules = this.getForOperation(options.operation);
        } else if (options.category) {
            rules = this.getForCategory(options.category);
        } else {
            rules = Array.from(this.rules.values());
        }

        // Apply additional filters
        if (options.category && options.operation) {
            rules = rules.filter(r => r.category === options.category);
        }

        if (options.phase) {
            rules = rules.filter(r => r.phase === options.phase);
        }

        return rules as RuleDefinition<TData>[];
    }

    /**
     * Check if a rule exists
     */
    has(id: string): boolean {
        return this.rules.has(id);
    }

    /**
     * Get total count of registered rules
     */
    get count(): number {
        return this.rules.size;
    }

    /**
     * Get all rule IDs
     */
    getAllIds(): string[] {
        return Array.from(this.rules.keys());
    }

    /**
     * Get all operations that have rules
     */
    getOperationsWithRules(): RuleOperation[] {
        return Array.from(this.rulesByOperation.keys());
    }

    /**
     * Get all categories that have rules
     */
    getCategoriesWithRules(): RuleCategory[] {
        return Array.from(this.rulesByCategory.keys());
    }

    /**
     * Generate documentation for all rules
     */
    generateDocs(): RuleDocumentation[] {
        return Array.from(this.rules.values()).map(rule => ({
            id: rule.id,
            name: rule.name,
            description: rule.description,
            category: rule.category,
            phase: rule.phase,
            severity: rule.severity,
            errorCode: rule.errorCode,
            operations: rule.operations,
        }));
    }

    /**
     * Generate markdown documentation
     */
    generateMarkdown(): string {
        const docs = this.generateDocs();
        const byCategory = new Map<RuleCategory, RuleDocumentation[]>();

        // Group by category
        for (const doc of docs) {
            if (!byCategory.has(doc.category)) {
                byCategory.set(doc.category, []);
            }
            byCategory.get(doc.category)!.push(doc);
        }

        // Build markdown
        const lines: string[] = [
            '# Business Rules Reference',
            '',
            `Total rules: ${docs.length}`,
            '',
        ];

        for (const [category, categoryDocs] of byCategory) {
            lines.push(`## ${category.charAt(0).toUpperCase() + category.slice(1)} Rules`);
            lines.push('');
            lines.push('| ID | Name | Description | Error Code | Operations | Phase | Severity |');
            lines.push('|---|---|---|---|---|---|---|');

            for (const doc of categoryDocs) {
                lines.push(
                    `| \`${doc.id}\` | ${doc.name} | ${doc.description} | \`${doc.errorCode}\` | ${doc.operations.join(', ')} | ${doc.phase} | ${doc.severity} |`
                );
            }

            lines.push('');
        }

        return lines.join('\n');
    }

    /**
     * Clear all rules (useful for testing)
     */
    clear(): void {
        this.rules.clear();
        this.rulesByOperation.clear();
        this.rulesByCategory.clear();
    }
}

/**
 * Singleton registry instance
 */
export const ruleRegistry = new RuleRegistry();
