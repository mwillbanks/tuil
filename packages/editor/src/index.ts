export interface EditorPosition {
  readonly line: number;
  readonly column: number;
}

export interface EditorRange {
  readonly anchor: EditorPosition;
  readonly head: EditorPosition;
}

export interface EditorSelection extends EditorRange {
  readonly primary?: boolean;
}

export interface EditorDocument {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly text: string;
}

export interface EditorChange {
  readonly range: EditorRange;
  readonly insert: string;
}

export interface EditorTransaction {
  readonly changes?: readonly EditorChange[];
  readonly selections?: readonly EditorSelection[];
  readonly annotations?: Readonly<Record<string, unknown>>;
  readonly addToHistory?: boolean;
}

export interface EditorDecoration {
  readonly id: string;
  readonly range: EditorRange;
  readonly kind: "highlight" | "underline" | "line" | "gutter" | "widget";
  readonly className?: string;
  readonly data?: unknown;
}

export interface EditorDiagnostic {
  readonly range: EditorRange;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly source?: string;
}

export type EditorMode =
  | "insert"
  | "normal"
  | "visual"
  | "visual-line"
  | "operator-pending"
  | "command-line"
  | (string & {});

export type EditorCapability =
  | "single-line"
  | "multiline"
  | "multiple-selections"
  | "history"
  | "search"
  | "replace"
  | "decorations"
  | "diagnostics"
  | "clipboard"
  | "masked"
  | "vim"
  | "rich-document"
  | "static";

export interface EditorSnapshot {
  readonly document: EditorDocument;
  readonly selections: readonly EditorSelection[];
  readonly decorations: readonly EditorDecoration[];
  readonly diagnostics: readonly EditorDiagnostic[];
  readonly mode: EditorMode;
  readonly readOnly: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly viewportAnchor?: EditorPosition;
}

export interface EditorCommand {
  readonly id: string;
  readonly title: string;
  execute(
    session: EditorSession,
    argument?: unknown,
  ): boolean | Promise<boolean>;
}

export interface EditorSession {
  snapshot(): EditorSnapshot;
  dispatch(transaction: EditorTransaction): EditorSnapshot;
  execute(
    command: string | EditorCommand,
    argument?: unknown,
  ): boolean | Promise<boolean>;
  undo(): boolean;
  redo(): boolean;
  search(query: string | RegExp): readonly EditorRange[];
  replace(query: string | RegExp, replacement: string, all?: boolean): number;
  copy(): string | Promise<string>;
  cut(): string | Promise<string>;
  paste(value?: string): boolean | Promise<boolean>;
  serialize(format?: "text" | "json" | "markdown"): string;
  subscribe(observer: (snapshot: EditorSnapshot) => void): () => void;
  key?(input: string): boolean;
  dispose(): void;
}

export interface EditorBackend {
  readonly id: string;
  readonly version: string;
  readonly capabilities: ReadonlySet<EditorCapability>;
  create(options: EditorProviderOptions): EditorSession;
}

export interface EditorProvider extends EditorBackend {
  readonly documentTypes?: readonly string[];
  readonly rendererCapabilities?: readonly string[];
  readonly inputCapabilities?: readonly string[];
  readonly staticModes?: readonly string[];
}

export type EditorProviderFactory = () =>
  | EditorProvider
  | Promise<EditorProvider>;

export interface EditorProviderOptions {
  readonly id?: string;
  readonly documentType?: string;
  readonly value?: string;
  readonly readOnly?: boolean;
  readonly masked?: boolean;
  readonly mode?: EditorMode;
  readonly viewportAnchor?: EditorPosition;
  readonly clipboard?: EditorClipboardAdapter;
  /**
   * Receives the unredacted document after a mutation.
   *
   * Masked sessions redact snapshots, serialization, and clipboard operations.
   * An owning control can use this explicit sink to synchronize its private
   * value without turning a general export API into a secret-recovery path.
   */
  readonly onDocumentChange?: (value: string) => void;
}

export interface EditorClipboardAdapter {
  read(): string | undefined | Promise<string | undefined>;
  write(value: string): void | Promise<void>;
}

