/**
 * The actor→hotbar-page assignment window, opened from the settings menu button.
 *
 * Rows are added and removed client-side and only written to the world setting
 * when the GM hits Save, so backing out of the window changes nothing.
 */
import { MODULE_ID, SETTINGS, TEMPLATES } from "../constants.js";
import {
  featureEnabled,
  getConfig,
  isPage,
  NO_PAGE,
  pageNumbers,
  saveConfig,
  type HotbarPagesConfigData,
} from "./hotbar-pages.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** One editable assignment. `actorId` is empty for a freshly added, unfilled row. */
interface Row {
  actorId: string;
  page: number;
}

/** An actor the GM can assign, as offered in the row dropdowns. */
interface ActorChoice {
  id: string;
  name: string;
}

/** "Page 3" etc. — the label shared by the row and default-page dropdowns. */
function pageLabel(page: number): string {
  return game.i18n.format("EE.HotbarPages.PageOption", { page });
}

export class HotbarPagesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  private rows: Row[] = [];
  private defaultPage: number = NO_PAGE;
  private applyToPlayers = false;
  /**
   * The feature's master switch. It lives in its own setting rather than in the
   * assignments object, but it is edited here because the two are useless apart:
   * assignments do nothing while it is off, and it does nothing without them.
   */
  private enabled = false;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-hotbar-pages`,
    // A form element so the browser styles the controls like the rest of the
    // settings UI. Submission is handled by our own listener, not the form
    // plumbing — see `_onRender`.
    tag: "form",
    classes: [MODULE_ID, "ee-hotbar-pages", "standard-form"],
    window: {
      title: "EE.HotbarPages.Title",
      icon: "fa-solid fa-bars-staggered",
      resizable: true,
    },
    position: {
      width: 560,
      height: "auto",
    },
  };

  static PARTS = {
    main: {
      template: TEMPLATES.hotbarPages,
    },
  };

  constructor(options: AnyObject = {}) {
    super(options);
    const config = getConfig();
    this.enabled = featureEnabled();
    this.defaultPage = config.defaultPage;
    this.applyToPlayers = config.applyToPlayers;
    // Sorted by actor name so the list reads the same way every time it opens —
    // the setting is a plain object, whose key order is an accident of editing.
    this.rows = Object.entries(config.pages)
      .map(([actorId, page]) => ({ actorId, page }))
      .sort((a, b) => this.actorName(a.actorId).localeCompare(this.actorName(b.actorId)));
  }

  /** Display name for an actor id, falling back to the raw id if it's gone. */
  private actorName(actorId: string): string {
    const actor = game.actors?.get(actorId) as AnyObject | undefined;
    return String(actor?.name ?? actorId);
  }

  /** Every world actor, name-sorted, as dropdown choices. */
  private actorChoices(): ActorChoice[] {
    const actors = (game.actors?.contents ?? []) as AnyObject[];
    return actors
      .map((actor) => ({ id: String(actor.id), name: String(actor.name ?? actor.id) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async _prepareContext(_options: AnyObject): Promise<AnyObject> {
    const choices = this.actorChoices();

    // Handlebars here has no `eq` helper (see CLAUDE.md), so every `selected`
    // flag is computed up front rather than compared in the template.
    const defaultOptions = [
      {
        value: NO_PAGE,
        label: game.i18n.localize("EE.HotbarPages.DefaultNone"),
        selected: this.defaultPage === NO_PAGE,
      },
      ...pageNumbers().map((page) => ({
        value: page,
        label: pageLabel(page),
        selected: this.defaultPage === page,
      })),
    ];

    const rows = this.rows.map((row) => {
      const known = choices.some((choice) => choice.id === row.actorId);
      // An assignment whose actor has since been deleted stays visible and
      // selected, so saving doesn't quietly drop it without the GM noticing.
      const actorOptions = [
        ...(row.actorId && !known
          ? [
              {
                id: row.actorId,
                name: game.i18n.format("EE.HotbarPages.MissingActor", { id: row.actorId }),
                selected: true,
              },
            ]
          : []),
        ...choices.map((choice) => ({ ...choice, selected: choice.id === row.actorId })),
      ];

      return {
        actorOptions,
        pageOptions: pageNumbers().map((page) => ({
          value: page,
          label: pageLabel(page),
          selected: row.page === page,
        })),
      };
    });

    return {
      rows,
      defaultOptions,
      enabled: this.enabled,
      applyToPlayers: this.applyToPlayers,
      hasRows: rows.length > 0,
      hasActors: choices.length > 0,
    };
  }

  _onRender(context: AnyObject, options: AnyObject): void {
    super._onRender?.(context, options);
    const root = this.element as HTMLElement | undefined;
    // One delegated listener on the root, which survives part re-renders, so it
    // is bound once. (ApplicationV2's built-in `actions` dispatch is unreliable
    // in this Foundry build — see CLAUDE.md.)
    if (!root || root.dataset["eeBound"]) return;
    root.dataset["eeBound"] = "1";

    // The window is a <form>; stop the browser from navigating on Enter.
    root.addEventListener("submit", (event: Event) => event.preventDefault());

    root.addEventListener("click", (event: Event) => {
      const el = (event.target as HTMLElement | null)?.closest?.("[data-ee]") as HTMLElement | null;
      if (!el || !root.contains(el)) return;

      switch (el.dataset["ee"]) {
        case "add":
          this.onAddRow();
          break;
        case "remove":
          this.onRemoveRow(el);
          break;
        case "save":
          void this.onSave();
          break;
        case "cancel":
          void this.close();
          break;
      }
    });
  }

  /**
   * Pull the current state out of the DOM. Every re-render rebuilds the rows from
   * `this.rows`, so edits made since the last render have to be harvested first —
   * otherwise adding a row would discard the dropdown changes above it.
   */
  private readFromDom(): void {
    const root = this.element as HTMLElement | undefined;
    if (!root) return;

    this.rows = Array.from(root.querySelectorAll<HTMLElement>("[data-ee-row]")).map((el) => {
      const actorId = el.querySelector<HTMLSelectElement>("select[name='actorId']")?.value ?? "";
      const page = Number(el.querySelector<HTMLSelectElement>("select[name='page']")?.value);
      return { actorId, page: isPage(page) ? page : 1 };
    });

    const defaultPage = Number(
      root.querySelector<HTMLSelectElement>("select[name='defaultPage']")?.value,
    );
    this.defaultPage = isPage(defaultPage) ? defaultPage : NO_PAGE;
    this.enabled =
      root.querySelector<HTMLInputElement>("input[name='hotbarPageSwap']")?.checked ?? false;
    this.applyToPlayers =
      root.querySelector<HTMLInputElement>("input[name='applyToPlayers']")?.checked ?? false;
  }

  private onAddRow(): void {
    this.readFromDom();
    this.rows.push({ actorId: "", page: 1 });
    void this.render();
  }

  private onRemoveRow(button: HTMLElement): void {
    const row = button.closest("[data-ee-row]");
    if (!row?.parentElement) return;
    const index = Array.from(row.parentElement.children).indexOf(row);
    this.readFromDom();
    if (index >= 0) this.rows.splice(index, 1);
    void this.render();
  }

  private async onSave(): Promise<void> {
    this.readFromDom();

    const pages: Record<string, number> = {};
    for (const row of this.rows) {
      // Rows left on the blank placeholder are simply not assignments yet.
      if (!row.actorId) continue;
      pages[row.actorId] = row.page;
    }

    const config: HotbarPagesConfigData = {
      defaultPage: this.defaultPage,
      applyToPlayers: this.applyToPlayers,
      pages,
    };

    // Assignments first, then the switch: if the GM is turning the feature on in
    // the same save, the assignments it reads are already the new ones.
    await saveConfig(config);
    if (this.enabled !== featureEnabled()) {
      await game.settings.set(MODULE_ID, SETTINGS.hotbarPageSwap, this.enabled);
    }

    ui.notifications?.info(game.i18n.localize("EE.HotbarPages.Saved"));
    await this.close();
  }
}
