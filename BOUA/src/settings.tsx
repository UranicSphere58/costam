import { ReactNative } from "@vendetta/metro/common";
import { Forms } from "@vendetta/ui/components";
import { storage } from "@vendetta/plugin";
import { useProxy } from "@vendetta/storage";

const { FormInput, FormDivider, FormRow } = Forms;

export default () => {
    useProxy(storage);

    storage.overrides = storage.overrides || [];

    return (
        <ReactNative.ScrollView>
            <FormRow label="Add User ID" />
            <FormInput
                placeholder="User ID"
                onChange={(v) => {
                    storage.overrides.push({ id: v, url: "" });
                    storage.overrides = [...storage.overrides];
                }}
            />

            <FormDivider />

            <FormRow label="Set URL for LAST added user" />
            <FormInput
                placeholder="Image URL"
                onChange={(v) => {
                    const arr = storage.overrides;
                    if (!arr.length) return;

                    arr[arr.length - 1].url = v;
                    storage.overrides = [...arr];
                }}
            />
        </ReactNative.ScrollView>
    );
};
