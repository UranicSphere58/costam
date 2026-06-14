import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";

const TAG = "[custom-avatars-multi]";
let patches = [];

export { default as settings } from "./settings";

export function onLoad(): void {
    console.log(`${TAG} loaded`);

    storage.overrides = storage.overrides || [];

    const overrides = storage.overrides;

    const UserStore = findByStoreName("UserStore");
    const avatarModule = findByProps("getUserAvatarURL");

    if (!UserStore || !avatarModule) {
        console.log(`${TAG} missing modules`);
        return;
    }

    // PATCH: getUserAvatarSource
    if (avatarModule.getUserAvatarSource) {
        const original = avatarModule.getUserAvatarSource;

        avatarModule.getUserAvatarSource = function (...args) {
            const user = args[0];
            const override = overrides.find(o => o.id === user?.id);

            if (override) {
                const res = original.apply(this, args);
                if (res) {
                    return { ...res, uri: override.url };
                }
            }

            return original.apply(this, args);
        };

        patches.push(() => {
            avatarModule.getUserAvatarSource = original;
        });
    }

    // PATCH: getUserAvatarURL
    const originalURL = avatarModule.getUserAvatarURL;

    avatarModule.getUserAvatarURL = function (...args) {
        const user = args[0];
        const override = overrides.find(o => o.id === user?.id);

        if (override) {
            return override.url;
        }

        return originalURL.apply(this, args);
    };

    patches.push(() => {
        avatarModule.getUserAvatarURL = originalURL;
    });

    // refresh UI
    try {
        FluxDispatcher.dispatch({
            type: "USER_UPDATE",
            user: UserStore.getUser(overrides?.[0]?.id)
        });
    } catch {}

    console.log(`${TAG} ready`);
}

export function onUnload(): void {
    patches.forEach(p => p());
    patches = [];
    console.log(`${TAG} unloaded`);
}
