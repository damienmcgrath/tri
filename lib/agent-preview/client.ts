import { createPreviewDatabase, getPreviewDatabase, getPreviewUser, resetPreviewDatabase } from "./data";

type Filter =
  | { type: "eq"; column: string; value: unknown }
  | { type: "in"; column: string; values: unknown[] }
  | { type: "gte"; column: string; value: unknown }
  | { type: "lte"; column: string; value: unknown }
  | { type: "lt"; column: string; value: unknown }
  | { type: "gt"; column: string; value: unknown }
  | { type: "is"; column: string; value: unknown }
  | { type: "not"; column: string; operator: string; value: unknown }
  | { type: "or"; expression: string };

type Order = {
  column: string;
  ascending: boolean;
  nullsFirst?: boolean;
};

type QueryResult = Promise<any>;

function cloneRow<T>(value: T): T {
  return structuredClone(value);
}

function splitTopLevel(value: string) {
  const result: string[] = [];
  let current = "";
  let depth = 0;

  for (const char of value) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;

    if (char === "," && depth === 0) {
      result.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) {
    result.push(current);
  }

  return result.map((part) => part.trim()).filter(Boolean);
}

function parseFilterValue(value: string) {
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function compareValues(left: unknown, right: unknown) {
  if (left === right) return 0;
  if (left === null || typeof left === "undefined") return -1;
  if (right === null || typeof right === "undefined") return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
}

function matchesOrClause(row: Record<string, unknown>, clause: string): boolean {
  if (clause.startsWith("and(") && clause.endsWith(")")) {
    const inner = clause.slice(4, -1);
    return splitTopLevel(inner).every((part) => matchesOrClause(row, part));
  }

  const [column, operator, ...rest] = clause.split(".");
  const value = parseFilterValue(rest.join("."));
  const current = row[column];

  if (operator === "eq") return current === value;
  if (operator === "gte") return compareValues(current, value) >= 0;
  if (operator === "lte") return compareValues(current, value) <= 0;
  if (operator === "lt") return compareValues(current, value) < 0;
  return false;
}

function rowMatchesFilter(row: Record<string, unknown>, filter: Filter) {
  if (filter.type === "or") {
    return splitTopLevel(filter.expression).some((part) => matchesOrClause(row, part));
  }

  const current = row[filter.column as keyof typeof row];

  if (filter.type === "eq") return current === filter.value;
  if (filter.type === "in") return filter.values.includes(current);
  if (filter.type === "gte") return compareValues(current, filter.value) >= 0;
  if (filter.type === "lte") return compareValues(current, filter.value) <= 0;
  if (filter.type === "lt") return compareValues(current, filter.value) < 0;
  if (filter.type === "gt") return compareValues(current, filter.value) > 0;
  if (filter.type === "is") {
    if (filter.value === null) return current === null || typeof current === "undefined";
    return current === filter.value;
  }
  if (filter.type === "not") {
    if (filter.operator === "is" && filter.value === null) {
      return current !== null && typeof current !== "undefined";
    }
    return current !== filter.value;
  }
  return false;
}

class PreviewQueryBuilder {
  private readonly filters: Filter[] = [];
  private readonly orders: Order[] = [];
  private action: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private mutationPayload: Record<string, unknown> | Array<Record<string, unknown>> | null = null;
  private onConflict: string[] = [];
  private limitCount: number | null = null;
  private selectAfterMutation = false;
  private singleMode: "many" | "maybeSingle" | "single" = "many";

  constructor(private readonly table: keyof ReturnType<typeof createPreviewDatabase>) {}

  select(_columns?: string) {
    this.selectAfterMutation = this.action !== "select";
    return this;
  }

  insert(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
    this.action = "insert";
    this.mutationPayload = payload;
    return this;
  }

  update(payload: Record<string, unknown>) {
    this.action = "update";
    this.mutationPayload = payload;
    return this;
  }

  upsert(payload: Record<string, unknown> | Array<Record<string, unknown>>, options?: { onConflict?: string }) {
    this.action = "upsert";
    this.mutationPayload = payload;
    this.onConflict = (options?.onConflict ?? "id").split(",").map((field) => field.trim()).filter(Boolean);
    return this;
  }

  delete() {
    this.action = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ type: "eq", column, value });
    return this;
  }

  neq(column: string, value: unknown) {
    this.filters.push({ type: "not", column, operator: "eq", value });
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push({ type: "in", column, values });
    return this;
  }

  gte(column: string, value: unknown) {
    this.filters.push({ type: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown) {
    this.filters.push({ type: "lte", column, value });
    return this;
  }

  lt(column: string, value: unknown) {
    this.filters.push({ type: "lt", column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.filters.push({ type: "gt", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ type: "is", column, value });
    return this;
  }

  not(column: string, operator: string, value: unknown) {
    this.filters.push({ type: "not", column, operator, value });
    return this;
  }

  or(expression: string) {
    this.filters.push({ type: "or", expression });
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push({
      column,
      ascending: options?.ascending !== false,
      nullsFirst: options?.nullsFirst
    });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  maybeSingle() {
    this.singleMode = "maybeSingle";
    return this.execute();
  }

  single() {
    this.singleMode = "single";
    return this.execute();
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
  ) {
    return this.execute().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null) {
    return this.execute().finally(onfinally);
  }

  private getRows() {
    return getPreviewDatabase()[this.table] ?? [];
  }

  private applyFilters(rows: Array<Record<string, unknown>>) {
    return (rows ?? []).filter((row) => this.filters.every((filter) => rowMatchesFilter(row, filter)));
  }

  private applyOrderAndLimit(rows: Array<Record<string, unknown>>) {
    const sorted = [...rows];

    for (let index = this.orders.length - 1; index >= 0; index -= 1) {
      const order = this.orders[index];
      sorted.sort((left, right) => {
        const leftValue = left[order.column];
        const rightValue = right[order.column];
        const leftNullish = leftValue === null || typeof leftValue === "undefined";
        const rightNullish = rightValue === null || typeof rightValue === "undefined";

        if (leftNullish || rightNullish) {
          if (leftNullish && rightNullish) return 0;
          const nullDirection = order.nullsFirst ? -1 : 1;
          return leftNullish ? nullDirection : -nullDirection;
        }

        const diff = compareValues(leftValue, rightValue);
        return order.ascending ? diff : -diff;
      });
    }

    if (typeof this.limitCount === "number") {
      return sorted.slice(0, this.limitCount);
    }

    return sorted;
  }

  private normalizeMutationPayload() {
    if (!this.mutationPayload) return [];
    return Array.isArray(this.mutationPayload) ? this.mutationPayload : [this.mutationPayload];
  }

  private executeMutation() {
    const tableRows = this.getRows();

    if (this.action === "insert") {
      const inserted = this.normalizeMutationPayload().map((row) => cloneRow(row));
      tableRows.push(...inserted);
      return inserted;
    }

    if (this.action === "update") {
      const matched = this.applyFilters(tableRows);
      matched.forEach((row) => Object.assign(row, this.mutationPayload));
      return matched.map((row) => cloneRow(row));
    }

    if (this.action === "delete") {
      const matched = new Set(this.applyFilters(tableRows));
      const removed = tableRows.filter((row) => matched.has(row)).map((row) => cloneRow(row));
      const retained = tableRows.filter((row) => !matched.has(row));
      getPreviewDatabase()[this.table] = retained;
      return removed;
    }

    if (this.action === "upsert") {
      const payload = this.normalizeMutationPayload();
      const affected: Array<Record<string, unknown>> = [];

      payload.forEach((row) => {
        const existing = tableRows.find((candidate) =>
          this.onConflict.every((field) => candidate[field] === row[field])
        );

        if (existing) {
          Object.assign(existing, row);
          affected.push(cloneRow(existing));
          return;
        }

        const inserted = cloneRow(row);
        tableRows.push(inserted);
        affected.push(cloneRow(inserted));
      });

      return affected;
    }

    return this.applyOrderAndLimit(this.applyFilters(tableRows)).map((row) => cloneRow(row));
  }

  private async execute(): QueryResult {
    const rows = this.action === "select"
      ? this.applyOrderAndLimit(this.applyFilters(this.getRows())).map((row) => cloneRow(row))
      : this.executeMutation();

    const data = this.selectAfterMutation || this.action === "select" ? rows : null;

    if (this.singleMode === "many") {
      return { data, error: null };
    }

    const first = Array.isArray(data) ? data[0] ?? null : data;
    return { data: first, error: null };
  }
}

export function createAgentPreviewClient() {
  return {
    auth: {
      async getUser() {
        return { data: { user: cloneRow(getPreviewUser()) }, error: null };
      },
      async signOut() {
        return { error: null };
      },
      async updateUser({ data }: { data?: Record<string, unknown> }) {
        const user = getPreviewUser();
        const mergedUser = {
          ...user,
          user_metadata: {
            ...user.user_metadata,
            ...(data ?? {})
          }
        };
        const profile = getPreviewDatabase().profiles[0];
        if (profile) {
          if (typeof data?.race_name !== "undefined") profile.race_name = data.race_name;
          if (typeof data?.race_date !== "undefined") profile.race_date = data.race_date;
        }
        return { data: { user: mergedUser }, error: null };
      }
    },
    from(table: keyof ReturnType<typeof createPreviewDatabase>) {
      return new PreviewQueryBuilder(table);
    },
    __preview: {
      reset() {
        resetPreviewDatabase();
      }
    }
  };
}
