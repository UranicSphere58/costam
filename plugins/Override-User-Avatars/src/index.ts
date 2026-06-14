import { findByProps, findByStoreName } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { storage } from "@vendetta/plugin";

// tag added to all print statements to help with debugging with logcat on adb
const TAG = "[custom-avatars]";

type AvatarOverride = {
  userId?: string;
  imageUrl?: string;
  displayName?: string;
};

let patches = [];

export { default as settings } from "./settings";

function getOverrides(): AvatarOverride[] {
  if (Array.isArray(storage.overrides)) {
    return storage.overrides;
  }

  const migratedOverrides: AvatarOverride[] = [];
  if (storage.targetUserId || storage.imageUrl) {
    migratedOverrides.push({
      userId: storage.targetUserId || "",
      imageUrl: storage.imageUrl || "",
    });
  }

  storage.overrides = migratedOverrides;
  return storage.overrides;
}

function getOverride(
  target: { id?: string } | string | undefined,
): AvatarOverride | null {
  const userId = typeof target === "string" ? target : target?.id;
  if (!userId) {
    return null;
  }

  for (const override of getOverrides()) {
    const overrideUserId = override?.userId?.trim();
    if (overrideUserId === userId) {
      return override;
    }
  }

  return null;
}

function getOverrideUrl(
  target: { id?: string } | string | undefined,
): string | null {
  return getOverride(target)?.imageUrl?.trim() || null;
}

function applyUserOverride<
  T extends { username?: string; globalName?: string; displayName?: string },
>(user: T, override: AvatarOverride | null): T {
  const overrideName = override?.displayName?.trim();
  if (!overrideName) {
    return user;
  }

  return {
    ...user,
    username: overrideName,
    globalName: overrideName,
    displayName: overrideName,
  };
}

function refreshUsers(
  userStore: { getUser: (id: string) => unknown } | undefined,
  userIds: string[],
): void {
  if (!userStore) {
    return;
  }

  for (const userId of new Set(
    userIds.map((id) => id?.trim()).filter(Boolean),
  )) {
    const user = userStore.getUser(userId);
    if (!user) {
      continue;
    }

    FluxDispatcher.dispatch({
      type: "USER_UPDATE",
      user,
    });
  }
}

function getAffectedUserIds(): string[] {
  return getOverrides()
    .map((override) => override?.userId?.trim())
    .filter(Boolean);
}

export function onLoad(): void {
  console.log(`${TAG} loaded`);

  const UserStore = findByStoreName("UserStore");
  if (!UserStore) {
    console.log(`${TAG} userStore not found`);
    return;
  }

  const avatarModule = findByProps("getUserAvatarURL");
  if (!avatarModule) {
    console.log(`${TAG} avatar module not found`);
    return;
  }

  const originalGetUser = UserStore.getUser;
  UserStore.getUser = function (...args) {
    const user = originalGetUser.apply(this, args);
    if (!user) {
      return user;
    }

    return applyUserOverride(user, getOverride(args[0]));
  };
  patches.push(() => {
    UserStore.getUser = originalGetUser;
  });

  // patch getUserAvatarSource, overrides avatar in DMs and group chats
  if (avatarModule.getUserAvatarSource) {
    const originalGetUserAvatarSource = avatarModule.getUserAvatarSource;
    avatarModule.getUserAvatarSource = function (...args) {
      const original = originalGetUserAvatarSource.apply(this, args);
      const overrideUrl = getOverrideUrl(args[0]);

      if (overrideUrl && original) {
        return {
          ...original,
          uri: overrideUrl,
        };
      }

      return original;
    };
    patches.push(() => {
      avatarModule.getUserAvatarSource = originalGetUserAvatarSource;
    });
  }

  // patch getUserAvatarURL, overrides avatar in voice calls
  const originalGetUserAvatarURL = avatarModule.getUserAvatarURL;
  avatarModule.getUserAvatarURL = function (...args) {
    const overrideUrl = getOverrideUrl(args[0]);
    if (overrideUrl) {
      return overrideUrl;
    }

    return originalGetUserAvatarURL.apply(this, args);
  };
  patches.push(() => {
    avatarModule.getUserAvatarURL = originalGetUserAvatarURL;
  });

  console.log(`${TAG} patches applied`);

  try {
    refreshUsers(UserStore, getAffectedUserIds());
    console.log(`${TAG} ui refreshed`);
  } catch (e) {
    console.log(`${TAG} could not trigger refresh:`, e.message);
  }
}

export function onUnload(): void {
  console.log(`${TAG} unloading...`);

  const UserStore = findByStoreName("UserStore");
  const affectedUserIds = getAffectedUserIds();

  // restore patches
  patches.forEach((unpatch) => unpatch());
  patches = [];

  try {
    refreshUsers(UserStore, affectedUserIds);
  } catch (e) {
    console.log(`${TAG} could not refresh after unload:`, e.message);
  }

  console.log(`${TAG} unloaded`);
}
