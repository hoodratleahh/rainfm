import * as React from "react";
import { after, before, instead } from "@api/patcher";
import { dismissAlert, openAlert } from "@api/ui/alerts";
import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { AlertActionButton, AlertModal, Button, Stack, TextInput } from "@metro/common/components";

import { applyMask, removeMask } from "./userMask";

const ALERT_KEY = "LocalMessagePreviewQuick";
const LONG_PRESS_DELAY = 2000;

// "Copy Username" must not be read as "Copy User ID" — hence user\s*name.
const TRIGGER_LABEL = /avatar\s*image\s*link|user\s*name/i;
const USER_ID_LABEL = /user\s*id/i;
const SNOWFLAKE = /^\d{15,25}$/;
const AVATAR_URL_ID = /\/avatars\/(\d{15,25})\//;

// ── Alert UI ──────────────────────────────────────────────────────────────────

function QuickMessageAlert({ sourceUserId }: { sourceUserId?: string }) {
    const [targetId, setTargetId] = React.useState("");
    const [error, setError] = React.useState("");

    const apply = () => {
        const tid = targetId.trim();
        const sid = sourceUserId?.trim();
        if (!tid) { setError("Type a user ID."); return; }
        if (!sid) { setError("Could not detect whose profile this is."); return; }
        try {
            applyMask(sid, tid);
            dismissAlert(ALERT_KEY);
            showToast("Profile swapped locally.");
        } catch (e) {
            setError((e as Error).message);
        }
    };

    const reset = () => {
        const sid = sourceUserId?.trim();
        if (sid) removeMask(sid);
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

function makeLongPressHandler(rowOnPress?: () => void) {
    return () => {
        const userId = resolveUserId(rowOnPress);
        setTimeout(() => openQuickMessageBox(userId), 50);
    };
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

            const triggers = options.filter(
                o => typeof o?.label === "string" && TRIGGER_LABEL.test(o.label),
            );
            if (triggers.length === 0) return;

            pendingOptions = options;
            for (const option of triggers) {
                option.onLongPress = makeLongPressHandler(option.onPress);
                option.delayLongPress = LONG_PRESS_DELAY;
            }
        }));
    }

    const rowModule = findByProps("ActionSheetRow") as any;
    if (rowModule?.ActionSheetRow) {
        unpatches.push(after("ActionSheetRow", rowModule, ([props]: any[], ret: any) => {
            if (!TRIGGER_LABEL.test(labelOf({ props }))) return;
            attachLongPress(ret, makeLongPressHandler(props?.onPress));
        }));
    }

    return () => {
        for (const fn of unpatches) fn();
        pendingOptions = null;
    };
}
