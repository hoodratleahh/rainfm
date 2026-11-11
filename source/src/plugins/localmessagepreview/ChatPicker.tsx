import React from "react";
import SettingsTextInput from "@api/ui/components/SettingsTextInput";
import { showToast } from "@api/ui/toasts";
import { findByProps } from "@metro";
import { NavigationNative } from "@metro/common";
import { Stack, TableRowGroup } from "@metro/common/components";
import { ScrollView } from "react-native";

import { channelName, currentChannelId, listDirectMessages } from "./chats";

const { Card } = findByProps("Card");
const { TableRow } = findByProps("TableRow");

const MAX_SHOWN = 60;
const CHANNEL_ID = /^\d{15,25}$/;

/** Opens the picker on top of the current page; it closes itself once a chat is chosen. */
export function pickChat(navigation: any, title: string, onPick: (channelId: string, name: string) => void): void {
    navigation.push("RAIN_CUSTOM_PAGE", {
        title,
        render: () => React.createElement(ChatPicker, { onPick }),
    });
}

function ChatPicker({ onPick }: { onPick: (channelId: string, name: string) => void }) {
    const navigation = NavigationNative.useNavigation();
    const [search, setSearch] = React.useState("");
    const [manualId, setManualId] = React.useState("");

    const chats = React.useMemo(() => listDirectMessages(), []);
    const current = currentChannelId();

    const query = search.trim().toLowerCase();
    const matches = query ? chats.filter(chat => chat.name.toLowerCase().includes(query)) : chats;

    const choose = (channelId: string) => {
        navigation.goBack();
        onPick(channelId, channelName(channelId));
    };

    const chooseManual = () => {
        const id = manualId.trim();
        if (!CHANNEL_ID.test(id)) { showToast("That channel ID isn't valid."); return; }
        choose(id);
    };

    return (
        <ScrollView style={{ flex: 1 }}>
            <Stack style={{ paddingVertical: 12, paddingHorizontal: 12 }} spacing={16}>
                {current && (
                    <TableRowGroup title="Open right now">
                        <TableRow label={channelName(current)} subLabel="The chat you have open" onPress={() => choose(current)} arrow />
                    </TableRowGroup>
                )}

                <TableRowGroup title={`Direct messages (${chats.length})`}>
                    <Card>
                        <SettingsTextInput placeholder="Search by name" value={search} onChange={setSearch} isClearable />
                    </Card>
                    {matches.slice(0, MAX_SHOWN).map(chat => (
                        <TableRow key={chat.id} label={chat.name} onPress={() => choose(chat.id)} arrow />
                    ))}
                    {matches.length === 0 && <TableRow label="No chats match" />}
                    {matches.length > MAX_SHOWN && (
                        <TableRow label={`${matches.length - MAX_SHOWN} more — search to narrow it down`} />
                    )}
                </TableRowGroup>

                <TableRowGroup title="Any other channel">
                    <Card>
                        <SettingsTextInput placeholder="Channel ID" value={manualId} onChange={setManualId} isClearable />
                    </Card>
                    <TableRow label="Use this channel ID" onPress={chooseManual} arrow />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
}
