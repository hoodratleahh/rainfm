import { findAssetId } from "@api/assets";
import SettingsTextInput from "@api/ui/components/SettingsTextInput";
import { showToast } from "@api/ui/toasts";
import { React } from "@metro/common";
import { Button, Stack, TableRow, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { ChannelStore, SelectedChannelStore, UserStore } from "@metro/common/stores";
import { View } from "react-native";

import { addFake, parseDuration } from "../core";

interface ComposeProps {
    /** Pre-selected author (e.g. from a message long-press) */
    initialUser?: any;
    /** Channel to add to; defaults to the channel you have open */
    channelId?: string;
    /** Called after a fake was added (e.g. to close the page) */
    onDone?: () => void;
}

const displayName = (user: any) => user?.globalName ?? user?.global_name ?? user?.username ?? "Unknown";

/** Search users Discord already has cached, by name or ID. */
function searchUsers(query: string): any[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // Exact ID paste
    if (/^\d{15,21}$/.test(q)) {
        const user = UserStore.getUser?.(q);
        return user ? [user] : [];
    }

    let all: any[] = [];
    try {
        const raw = UserStore.getUsers?.();
        all = raw ? (typeof raw.values === "function" ? Array.from(raw.values()) : Object.values(raw)) : [];
    } catch {
        all = [];
    }

    return all
        .filter(u => u && (
            u.username?.toLowerCase().includes(q) ||
            u.globalName?.toLowerCase().includes(q)
        ))
        .slice(0, 8);
}

function channelLabel(channelId?: string): string {
    if (!channelId) return "No channel open - open a chat first";
    const channel = ChannelStore.getChannel?.(channelId);
    if (!channel) return "Current chat";
    if (channel.name) return `#${channel.name}`;
    const recipient = channel.recipients?.[0] ? UserStore.getUser?.(channel.recipients[0]) : null;
    return recipient ? `DM with ${displayName(recipient)}` : "Current DM";
}

export default function Compose({ initialUser, channelId, onDone }: ComposeProps) {
    const [user, setUser] = React.useState<any>(initialUser ?? null);
    const [query, setQuery] = React.useState("");
    const [content, setContent] = React.useState("");
    const [minutesAgo, setMinutesAgo] = React.useState("0");
    const [isCall, setIsCall] = React.useState(false);
    const [missed, setMissed] = React.useState(false);
    const [duration, setDuration] = React.useState("5:00");

    const targetChannel = channelId ?? SelectedChannelStore.getChannelId?.();
    const results = React.useMemo(() => (user ? [] : searchUsers(query)), [query, user]);

    const canAdd = !!targetChannel && !!user && (isCall || content.trim().length > 0);

    const add = () => {
        if (!targetChannel) return void showToast("Open a chat first, then come back here");
        if (!user) return void showToast("Pick who it should be from");

        const minutes = Number(minutesAgo) || 0;
        const ok = isCall
            ? addFake(targetChannel, user, "", minutes, { durationSeconds: missed ? 0 : parseDuration(duration), missed })
            : addFake(targetChannel, user, content.trim(), minutes);

        if (!ok) return;
        showToast(isCall
            ? (missed ? "Fake missed call added" : "Fake call added")
            : `Fake message added as ${displayName(user)}`);
        setContent("");
        onDone?.();
    };

    return (
        <Stack spacing={16}>
            <TableRowGroup title="Where">
                <TableRow
                    label={channelLabel(targetChannel)}
                    subLabel="Only you will see it"
                    icon={<TableRow.Icon source={findAssetId("ChatIcon")} />}
                />
            </TableRowGroup>

            <TableRowGroup title="From">
                {user ? (
                    <TableRow
                        label={displayName(user)}
                        subLabel={`@${user.username} - tap to change`}
                        icon={<TableRow.Icon source={findAssetId("UserIcon")} />}
                        onPress={() => !initialUser && setUser(null)}
                        arrow={!initialUser}
                    />
                ) : (
                    <>
                        <View style={{ padding: 12 }}>
                            <SettingsTextInput
                                placeholder="Search by name, or paste a user ID"
                                value={query}
                                onChange={setQuery}
                                isClearable
                            />
                        </View>
                        {results.map(u => (
                            <TableRow
                                key={u.id}
                                label={displayName(u)}
                                subLabel={`@${u.username}`}
                                icon={<TableRow.Icon source={findAssetId("UserIcon")} />}
                                onPress={() => setUser(u)}
                                arrow
                            />
                        ))}
                        {query.trim() !== "" && results.length === 0 && (
                            <TableRow
                                label="No cached user found"
                                subLabel="Open their profile or a chat with them first, or paste their ID"
                            />
                        )}
                    </>
                )}
            </TableRowGroup>

            <TableRowGroup title="What">
                <TableSwitchRow
                    label="Call log instead of a message"
                    subLabel="Shows a phone-icon call entry"
                    icon={<TableRow.Icon source={findAssetId("PhoneCallIcon")} />}
                    value={isCall}
                    onValueChange={setIsCall}
                />
                {isCall && (
                    <TableSwitchRow
                        label="Missed call"
                        subLabel="Show it as an unanswered call"
                        icon={<TableRow.Icon source={findAssetId("PhoneCallIcon")} />}
                        value={missed}
                        onValueChange={setMissed}
                    />
                )}
                <View style={{ padding: 12 }}>
                    {isCall ? (
                        !missed && (
                            <SettingsTextInput
                                placeholder="Duration as mm:ss (e.g. 5:00)"
                                value={duration}
                                onChange={v => setDuration(v.replace(/[^\d:]/g, "").slice(0, 8))}
                                leadingText="Length"
                            />
                        )
                    ) : (
                        <SettingsTextInput
                            placeholder="Message text (markdown and @mentions work)"
                            value={content}
                            onChange={setContent}
                            autoCapitalize="sentences"
                            autoCorrect
                        />
                    )}
                </View>
                <View style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                    <SettingsTextInput
                        placeholder="0 = right now"
                        value={minutesAgo}
                        onChange={v => setMinutesAgo(v.replace(/\D/g, "").slice(0, 4))}
                        leadingText="Minutes ago"
                    />
                </View>
            </TableRowGroup>

            <Button
                text={isCall ? "Add fake call" : "Add fake message"}
                variant="primary"
                disabled={!canAdd}
                onPress={add}
            />
        </Stack>
    );
}
