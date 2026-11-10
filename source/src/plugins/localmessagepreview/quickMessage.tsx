import * as React from "react";
import { after, before, instead } from "@api/patcher";
import { dismissAlert, openAlert } from "@api/ui/alerts";
import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { AlertActionButton, AlertModal, Button, Stack, TextInput } from "@metro/common/components";
import {
    FlatList, Image, Platform, Pressable, ScrollView, Text,
    TouchableHighlight, TouchableOpacity, TouchableWithoutFeedback, View,
} from "react-native";

import { applyMask, findMaskSources, getAllMasks, getMaskTarget, removeMask } from "./userMask";

const ALERT_KEY = "LocalMessagePreviewQuick";
const RESET_ALERT_KEY = "LocalMessagePreviewReset";
const LONG_PRESS_DELAY = 2000;

// "Copy Username" must not be read as "Copy User ID" — hence user\s*name.
const SWAP_LABEL = /avatar\s*image\s*link|user\s*name/i;
const USER_ID_LABEL = /user\s*id/i;
const SNOWFLAKE = /^\d{15,25}$/;
const AVATAR_URL_ID = /\/avatars\/(\d{15,25})\//;

// ── Alert UI ──────────────────────────────────────────────────────────────────

// An already-swapped profile shows up under its target's ID; map it back to the
// user(s) it really belongs to so a re-swap or reset lands on the right person.
function originalsOf(userId: string): string[] {
    const sources = findMaskSources(userId);
    return sources.length > 0 ? sources : [userId];
}

