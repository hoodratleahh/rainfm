import * as React from "react";
import { after, before, instead } from "@api/patcher";
import { dismissAlert, openAlert } from "@api/ui/alerts";
import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { AlertActionButton, AlertModal, Button, Stack, TextInput } from "@metro/common/components";

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

    return <AlertModal
        title="Swap profile"
        content="Only you will see this. Changes nothing on Discord."
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

// ── Main export ───────────────────────────────────────────────────────────────

export default function patchQuickMessage(): () => void {
    const unpatches: (() => void)[] = [];

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
