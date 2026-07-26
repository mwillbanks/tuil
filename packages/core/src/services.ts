import { type Disposable, toDisposable } from "./disposable.ts";

export type ServiceMap = Record<string, unknown>;

export interface ServiceFactoryContext {
  readonly services: ServiceContainer;
  readonly signal: AbortSignal;
}

export interface ServiceDefinition<
  TId extends string = string,
  TValue = unknown,
> {
  readonly id: TId;
  readonly create: (context: ServiceFactoryContext) => TValue | Promise<TValue>;
  readonly dispose?: (value: TValue) => void | Promise<void>;
}

export function defineService<const TId extends string, TValue>(
  definition: ServiceDefinition<TId, TValue>,
): ServiceDefinition<TId, TValue> {
  return Object.freeze(definition);
}

interface ServiceRecord {
  definition?: {
    create: ServiceDefinition["create"];
    dispose?: (value: unknown) => void | Promise<void>;
  };
  value?: unknown;
  status: "registered" | "initializing" | "ready" | "failed";
  error?: unknown;
}

export class ServiceContainer implements Disposable {
  readonly #records: Map<string, ServiceRecord>;
  readonly #order: string[];
  readonly #controller: AbortController;
  #disposed: boolean;

  constructor() {
    this.#records = new Map();
    this.#order = [];
    this.#controller = new AbortController();
    this.#disposed = false;
  }

  register<TId extends string, TValue>(
    definition: ServiceDefinition<TId, TValue>,
  ): Disposable;
  register<TId extends string, TValue>(id: TId, value: TValue): Disposable;
  register<TId extends string, TValue>(
    definitionOrId: ServiceDefinition<TId, TValue> | TId,
    value?: TValue,
  ): Disposable {
    this.#assertActive();
    const id =
      typeof definitionOrId === "string" ? definitionOrId : definitionOrId.id;
    if (this.#records.has(id)) {
      throw new Error(`Service "${id}" is already registered`);
    }
    this.#records.set(
      id,
      typeof definitionOrId === "string"
        ? { value, status: "ready" }
        : {
            definition: {
              create: definitionOrId.create,
              dispose: definitionOrId.dispose as
                | ((created: unknown) => void | Promise<void>)
                | undefined,
            },
            status: "registered",
          },
    );
    this.#order.push(id);
    return toDisposable(() => {
      const record = this.#records.get(id);
      if (record?.status === "initializing") {
        throw new Error(
          `Cannot unregister service "${id}" while it initializes`,
        );
      }
      this.#records.delete(id);
      const index = this.#order.indexOf(id);
      if (index >= 0) {
        this.#order.splice(index, 1);
      }
    });
  }

  has(id: string): boolean {
    return this.#records.has(id);
  }

  get<TValue>(id: string): TValue {
    this.#assertActive();
    const record = this.#records.get(id);
    if (!record) {
      throw new Error(`Service "${id}" is not registered`);
    }
    if (record.status === "failed") {
      throw record.error;
    }
    if (record.status !== "ready") {
      throw new Error(`Service "${id}" has not been initialized`);
    }
    return record.value as TValue;
  }

  async resolve<TValue>(id: string): Promise<TValue> {
    this.#assertActive();
    const record = this.#records.get(id);
    if (!record) {
      throw new Error(`Service "${id}" is not registered`);
    }
    if (record.status === "ready") {
      return record.value as TValue;
    }
    if (record.status === "failed") {
      throw record.error;
    }
    if (record.status === "initializing") {
      throw new Error(
        `Circular or concurrent initialization detected for service "${id}"`,
      );
    }
    record.status = "initializing";
    try {
      record.value = await record.definition?.create({
        services: this,
        signal: this.#controller.signal,
      });
      record.status = "ready";
      return record.value as TValue;
    } catch (error) {
      record.status = "failed";
      record.error = error;
      throw error;
    }
  }

  async initialize(): Promise<void> {
    for (const id of this.#order) {
      await this.resolve(id);
    }
  }

  entries(): readonly [string, unknown][] {
    return this.#order
      .filter((id) => this.#records.get(id)?.status === "ready")
      .map((id) => [id, this.#records.get(id)?.value] as const);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#controller.abort(new Error("Service container disposed"));
    const errors: unknown[] = [];
    for (const id of [...this.#order].reverse()) {
      const record = this.#records.get(id);
      if (
        record?.status === "ready" &&
        record.definition?.dispose &&
        record.value !== undefined
      ) {
        try {
          await record.definition.dispose(record.value);
        } catch (error) {
          errors.push(error);
        }
      }
    }
    this.#records.clear();
    this.#order.length = 0;
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose runtime services");
    }
  }

  #assertActive(): void {
    if (this.#disposed) {
      throw new Error("Service container is disposed");
    }
  }
}