function QuickMessageAlert({ sourceUserId }: { sourceUserId?: string }) {
    const [targetId, setTargetId] = React.useState("");
    const [error, setError] = React.useState("");

    const apply = () => {
        const tid = targetId.trim();
        const sid = sourceUserId?.trim();
        if (!tid) { setError("Type a user ID."); return; }
        if (!sid) { setError("Could not detect whose profile this is."); return; }
        try {
            for (const source of originalsOf(sid)) {
                if (source === tid) removeMask(source);
                else applyMask(source, tid);
            }
            dismissAlert(ALERT_KEY);
            showToast("Profile swapped locally.");
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const reset = () => {
        const sid = sourceUserId?.trim();
        if (sid) for (const source of originalsOf(sid)) removeMask(source);
        dismissAlert(ALERT_KEY);
        showToast("Profile reset.");
    };

    // On Android this dialog is also the way to reset, so say what is swapped.
    const shownId = sourceUserId?.trim();
    const current = shownId ? findMaskSources(shownId).map(s => `${s} → ${getMaskTarget(s)}`) : [];
    let status = "Couldn't detect this profile's ID.";
    if (current.length > 0) status = `Swapped now: ${current.join(", ")}`;
    else if (shownId) status = `This profile: ${shownId}`;

    return <AlertModal
        title="Swap profile"
        content={`Only you will see this. Changes nothing on Discord.\n${status}`}
        extraContent={
            <TextInput
                autoFocus={true}
                isClearable={true}
                placeholder="Target user ID"
                value={targetId}
                onChange={(v: string) => { setTargetId(v); if (error) setError(""); }}
                returnKeyType="done"
                onSubmitEditing={apply}
                state={error ? "error" : undefined}
                errorMessage={error || undefined}
            />
        }
        actions={
            <Stack>
                <Button text="Apply" variant="primary" onPress={apply} />
                <Button text="Reset" variant="secondary" onPress={reset} />
                <AlertActionButton text="Cancel" variant="secondary" />
            </Stack>
        }
    />;
}

function openQuickMessageBox(sourceUserId?: string) {
    openAlert(ALERT_KEY, <QuickMessageAlert sourceUserId={sourceUserId} />);
}

function ResetProfileAlert({ sourceUserId }: { sourceUserId?: string }) {
    const matched = sourceUserId ? findMaskSources(sourceUserId) : [];
    // No match for this profile still leaves every saved swap resettable.
    const sources = matched.length > 0 ? matched : getAllMasks().map(([source]) => source);
    const pairs = sources.map(s => `${s} → ${getMaskTarget(s)}`).join("\n");
    const detected = `Detected ID: ${sourceUserId ?? "none"}`;

    const reset = () => {
        for (const source of sources) removeMask(source);
        dismissAlert(RESET_ALERT_KEY);
        showToast(sources.length > 1 ? "Profiles reset." : "Profile reset.");
    };

    let title = "No swaps saved";
    let content = `Nothing is swapped right now.\n${detected}`;
    if (matched.length > 0) {
        title = "Reset profile";
        content = `Saved swap:\n${pairs}\n\nPut it back to normal?`;
    } else if (sources.length > 0) {
        title = "Reset swaps";
        content = `Couldn't match this profile to a swap. All saved swaps:\n${pairs}\n\n${detected}`;
    }

    return <AlertModal
        title={title}
        content={content}
        actions={
            <Stack>
                {sources.length > 0
                    ? <Button
                        text={matched.length > 0 ? "Reset to normal" : "Reset all"}
                        variant="primary"
                        onPress={reset}
                    />
                    : null}
                <AlertActionButton text={sources.length > 0 ? "Cancel" : "Close"} variant="secondary" />
            </Stack>
        }
    />;
}

function openResetBox(sourceUserId?: string) {
    openAlert(RESET_ALERT_KEY, <ResetProfileAlert sourceUserId={sourceUserId} />);
}

// ── User ID capture ───────────────────────────────────────────────────────────

// The sheet's own rows already know the user: "Copy User ID" writes the raw
// snowflake and "Copy Avatar Image Link" writes a URL containing it. Running a
// row's handler with clipboard writes redirected reads the value out without
// touching the real clipboard.
function captureCopiedString(onPress: () => void): string | undefined {
    const clipboard = findByProps("setString", "getString", "hasString") as any;
    if (!clipboard) return undefined;

    let captured: string | undefined;
    const unpatch = instead("setString", clipboard, ([value]: any[]) => { captured = String(value); });
    try { onPress(); } catch (_) { /* row handler blew up; nothing to read */ }
    unpatch();
    return captured;
}

let pendingOptions: any[] | null = null;

function resolveUserId(rowOnPress?: () => void): string | undefined {
    const idOption = pendingOptions?.find(
        o => typeof o?.label === "string" && USER_ID_LABEL.test(o.label) && typeof o.onPress === "function",
    );
    if (idOption) {
        const copied = captureCopiedString(idOption.onPress)?.trim();
        if (copied && SNOWFLAKE.test(copied)) return copied;
    }

    if (typeof rowOnPress === "function") {
        const url = captureCopiedString(rowOnPress);
        const match = url && AVATAR_URL_ID.exec(url);
        if (match) return match[1];
    }

    return undefined;
}

function makeLongPressHandler(rowOnPress: (() => void) | undefined, open: (userId?: string) => void) {
    return () => {
        const userId = resolveUserId(rowOnPress);
        setTimeout(() => open(userId), 50);
    };
}

function handlerFor(label: string): ((userId?: string) => void) | undefined {
    if (SWAP_LABEL.test(label)) return openQuickMessageBox;
    if (USER_ID_LABEL.test(label)) return openResetBox;
    return undefined;
}

// ── Element tree helpers ──────────────────────────────────────────────────────

function labelOf(node: any): string {
    const props = node?.props;
    if (!props) return "";
    return [props.label, props.title, props.text, props.children]
        .filter(v => typeof v === "string")
        .join(" ");
}

// Attach to every pressable level we can reach — the row's root may be a
// composite that forwards onLongPress, or the host element one level down.
function attachLongPress(node: any, handler: () => void, depth = 0): void {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
        for (const child of node) attachLongPress(child, handler, depth + 1);
        return;
    }
    const props = node.props;
    if (!props) return;
    if (typeof props.onPress === "function") {
        props.onLongPress = handler;
        props.delayLongPress = LONG_PRESS_DELAY;
    }
    attachLongPress(props.children, handler, depth + 1);
}

// ── Android profile menu ──────────────────────────────────────────────────────

// Android has no "Copy User Info" sheet: Copy Username / Copy User ID sit in the
// profile "⋯" popout, whose rows are plain { label, action } data with no
// long-press of their own. How those rows are rendered is not visible from
// here, so the handler is attached to whatever each row turns out to render,
// following the row down through its components until a pressable shows up.

const MENU_LABEL = /user\s*name|user\s*id/i;
const JOB_PROP = "__lmpJob";
const MAX_WRAP_DEPTH = 6;
const MEMO = Symbol.for("react.memo");
const FORWARD_REF = Symbol.for("react.forward_ref");

interface MenuJob {
    byItem: Map<any, () => void>;
    byLabel: Map<string, () => void>;
    byAction: Map<any, () => void>;
    /** The menu object and its item arrays: whoever is handed one renders rows. */
    containers: Set<any>;
    /** Set once inside a matched row. */
    attach?: () => void;
    depth: number;
}

// Already take onLongPress directly, or render nothing pressable.
const CORE_TYPES = new Set<any>([
    Pressable, View, Text, Image, ScrollView, FlatList,
    TouchableOpacity, TouchableHighlight, TouchableWithoutFeedback,
]);

const wrappedTypes = new WeakMap<object, any>();

function runJob(ret: any, props: any): any {
    const job = props?.[JOB_PROP];
    if (job) {
        try { processNode(ret, job); } catch (_) { /* leave the row as Discord rendered it */ }
    }
    return ret;
}

// A stand-in for a component that renders the original and then runs the job
// on its output. Cached per component so its identity stays stable.
function wrapType(type: any): any {
    if (!type || CORE_TYPES.has(type)) return null;
    const cached = wrappedTypes.get(type);
    if (cached) return cached;

    let wrapped: any = null;
    if (typeof type === "function") {
        if (type.prototype?.isReactComponent) return null;
        wrapped = function (props: any, second: any) { return runJob(type(props, second), props); };
        wrapped.displayName = type.displayName ?? type.name;
        if (type.defaultProps) wrapped.defaultProps = type.defaultProps;
    } else if (typeof type === "object") {
        if (type.$$typeof === FORWARD_REF && typeof type.render === "function") {
            wrapped = React.forwardRef((props: any, ref: any) => runJob(type.render(props, ref), props));
        } else if (type.$$typeof === MEMO) {
            const inner = wrapType(type.type);
            if (inner) wrapped = React.memo(inner, type.compare ?? undefined);
        }
    }

    if (wrapped) {
        wrappedTypes.set(type, wrapped);
        wrappedTypes.set(wrapped, wrapped);
    }
    return wrapped;
}

function delegate(node: any, job: MenuJob): boolean {
    if (job.depth >= MAX_WRAP_DEPTH) return false;
    const wrapped = wrapType(node?.type);
    if (!wrapped) return false;
    node.type = wrapped;
    node.props[JOB_PROP] = { ...job, depth: job.depth + 1 };
    return true;
}

function visibleText(node: any, depth = 0): string {
    if (node == null || depth > 8) return "";
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(child => visibleText(child, depth + 1)).join(" ");
    const props = node.props;
    if (!props) return "";
    return [props.label, props.title, props.text]
        .filter(v => typeof v === "string")
        .concat(visibleText(props.children, depth + 1))
        .join(" ");
}

function rowHandler(props: any, job: MenuJob): (() => void) | undefined {
    for (const key in props) {
        const handler = job.byItem.get(props[key]);
        if (handler) return handler;
    }
    const byAction = job.byAction.get(props.action) ?? job.byAction.get(props.onPress);
    if (byAction) return byAction;
    if (typeof props.label === "string" && job.byLabel.has(props.label)) return job.byLabel.get(props.label);
    if (typeof props.onPress === "function") {
        const text = visibleText({ props }).trim();
        if (job.byLabel.has(text)) return job.byLabel.get(text);
    }
    return undefined;
}

function collectRowParts(node: any, pressables: any[], components: any[], depth = 0): void {
    if (!node || depth > 12) return;
    if (Array.isArray(node)) {
        for (const child of node) collectRowParts(child, pressables, components, depth + 1);
        return;
    }
    const props = node.props;
    if (!props || typeof props !== "object") return;
    if (typeof props.onPress === "function") pressables.push(node);
    else if (typeof node.type !== "string") components.push(node);
    collectRowParts(props.children, pressables, components, depth + 1);
}

function attachRow(node: any, job: MenuJob): void {
    const handler = job.attach!;
    const pressables: any[] = [];
    const components: any[] = [];
    collectRowParts(node, pressables, components);

    for (const el of pressables) {
        el.props.onLongPress = handler;
        el.props.delayLongPress = LONG_PRESS_DELAY;
    }
    // A row component may drop onLongPress, or render its pressable further
    // down; either way, keep following it.
    for (const el of pressables.length > 0 ? pressables : components) delegate(el, job);
}

function searchRows(node: any, job: MenuJob, found: { any: boolean }, depth = 0): void {
    if (!node || depth > 30) return;
    if (Array.isArray(node)) {
        for (const child of node) searchRows(child, job, found, depth + 1);
        return;
    }
    const props = node.props;
    if (!props || typeof props !== "object") return;

    const handler = rowHandler(props, job);
    if (handler) {
        found.any = true;
        attachRow(node, { ...job, attach: handler });
        return;
    }

    if (typeof props.renderItem === "function" && Array.isArray(props.data) && !props.renderItem.__lmp) {
        const renderItem = props.renderItem;
        const patched = (info: any) => {
            const el = renderItem(info);
            try {
                const itemHandler = job.byItem.get(info?.item);
                if (itemHandler) attachRow(el, { ...job, attach: itemHandler });
            } catch (_) { /* leave the row as rendered */ }
            return el;
        };
        (patched as any).__lmp = true;
        props.renderItem = patched;
        found.any = true;
    }

    for (const key in props) {
        if (job.containers.has(props[key])) {
            if (delegate(node, job)) found.any = true;
            break;
        }
    }

    searchRows(props.children, job, found, depth + 1);
}

function delegateAll(node: any, job: MenuJob, depth = 0): void {
    if (!node || depth > 30) return;
    if (Array.isArray(node)) {
        for (const child of node) delegateAll(child, job, depth + 1);
        return;
    }
    const props = node.props;
    if (!props || typeof props !== "object") return;
    if (typeof node.type !== "string") delegate(node, job);
    delegateAll(props.children, job, depth + 1);
}

function processNode(node: any, job: MenuJob): void {
    if (job.attach) {
        attachRow(node, job);
        return;
    }
    const found = { any: false };
    searchRows(node, job, found);
    // Nothing here mentions the menu: the rows are rendered by a child that
    // reads it from elsewhere, so look inside every child instead.
    if (!found.any) delegateAll(node, job);
}

function buildMenuJob(menu: any): MenuJob | null {
    const items = menu?.items;
    if (!Array.isArray(items)) return null;

    const job: MenuJob = {
        byItem: new Map(),
        byLabel: new Map(),
        byAction: new Map(),
        containers: new Set<any>([menu, items]),
        depth: 0,
    };

    const flat: any[] = [];
    for (const entry of items) {
        if (Array.isArray(entry)) {
            job.containers.add(entry);
            flat.push(...entry);
        } else {
            flat.push(entry);
        }
    }

    const idItem = flat.find(item => typeof item?.label === "string" && USER_ID_LABEL.test(item.label));
    const resolve = (): string | undefined => {
        const key = typeof menu.key === "string" ? menu.key.trim() : "";
        if (SNOWFLAKE.test(key)) return key;
        if (typeof idItem?.action !== "function") return undefined;
        const copied = captureCopiedString(idItem.action)?.trim();
        return copied && SNOWFLAKE.test(copied) ? copied : undefined;
    };

    for (const item of flat) {
        if (typeof item?.label !== "string" || !MENU_LABEL.test(item.label)) continue;
        const handler = () => {
            const userId = resolve();
            try { (findByProps("showContextMenu", "hideContextMenu") as any)?.hideContextMenu?.(); } catch (_) {}
            setTimeout(() => openQuickMessageBox(userId), 50);
        };
        job.byItem.set(item, handler);
        job.byLabel.set(item.label, handler);
        if (typeof item.action === "function") job.byAction.set(item.action, handler);
    }

    return job.byItem.size > 0 ? job : null;
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function patchQuickMessage(): () => void {
    const unpatches: (() => void)[] = [];

    if (Platform.OS === "android") {
        const popoutModule = findByProps("ContextMenuPopout") as any;
        if (typeof popoutModule?.ContextMenuPopout === "function") {
            unpatches.push(after("ContextMenuPopout", popoutModule, ([props]: any[], ret: any) => {
                try {
                    const job = buildMenuJob(props?.menu);
                    if (job) processNode(ret, job);
                } catch (_) { /* never break the menu */ }
            }));
        }
    }

    const sheetModule = findByProps("showSimpleActionSheet") as any;
    if (sheetModule) {
        unpatches.push(before("showSimpleActionSheet", sheetModule, ([config]: any[]) => {
            const options = config?.options;
            if (!Array.isArray(options)) return;

            let matched = false;
            for (const option of options) {
                const open = typeof option?.label === "string" ? handlerFor(option.label) : undefined;
                if (!open) continue;
                matched = true;
                option.onLongPress = makeLongPressHandler(option.onPress, open);
                option.delayLongPress = LONG_PRESS_DELAY;
            }
            if (matched) pendingOptions = options;
        }));
    }

    const rowModule = findByProps("ActionSheetRow") as any;
    if (rowModule?.ActionSheetRow) {
        unpatches.push(after("ActionSheetRow", rowModule, ([props]: any[], ret: any) => {
            const open = handlerFor(labelOf({ props }));
            if (!open) return;
            attachLongPress(ret, makeLongPressHandler(props?.onPress, open));
        }));
    }

    return () => {
        for (const fn of unpatches) fn();
        pendingOptions = null;
    };
}
