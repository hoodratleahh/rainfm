import { findAssetId } from "@api/assets";
import { after, before } from "@api/patcher";
import { showToast } from "@api/ui/toasts";
import { findInReactTree } from "@lib/utils";
import { logger } from "@lib/utils/logger";
import { findByName, findByProps } from "@metro";
import { React } from "@metro/common";
import { Forms } from "@metro/common/components";
import { ScrollView } from "react-native";

import { isFake, removeFake } from "../core";
import Compose from "./Compose";

// Same building blocks Rain's ViewRaw plugin uses for its long-press entry
const LazyActionSheet = findByProps("openLazy", "hideActionSheet");
const Navigation = findByProps("push", "pushLazy", "pop");
const modalCloseButton =
    findByProps("getRenderCloseButton")?.getRenderCloseButton ??
    findByProps("getHeaderCloseButton")?.getHeaderCloseButton;
const Navigator = findByName("Navigator") ?? findByProps("Navigator")?.Navigator;
const { FormRow, FormIcon } = Forms;

const displayName = (user: any) => user?.globalName ?? user?.global_name ?? user?.username ?? "this user";

function openComposePage(author: any, channelId: string) {
    const page = () => (
        <Navigator
            initialRouteName="FakeMessageCompose"
            goBackOnBackPress
            screens={{
                FakeMessageCompose: {
                    title: "Fake Message",
                    headerLeft: modalCloseButton?.(() => Navigation.pop()),
                    render: () => (
                        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
                            <Compose initialUser={author} channelId={channelId} onDone={() => Navigation.pop()} />
                        </ScrollView>
                    ),
                },
            }}
        />
    );
    Navigation.push(page);
}

interface Entry {
    key: string;
    label: string;
    icon: string;
    onPress: () => void;
}

/** Add rows to the long-press sheet, handling both sheet layouts Discord ships (mirrors ViewRaw). */
function addEntries(tree: any, entries: Entry[]) {
    const legacyButtons = findInReactTree(tree, x => x?.[0]?.type?.name === "ButtonRow");
    if (legacyButtons) {
        for (const e of entries) {
            legacyButtons.push(
                <FormRow
                    key={e.key}
                    label={e.label}
                    leading={<FormIcon style={{ opacity: 1 }} source={findAssetId(e.icon)} />}
                    onPress={e.onPress}
                />,
            );
        }
        return;
    }

    const groups = findInReactTree(tree, x => Array.isArray(x) && x[0]?.type?.name === "ActionSheetRowGroup");
    const middleGroup = groups?.[1];
    const template = middleGroup?.props?.children?.[0];
    if (!template) {
        logger.log("[FakeMessage] Could not find the long-press action sheet");
        return;
    }

    const ActionSheetRow = template.type;
    for (const e of entries) {
        middleGroup.props.children.push(
            <ActionSheetRow
                key={e.key}
                label={e.label}
                icon={{
                    $$typeof: template.props.icon.$$typeof,
                    type: template.props.icon.type,
                    key: null,
                    ref: null,
                    props: {
                        IconComponent: () => <FormIcon style={{ opacity: 1 }} source={findAssetId(e.icon)} />,
                    },
                }}
                onPress={e.onPress}
            />,
        );
    }
}

export default () => [
    before("openLazy", LazyActionSheet, ([component, key, msg]) => {
        const message = msg?.message;
        if (key !== "MessageLongPressActionSheet" || !message?.author) return;

        component.then((instance: any) => {
            const unpatch = after("default", instance, (_, tree) => {
                React.useEffect(() => () => { unpatch(); }, []);

                const channelId = message.channel_id ?? message.channelId;
                const entries: Entry[] = [
                    {
                        key: "fakemessage-as-user",
                        label: `Fake Message As ${displayName(message.author)}`,
                        icon: "PencilIcon",
                        onPress: () => {
                            LazyActionSheet.hideActionSheet();
                            openComposePage(message.author, channelId);
                        },
                    },
                ];

                if (isFake(message.id)) {
                    entries.push({
                        key: "fakemessage-remove",
                        label: message.type === 3 ? "Remove Fake Call" : "Remove Fake Message",
                        icon: "TrashIcon",
                        onPress: () => {
                            LazyActionSheet.hideActionSheet();
                            if (removeFake(message.id)) showToast("Fake removed");
                        },
                    });
                }

                try {
                    addEntries(tree, entries);
                } catch (e) {
                    logger.log("[FakeMessage] Failed to add long-press entries:", e);
                }
            });
        });
    }),
];
