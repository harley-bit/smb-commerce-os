import type { PushNotification, TenantContext } from "@smb-os/domain";
import type { PushDeviceTokenRepository } from "../repositories/PushDeviceTokenRepository.js";

export interface PushSendInput {
  readonly platform: string;
  readonly token: string;
  readonly notification: PushNotification;
}

/**
 * `docs/cards/D148.md` — "delivery out of scope" posture, same as every
 * other notifier in this codebase (D069/D076/D094/D120/D131/D134): this
 * dispatcher has no opinion on the actual push transport (no live
 * APNs/FCM wiring exists anywhere in this repo) — it guarantees the
 * injected `send` callback fires once per registered device with the
 * pre-built, already-sanitized `PushNotification` content.
 *
 * This card's acceptance criterion ("delivered on both platforms"): the
 * dispatch loop iterates every device row `PushDeviceTokenRepository`
 * returns for the customer without branching on `platform` at all — an
 * iOS-registered and an Android-registered device are dispatched through
 * the exact same code path, proven in `PushNotificationDispatcher.test.ts`
 * by registering one of each and asserting both receive the call.
 */
export type PushSender = (input: PushSendInput) => void;

export class PushNotificationDispatcher {
  constructor(
    private readonly tokens: PushDeviceTokenRepository,
    private readonly send: PushSender = () => undefined,
  ) {}

  dispatch(ctx: TenantContext, customerUserId: string, notification: PushNotification): void {
    const devices = this.tokens.listForCustomer(ctx, customerUserId);
    for (const device of devices) {
      this.send({ platform: device.platform, token: device.token, notification });
    }
  }
}
