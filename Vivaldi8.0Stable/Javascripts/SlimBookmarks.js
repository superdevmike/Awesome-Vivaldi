// ==UserScript==
// @name         Slim Bookmarks
// @description  Custom bookmark bar rendered inline in the address bar toolbar, with folder menus, drag & drop of bookmarks and folders, context menu, edit dialog and folder creation.
// @version      2026.8.27
// @author       superdevmike
// ==/UserScript==

(function vivaldiBookmarksMod() {
    'use strict';

    console.log('🔍 [SlimBookmarks] Script loaded');

    const BAR_CLASS = 'custom-bookmark-bar';
    const BTN_CLASS = 'custom-bookmark-bar-button';
    const MENU_CLASS = 'custom-bookmark-menu';
    const ROW_CLASS = 'custom-bookmark-menu-row';
    const LAYER_ID = 'custom-bookmark-layer';
    const STYLE_ID = 'custom-bookmark-style';
    // halo filters for dark favicons: over --colorBg and over --colorAccentBg
    const HALO_FG_ID = 'custom-bookmark-halo-fg';
    const HALO_ACCENT_ID = 'custom-bookmark-halo-accent';
    const ACTIVE_CLASS = 'is-active';   // highlighted menu row
    const OPEN_CLASS = 'is-open';       // bar button whose menu is open
    const GAP = 4;              // menu offset from the screen edge
    // Extra offset when the menu unfolds away from the cursor (upwards or
    // leftwards). A plain GAP leaves only its own 4px between the cursor and
    // the menu edge — enough near a normal screen edge, but when the menu
    // unfolds "away from the cursor" its last row (Delete for the context
    // menu, or deleting a whole subtree for a folder) can end up within
    // those same 4px of the click point. A couple of pixels of mouse jitter
    // after a right click would then delete the node with no chance to
    // undo. Vivaldi's own menus never keep rows under the cursor — this
    // offset reproduces the same behaviour.
    const CTX_FLIP_MARGIN = 8;
    const BTN_GAP = 2;          // gap between bar buttons
    const TRASH_ID = '4';       // the trash holds stale "Bookmarks Bar" folders
    // Vivaldi keeps menus at z-index 101 and dialogs at 1000..1002
    const MENU_Z_INDEX = 1010;
    const SEP_CLASS = 'custom-bookmark-menu-sep';
    const CTX_DEPTH = 100;      // context menu depth: z-index above submenus
    const DIALOG_CLASS = 'custom-bookmark-dialog';
    const DRAG_MIME = 'application/x-vivaldi-mod-bookmark';
    const DROP_LINE_CLASS = 'custom-bookmark-drop-line';
    const DROP_INTO_CLASS = 'is-drop-into';
    const EDGE_RATIO = 0.25;        // share of a button/row that means "insert next to"
    const ICON_CLASS = MENU_CLASS + '-icon';    // shared by the favicon <img> and the fallback <svg>
    const ICONS_CLASS = 'is-icons';             // display: icons only
    const TEXT_CLASS = 'is-text';               // display: titles only
    const ICONS_NF_CLASS = 'is-icons-no-folders';   // display: icons, except folders
    const FOLDER_BTN_CLASS = 'is-folder';       // marks a bar button that is a folder
    const CHEVRON_CLASS = 'custom-bookmark-bar-chevron';   // step 3: the "the rest" button

    // When the user picks a custom folder for the bookmark bar, Vivaldi flags
    // it in Bookmarks with meta_info.Bookmarkbar = 'true'. It can sit at any
    // depth, not only in the root with id '1'.
    // If auto-detection somehow fails, put the folder id here (or, better,
    // fill in "Bar Folder ID" in the mod's settings panel).
    const FORCE_FOLDER_ID = null;

    // ------------------------------------------------------------------
    // Vivaldi's own Bookmarks settings.
    //
    // Paths and types come from prefs_definitions.json. The mod deliberately
    // follows the native settings instead of duplicating them: whatever the
    // user has already configured for Vivaldi's own bookmark bar keeps working
    // here. Everything read below is listed, in the same words, in the
    // "Vivaldi Settings" note of the mod's ModConfig panel — keep the two in
    // step when adding a pref.
    //
    //   open_in_new_tab   boolean   Settings > Bookmarks > Open Bookmark in New Tab
    //   bar.display       enum      Settings > Bookmarks > Bookmark Bar > Display
    //                               (default | text | icon | iconexceptfolders)
    //   bar.folder_ids    list      Settings > Bookmarks > Bookmark Bar > Folder
    //
    // Not read, and why:
    //   bar.visible / bar.position — our bar lives inside the address bar
    //     toolbar, so Vivaldi's own bar placement says nothing about it.
    //   confirm_opening, confirm_opening_threshold — they guard "Open All
    //     Bookmarks", an action this mod's menus do not offer.
    //   single_click_opens, bar.sorting — they belong to the bookmark manager
    //     and the panel, not to the bar.
    // ------------------------------------------------------------------
    const PREF_OPEN_NEW_TAB = 'vivaldi.bookmarks.open_in_new_tab';
    const PREF_BAR_DISPLAY = 'vivaldi.bookmarks.bar.display';
    const PREF_BAR_FOLDERS = 'vivaldi.bookmarks.bar.folder_ids';

    // Vivaldi's enum -> our display modes
    const VIVALDI_DISPLAY_MODES = {
        default: 'titleAndIcon',
        text: 'titleOnly',
        icon: 'iconOnly',
        iconexceptfolders: 'iconExceptFolders',
    };

    // Not named openInNewTab: that is the name of the "Open in New Tab"
    // context menu action (see the "Context menu" section) — matching names
    // would collide as duplicate declarations.
    let openInNewTabPref = false;   // cached value of the Vivaldi setting
    let barDisplayPref = 'default'; // cached vivaldi.bookmarks.bar.display
    let barFolderIdsPref = [];      // cached vivaldi.bookmarks.bar.folder_ids

    // ------------------------------------------------------------------
    // Mod settings (ModConfig).
    //
    // The panel lives in vivaldi:settings/appearance -> Awesome Vivaldi ->
    // Slim Bookmarks; the values are stored in OPFS under
    // .askonpage/config.json, in mods.slimBookmarks. The defaults below are
    // duplicated as defaultValue in MOD_SETTING_SCHEMAS.slimBookmarks
    // (ModConfig.js) — the two lists must stay in step.
    // ------------------------------------------------------------------
    const MOD_CONFIG_KEY = 'slimBookmarks';
    const MOD_CONFIG_DIR = '.askonpage';
    const MOD_CONFIG_FILE = 'config.json';

    const settings = {
        maxBarWidth: 600,       // px, ceiling for the whole bar
        barLabelWidth: 105,     // px, ceiling for one bar button's title
        menuLabelWidth: 300,    // px, ceiling for one menu row's title
        labelMinWidth: 24,      // px, floor a bar title shrinks to before "…"
        displayMode: 'vivaldi', // vivaldi | titleAndIcon | titleOnly | iconOnly | iconExceptFolders
        hoverDelay: 120,        // ms, hovering a folder opens its menu
        dragOpenDelay: 400,     // ms, hovering a folder while dragging opens it
        barFolderId: '',        // overrides the folder the bar is built from
    };

    // key -> [min, max]. Values are clamped rather than rejected: ModConfig's
    // number inputs happily accept anything, and a bar with a 0 px ceiling
    // would just silently vanish with no hint as to why.
    const SETTING_LIMITS = {
        maxBarWidth: [120, 4000],
        barLabelWidth: [0, 600],
        menuLabelWidth: [80, 1200],
        labelMinWidth: [0, 300],
        hoverDelay: [0, 5000],
        dragOpenDelay: [0, 10000],
    };
    const DISPLAY_MODES = ['vivaldi', 'titleAndIcon', 'titleOnly', 'iconOnly', 'iconExceptFolders'];

    // Set by createBookmarkBar once the bar exists. The config may arrive
    // either before or after that — this is the single place both paths meet.
    let onSettingsChanged = null;

    let attempts = 0;
    const timer = setInterval(() => {
        attempts++;

        const toolbar = findToolbar();
        const isApiReady = typeof chrome !== 'undefined' && chrome.bookmarks;

        if (toolbar && isApiReady) {
            if (document.querySelector('.' + BAR_CLASS)) { clearInterval(timer); return; }

            console.log('✅ [SlimBookmarks] Inserting the bookmark bar...');
            try {
                injectStyles();
                createBookmarkBar();
            } catch (err) {
                // keep the interval alive: next attempt in 300 ms
                console.error('[SlimBookmarks] failed to build the bar:', err);
                return;
            }
            clearInterval(timer);
            // settings are read last — they no longer affect the bar itself
            watchVivaldiPrefs();
            return;
        }

        if (attempts >= 30) clearInterval(timer);
    }, 300);

    // ------------------------------------------------------------------
    // Vivaldi settings
    // ------------------------------------------------------------------
    // Some builds return the value itself, others an object {path, value}
    const unwrapPref = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);

    function prefsApi() {
        try {
            const prefs = (typeof vivaldi !== 'undefined' && vivaldi.prefs) || null;
            return prefs && typeof prefs.get === 'function' ? prefs : null;
        } catch {
            return null;
        }
    }

    // Reads one pref, hands the raw value to apply(), and calls done() — on
    // success, on failure and when the API stays silent alike. done() is what
    // openBookmark waits on, so it must never be left hanging; apply(), on the
    // other hand, only runs when there really is a value, so a failure simply
    // leaves the last known one in place.
    function readPref(path, apply, done) {
        const finishOnce = (() => {
            let settled = false;
            return () => { if (!settled) { settled = true; (done || (() => {}))(); } };
        })();

        const prefs = prefsApi();
        if (!prefs) { finishOnce(); return; }

        const receive = (value) => {
            if (chrome.runtime.lastError) {
                console.warn('[SlimBookmarks] could not read', path, chrome.runtime.lastError.message);
            } else {
                apply(unwrapPref(value));
            }
            finishOnce();
        };

        // if no answer arrives — carry on with the last known value
        setTimeout(finishOnce, 400);

        try {
            // the prefs.get signature differs between builds: some take an
            // object {path}, some a plain string — try both
            try {
                prefs.get({ path }, receive);
            } catch {
                prefs.get(path, receive);
            }
        } catch (err) {
            console.warn('[SlimBookmarks] reading the setting failed:', err);
            finishOnce();
        }
    }

    // Re-reads the setting and calls done() in every case. Nothing here may get
    // in the way of opening a bookmark.
    function readOpenInNewTab(done) {
        readPref(PREF_OPEN_NEW_TAB, (value) => { openInNewTabPref = !!value; }, done);
    }

    // The two prefs that shape the bar itself. Unlike open_in_new_tab they gate
    // no user action, so there is nothing to wait for — whatever arrives is
    // applied through onSettingsChanged, exactly like a ModConfig change.
    function readBarPrefs() {
        readPref(PREF_BAR_DISPLAY, (value) => {
            const mode = String(value || '').toLowerCase();
            // onChanged fires for every pref in Vivaldi, not just ours, so the
            // bar is rebuilt only when the value really moved — otherwise any
            // unrelated setting would close the menu the user has open
            if (!VIVALDI_DISPLAY_MODES[mode] || mode === barDisplayPref) return;
            barDisplayPref = mode;
            if (onSettingsChanged) onSettingsChanged();
        });
        readPref(PREF_BAR_FOLDERS, (value) => {
            if (!Array.isArray(value)) return;
            const ids = value.map(String).filter(Boolean);
            // the bar is rebuilt only when the choice actually changed: a
            // pointless reload closes whatever menu the user has open
            if (ids.join(',') === barFolderIdsPref.join(',')) return;
            barFolderIdsPref = ids;
            if (onSettingsChanged) onSettingsChanged();
        });
    }

    // Nothing here may break the bar: on any error we stay with the defaults
    // and log to the console.
    function watchVivaldiPrefs() {
        try {
            if (!prefsApi()) {
                console.warn('[SlimBookmarks] vivaldi.prefs unavailable — Vivaldi\'s own Bookmarks settings are not read');
                return;
            }

            readOpenInNewTab(() => {
                console.log('⚙️ [SlimBookmarks] Open in a new tab:', openInNewTabPref);
            });
            readBarPrefs();

            // The onChanged payload shape differs between builds, so we do not
            // parse it at all — any change simply triggers a re-read.
            prefsApi().onChanged?.addListener?.(() => {
                readOpenInNewTab(() => {});
                readBarPrefs();
            });
        } catch (err) {
            console.warn('[SlimBookmarks] subscribing to settings failed:', err);
        }
    }

    // ------------------------------------------------------------------
    // Mod settings (ModConfig)
    //
    // The same contract every other mod in the pack follows: read
    // .askonpage/config.json out of OPFS once at startup, then listen for
    // ModConfig's broadcast. A missing file is the normal case — the user has
    // simply never opened the panel — so it is not an error.
    // ------------------------------------------------------------------
    function applyModConfig(raw) {
        const source = raw?.mods?.[MOD_CONFIG_KEY] && typeof raw.mods[MOD_CONFIG_KEY] === 'object'
            ? raw.mods[MOD_CONFIG_KEY]
            : {};

        Object.keys(SETTING_LIMITS).forEach((key) => {
            const value = Number(source[key]);
            if (!Number.isFinite(value)) return;
            const [min, max] = SETTING_LIMITS[key];
            settings[key] = clamp(value, min, max);
        });
        if (DISPLAY_MODES.includes(source.displayMode)) {
            settings.displayMode = source.displayMode;
        }
        if (typeof source.barFolderId === 'string') {
            settings.barFolderId = source.barFolderId.trim();
        }
    }

    async function loadModConfig() {
        try {
            const root = await navigator.storage.getDirectory();
            const dir = await root.getDirectoryHandle(MOD_CONFIG_DIR, { create: true });
            const fileHandle = await dir.getFileHandle(MOD_CONFIG_FILE, { create: false });
            const file = await fileHandle.getFile();
            applyModConfig(JSON.parse(await file.text()));
        } catch (err) {
            console.warn('[SlimBookmarks] mod config not loaded, using defaults:', err);
        }
    }

    // The config load races the bar's own construction; whichever finishes
    // second finds the other side ready through onSettingsChanged.
    loadModConfig().then(() => { if (onSettingsChanged) onSettingsChanged(); });
    window.addEventListener('vivaldi-mod-config-updated', (event) => {
        applyModConfig(event.detail || {});
        if (onSettingsChanged) onSettingsChanged();
    });

    // The display the bar starts from, before the shrinking ladder narrows it.
    function baseDisplayMode() {
        if (settings.displayMode !== 'vivaldi') return settings.displayMode;
        return VIVALDI_DISPLAY_MODES[barDisplayPref] || 'titleAndIcon';
    }

    // ------------------------------------------------------------------
    // Appearance.
    //
    // Not a single colour of our own: everything comes from Vivaldi's theme
    // variables (style/common.css + the inline style on #browser). Geometry
    // and highlight values are copied from Vivaldi's native menus:
    //   container : .menu > ul            — colorBg/colorFg, radiusCap, padding 4px
    //   row       : .menu > ul li a       — 24px + densityGap, padding 0 9px, radiusHalf
    //   selection : the row under the cursor — colorBgDark, as in the native
    //                                       bookmark bar menus (the accent
    //                                       colour is used there only for the
    //                                       item selected with the keyboard)
    //   button    : .bookmark-bar button  — hover colorBgDark / colorAccentBgDark
    // Vivaldi's shadows are defined in black with transparency and do not
    // depend on the theme — we take exactly the same values as the native menus.
    // ------------------------------------------------------------------
    const STYLESHEET = `
        #${LAYER_ID} {
            position: fixed;
            top: 0;
            left: 0;
            width: 0;
            height: 0;
            overflow: visible;
            /* Window drag region. With disable-titlebar + address-top Vivaldi
               marks .mainbar as -webkit-app-region: drag, and such regions are
               handled outside hit testing: the menu is painted on top, but the
               window swallows mouse events over the toolbar strip — neither
               highlighting nor clicks worked. Vivaldi declares the same
               exception for its own interactive elements (common.css: button,
               input, .topmenu…); our menu rows are plain divs, so we declare
               the exception ourselves, for the whole layer. */
            -webkit-app-region: no-drag;
            /* The z-index is required exactly here. The layer is positioned, and
               such an element forms its own stacking context in Blink, so the
               z-index values of the menus inside the layer are only compared
               against each other. Without raising the layer itself it stays at
               auto, and Vivaldi's toolbar (common.css: .mainbar
               .toolbar-mainbar, z-index: 4) covers the top of a menu opened at
               the cursor over a bar button — it looks like a translucent strip
               on top of the menu. */
            z-index: ${MENU_Z_INDEX};
        }

        .${BAR_CLASS} {
            display: flex;
            align-items: center;
            flex-wrap: nowrap;
            gap: ${BTN_GAP}px;
            margin-left: 6px;
            /* flex: 0 1 auto + min-width: 0 -> the bar stops at its ceiling and
               yields room to the address field instead of squeezing it out */
            flex: 0 1 auto;
            min-width: 0;
            /* the fallbacks are only for the split second before
               applyBarVars() runs — the real values come from the settings */
            max-width: var(--sb-max-bar-width, 600px);
            overflow: hidden;
            /* same as the native .bookmark-bar */
            font-size: 11.5px;
        }

        .${BTN_CLASS} {
            display: flex;
            align-items: center;
            justify-content: flex-start;
            text-align: left;
            gap: 6px;
            padding: 0 6px;
            height: 22px;
            flex: 0 1 auto;
            min-width: 0;
            box-sizing: border-box;
            appearance: none;
            -webkit-appearance: none;
            border: none;
            outline: none;
            box-shadow: none;
            border-radius: var(--radiusHalf);
            background-color: transparent;
            color: inherit;
            fill: currentColor;
            font: inherit;
            white-space: nowrap;
            cursor: default;
        }

        /* The focus ring is Vivaldi's global rule (common.css: :focus-visible),
           and its specificity matches ours — so it is neutralised explicitly.
           The bar is not keyboard-navigable (the button gives focus up on
           mouseup), so no navigation cue is lost here. */
        .${BTN_CLASS}:focus,
        .${BTN_CLASS}:focus-visible {
            outline: none;
            box-shadow: none;
        }

        /* [hidden] loses to the button's display: flex, hence the explicit rule */
        .${BTN_CLASS}[hidden] {
            display: none;
        }

        /* Rule order = priority: base hover, then the theme variants, then the
           opened button. Their specificity is identical. */
        .${BTN_CLASS}:hover {
            background-color: var(--colorBgDark);
        }
        #browser.color-behind-tabs-on .${BTN_CLASS}:hover {
            background-color: var(--colorBgDark);
        }
        #browser.color-behind-tabs-off .${BTN_CLASS}:hover {
            background-color: var(--colorAccentBgDark);
        }
        #browser.unified-ui .${BTN_CLASS}:hover {
            background-color: var(--colorBgAlphaHeavier);
        }

        .${BTN_CLASS}.${OPEN_CLASS} {
            background-color: var(--colorBgDarker);
        }
        #browser.color-behind-tabs-off .${BTN_CLASS}.${OPEN_CLASS} {
            background-color: var(--colorAccentBgDarker);
        }
        #browser.unified-ui .${BTN_CLASS}.${OPEN_CLASS} {
            background-color: var(--colorBgAlphaHeavy);
        }

        /* app-region inheritance is not guaranteed, so we repeat the exception
           on everything inside the layer. */
        #${LAYER_ID} * {
            -webkit-app-region: no-drag;
        }

        .${MENU_CLASS} {
            /* position: fixed -> coordinates relative to the viewport, nothing
               can clip it. Scrolling is safe here: submenus live in the layer,
               not inside this menu. */
            position: fixed;
            top: 0;
            left: 0;
            visibility: hidden;
            text-align: left;
            color: var(--colorFg);
            /* In some Vivaldi themes --colorBg is translucent: the native menus
               hide that with a backdrop blur (--backgroundBlur), while in our
               case the toolbar simply showed through the menu. We take only the
               RGB from the theme and drop the alpha — same colour, but the menu
               is opaque. The first line is a fallback for builds without
               relative colour syntax, where the menu stays as it was. */
            background-color: var(--colorBg);
            background-color: rgb(from var(--colorBg) r g b / 1);
            fill: currentColor;
            border: none;
            border-radius: var(--radiusCap);
            padding: 4px;
            font: inherit;
            font-size: 13px;
            box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1), 0 3px 10px rgba(0, 0, 0, 0.3);
            min-width: 150px;
            max-width: 420px;
            max-height: 80vh;
            overflow-x: hidden;
            overflow-y: auto;
        }

        /* The contents of a row or a button take no part in hover: the target
           must be the row itself. Otherwise Vivaldi does not repaint its
           background when a descendant is hovered — the computed style is
           already :hover, but the painted fill stays the old one. */
        .${ROW_CLASS} > *,
        .${BTN_CLASS} > * {
            pointer-events: none;
        }

        .${ROW_CLASS} {
            display: flex;
            align-items: center;
            gap: 9px;
            height: calc(24px + var(--densityGap, 0px));
            padding: 0 9px;
            border-radius: var(--radiusHalf);
            color: inherit;
            background-color: transparent;
            white-space: nowrap;
            overflow: hidden;
            cursor: default;
        }

        .${SEP_CLASS} {
            height: 1px;
            margin: 4px 9px;
            background-color: var(--colorBorder);
        }

        /* Edit dialog. Vivaldi's native dialog is unreachable from a mod, but
           the geometry and colours are taken from its own theme, so the window
           looks native. The z-index is above the context menu: the dialog opens
           on top of it. */
        .${DIALOG_CLASS} {
            position: fixed;
            inset: 0;
            z-index: ${MENU_Z_INDEX + 300};
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: rgba(0, 0, 0, 0.35);
        }

        .${DIALOG_CLASS}-box {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 320px;
            max-width: 90vw;
            padding: 16px;
            color: var(--colorFg);
            background-color: var(--colorBg);
            background-color: rgb(from var(--colorBg) r g b / 1);
            border-radius: var(--radiusCap);
            box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1), 0 6px 24px rgba(0, 0, 0, 0.4);
            font: inherit;
            font-size: 13px;
        }

        .${DIALOG_CLASS}-heading {
            font-weight: 600;
        }

        .${DIALOG_CLASS}-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .${DIALOG_CLASS}-field > span {
            color: var(--colorFgFadedMore);
        }
        .${DIALOG_CLASS}-field > input {
            height: 26px;
            padding: 0 8px;
            color: inherit;
            background-color: var(--colorBgDark);
            background-color: rgb(from var(--colorBgDark) r g b / 1);
            border: 1px solid var(--colorBorder);
            border-radius: var(--radiusHalf);
            font: inherit;
            font-size: 13px;
        }
        .${DIALOG_CLASS}-field > input:focus {
            outline: 2px solid var(--colorHighlightBg);
            outline-offset: -1px;
        }

        .${DIALOG_CLASS}-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 4px;
        }
        .${DIALOG_CLASS}-button {
            height: 26px;
            padding: 0 14px;
            appearance: none;
            -webkit-appearance: none;
            color: inherit;
            background-color: var(--colorBgDark);
            border: none;
            border-radius: var(--radiusHalf);
            font: inherit;
            font-size: 13px;
            cursor: default;
        }
        .${DIALOG_CLASS}-button:hover {
            background-color: var(--colorBgDarker);
        }
        .${DIALOG_CLASS}-button.is-primary {
            color: var(--colorHighlightFg);
            background-color: var(--colorHighlightBg);
        }
        .${DIALOG_CLASS}-button.is-primary:hover {
            filter: brightness(1.1);
        }


        /* Row highlight: the theme's grey background, as in the native bookmark
           bar menus. In practice it is applied by setRowActive writing into the
           element's inline style — inside Vivaldi's UI window the rule below
           does not repaint the row. The rule is kept as a fallback for
           environments where painting behaves. */
        .${ROW_CLASS}:hover,
        .${ROW_CLASS}.${ACTIVE_CLASS} {
            background-color: var(--colorBgDark);
        }

        .${MENU_CLASS}-icon {
            display: block;
            flex: 0 0 16px;
            width: 16px;
            height: 16px;
        }
        img.${MENU_CLASS}-icon {
            border-radius: 3px;
            object-fit: contain;
        }
        svg.${MENU_CLASS}-icon {
            opacity: 0.85;
        }

        /* A halo for favicons that get lost on a dark background (a dark glyph
           on a transparent background — the GitHub case). The trick is borrowed
           from Vivaldi, where it is applied to the active tab's favicon:
             .theme-dark .tab.active .tab-header .favicon:not(.svg)
           But the native rule puts an outline around the whole icon, so the edge
           shows up even on bright icons that do not need it. That is why the
           shadow is replaced with an SVG filter: it finds the dark pixels by
           itself, and for a bright icon the mask comes out empty. The graph is
           broken down at makeHaloDefs.

           The halo colour is set here rather than in the filter markup:
           flood-color understands var(), and the <feFlood> elements themselves
           live in <defs> inside #browser, so the theme variables are available
           to them. The 75% opacity is the native one.

           The selectors only target img: the SVG placeholders (folder, globe)
           are painted with currentColor and need no highlight.

           The background behind the icon depends on the location, hence three
           rules:
             menu — always --colorBg;
             bar  — also --colorBg, except in "accent on the address bar" mode,
                    where the toolbar is filled with --colorAccentBg.
           The cross cases resolve themselves: dark theme + light accent -> a
           halo only in the menu, and vice versa. */
        #${HALO_FG_ID} feFlood {
            flood-color: var(--colorFg);
            flood-opacity: 0.75;
        }
        #${HALO_ACCENT_ID} feFlood {
            flood-color: var(--colorAccentFg);
            flood-opacity: 0.75;
        }
        #browser.theme-dark .${MENU_CLASS} img.${MENU_CLASS}-icon,
        #browser.theme-dark:not(.color-behind-tabs-off) .${BAR_CLASS} img.${MENU_CLASS}-icon {
            filter: url(#${HALO_FG_ID});
        }
        #browser.acc-dark.color-behind-tabs-off .${BAR_CLASS} img.${MENU_CLASS}-icon {
            filter: url(#${HALO_ACCENT_ID});
        }

        .${MENU_CLASS}-label {
            display: block;
            /* line-height exactly the icon height: otherwise the text box sits
               below the image and the label visually drifts downwards */
            line-height: 16px;
            height: 16px;
            min-width: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            text-align: left;
        }

        /* Step 1: the label shrinks down to the floor, then "…".
           Step 2: labels are dropped entirely, only icons remain. */
        .${BAR_CLASS} .${MENU_CLASS}-label {
            flex: 0 1 auto;
            min-width: var(--sb-label-min, 24px);
        }
        .${BAR_CLASS}.${ICONS_CLASS} .${MENU_CLASS}-label {
            display: none;
        }

        /* Display modes that Vivaldi's own bookmark bar offers, reproduced
           here (Settings > Bookmarks > Bookmark Bar > Display), plus the same
           choices as explicit overrides in the mod's own settings.
           "Icons only" is ICONS_CLASS above — it doubles as step 2 of the
           shrinking ladder. */
        /* :not(chevron) — the overflow button is nothing but its icon, so
           hiding icons wholesale would leave an empty square at the end */
        .${BAR_CLASS}.${TEXT_CLASS} .${BTN_CLASS}:not(.${CHEVRON_CLASS}) .${ICON_CLASS} {
            display: none;
        }
        .${BAR_CLASS}.${ICONS_NF_CLASS} .${BTN_CLASS}:not(.${FOLDER_BTN_CLASS}) .${MENU_CLASS}-label {
            display: none;
        }

        /* The native submenu arrow: --svgArrow is declared on :root in
           common.css and points down, so we rotate it towards the unfold side. */
        .${MENU_CLASS}-arrow {
            flex: 0 0 16px;
            width: 16px;
            height: 16px;
            margin-left: auto;
            background-color: currentColor;
            mask-image: var(--svgArrow);
            mask-repeat: no-repeat;
            mask-position: center;
            mask-size: 16px 16px;
            rotate: -90deg;
            opacity: 0.65;
        }
        #browser.RTL .${MENU_CLASS}-arrow {
            rotate: 90deg;
        }

        .${MENU_CLASS}-empty {
            display: flex;
            align-items: center;
            height: calc(24px + var(--densityGap, 0px));
            padding: 0 9px;
            color: var(--colorFgFadedMore);
        }

        .${DROP_LINE_CLASS} {
            position: fixed;
            display: none;
            z-index: ${MENU_Z_INDEX + 200};
            background-color: var(--colorHighlightBg);
            border-radius: 1px;
            pointer-events: none;
        }

        /* "into the folder" — outline the target so it cannot be confused with
           the insertion line for "next to" */
        .${BTN_CLASS}.${DROP_INTO_CLASS},
        .${ROW_CLASS}.${DROP_INTO_CLASS} {
            outline: 2px solid var(--colorHighlightBg);
            outline-offset: -2px;
        }
    `;

    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = STYLESHEET;
        (document.head || document.documentElement).appendChild(style);
    }

    // ------------------------------------------------------------------
    // Halo filter.
    //
    // The goal: outline in a light colour only those favicon pixels that drown
    // in a dark background, and leave bright icons alone. The solution is
    // per-pixel, without reading the image in JS (a canvas over
    // chrome://favicon2 may turn out tainted, and the "whole icon at once"
    // approach is too coarse anyway).
    //
    // Filter graph:
    //   1. luminanceToAlpha       -> alpha = pixel luminance
    //   2. feComponentTransfer    -> threshold: full halo at luminance <= 0.125,
    //                                fading out towards 0.375, nothing beyond.
    //      The threshold is on luminance itself, not on "1 - luminance":
    //      saturated colours have low luminance (#ff6600 -> 0.50), and a linear
    //      inversion would draw an edge around orange and grey icons.
    //   3. feComposite in         -> keep only the opaque pixels (transparent
    //                                ones have zero RGB and would read as black)
    //   4. feMorphology dilate    -> grow the mask by 1px
    //   5. feComposite out        -> keep only what spilled outside the icon:
    //                                the outline appears where a dark pixel
    //                                borders on emptiness
    //   6. feFlood + in           -> paint the mask (colour comes from CSS)
    //   7. feMerge                -> the filled mask underneath the original icon
    //
    // Hence the behaviour, with no heuristics at all: an opaque light tile gets
    // no edge (there are no dark pixels), an opaque dark one does (it gets lost
    // too), a dark glyph on a transparent background is outlined along its
    // silhouette, and a grey glyph — proportionally to how dark it is.
    // ------------------------------------------------------------------
    const SVG_NS = 'http://www.w3.org/2000/svg';

    function svgEl(tag, attrs, children) {
        const el = document.createElementNS(SVG_NS, tag);
        Object.entries(attrs || {}).forEach(([k, v]) => el.setAttribute(k, v));
        (children || []).forEach(child => el.appendChild(child));
        return el;
    }

    // The two filters differ only by id: the fill colour comes from STYLESHEET
    function haloFilter(id) {
        return svgEl('filter', {
            id,
            // the filter region is larger than the dilation: otherwise the
            // outline would be clipped
            x: '-50%', y: '-50%', width: '200%', height: '200%',
            // filters compute in linearRGB by default, while the luminance
            // threshold was tuned in sRGB
            'color-interpolation-filters': 'sRGB',
        }, [
            svgEl('feColorMatrix', { in: 'SourceGraphic', type: 'luminanceToAlpha', result: 'lum' }),
            svgEl('feComponentTransfer', { in: 'lum', result: 'dark' }, [
                svgEl('feFuncA', { type: 'table', tableValues: '1 1 0.3 0 0 0 0 0 0' }),
            ]),
            svgEl('feComposite', { in: 'dark', in2: 'SourceGraphic', operator: 'in', result: 'darkOpaque' }),
            svgEl('feMorphology', { in: 'darkOpaque', operator: 'dilate', radius: '1', result: 'spread' }),
            svgEl('feComposite', { in: 'spread', in2: 'SourceGraphic', operator: 'out', result: 'ring' }),
            svgEl('feFlood', { result: 'flood' }),
            svgEl('feComposite', { in: 'flood', in2: 'ring', operator: 'in', result: 'halo' }),
            svgEl('feMerge', {}, [
                svgEl('feMergeNode', { in: 'halo' }),
                svgEl('feMergeNode', { in: 'SourceGraphic' }),
            ]),
        ]);
    }

    function makeHaloDefs() {
        const svg = svgEl('svg', { width: '0', height: '0', 'aria-hidden': 'true' }, [
            svgEl('defs', {}, [haloFilter(HALO_FG_ID), haloFilter(HALO_ACCENT_ID)]),
        ]);
        svg.style.cssText = 'position: absolute; width: 0; height: 0; overflow: hidden;';
        return svg;
    }

    // ------------------------------------------------------------------
    // Menu layer.
    //
    // It lives inside #browser, and that is essential: Vivaldi's theme
    // variables (--colorBg, --colorFg, --colorHighlightBg, --radius*,
    // --densityGap) are declared exactly on #browser — by the window's inline
    // style and by common.css rules. They are not inherited into <body>, so a
    // menu placed there picked up system colours and stayed light in a dark
    // theme.
    // Nothing can clip the layer: #browser has no transform/filter/contain, so
    // position: fixed inside it is still resolved against the viewport.
    // ------------------------------------------------------------------
    function layerHost() {
        return document.getElementById('browser') || document.body;
    }

    function getLayer() {
        const host = layerHost();
        let layer = document.getElementById(LAYER_ID);
        if (!layer) {
            layer = document.createElement('div');
            layer.id = LAYER_ID;
            // <defs> are kept right here: the layer lives inside #browser, so
            // flood-color sees the theme variables, and the defs travel along
            // with the layer if it ever has to be recreated
            layer.appendChild(makeHaloDefs());
        }
        // a window repaint could have pulled the layer out of the tree or left
        // it in its previous parent — check every time and put it back
        if (layer.parentElement !== host) host.appendChild(layer);
        return layer;
    }

    const openMenus = [];   // stack: [top-level menu, submenu, ...]
    let hoverTimer = null;
    let activeBarBtn = null;

    // A menu holding a live drag source is never closed: removing the node the
    // drag started from kills the drag, and the user is left holding nothing.
    // The loop stops at that menu rather than skipping it — the menus above it
    // are its own submenus, and closing those while keeping this one would
    // leave the stack inconsistent.
    // Deliberately unconditional, including while a drag is in flight. Closing
    // the menu a drag started from does not cancel that drag — Blink captured
    // the payload at dragstart and the session outlives the source node — and
    // the folder that auto-opens under a dragged item comes through
    // openBarMenu(), which closes the whole stack first. An exception for the
    // drag source here made that opened folder refuse every drop.
    function closeFrom(depth) {
        while (openMenus.length > depth) {
            const menu = openMenus.pop();
            if (menu === ctxMenu) ctxMenu = null;
            menu.remove();
        }
        if (!openMenus.length && activeBarBtn) {
            activeBarBtn.classList.remove(OPEN_CLASS);
            activeBarBtn = null;
        }
    }

    // Closes the menus and nothing else. It must stay drag-neutral: dragging an
    // item onto a bar folder auto-opens that folder through openBarMenu(),
    // which starts here — ending the drag at that point left the folder open
    // but inert, with no insertion line and no drop.
    function closeAll() {
        clearTimeout(hoverTimer);
        highlightBg = null;     // the theme may have changed between sessions
        closeFrom(0);
    }

    // true if the element's content does not fit its current box — exactly what
    // overflow: hidden in STYLESHEET produces, but measurable from JS
    const overflowing = (el) => el.scrollWidth > el.clientWidth + 1;

    // ------------------------------------------------------------------
    // Bookmark bar: top-level items as buttons in the toolbar
    // ------------------------------------------------------------------
    function createBookmarkBar() {
        const bar = document.createElement('div');
        // no Vivaldi classes: their rules centre the text, impose a min-width
        // and draw a focus ring — because of them labels got clipped in the middle
        bar.className = BAR_CLASS;

        let barButtons = [];    // top-level buttons
        let barFolderId = null; // id of the folder the bar was built from
        let barItems = [];      // children of the bar folder in their current order

        // The two size settings the stylesheet needs. They are custom
        // properties rather than a re-injected stylesheet: the sheet is shared
        // by the bar and by every menu in the layer, and replacing it under an
        // open menu would restart its transitions.
        function applyBarVars() {
            bar.style.setProperty('--sb-max-bar-width', settings.maxBarWidth + 'px');
            bar.style.setProperty('--sb-label-min', settings.labelMinWidth + 'px');
        }

        function render(items) {
            // rebuilding the bar pulls every button out of the tree, including
            // the ones a current drag may be bound to (the source and/or the
            // "into the folder" target) — a stale reference would keep the
            // outline/timer on an element outside the document and would keep
            // accepting further dragover events against an already outdated
            // snapshot of the tree, so a live drag is simply aborted here
            if (dragNode) endDrag();
            barItems = items;
            barButtons.forEach(b => b.remove());
            barButtons = [];

            items.forEach((item) => {
                const btn = makeBarButton();
                const isFolder = !item.url;

                btn.append(makeIcon(item), makeLabel(item, settings.barLabelWidth));
                btn.title = tooltipOf(item);
                btn._node = item;   // the node is needed by the context menu and by dragging
                btn.addEventListener('contextmenu', (e) => {
                    // without preventDefault the toolbar menu shows up over ours
                    e.preventDefault();
                    e.stopPropagation();
                    showContextMenu({ node: item, parentId: barFolderId }, e.clientX, e.clientY, 0);
                });
                makeDraggable(btn, item);
                makeDropTarget(btn, {
                    node: item,
                    parentId: barFolderId,
                    axis: 'x',
                    openFolder: isFolder
                        ? () => openBarMenu(btn, item.children || [], item.id)
                        : null,
                });

                if (isFolder) {
                    // the marker the "icons except folders" display mode selects on
                    btn.classList.add(FOLDER_BTN_CLASS);
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        clearTimeout(hoverTimer);
                        // clicking an already open folder does nothing: neither
                        // closing nor rebuilding — the menu simply stays
                        openBarMenu(btn, item.children || [], item.id);
                    });
                    btn.addEventListener('mouseenter', () => {
                        if (ctxMenu || dragNode) return;    // the context menu and a live drag keep focus
                        // if a menu is already open — hovering switches the
                        // folder, as in the native bookmark bar
                        if (!openMenus.length || activeBarBtn === btn) return;
                        clearTimeout(hoverTimer);
                        hoverTimer = setTimeout(() => openBarMenu(btn, item.children || [], item.id), settings.hoverDelay);
                    });
                } else {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        // Ctrl/⌘ — open in the background, without switching
                        openBookmark(item.url, e.ctrlKey || e.metaKey);
                        closeAll();
                    });
                    btn.addEventListener('auxclick', (e) => {
                        if (e.button !== 1) return;
                        e.stopPropagation();
                        openBookmark(item.url, true);   // middle click — in the background
                        closeAll();
                    });
                    btn.addEventListener('mouseenter', () => {
                        if (ctxMenu || dragNode) return;    // the context menu and a live drag keep focus
                        if (!openMenus.length) return;
                        clearTimeout(hoverTimer);
                        hoverTimer = setTimeout(closeAll, settings.hoverDelay);
                    });
                }

                barButtons.push(btn);
                bar.appendChild(btn);
            });

            bar.appendChild(chevron);   // the buttons were appended after it
            fitBar();
        }

        function openBarMenu(btn, items, folderId) {
            if (activeBarBtn === btn) return;   // already opened by this button
            closeAll();
            const menu = buildMenu(items, 0, folderId);
            getLayer().appendChild(menu);
            openMenus.push(menu);
            positionRoot(menu, btn);
            activeBarBtn = btn;
            btn.classList.add(OPEN_CLASS);
        }

        // The shrinking ladder. Step 1 (clipping labels) is entirely CSS; only
        // step 2 lives here: once the minimums no longer fit, labels are dropped
        // completely. The ladder is monotonic: we always try the fullest look
        // first, otherwise the state would depend on history.
        //
        // The ladder starts from whatever display mode is in force rather than
        // always from icon + title, and step 2 is skipped where it makes no
        // sense: with titles only there is no icon left to recognise a button
        // by, and with icons only there is no title left to drop.
        let fitting = false;
        function fitBar() {
            if (fitting || !bar.isConnected) return;
            fitting = true;

            // always start from the fullest look — otherwise the result would
            // depend on what had been hidden earlier
            const mode = baseDisplayMode();
            bar.classList.remove(ICONS_CLASS, TEXT_CLASS, ICONS_NF_CLASS);
            if (mode === 'titleOnly') bar.classList.add(TEXT_CLASS);
            if (mode === 'iconOnly') bar.classList.add(ICONS_CLASS);
            if (mode === 'iconExceptFolders') bar.classList.add(ICONS_NF_CLASS);
            barButtons.forEach((btn) => { btn.hidden = false; });
            chevron.hidden = true;
            hiddenItems = [];

            if (overflowing(bar) && (mode === 'titleAndIcon' || mode === 'iconExceptFolders')) {
                bar.classList.remove(ICONS_NF_CLASS);
                bar.classList.add(ICONS_CLASS);          // step 2: icons only
            }
            if (overflowing(bar)) {
                // step 3: whatever still does not fit moves under the chevron,
                // starting from the end
                chevron.hidden = false;
                for (let i = barButtons.length - 1; i >= 0; i--) {
                    barButtons[i].hidden = true;
                    hiddenItems.unshift(barButtons[i]._node);
                    if (!overflowing(bar)) break;
                }
            }

            fitting = false;
        }

        // A right click on the free space between/after the buttons = the
        // context menu of the bar folder itself, so that a new folder can be
        // added to the top level of the bar. An event from a button never
        // reaches here: there is a stopPropagation over there.
        bar.addEventListener('contextmenu', (e) => {
            if (!barFolderId) return;   // no folder resolved yet -> leave the native menu alone
            e.preventDefault();
            e.stopPropagation();
            showContextMenu({ node: null, parentId: barFolderId }, e.clientX, e.clientY, 0);
        });

        // A drop on the free space to the right of the buttons = to the end of
        // the bar folder. An event from a button never reaches here: there is a
        // stopPropagation over there.
        bar.addEventListener('dragover', (e) => {
            if (!dragNode || !barFolderId) return;
            const dest = { parentId: barFolderId };
            if (!canDrop(dragNode, dest)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // after: true -> the line stands at the bar's right edge, that is,
            // exactly where the item will end up
            showDropFeedback(bar, { parentId: barFolderId, index: barItems.length, after: true }, 'x');
        });
        bar.addEventListener('drop', (e) => {
            e.preventDefault();
            // the drop location is recomputed from this very drop event: the
            // cursor may have last been over another element
            const dest = dragNode && barFolderId ? { parentId: barFolderId } : null;
            if (dragNode && dest && canDrop(dragNode, dest)) applyDrop(dragNode, dest);
            endDrag();
        });
        bar.addEventListener('dragleave', (e) => {
            if (!bar.contains(e.relatedTarget)) clearDropFeedback();
        });

        // Step 3: whatever did not fit even in icons-only mode moves into this
        // button's menu. The button itself is never hidden and is not part of
        // barButtons, otherwise fitBar could hide it too.
        let hiddenItems = [];   // items that did not fit into the bar
        const chevron = makeBarButton();
        chevron.classList.add(CHEVRON_CLASS);
        chevron.appendChild(chevronIcon());
        chevron.title = 'Other bookmarks';
        chevron.hidden = true;
        chevron.addEventListener('click', (e) => {
            e.stopPropagation();
            clearTimeout(hoverTimer);
            openBarMenu(chevron, hiddenItems, barFolderId);
        });
        chevron.addEventListener('mouseenter', () => {
            if (ctxMenu || dragNode) return;
            if (!openMenus.length || activeBarBtn === chevron) return;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(() => openBarMenu(chevron, hiddenItems, barFolderId), settings.hoverDelay);
        });
        bar.appendChild(chevron);

        insertBar(bar);
        // We observe the parent: the toolbar decides how much free space there
        // is, while changes to the bar itself are caused by us — otherwise it
        // would be a loop. The same observer is reused on every (re-)insertion
        // of the bar: disconnect() stops watching the previous parent before
        // starting to watch the new one — without that, repeated insertions
        // (leaving toolbar customization mode) would pile up observers, and only
        // the very first one — possibly attached to a parent already detached
        // from the document — would be considered current.
        const resizeObserver = new ResizeObserver(fitBar);
        const rewatchParent = () => {
            resizeObserver.disconnect();
            if (bar.parentElement) resizeObserver.observe(bar.parentElement);
        };
        rewatchParent();
        // after every re-insertion of the bar (leaving toolbar customization
        // mode) we need both to recompute the shrinking ladder for the current
        // size and to move the observation to the current parent — without that
        // the bar sticks in a state computed for the previous size until the
        // next "real" window resize
        watchToolbarEditMode(bar, () => { rewatchParent(); fitBar(); });
        // the bar's own icons need the filter right away, without waiting for
        // the first menu
        getLayer();

        // --- data and its updates ---
        function load() {
            chrome.bookmarks.getTree((tree) => {
                const folder = resolveBarFolder(tree);
                console.log('📚 [SlimBookmarks] Bar folder:', folder?.id, folder?.title);
                barFolderId = folder?.id || null;
                render(folder?.children || []);
            });
        }

        let reloadTimer = null;
        const scheduleReload = () => {
            clearTimeout(reloadTimer);
            reloadTimer = setTimeout(() => { closeAll(); load(); }, 200);
        };
        ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered']
            .forEach(ev => chrome.bookmarks[ev]?.addListener(scheduleReload));

        // changing the bar folder itself changes meta_info, not the bookmark structure
        if (typeof vivaldi !== 'undefined') {
            vivaldi.bookmarksPrivate?.onMetaInfoChanged?.addListener(scheduleReload);
        }

        applyBarVars();
        load();

        // Settings changed — from ModConfig or from Vivaldi's own Bookmarks
        // page. A full reload rather than a targeted update: the label widths
        // are baked into the buttons at build time, and the folder the bar is
        // built from may have changed too. Open menus go first — they were
        // built against the old widths.
        onSettingsChanged = () => {
            applyBarVars();
            closeAll();
            load();
        };

        // --- global closing ---
        document.addEventListener('click', (e) => {
            // while the context menu is open, a click outside only dismisses it
            if (ctxMenu && !ctxMenu.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                // the index is a safeguard in case the "ctxMenu is in openMenus"
                // invariant is ever broken: -1 in closeFrom would reach
                // undefined.remove()
                closeFrom(Math.max(0, openMenus.indexOf(ctxMenu)));
                return;
            }
            if (bar.contains(e.target)) return;
            if (openMenus.some(m => m.contains(e.target))) return;
            closeAll();
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            // the one place a drag really is being cancelled by the user
            endDrag();
            closeAll();
            closeEditDialog();
        });
        window.addEventListener('blur', closeAll);
        window.addEventListener('resize', () => { closeAll(); fitBar(); });
    }

    // ------------------------------------------------------------------
    // Bar insertion and toolbar customization mode
    //
    // Vivaldi determines where to insert its own elements by the indices of the
    // toolbar's children, so our extra node shifts everything by one. Hiding it
    // with display: none is useless — the node stays in the DOM and is still
    // counted. While editing is in progress we remove the bar from the tree
    // entirely.
    // ------------------------------------------------------------------
    function findToolbar() {
        return document.querySelector('.toolbar-addressbar')
            || document.querySelector('.toolbar-mainbar')
            || document.querySelector('[role="toolbar"]')
            || document.querySelector('.UrlBar-AddressField')?.parentElement
            || null;
    }

    function insertBar(bar) {
        const toolbar = findToolbar();
        if (!toolbar) return false;

        const addressField = toolbar.querySelector('.UrlBar-AddressField');
        if (addressField && addressField.nextSibling) {
            toolbar.insertBefore(bar, addressField.nextSibling);
        } else {
            toolbar.appendChild(bar);
        }
        return true;
    }

    function watchToolbarEditMode(bar, onInserted) {
        // the class sits on the root <div id="browser">
        const root = document.getElementById('browser');
        if (!root) {
            console.warn('[SlimBookmarks] #browser not found — customization mode is not tracked');
            return;
        }

        const isEditing = () => root.classList.contains('toolbar-edit-mode');

        const sync = () => {
            if (isEditing()) {
                if (bar.isConnected) {
                    closeAll();
                    bar.remove();
                }
                return;
            }
            // leaving the mode repaints the toolbar, and our insertion may be
            // wiped by the next render — hence a couple of extra attempts. After
            // every (including deferred) successful insertion, onInserted()
            // recomputes the shrinking ladder and moves the ResizeObserver to the
            // current parent — without that the bar stays in a state computed for
            // the previous size after leaving customization mode, until the user
            // touches the window manually
            if (!bar.isConnected && insertBar(bar)) onInserted();
            [200, 600].forEach(delay => setTimeout(() => {
                if (!isEditing() && !bar.isConnected && insertBar(bar)) onInserted();
            }, delay));
        };

        new MutationObserver(sync).observe(root, {
            attributes: true,
            attributeFilter: ['class'],
        });

        sync();
    }

    // ------------------------------------------------------------------
    // Finding the folder the user picked as the bookmark bar
    // ------------------------------------------------------------------
    function isBarFolder(node) {
        if (node.url) return false;
        // a Vivaldi build may expose the flag both as meta_info and as a node property
        const meta = node.meta_info || node.metaInfo;
        if (meta && String(meta.Bookmarkbar) === 'true') return true;
        return node.bookmarkbar === true || String(node.bookmarkbar) === 'true';
    }

    function findNode(node, predicate) {
        if (predicate(node)) return node;
        for (const child of node.children || []) {
            const hit = findNode(child, predicate);
            if (hit) return hit;
        }
        return null;
    }

    function resolveBarFolder(tree) {
        const roots = (tree[0]?.children || []).filter(r => r.id !== TRASH_ID);
        const findById = (id) => {
            for (const root of roots) {
                const hit = findNode(root, n => n.id === String(id));
                if (hit) return hit;
            }
            return null;
        };

        // the explicit override wins over everything: it exists precisely for
        // the case where the two automatic sources below get it wrong
        const forcedId = String(settings.barFolderId || FORCE_FOLDER_ID || '').trim();
        if (forcedId) {
            const forced = findById(forcedId);
            if (forced) return forced;
            console.warn('[SlimBookmarks] Bar Folder ID not found:', forcedId);
        }

        for (const root of roots) {
            const flagged = findNode(root, isBarFolder);
            if (flagged) return flagged;
        }

        // Vivaldi's own "Bookmark Bar folder" setting. meta_info comes first
        // because that is what Vivaldi writes when the folder is picked from
        // the bar itself; the pref is the same choice as stored in settings,
        // and it is the only source left when the tree snapshot this build
        // hands us carries no meta_info at all.
        for (const id of barFolderIdsPref) {
            const picked = findById(id);
            if (picked) return picked;
        }

        // no custom folder picked — the stock bookmark bar (id '1')
        return roots.find(r => r.id === '1') || roots[0] || null;
    }

    function makeBarButton() {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = BTN_CLASS;
        // Vivaldi draws a focus ring on toolbar buttons — it is out of place here.
        // The blur has to happen on mouseup, not on focus: blurring inside the
        // focus that a mousedown produces aborts the drag Blink is about to
        // start, so dragging a bar button only worked about one time in four.
        // After a drop no mouseup is dispatched at all, so this cannot interfere
        // with a drag; the ring itself is suppressed in STYLESHEET.
        btn.addEventListener('mouseup', () => btn.blur());
        return btn;
    }

    // Menu row highlight: a class, with the colours for it picked in STYLESHEET
    // following the rules of Vivaldi's native menus.
    // The row highlight colour matches Vivaldi's native bookmark bar menus: the
    // theme's grey background, with the text keeping its own colour. The accent
    // --colorHighlightBg is reserved there for the item selected with the
    // keyboard (selectedItem), not for the one under the cursor.
    // getComputedStyle(#browser) forces a style recalculation of Vivaldi's whole
    // UI tree, and this is called from mousemove — so it used to run on every
    // single pointer movement across a menu. The colour cannot change while a
    // menu is open, so it is read once per menu session and dropped in
    // closeAll(), where the next session begins.
    let highlightBg = null;

    function rowHighlightColors() {
        if (highlightBg === null) {
            highlightBg = getComputedStyle(layerHost()).getPropertyValue('--colorBgDark').trim();
        }
        return { bg: highlightBg, fg: '' };
    }

    // The highlight is written straight into the element's style, not only as a
    // class. Inside Vivaldi's UI window the rule from our stylesheet does not
    // repaint the row under the cursor: its computed style is already
    // highlighted, but it is painted with the old background. Writing into the
    // element's style always produces a repaint. The class stays: the code uses
    // it to tell which row is active.
    function setRowActive(row, on) {
        row.classList.toggle(ACTIVE_CLASS, on);
        if (!on) {
            row.style.backgroundColor = '';
            row.style.color = '';
            return;
        }
        const { bg, fg } = rowHighlightColors();
        if (bg) row.style.backgroundColor = bg;
        if (fg) row.style.color = fg;
    }

    // Highlighting follows the actual cursor position rather than a chain of
    // mouseenter events: the menu often appears underneath an already stationary
    // cursor, and then no row-entered event arrives at all.
    function trackRowUnderPointer(menu) {
        menu.addEventListener('mousemove', (e) => {
            const row = e.target.closest ? e.target.closest('.' + ROW_CLASS) : null;
            menu.querySelectorAll('.' + ROW_CLASS + '.' + ACTIVE_CLASS)
                .forEach((other) => { if (other !== row) setRowActive(other, false); });
            if (row) setRowActive(row, true);
        });
    }

    // ------------------------------------------------------------------
    // Icons and labels
    // ------------------------------------------------------------------
    const ICON_SIZE = 16;

    function svgIcon(pathD) {
        const ns = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        svg.setAttribute('class', ICON_CLASS);
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.3');
        svg.setAttribute('stroke-linejoin', 'round');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', pathD);
        svg.appendChild(path);
        return svg;
    }

    const folderIcon = () => svgIcon('M1.8 4.3a1.3 1.3 0 0 1 1.3-1.3h2.7l1.4 1.7h5.9a1.3 1.3 0 0 1 1.3 1.3v6a1.3 1.3 0 0 1-1.3 1.3H3.1a1.3 1.3 0 0 1-1.3-1.3V4.3Z');
    const globeIcon = () => svgIcon('M8 1.6a6.4 6.4 0 1 0 0 12.8A6.4 6.4 0 0 0 8 1.6Zm0 0c-1.8 1.5-2.7 3.6-2.7 6.4S6.2 12.9 8 14.4c1.8-1.5 2.7-3.6 2.7-6.4S9.8 3.1 8 1.6ZM1.8 8h12.4');
    const chevronIcon = () => svgIcon('M4.5 4l4 4-4 4M9.5 4l4 4-4 4');

    function makeIcon(item) {
        if (!item.url) return folderIcon();

        const img = document.createElement('img');
        img.className = ICON_CLASS;
        // chrome://favicon2 is the current scheme; chrome://favicon is a legacy fallback
        const sources = [
            `chrome://favicon2/?size=${ICON_SIZE}&scaleFactor=2x&pageUrl=${encodeURIComponent(item.url)}&allowGoogleServerFallback=0`,
            `chrome://favicon/size/${ICON_SIZE}@2x/${item.url}`,
        ];
        let attempt = 0;
        img.addEventListener('error', () => {
            attempt++;
            if (attempt < sources.length) img.src = sources[attempt];
            else img.replaceWith(globeIcon());   // no favicon — a neutral globe
        });
        img.src = sources[0];
        return img;
    }

    function makeLabel(item, maxWidth) {
        const label = document.createElement('span');
        label.className = MENU_CLASS + '-label';
        label.style.maxWidth = maxWidth + 'px';
        label.textContent = titleOf(item);
        return label;
    }

    function titleOf(item) {
        if (item.title) return item.title;
        if (!item.url) return 'Untitled';
        try { return new URL(item.url).hostname; } catch { return item.url; }
    }

    // Bar button tooltip: it used to be a bare URL, and in icons-only mode (with
    // the label hidden) the button was impossible to identify. The title on the
    // first line and the link on the second — the way Vivaldi's native bookmark
    // bar does it.
    function tooltipOf(item) {
        if (!item.url) return titleOf(item);
        return titleOf(item) + '\n' + item.url;
    }

    // ------------------------------------------------------------------
    // Building a single menu level
    // ------------------------------------------------------------------
    function makeMenuShell(depth) {
        const menu = document.createElement('div');
        menu.className = MENU_CLASS;
        menu.dataset.depth = String(depth);
        menu.style.zIndex = String(MENU_Z_INDEX + depth);
        trackRowUnderPointer(menu);
        return menu;
    }

    function makeMenuRow() {
        const row = document.createElement('div');
        row.className = ROW_CLASS;
        row.onmouseleave = () => setRowActive(row, false);
        return row;
    }

    function buildMenu(items, depth, folderId) {
        const menu = makeMenuShell(depth);
        // the folder id is needed while dragging: it doubles as the parentId for insertion
        menu.dataset.folderId = folderId || '';

        if (!items || !items.length) {
            const empty = document.createElement('div');
            empty.className = MENU_CLASS + '-empty';
            empty.textContent = 'Empty';
            menu.appendChild(empty);
            // no return: an empty folder must accept drops too — that is the only
            // way to put something into it through its own menu
        }

        (items || []).forEach(item => {
            const row = makeMenuRow();

            const isFolder = !item.url;
            row.append(makeIcon(item), makeLabel(item, settings.menuLabelWidth));
            row.title = item.url || titleOf(item);
            row.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // depth + 1: the menu holding the row stays open
                showContextMenu({ node: item, parentId: folderId }, e.clientX, e.clientY, depth + 1);
            });

            // openSub is declared below, inside the isFolder branch, but dragging
            // needs it before that branch (makeDropTarget is called once for both
            // branches) — the branch itself copies it here if this is a folder
            let openSubForDrag = null;

            if (isFolder) {
                const arrow = document.createElement('span');
                arrow.className = MENU_CLASS + '-arrow';
                row.appendChild(arrow);

                const openSub = () => {
                    // this row's submenu is already open — bail out without
                    // recreating it: recreation was exactly what caused the
                    // flicker on click/hover
                    if (openMenus[depth + 1]?._ownerRow === row) return;
                    closeFrom(depth + 1);
                    const sub = buildMenu(item.children || [], depth + 1, item.id);
                    sub._ownerRow = row;
                    getLayer().appendChild(sub);
                    openMenus.push(sub);
                    positionSub(sub, row, menu);
                };
                openSubForDrag = openSub;

                row.onmouseenter = () => {
                    if (ctxMenu || dragNode) return;    // the context menu and a live drag keep focus
                    setRowActive(row, true);
                    clearTimeout(hoverTimer);
                    hoverTimer = setTimeout(openSub, settings.hoverDelay);
                };
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    clearTimeout(hoverTimer);
                    openSub();
                });
            } else {
                row.onmouseenter = () => {
                    if (ctxMenu || dragNode) return;    // the context menu and a live drag keep focus
                    setRowActive(row, true);
                    clearTimeout(hoverTimer);
                    // hovering a bookmark -> close the neighbouring folder's submenu
                    hoverTimer = setTimeout(() => closeFrom(depth + 1), settings.hoverDelay);
                };
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openBookmark(item.url, e.ctrlKey || e.metaKey);
                    closeAll();
                });
                row.addEventListener('auxclick', (e) => {
                    if (e.button !== 1) return;
                    e.stopPropagation();
                    openBookmark(item.url, true);
                    closeAll();
                });
            }

            makeDraggable(row, item);
            makeDropTarget(row, {
                node: item,
                parentId: folderId,
                axis: 'y',
                openFolder: isFolder ? openSubForDrag : null,
            });

            menu.appendChild(row);
        });

        // A right click past the rows (an empty folder, or the space below the
        // last row) = the context menu of this folder itself. This is the only
        // way into a folder that has nothing in it yet: there is no row to aim
        // at. Rows stop propagation in their own handler, so only events from
        // the menu's background get here.
        menu.addEventListener('contextmenu', (e) => {
            if (!folderId) return;
            e.preventDefault();
            e.stopPropagation();
            showContextMenu({ node: null, parentId: folderId }, e.clientX, e.clientY, depth + 1);
        });

        // A drop past the rows (an empty folder, or the space below the last row)
        // = to the end of this folder. On target rows makeDropTarget already
        // calls stopPropagation in both branches (accept and reject), so only
        // events from the menu's own background reach here.
        menu.addEventListener('dragover', (e) => {
            if (!dragNode || !folderId) return;
            const dest = { parentId: folderId };
            if (!canDrop(dragNode, dest)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // after: true -> the line along the menu's bottom edge: the item goes
            // to the end
            showDropFeedback(menu, { parentId: folderId, index: (items || []).length, after: true }, 'y');
        });
        menu.addEventListener('drop', (e) => {
            e.preventDefault();
            // the drop location is recomputed from this very drop event: the
            // cursor may have last been over another row
            const dest = dragNode && folderId ? { parentId: folderId } : null;
            if (dragNode && dest && canDrop(dragNode, dest)) applyDrop(dragNode, dest);
            endDrag();
        });
        menu.addEventListener('dragleave', (e) => {
            if (!menu.contains(e.relatedTarget)) clearDropFeedback();
        });

        return menu;
    }

    // ------------------------------------------------------------------
    // Labels from Vivaldi's locale.
    //
    // The key in _locales/<language>/messages.json is an encoded English
    // string: lowercase letters and digits stay as they are, everything else
    // (uppercase, spaces, punctuation) becomes _<char code>_, with a 0 appended
    // at the end; an optional context prefix is separated by _4_.
    //   'Open in New Tab' -> _79_pen_32_in_32__78_ew_32__84_ab0
    //   'verb' + 'Delete' -> verb_4__68_elete0
    // If chrome.i18n stays silent, the hardcoded English text remains: that way
    // localization is an improvement rather than a prerequisite for working.
    // ------------------------------------------------------------------
    function localeKey(text, prefix) {
        const body = text.replace(/[^a-z0-9]/g, (ch) => `_${ch.charCodeAt(0)}_`);
        return (prefix ? prefix + '_4_' : '') + body + '0';
    }

    function label(text, prefix, fallback) {
        try {
            const msg = chrome.i18n?.getMessage?.(localeKey(text, prefix));
            if (msg) return msg;
        } catch (err) {
            console.warn('[SlimBookmarks] chrome.i18n unavailable:', err);
        }
        return fallback;
    }

    // the test harness needs access to the key encoding; unused in the browser
    window.__bookmarkModLocaleKey = localeKey;

    // ------------------------------------------------------------------
    // Context menu.
    //
    // Its contents are deliberately shorter than Vivaldi's native menu: the
    // open and copy-link entries are dropped — a plain click, the middle button
    // and Ctrl/⌘ already cover opening. Editing and deleting are what is left.
    // Styling, the layer, closing and positioning are taken from the folder
    // menus — only the contents and the group separator are specific here.
    // ------------------------------------------------------------------
    // A function rather than a constant: chrome.i18n may not be ready yet inside
    // Vivaldi's UI window when the script loads, and label() does not throw on
    // failure — all labels would then silently and permanently be stuck on the
    // hardcoded English fallback. We call it anew on every menu build so that
    // localization is picked up as soon as the API is ready.
    function buildLabels() {
        return {
            edit: label('Edit', 'command', 'Edit'),
            addFolder: label('Add Folder', null, 'Add Folder'),
            newFolder: label('New Folder', 'command', 'New Folder'),
            remove: label('Delete', 'verb', 'Delete'),
            // Vivaldi's locale has no strings for our own dialog's fields —
            // the native edit dialog lives in a React store and is unreachable.
            editBookmarkTitle: 'Edit Bookmark',
            editFolderTitle: 'Edit Folder',
            fieldName: 'Name',
            fieldUrl: 'URL',
            save: 'Save',
            cancel: 'Cancel',
        };
    }

    let ctxMenu = null;     // the open context menu, if any

    // target = { node, parentId }: the node that was right clicked (null for a
    // click on the bar's or a menu's background) and the folder that node —
    // or that background — belongs to.
    //
    // Edit and Delete are the same for a bookmark and a folder: the difference
    // is only inside the edit dialog (a folder has no URL field). Add Folder is
    // the one entry that reads the click position, so that the new folder lands
    // where the user pointed:
    //   right click on a folder   -> a subfolder inside it (at its end)
    //   right click on a bookmark -> a folder next to it, in the same folder
    //   right click on background -> at the end of the folder that background
    //                                shows (the bar folder, or the open menu's)
    function contextItems(target) {
        const LABELS = buildLabels();
        const node = target.node;
        const intoNode = node && !node.url;      // a folder takes the new folder inside itself

        const addFolder = (intoNode || target.parentId)
            ? {
                label: LABELS.addFolder,
                // afterId is null for "at the end": a subfolder goes to the end
                // of its new parent, a sibling goes right after the clicked node
                run: () => showNewFolderDialog(intoNode ? node.id : target.parentId,
                                               intoNode ? null : (node ? node.id : null)),
            }
            : null;

        // background click — nothing to edit or delete, only the one entry
        if (!node) return addFolder ? [addFolder] : [];

        const items = [{ label: LABELS.edit, run: () => showEditDialog(node) }];
        if (addFolder) items.push(addFolder);
        items.push(null, { label: LABELS.remove, run: () => removeNode(node) });
        return items;
    }

    // keepDepth — how many already open menus to keep: 0 for a bar button,
    // depth + 1 for a menu row (the row itself must stay on screen).
    function showContextMenu(target, x, y, keepDepth) {
        const items = contextItems(target);
        if (!items.length) return;
        closeFrom(keepDepth);
        clearTimeout(hoverTimer);

        const menu = makeMenuShell(CTX_DEPTH);
        items.forEach((item) => {
            if (!item) {
                const sep = document.createElement('div');
                sep.className = SEP_CLASS;
                menu.appendChild(sep);
                return;
            }
            const row = makeMenuRow();
            const label = document.createElement('span');
            label.className = MENU_CLASS + '-label';
            label.textContent = item.label;
            row.appendChild(label);
            row.onmouseenter = () => setRowActive(row, true);
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                closeAll();
                item.run();
            });
            menu.appendChild(row);
        });

        getLayer().appendChild(menu);
        openMenus.push(menu);
        ctxMenu = menu;
        positionAt(menu, x, y);
    }

    // The menu unfolds from the cursor, and near the right or bottom edge — in
    // the opposite direction, like Vivaldi's native menus.
    function positionAt(menu, x, y) {
        const m = menu.getBoundingClientRect();
        const flipX = x + m.width > window.innerWidth - GAP;
        const flipY = y + m.height > window.innerHeight - GAP;
        // when flipping we step away from the click point by CTX_FLIP_MARGIN on
        // top of the usual GAP — see the comment on the constant
        const left = flipX ? x - m.width - CTX_FLIP_MARGIN : x;
        const top = flipY ? y - m.height - CTX_FLIP_MARGIN : y;
        place(menu, clamp(left, GAP, window.innerWidth - m.width - GAP),
                    clamp(top, GAP, window.innerHeight - m.height - GAP));
    }

    // ------------------------------------------------------------------
    // Context menu actions.
    // ------------------------------------------------------------------
    function reportError() {
        if (chrome.runtime.lastError) {
            console.warn('[SlimBookmarks] action failed:', chrome.runtime.lastError.message);
        }
    }

    // In Vivaldi the regular delete moves the node to the bookmark trash — this
    // is the same call the native bar makes.
    function removeNode(node) {
        if (node.url) chrome.bookmarks.remove(node.id, reportError);
        else chrome.bookmarks.removeTree(node.id, reportError);
    }

    // afterId — the node the new folder must follow, or null for "at the end".
    // The index is resolved here rather than taken from the tree snapshot the
    // bar was rendered from: between the right click and the Save button the
    // folder may well have been reordered from elsewhere, and an index that no
    // longer fits its parent makes chrome.bookmarks.create fail outright.
    function createFolder(parentId, afterId, title) {
        if (!afterId) {
            chrome.bookmarks.create({ parentId, title }, reportError);
            return;
        }
        chrome.bookmarks.getChildren(parentId, (children) => {
            if (chrome.runtime.lastError) { reportError(); return; }
            const at = (children || []).findIndex(c => c.id === afterId);
            const details = { parentId, title };
            // the sibling is gone — fall back to the end of the folder
            if (at >= 0) details.index = at + 1;
            chrome.bookmarks.create(details, reportError);
        });
    }

    // ------------------------------------------------------------------
    // Edit dialog.
    //
    // Vivaldi's native dialog is unreachable: it is shown through an internal
    // React store. Hence our own — in the same layer as the menus and on the
    // same theme variables. The edit goes to chrome.bookmarks.update, and the
    // bar rebuilds itself on the onChanged event.
    // ------------------------------------------------------------------
    let editDialog = null;

    function closeEditDialog() {
        if (!editDialog) return;
        editDialog.remove();
        editDialog = null;
    }

    // The shell shared by editing and by creating a folder: both are a heading,
    // a text field or two, and a Save/Cancel pair — only what Save does differs.
    // onApply receives the field values in the order they were declared.
    function showDialog(heading, fieldSpecs, onApply) {
        closeAll();
        closeEditDialog();

        const LABELS = buildLabels();

        const overlay = document.createElement('div');
        overlay.className = DIALOG_CLASS;
        const box = document.createElement('div');
        box.className = DIALOG_CLASS + '-box';

        const headingEl = document.createElement('div');
        headingEl.className = DIALOG_CLASS + '-heading';
        headingEl.textContent = heading;
        box.appendChild(headingEl);

        const fields = fieldSpecs.map((spec) => {
            const field = makeDialogField(spec.label, spec.value || '');
            box.appendChild(field.row);
            return field;
        });

        const buttons = document.createElement('div');
        buttons.className = DIALOG_CLASS + '-buttons';
        const cancel = makeDialogButton(LABELS.cancel, false);
        const save = makeDialogButton(LABELS.save, true);
        buttons.append(cancel, save);

        box.appendChild(buttons);
        overlay.appendChild(box);
        getLayer().appendChild(overlay);
        editDialog = overlay;

        const apply = () => {
            const values = fields.map(f => f.input.value);
            closeEditDialog();
            onApply(values);
        };

        save.addEventListener('click', apply);
        cancel.addEventListener('click', closeEditDialog);
        // a click on the dim backdrop outside the box = cancel, as in the native dialogs
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeEditDialog(); });
        box.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeEditDialog(); }
        });

        fields[0]?.input.focus();
        fields[0]?.input.select();
    }

    function showEditDialog(node) {
        const LABELS = buildLabels();
        const isFolder = !node.url;

        const specs = [{ label: LABELS.fieldName, value: node.title || '' }];
        if (!isFolder) specs.push({ label: LABELS.fieldUrl, value: node.url || '' });

        showDialog(isFolder ? LABELS.editFolderTitle : LABELS.editBookmarkTitle, specs, (values) => {
            const changes = { title: values[0] };
            // an empty URL is not saved: a node without a url would turn into a folder
            if (!isFolder && values[1].trim()) changes.url = values[1].trim();
            chrome.bookmarks.update(node.id, changes, reportError);
        });
    }

    // The name is pre-filled with Vivaldi's own "New Folder" and selected, so
    // that Enter alone is enough to get the same result as the native menu.
    function showNewFolderDialog(parentId, afterId) {
        const LABELS = buildLabels();
        showDialog(LABELS.newFolder, [{ label: LABELS.fieldName, value: LABELS.newFolder }], (values) => {
            createFolder(parentId, afterId, values[0].trim() || LABELS.newFolder);
        });
    }

    function makeDialogField(labelText, value) {
        const row = document.createElement('label');
        row.className = DIALOG_CLASS + '-field';
        const caption = document.createElement('span');
        caption.textContent = labelText;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.spellcheck = false;
        row.append(caption, input);
        return { row, input };
    }

    function makeDialogButton(text, primary) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = DIALOG_CLASS + '-button' + (primary ? ' is-primary' : '');
        btn.textContent = text;
        return btn;
    }

    // ------------------------------------------------------------------
    // Dragging.
    //
    // HTML5 drag & drop: the browser draws the preview itself and scrolls long
    // menus itself. Mouse events do not arrive during a drag, so both picking
    // the insertion point and opening the folder under the cursor are done in
    // dragover. The node is remembered in dragNode: dataTransfer must not be
    // read in dragover, and the drop zones depend on whether a folder or a
    // bookmark is being dragged.
    // ------------------------------------------------------------------
    let dragNode = null;
    let dropLine = null;
    let dropInto = null;        // the highlighted "into the folder" target
    let dragOpenTimer = null;
    let dragOpenEl = null;

    // A shared reset of the drag state: used both in dragend and in drop — after
    // applying (or declining) a drop the state is always the same.
    function endDrag() {
        dragNode = null;
        clearDropFeedback();
    }

    function makeDraggable(el, node) {
        el.draggable = true;
        // Between the press and the first move Blink is still deciding whether
        // this gesture becomes a drag, and it resolves the drag source by hit
        // testing. A menu that opens in that window lands on top of the element
        // under the cursor and the gesture is dropped — the press ends up doing
        // nothing at all. So the pending hover timer dies with the press: this
        // is the same class of bug as the focus ring blur that used to abort
        // drags on bar buttons.
        el.addEventListener('mousedown', () => clearTimeout(hoverTimer));
        el.addEventListener('dragstart', (e) => {
            clearTimeout(hoverTimer);
            // a bar button is dragged with the menus closed, a menu row is not:
            // closing would remove the row itself and break the drag. This runs
            // before the state below is claimed: closeAll() ends any drag.
            if (el.classList.contains(BTN_CLASS)) closeAll();
            dragNode = node;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData(DRAG_MIME, node.id);
            // text/plain is always set, folders included. DRAG_MIME alone is a
            // custom type, and a drag carrying nothing the platform recognises
            // is not reliably started by the OS drag session — which is the one
            // difference there was between folder rows (custom type only) and
            // bookmark rows (which also carried their URL), and folder rows
            // were exactly the ones that would not pick up.
            e.dataTransfer.setData('text/plain', node.url || titleOf(node));
        });
        el.addEventListener('dragend', endDrag);
    }

    // A drag that dies anywhere else — dropped on Vivaldi's own UI, cancelled
    // with Escape, ended over a target that never saw the drop — still has to
    // release the state.
    //
    // Bubble phase, deliberately: in capture this runs BEFORE the drop target's
    // own handler and would clear dragNode out from under it, so every drop
    // would silently do nothing. Our own targets stop propagation after they
    // have applied the drop (and call endDrag themselves), so what reaches here
    // is only the drops that landed on nothing.
    document.addEventListener('dragend', endDrag);
    document.addEventListener('drop', endDrag);

    // ctx: { node, parentId, axis, openFolder }
    //   node       — the node under the cursor
    //   parentId   — the folder node lives in (the parent for inserting next to it)
    //   axis       — 'x' for the bar, 'y' for menu rows
    //   openFolder — how to open the folder under the cursor, if there is one
    function makeDropTarget(el, ctx) {
        el.addEventListener('dragover', (e) => {
            if (!dragNode) return;
            const dest = resolveDrop({ el, ...ctx }, e);
            if (!canDrop(dragNode, dest)) {
                // a rejection on this particular target must not bubble up to the
                // parent (the bar, for instance) and turn into an allowed drop
                // there by the coarse "the whole bar folder" rule
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'none';
                clearDropFeedback();
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            showDropFeedback(el, dest, ctx.axis);
            if (dest.into && ctx.openFolder) scheduleDragOpen(el, ctx.openFolder);
        });
        el.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            // the drop location is recomputed from this very drop event: the
            // cursor may have last been over a neighbouring element before the
            // button was released here
            const dest = dragNode ? resolveDrop({ el, ...ctx }, e) : null;
            if (dragNode && dest && canDrop(dragNode, dest)) applyDrop(dragNode, dest);
            endDrag();
        });
    }

    function resolveDrop(ctx, e) {
        const r = ctx.el.getBoundingClientRect();
        const size = (ctx.axis === 'x' ? r.width : r.height) || 1;
        const offset = ctx.axis === 'x' ? e.clientX - r.left : e.clientY - r.top;
        const pos = offset / size;
        const isFolder = !ctx.node.url;
        // targetId — the node under the cursor: needed so canDrop can tell
        // "dropped where it was picked up" (a cancel gesture) from a real drop
        if (isFolder && pos > EDGE_RATIO && pos < 1 - EDGE_RATIO) {
            return { parentId: ctx.node.id, into: true, targetId: ctx.node.id };
        }
        const after = pos >= 0.5;
        return { parentId: ctx.parentId, index: ctx.node.index + (after ? 1 : 0), after, targetId: ctx.node.id };
    }

    function canDrop(node, dest) {
        if (!node || !dest || !dest.parentId) return false;
        // released where it was picked up — that is a cancelled drag, not a drop:
        // disallowed in any zone ("next to" and "into" alike)
        if (dest.targetId === node.id) return false;
        // a folder cannot move inside its own subtree (the "into itself" case is
        // already cut off by the targetId check above)
        if (!node.url && isDescendant(dest.parentId, node)) return false;
        return true;
    }

    function isDescendant(id, node) {
        if (id === node.id) return true;
        return (node.children || []).some(child => isDescendant(id, child));
    }

    // The index is passed as is: when reordering within one folder, Chromium
    // accounts for the node's removal itself — the native Vivaldi bar does the
    // same (bundle.js, BookmarksService.move).
    function applyDrop(node, dest) {
        const dst = { parentId: dest.parentId };
        // the index is only set when it is a number: without it Chromium appends
        // to the end of the folder, and an undefined in the object fails
        // chrome.* validation
        if (typeof dest.index === 'number') dst.index = dest.index;
        chrome.bookmarks.move(node.id, dst, reportError);
    }

    function dropLineEl() {
        if (!dropLine) {
            dropLine = document.createElement('div');
            dropLine.className = DROP_LINE_CLASS;
        }
        const layer = getLayer();
        if (dropLine.parentElement !== layer) layer.appendChild(dropLine);
        return dropLine;
    }

    function showDropFeedback(el, dest, axis) {
        clearDropInto();
        if (dest.into) {
            if (dropLine) dropLine.style.display = 'none';
            el.classList.add(DROP_INTO_CLASS);
            dropInto = el;
            return;
        }
        // the cursor left "into the folder" for a regular insert-next-to point —
        // cancel the pending auto-open of the previous folder: otherwise it would
        // fire after the remaining time (up to dragOpenDelay) even though the
        // cursor is no longer over that folder
        clearDragOpenTimer();
        const r = el.getBoundingClientRect();
        const line = dropLineEl();
        line.style.display = 'block';
        if (axis === 'x') {
            line.style.left = (dest.after ? r.right : r.left) + 'px';
            line.style.top = r.top + 'px';
            line.style.width = '2px';
            line.style.height = r.height + 'px';
        } else {
            line.style.left = r.left + 'px';
            line.style.top = (dest.after ? r.bottom : r.top) + 'px';
            line.style.width = r.width + 'px';
            line.style.height = '2px';
        }
    }

    function clearDropInto() {
        if (dropInto) dropInto.classList.remove(DROP_INTO_CLASS);
        dropInto = null;
    }

    function clearDropFeedback() {
        clearDropInto();
        clearDragOpenTimer();
        if (dropLine) dropLine.style.display = 'none';
    }

    function clearDragOpenTimer() {
        clearTimeout(dragOpenTimer);
        dragOpenEl = null;
    }

    // dragover fires dozens of events — the timer is set once per target
    function scheduleDragOpen(el, openFolder) {
        if (dragOpenEl === el) return;
        dragOpenEl = el;
        clearTimeout(dragOpenTimer);
        dragOpenTimer = setTimeout(() => {
            // while we were waiting, a bar rebuild (render()) could have removed
            // el from the document — a menu anchored to an element outside the
            // tree must not be opened: it would land in the screen corner on top
            // of everything
            if (el.isConnected) openFolder();
        }, settings.dragOpenDelay);
    }

    // ------------------------------------------------------------------
    // Positioning (after insertion into the DOM, so the real sizes are known)
    // ------------------------------------------------------------------
    function positionRoot(menu, anchor) {
        const a = anchor.getBoundingClientRect();
        const m = menu.getBoundingClientRect();
        const left = clamp(a.left, GAP, window.innerWidth - m.width - GAP);
        const top = clamp(a.bottom + 2, GAP, window.innerHeight - m.height - GAP);
        place(menu, left, top);
    }

    function positionSub(menu, row, parentMenu) {
        const r = row.getBoundingClientRect();
        const p = parentMenu.getBoundingClientRect();
        const m = menu.getBoundingClientRect();

        // to the right of the parent by default, to the left when there is not
        // enough room
        let left = p.right - 2;
        if (left + m.width > window.innerWidth - GAP) left = p.left - m.width + 2;
        left = clamp(left, GAP, window.innerWidth - m.width - GAP);
        const top = clamp(r.top - 6, GAP, window.innerHeight - m.height - GAP);
        place(menu, left, top);
    }

    function place(menu, left, top) {
        menu.style.left = Math.round(left) + 'px';
        menu.style.top = Math.round(top) + 'px';
        menu.style.visibility = 'visible';
    }

    function clamp(v, min, max) {
        return Math.max(min, Math.min(v, Math.max(min, max)));
    }

    // ------------------------------------------------------------------
    // Opening a bookmark.
    //   setting off + plain click -> current tab
    //   setting on  + plain click -> new tab, immediately active
    //   Ctrl/⌘ or middle button   -> new background tab, always
    // window.location.href is not an option: the script lives in Vivaldi's UI window.
    // ------------------------------------------------------------------
    function openBookmark(url, modifier) {
        if (!url) return;
        // the setting may have just been toggled, so we do not rely on the value
        // read at startup
        readOpenInNewTab(() => doOpenBookmark(url, modifier));
    }

    function doOpenBookmark(url, modifier) {
        const fallback = (reason) => {
            console.warn('[SlimBookmarks] could not open a tab:', reason);
            window.open(url, '_blank');
        };

        // chrome.tabs errors arrive asynchronously, in lastError, so a single
        // try/catch is not enough
        const done = () => {
            if (chrome.runtime.lastError) fallback(chrome.runtime.lastError.message);
        };

        try {
            if (!openInNewTabPref && !modifier) chrome.tabs.update({ url }, done);
            else chrome.tabs.create({ url, active: !modifier }, done);
        } catch (err) {
            fallback(err);
        }
    }
})();