export interface EditorRegistration {
  readonly provider: EditorProvider;
  readonly default: boolean;
  dispose(): void;
}

function validateEditorProvider(
  providers: ReadonlyMap<string, EditorProvider>,
  defaultId: string | undefined,
  provider: EditorProvider,
  options: { readonly default?: boolean; readonly replace?: boolean },
): void {
  if (!provider.id.trim() || !provider.version.trim()) {
    throw new Error("Editor providers require a stable id and version");
  }
  if (providers.has(provider.id) && !options.replace) {
    throw new Error(`Editor provider "${provider.id}" is already registered`);
  }
  const replacesDefault =
    options.default && defaultId && defaultId !== provider.id;
  if (replacesDefault && !options.replace) {
    throw new Error(
      `Default editor "${defaultId}" cannot be replaced accidentally`,
    );
  }
}

function supportsOptional(
  required: string | undefined,
  provided: readonly string[] | undefined,
): boolean {
  return !required || !provided || provided.includes(required);
}

function supportsEditorRequirements(
  provider: EditorProvider,
  requirements: {
    readonly documentType?: string;
    readonly capabilities?: readonly EditorCapability[];
    readonly renderer?: string;
    readonly input?: string;
    readonly staticMode?: string;
  },
): boolean {
  if (
    requirements.documentType &&
    provider.documentTypes &&
    !provider.documentTypes.includes(requirements.documentType)
  ) {
    return false;
  }
  const capabilities = requirements.capabilities ?? [];
  if (
    !capabilities.every((capability) => provider.capabilities.has(capability))
  )
    return false;
  return (
    supportsOptional(requirements.renderer, provider.rendererCapabilities) &&
    supportsOptional(requirements.input, provider.inputCapabilities) &&
    supportsOptional(requirements.staticMode, provider.staticModes)
  );
}

export class EditorProviderRegistry {
  readonly #providers: Map<string, EditorProvider>;
  #defaultId?: string;

  constructor() {
    this.#providers = new Map();
    this.#defaultId = undefined;
  }

  register(
    provider: EditorProvider,
    options: { readonly default?: boolean; readonly replace?: boolean } = {},
  ): EditorRegistration {
    validateEditorProvider(this.#providers, this.#defaultId, provider, options);
    this.#providers.set(provider.id, provider);
    if (options.default || !this.#defaultId) this.#defaultId = provider.id;
    return Object.freeze({
      provider,
      default: this.#defaultId === provider.id,
      dispose: this.#providerDisposer(provider),
    });
  }

  #providerDisposer(provider: EditorProvider): () => void {
    let disposed = false;
    return () => {
      if (disposed || this.#providers.get(provider.id) !== provider) return;
      disposed = true;
      this.#providers.delete(provider.id);
      if (this.#defaultId === provider.id) {
        this.#defaultId = this.#providers.keys().next().value;
      }
    };
  }

  resolve(
    id?: string,
    requirements: {
      readonly documentType?: string;
      readonly capabilities?: readonly EditorCapability[];
      readonly renderer?: string;
      readonly input?: string;
      readonly staticMode?: string;
    } = {},
  ): EditorProvider {
    const preferred = this.#defaultId
      ? this.#providers.get(this.#defaultId)
      : undefined;
    const candidates = id
      ? [this.#providers.get(id)]
      : [preferred, ...this.#providers.values()];
    const provider = candidates.find(
      (candidate): candidate is EditorProvider =>
        candidate !== undefined &&
        supportsEditorRequirements(candidate, requirements),
    );
    if (!provider) {
      throw new Error(
        `No compatible editor provider found${id ? ` for "${id}"` : ""}`,
      );
    }
    return provider;
  }

  list(): readonly EditorProvider[] {
    return Object.freeze([...this.#providers.values()]);
  }
}

export function position(line: number, column: number): EditorPosition {
  return Object.freeze({
    line: Math.max(0, Math.floor(line)),
    column: Math.max(0, Math.floor(column)),
  });
}

export function selection(
  anchor: EditorPosition,
  head: EditorPosition = anchor,
  primary = true,
): EditorSelection {
  return Object.freeze({
    anchor: position(anchor.line, anchor.column),
    head: position(head.line, head.column),
    primary,
  });
}
