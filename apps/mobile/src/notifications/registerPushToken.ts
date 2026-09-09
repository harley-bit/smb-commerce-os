export type PushPlatform = "ios" | "android";

export interface RegisterPushTokenDeps {
  baseUrl: string;
  fetchFn: typeof fetch;
  accessToken: string | null;
}

export interface DevicePushToken {
  platform: PushPlatform;
  token: string;
}

export type RegisterPushTokenResult = { ok: true } | { ok: false; reason: "unauthenticated" | "error" };

/**
 * `docs/cards/D148.md` — mobile's device push-token registration, calling
 * `apps/api/src/routes/pushTokens.ts`'s `POST /v1/m/{slug}/account/push-tokens`
 * (D148), same `Authorization: Bearer` posture as every other mobile fetch
 * helper since D138's session split (`../account/fetchOrderHistory.ts`).
 *
 * This card's acceptance criterion ("delivered on both platforms"): this
 * module takes the platform as plain data on `DevicePushToken` and sends it
 * through the exact same request shape either way — no `if (platform ===
 * "ios")` branch anywhere — proven in `registerPushToken.test.ts` by
 * registering one of each and asserting an identical call shape.
 *
 * No live `expo-notifications` (or any push SDK) dependency exists in this
 * repo yet — same "native/simulated now, real provider later" posture as
 * `../payments/HostedCardField.tsx` (D146). The caller is responsible for
 * obtaining the device's own real token; this module only relays it.
 */
export async function registerPushToken(
  deps: RegisterPushTokenDeps,
  slug: string,
  device: DevicePushToken,
): Promise<RegisterPushTokenResult> {
  if (!deps.accessToken) {
    return { ok: false, reason: "unauthenticated" };
  }

  const response = await deps.fetchFn(`${deps.baseUrl}/v1/m/${slug}/account/push-tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deps.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ platform: device.platform, token: device.token }),
  });

  if (response.status === 401) {
    return { ok: false, reason: "unauthenticated" };
  }
  if (!response.ok) {
    return { ok: false, reason: "error" };
  }

  return { ok: true };
}
