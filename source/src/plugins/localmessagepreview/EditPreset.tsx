import React from "react";
import { showConfirmationAlert } from "@api/ui/alerts";
import { showToast } from "@api/ui/toasts";
import SettingsTextInput from "@api/ui/components/SettingsTextInput";
import { findByProps } from "@metro";
import { NavigationNative } from "@metro/common";
import { Stack, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { ScrollView } from "react-native";

import { dispatchLocalMessage } from "./dispatch";
import { buildPayload } from "./message";
import { commitPreset, deletePreset } from "./storageModel";
import { useRootStore } from "./storage";
import type { Preset } from "./types";

const { Card } = findByProps("Card");
const { TableRow } = findByProps("TableRow");

export default function EditPreset({ presetIndex }: { presetIndex: number }) {
    const store = useRootStore();
    const initial = store.rules[presetIndex];
    if (!initial) return null;

    const [local, setLocal] = React.useState<Preset>({ ...initial });
    const localRef = React.useRef(local);
    React.useEffect(() => { localRef.current = local; }, [local]);

    const navigation = NavigationNative.useNavigation();
    const deletingRef = React.useRef(false);

    React.useEffect(() => {
        const unsub = navigation.addListener("beforeRemove", () => {
            if (deletingRef.current || !store.rules[presetIndex]) return;
            commitPreset(store as any, presetIndex, localRef.current);
        });
        return unsub;
    }, [navigation, presetIndex]);

    const set = <K extends keyof Preset>(key: K, value: Preset[K]) =>
        setLocal(prev => { const n = { ...prev, [key]: value }; localRef.current = n; return n; });

    const sendNow = () => {
        try {
            const count = Math.max(1, localRef.current.messages.length);
            for (let i = 0; i < count; i++) {
                const msg = buildPayload(localRef.current, i);
                (store as any).cached = [...((store as any).cached ?? []), { ...msg }];
                dispatchLocalMessage(msg as Record<string, unknown>);
            }
            showToast(`Injected ${count} local message(s).`);
        } catch (e) {
            showToast((e as Error).message);
        }
    };

    const confirmDelete = () => {
        showConfirmationAlert({
            title: "Delete preset?",
            content: "This cannot be undone.",
            confirmText: "Delete",
            confirmColor: "red",
            cancelText: "Cancel",
            onConfirm: () => {
                deletingRef.current = true;
                deletePreset(store as any, presetIndex);
                navigation.goBack();
            },
        });
    };

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ paddingVertical: 12, paddingHorizontal: 12 }} spacing={16}>
                <TableRowGroup title="Preset">
                    <Card>
                        <SettingsTextInput
                            placeholder="Preset name"
                            value={local.name}
                            onChange={(v: string) => set("name", v)}
                            isClearable
                        />
                    </Card>
                    <Card>
                        <SettingsTextInput
                            placeholder="Channel ID (blank = current channel)"
                            value={local.channelId}
                            onChange={(v: string) => set("channelId", v)}
                            isClearable
                        />
                    </Card>
                    <Card>
                        <SettingsTextInput
                            placeholder="Target user ID (blank = your account)"
                            value={local.targetUserId}
                            onChange={(v: string) => set("targetUserId", v)}
                            isClearable
                        />
                    </Card>
                </TableRowGroup>

                <TableRowGroup title="Messages">
                    {local.messages.map((text, i) => (
                        <React.Fragment key={i}>
                            <Card>
                                <SettingsTextInput
                                    placeholder={`Variant ${i + 1} text`}
                                    value={text}
                                    onChange={(v: string) => {
                                        const next = [...local.messages];
                                        next[i] = v;
                                        set("messages", next);
                                    }}
                                    isClearable
                                />
                            </Card>
                        </React.Fragment>
                    ))}
                    <TableRow
                        label="Add variant"
                        onPress={() => setLocal(prev => {
                            const n = { ...prev, messages: [...prev.messages, ""] };
                            localRef.current = n;
                            return n;
                        })}
                    />
                    {local.messages.length > 1 && (
                        <TableRow
                            label="Remove last variant"
                            onPress={() => setLocal(prev => {
                                const n = { ...prev, messages: prev.messages.slice(0, -1) };
                                localRef.current = n;
                                return n;
                            })}
                        />
                    )}
                </TableRowGroup>

                <TableRowGroup title="Embed">
                    <TableSwitchRow
                        label="Show as embed"
                        value={local.showEmbedPreview}
                        onValueChange={(v: boolean) => set("showEmbedPreview", v)}
                    />
                    {local.showEmbedPreview && (
                        <Card>
                            <SettingsTextInput
                                placeholder="Embed image URL (optional)"
                                value={local.embedImageUrl}
                                onChange={(v: string) => set("embedImageUrl", v)}
                                isClearable
                            />
                        </Card>
                    )}
                </TableRowGroup>

                <TableRowGroup title="Actions">
                    <TableRow
                        label="Send now (local only)"
                        subLabel="Injects all variants and saves to cache"
                        onPress={sendNow}
                    />
                    <TableRow
                        label="Delete preset"
                        onPress={confirmDelete}
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}
