import * as React from "react";
import { after } from "@api/patcher";
import { dismissAlert, openAlert } from "@api/ui/alerts";
import { showToast } from "@api/ui/toasts";
import { findInReactTree } from "@lib/utils";
import { findByName } from "@metro";
import { AlertActionButton, AlertModal, Button, Stack, TextInput } from "@metro/common/components";
// Stack used for button layout; AlertActionButton for Cancel
import { waitFor } from "@metro/internals/modules";

import { applyMask, removeMask } from "./userMask";

const MENU_NAMES = ["UserProfileOverflowMenu", "BotUserProfileOverflowMenu"];
const COPY_USERNAME = /copy\s*user\s*name/i;
const FALLBACK_LABEL = "Quick local message";
const ALERT_KEY = "LocalMessagePreviewQuick";

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

function extractUserId(args: any[]): string | undefined {
    const props = args?.[0]?.props ?? args?.[0];
    return props?.user?.id ?? props?.userId ?? undefined;
}

function patchMenu(args: any[], ret: any) {
    const userId = extractUserId(args);
    const node = findInReactTree(ret, (n: any) => Array.isArray(n?.props?.items) && Array.isArray(n.props.items[0]));
    const groups: any[][] | undefined = node?.props?.items;
    if (!groups) return;

    let hooked = false;
    for (const group of groups) {
        for (const item of group) {
            if (typeof item?.label !== "string" || !COPY_USERNAME.test(item.label)) continue;
            hooked = true;
            if (item.__lmpWrapped) continue;
            const original = item.action;
            item.action = () => {
                setTimeout(() => openQuickMessageBox(userId), 300);
            };
            item.__lmpWrapped = true;
        }
    }

    if (!hooked && !groups[0].some((i: any) => i?.label === FALLBACK_LABEL)) {
        groups[0].push({ label: FALLBACK_LABEL, action: () => setTimeout(() => openQuickMessageBox(userId), 300) });
    }
}

export default function patchQuickMessage(): () => void {
    const unpatches: (() => void)[] = [];
    for (const name of MENU_NAMES) {
        const mod = findByName(name, false);
        if (mod) {
            unpatches.push(after("default", mod, patchMenu));
        } else {
            unpatches.push(waitFor(
                (exports: any) => (exports?.name === name || exports?.default?.name === name) ? exports : undefined,
                (exports: any) => unpatches.push(after("default", exports, patchMenu)),
            ));
        }
    }
    return () => { for (const fn of unpatches) fn(); };
}
