/**
 * Minimal ambient declarations for the FoundryVTT globals this module touches.
 *
 * This is a deliberately small shim so the project type-checks and builds without
 * pulling in the full community type packages. When you want richer typings,
 * install `fvtt-types` (https://github.com/League-of-Foundry-Developers/foundry-vtt-types)
 * and delete this file.
 *
 * When you touch a new Foundry global, add it here rather than reaching for `any`
 * everywhere.
 */

export {};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type AnyObject = Record<string, any>;

  /** Loose stand-in for jQuery — some classic Foundry hooks still pass it. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type JQuery = any;

  /** A PIXI display object — we only ever toggle its visibility. */
  interface DisplayObject {
    visible: boolean;
  }

  /** The persisted side of a Token (embedded in a Scene). */
  interface TokenDocument {
    id: string;
    /** Foundry's own GM-only hidden flag — deliberately left untouched here. */
    hidden: boolean;
    /**
     * Id of the *base* Actor this token represents. Unlike `actor.id`, this is
     * stable for unlinked tokens (whose `actor` is a synthetic ActorDelta actor).
     */
    actorId?: string | null;
    /** The placeable on the canvas, once drawn. */
    object?: Token | null;
    actor?: AnyObject | null;
    getFlag(scope: string, key: string): unknown;
    setFlag(scope: string, key: string, value: unknown): Promise<TokenDocument>;
    unsetFlag(scope: string, key: string): Promise<TokenDocument>;
    /** Mutate the document's source data in place (used from preCreate hooks). */
    updateSource(changes: AnyObject, options?: AnyObject): object;
  }

  /** A Token placeable on the canvas. Only the members this module touches. */
  interface Token {
    id: string;
    document: TokenDocument;
    /** The sprite. Parented to the primary canvas group; null until drawn. */
    mesh: DisplayObject | null;
    border: DisplayObject;
    nameplate: DisplayObject;
    bars: DisplayObject;
    tooltip: DisplayObject;
    effects: DisplayObject;
    /** Target reticle graphics, drawn when the token is targeted. */
    targetPips: DisplayObject;
    targetArrows: DisplayObject;
    levelIndicator?: DisplayObject | null;
    /** Schedules an incremental refresh; fires the `refreshToken` hook. */
    renderFlags: { set(flags: AnyObject): void };
  }

  /** The active canvas. `tokens` is undefined until the canvas is ready. */
  const canvas: {
    ready: boolean;
    scene?: { id: string } | null;
    tokens?: {
      placeables: Token[];
      /** Currently selected tokens, in the order they were selected (last = newest). */
      controlled: Token[];
      get(id: string): Token | undefined;
    };
  } & AnyObject;

  /** Foundry's global hook dispatcher. */
  const Hooks: {
    on(hook: string, fn: (...args: any[]) => unknown): number;
    once(hook: string, fn: (...args: any[]) => unknown): number;
    off(hook: string, fn: number | ((...args: any[]) => unknown)): void;
    call(hook: string, ...args: any[]): boolean;
    callAll(hook: string, ...args: any[]): boolean;
  };

  /** The active game instance. Only ready after the `ready` hook fires. */
  const game: {
    modules: Map<string, { active: boolean; api?: unknown } & AnyObject>;
    system: { id: string; version: string } & AnyObject;
    settings: {
      register(namespace: string, key: string, data: AnyObject): void;
      registerMenu(namespace: string, key: string, data: AnyObject): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    };
    user?: { id: string; isGM: boolean; name: string } & AnyObject;
    /**
     * Connected users. `activeGM` is Foundry's designated single GM — the same
     * user on every client — which is how a hook that fires everywhere can pick
     * exactly one writer without any socket coordination. Undefined when no GM
     * is connected.
     */
    users?: {
      activeGM?: ({ id: string; isSelf: boolean } & AnyObject) | null;
      /** Every user, connected or not — `character` is their assigned actor. */
      contents: AnyObject[];
      get(id: string): AnyObject | undefined;
    } & AnyObject;
    /** World actors. Undefined before the `setup` hook. */
    actors?: {
      contents: AnyObject[];
      get(id: string): AnyObject | undefined;
    } & AnyObject;
    /** Every sidebar folder in the world, across all document types. */
    folders?: {
      contents: AnyObject[];
      find(predicate: (folder: AnyObject) => boolean): AnyObject | undefined;
      get(id: string): AnyObject | undefined;
    } & AnyObject;
    /** Present once the socket connects; requires `"socket": true` in module.json. */
    socket?: {
      on(event: string, callback: (...args: any[]) => void): void;
      emit(event: string, ...args: any[]): void;
    };
    i18n: {
      localize(key: string): string;
      format(key: string, data?: AnyObject): string;
    };
  } & AnyObject;

  /**
   * Synchronous UUID resolution. Returns null for anything not yet loaded, and
   * a compendium's *index entry* (name/type, no system data) when the pack is
   * indexed but the document isn't cached. Pass `{ strict: false }` to get null
   * instead of a throw for a UUID that can only be resolved asynchronously.
   */
  function fromUuidSync(uuid: string, options?: AnyObject): AnyObject | null;

  /** Chat log entries. Only the members this module touches. */
  const ChatMessage: {
    create(data: AnyObject): Promise<AnyObject>;
    getSpeaker(data: AnyObject): AnyObject;
  };

  /**
   * Items, world or embedded. `create` takes `parent` (the owning Actor) and any
   * other operation options in its second argument.
   */
  const Item: {
    create(data: AnyObject, options?: AnyObject): Promise<AnyObject | undefined>;
  };

  /** World journal entries. Only the members this module touches. */
  const JournalEntry: {
    create(data: AnyObject): Promise<AnyObject | undefined>;
  };

  /**
   * Sidebar folders. `type` is the document type the folder holds
   * ("JournalEntry", "Actor", …) — folder names are only unique within a type.
   */
  const Folder: {
    create(data: AnyObject): Promise<AnyObject | undefined>;
  };

  const CONFIG: AnyObject;
  const CONST: AnyObject;
  const ui: AnyObject & {
    notifications?: { info(m: string): void; warn(m: string): void; error(m: string): void };
    /** The macro bar. Foundry supports exactly 5 pages; `changePage` throws outside 1–5. */
    hotbar?: { page: number; changePage(page: number): Promise<void> } & AnyObject;
  };

  /** The Foundry client-side API namespace (ApplicationV2, template helpers). */
  const foundry: {
    applications: {
      api: {
        ApplicationV2: any;
        HandlebarsApplicationMixin: <T>(base: T) => T;
        DialogV2: any;
      };
      handlebars: {
        loadTemplates(paths: string[]): Promise<unknown>;
      };
    };
    utils: AnyObject;
  } & AnyObject;
}
