import React from "react";
import { showToast } from "@api/ui/toasts";
import { NavigationNative } from "@metro/common";
import { Stack, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { findByProps } from "@metro";
import { ScrollView } from "react-native";

import EditPreset from "./EditPreset";
import { dispatchLocalMessage } from "./dispatch";
import { defaultPreset, ensureRoot } from "./storageModel";
import { useRootStore } from "./storage";
import { clearAllMasks } from "./userMask";

const { TableRow } = findByProps("TableRow");

export default function LocalMessagePreviewSettings() {
    const store = useRootStore();
    ensureRoot(store as any);
    const navigation = NavigationNative.useNavigation();

    const openEditor = (index: number) => {
        navigation.push("RAIN_CUSTOM_PAGE", {
            title: store.rules[index]?.name || "Edit preset",
            render: () => React.createElement(EditPreset, { presetIndex: index }),
        });
    };

    const addPreset = () => {
        const next = defaultPreset(`Preset ${store.rules.length + 1}`);
        (store as any).rules = [...store.rules, next];
        openEditor(store.rules.length - 1);
    };

    const replayNow = () => {
        const cached = (store as any).cached as Record<string, unknown>[];
        if (!cached?.length) { showToast("No cached messages."); return; }
        let count = 0;
        for (const msg of cached) {
            try { dispatchLocalMessage(msg); count++; } catch (_) {}
        }
        showToast(`Replayed ${count} message(s).`);
    };

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ paddingVertical: 12, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Presets">
                    {store.rules.length === 0 && (
                        <TableRow label="No presets yet — add one below" />
                    )}
                    {store.rules.map((rule, i) => (
                        <TableRow
                            key={i}
                            label={rule.name || "Unnamed"}
                            subLabel={
                                rule.channelId
                                    ? `${rule.messages?.length ?? 1} variant(s) · ch ${rule.channelId.slice(0, 8)}…`
                                    : "Set channel ID"
                            }
                            onPress={() => openEditor(i)}
                            arrow
                        />
                    ))}
                    <TableRow
                        label="Add preset"
                        subLabel="Name it, set a channel, write message variants"
                        onPress={addPreset}
                        arrow
                    />
                </TableRowGroup>

                <TableRowGroup title="Cache & replay">
                    <TableSwitchRow
                        label="Auto-replay on load"
                        subLabel="Re-inject cached messages each time Discord opens"
                        value={(store as any).autoReplayOnLoad ?? true}
                        onValueChange={(v: boolean) => { (store as any).autoReplayOnLoad = v; }}
                    />
                    <TableRow
                        label={`Replay now (${(store as any).cached?.length ?? 0} cached)`}
                        onPress={replayNow}
                        arrow
                    />
                    <TableRow
                        label="Clear cache"
                        onPress={() => { (store as any).cached = []; showToast("Cache cleared."); }}
                        arrow
                    />
                    <TableRow
                        label={`Clear all profile swaps (${Object.keys((store as any).masks ?? {}).length})`}
                        subLabel="Removes every locally swapped profile"
                        onPress={() => { clearAllMasks(); showToast("All profile swaps cleared."); }}
                        arrow
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}
