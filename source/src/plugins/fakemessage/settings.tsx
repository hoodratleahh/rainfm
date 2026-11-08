import { findAssetId } from "@api/assets";
import { showToast } from "@api/ui/toasts";
import { React } from "@metro/common";
import { Stack, TableRow, TableRowGroup, TableSwitchRow } from "@metro/common/components";
import { ScrollView } from "react-native";

import { clearAllFakes, getFakeCount } from "./core";
import { useFakeMessageSettings } from "./storage";
import Compose from "./ui/Compose";

export default () => {
    const settings = useFakeMessageSettings();
    const [, forceUpdate] = React.useReducer((n: number) => n + 1, 0);

    return (
        <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            <Stack style={{ paddingVertical: 24, paddingHorizontal: 12 }} spacing={24}>
                <Compose onDone={forceUpdate} />

                <TableRowGroup title="Storage">
                    <TableSwitchRow
                        label="Keep fake messages after restart"
                        subLabel="Re-adds your fakes whenever you open a channel"
                        icon={<TableRow.Icon source={findAssetId("ClockIcon")} />}
                        onValueChange={(v: boolean) => {
                            useFakeMessageSettings.getState().updateSettings({ persist: v });
                        }}
                        value={settings.persist}
                    />
                </TableRowGroup>

                <TableRowGroup title="Cleanup">
                    <TableRow
                        label="Clear all fake messages"
                        subLabel={`${getFakeCount()} stored. Long-press a fake to remove just that one.`}
                        variant="danger"
                        icon={<TableRow.Icon variant="danger" source={findAssetId("TrashIcon")} />}
                        onPress={() => {
                            clearAllFakes();
                            forceUpdate();
                            showToast("All fake messages removed");
                        }}
                    />
                </TableRowGroup>
            </Stack>
        </ScrollView>
    );
};
