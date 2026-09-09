import type { FastifyInstance } from "fastify";
import { ForbiddenActionError, IllegalReservationTransitionError } from "@smb-os/domain";
import {
  ConditionMediaConfirmService,
  ConditionMediaHashMismatchError,
  ConditionMediaRepository,
  ConditionMediaStorageKeyReusedError,
  ConditionMediaUploadService,
  ConditionReportNotFoundError,
  ConditionReportRepository,
  ConditionReportService,
  FulfillmentEventRepository,
  FulfillmentEventService,
  MediaTooLargeError,
  MissingCheckoutBaselineError,
  MissingCheckoutConditionReportError,
  MissingFulfillmentNoteError,
  OrderLineNotFoundError,
  OrderRepository,
  ReservationRepository,
  UnsupportedMediaTypeError,
  runSqliteMigrations,
  type Connection,
} from "@smb-os/db";
import type { MediaUploadProvider } from "@smb-os/domain";
import { problemType, sendProblem } from "../problemDetails.js";

export interface FulfillmentRouteOptions {
  mediaUploadProvider: MediaUploadProvider;
}

interface FulfillmentRouteServices {
  conditionReports: ConditionReportService;
  mediaUpload: ConditionMediaUploadService;
  mediaConfirm: ConditionMediaConfirmService;
  fulfillmentEvents: FulfillmentEventService;
}

/**
 * Lazily migrates `connection` on first use — same pattern as
 * `./bookings.ts`'s `createBookingServiceFactory`.
 */
function createFulfillmentServiceFactory(
  connection: Connection,
  mediaUploadProvider: MediaUploadProvider,
): () => Promise<FulfillmentRouteServices> {
  let ready: Promise<FulfillmentRouteServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => {
      const orderLines = new OrderRepository(connection);
      const conditionReportRepo = new ConditionReportRepository(connection);
      const conditionMediaRepo = new ConditionMediaRepository(connection);
      return {
        conditionReports: new ConditionReportService(conditionReportRepo, orderLines, conditionMediaRepo),
        mediaUpload: new ConditionMediaUploadService(conditionReportRepo, mediaUploadProvider),
        mediaConfirm: new ConditionMediaConfirmService(conditionReportRepo, conditionMediaRepo),
        fulfillmentEvents: new FulfillmentEventService(
          orderLines,
          new FulfillmentEventRepository(connection),
          new ReservationRepository(connection),
          conditionReportRepo,
        ),
      };
    });
    return ready;
  };
}

/**
 * `docs/cards/D116.md` — Rental check-out flow. Exposes the CHECKOUT half
 * of the condition-report trail (`ConditionReportService.recordCheckout`,
 * D116) and the media-evidence upload pair (D073/D074) as HTTP, plus
 * `POST /order-lines/:orderLineId/pickup` over `FulfillmentEventService`
 * (D070/D072). This card's acceptance criterion — "cannot complete
 * checkout without a report" — already holds at the service layer
 * (`MissingCheckoutConditionReportError`, D072): the pickup route below
 * maps that error to `409 Conflict` rather than letting it become an
 * unhandled 500, so a staff member who tries to skip straight to pickup
 * gets an explicit, actionable rejection instead of a report or an event
 * ever being written.
 *
 * This card's security check ("photograph the asset, not the customer")
 * is a UI-guidance requirement, not a server-enforceable one — nothing
 * in `condition_reports`/`condition_media`'s schema references a person,
 * only `orderLineId`/`inventoryUnitId`, and the dashboard checkout view
 * (`apps/web/src/app/dashboard/rentals`) surfaces the guidance text at the
 * photo-capture step itself.
 */
export function registerFulfillmentRoutes(
  app: FastifyInstance,
  connection: Connection,
  options: FulfillmentRouteOptions,
): void {
  const getServices = createFulfillmentServiceFactory(connection, options.mediaUploadProvider);

  app.post<{ Params: { orderLineId: string }; Body: unknown }>(
    "/order-lines/:orderLineId/condition-reports/checkout",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        inventoryUnitId?: unknown;
        conditionGrade?: unknown;
        notes?: unknown;
      };
      if (typeof body.inventoryUnitId !== "string" || body.inventoryUnitId.length === 0) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "inventoryUnitId is required.");
      }
      if (typeof body.conditionGrade !== "string" || body.conditionGrade.length === 0) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "conditionGrade is required.");
      }

      const { conditionReports } = await getServices();
      try {
        const report = conditionReports.recordCheckout(request.auth!.tenant, request.auth!.role, {
          orderLineId: request.params.orderLineId,
          inventoryUnitId: body.inventoryUnitId,
          conditionGrade: body.conditionGrade,
          notes: typeof body.notes === "string" ? body.notes : null,
          createdBy: request.auth!.identity.userId,
          createdAt: new Date().toISOString(),
        });
        return reply.code(201).send(report);
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof OrderLineNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order line with that id.");
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { conditionReportId: string }; Body: unknown }>(
    "/condition-reports/:conditionReportId/media/upload-url",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as { contentType?: unknown; bytes?: unknown };
      if (typeof body.contentType !== "string" || typeof body.bytes !== "number") {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          "contentType (string) and bytes (number) are required.",
        );
      }

      const { mediaUpload } = await getServices();
      try {
        const grant = await mediaUpload.requestUpload(request.auth!.tenant, request.auth!.role, {
          conditionReportId: request.params.conditionReportId,
          contentType: body.contentType,
          bytes: body.bytes,
        });
        return reply.code(201).send(grant);
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof ConditionReportNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No condition report with that id.");
        }
        if (error instanceof UnsupportedMediaTypeError || error instanceof MediaTooLargeError) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { conditionReportId: string }; Body: unknown }>(
    "/condition-reports/:conditionReportId/media/confirm",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        storageKey?: unknown;
        contentType?: unknown;
        bytesBase64?: unknown;
        declaredSha256?: unknown;
        capturedAt?: unknown;
      };
      if (
        typeof body.storageKey !== "string" ||
        typeof body.contentType !== "string" ||
        typeof body.bytesBase64 !== "string" ||
        typeof body.declaredSha256 !== "string" ||
        typeof body.capturedAt !== "string"
      ) {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          "storageKey, contentType, bytesBase64, declaredSha256, and capturedAt are all required.",
        );
      }

      const { mediaConfirm } = await getServices();
      try {
        const id = mediaConfirm.confirmUpload(request.auth!.tenant, request.auth!.role, {
          conditionReportId: request.params.conditionReportId,
          storageKey: body.storageKey,
          contentType: body.contentType,
          bytes: Buffer.from(body.bytesBase64, "base64"),
          declaredSha256: body.declaredSha256,
          capturedAt: body.capturedAt,
        });
        return reply.code(201).send({ id });
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof ConditionReportNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No condition report with that id.");
        }
        if (error instanceof UnsupportedMediaTypeError || error instanceof MediaTooLargeError) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
        }
        if (error instanceof ConditionMediaHashMismatchError) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "Uploaded bytes do not match the declared hash.");
        }
        if (error instanceof ConditionMediaStorageKeyReusedError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", "This upload has already been confirmed.");
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { orderLineId: string }; Body: unknown }>(
    "/order-lines/:orderLineId/pickup",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as { note?: unknown; occurredAt?: unknown };
      const note = typeof body.note === "string" ? body.note : "";
      const occurredAt = typeof body.occurredAt === "string" ? body.occurredAt : new Date().toISOString();

      const { fulfillmentEvents } = await getServices();
      try {
        const id = fulfillmentEvents.recordPickup(request.auth!.tenant, request.auth!.role, {
          orderLineId: request.params.orderLineId,
          occurredAt,
          actorUserId: request.auth!.identity.userId,
          note,
        });
        return reply.code(201).send({ id });
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof OrderLineNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order line with that id.");
        }
        if (error instanceof MissingFulfillmentNoteError) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
        }
        if (error instanceof MissingCheckoutConditionReportError) {
          return sendProblem(
            request,
            reply,
            409,
            problemType("conflict"),
            "Conflict",
            "A CHECKOUT condition report is required before this order line can be picked up.",
          );
        }
        if (error instanceof IllegalReservationTransitionError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", error.message);
        }
        throw error;
      }
    },
  );

  /**
   * `docs/cards/D117.md` — the CHECKIN half of the condition-report trail
   * (`ConditionReportService.recordCheckin`, D075) gets its HTTP surface,
   * mirroring `POST .../condition-reports/checkout` above. The card's
   * acceptance criterion ("grade delta surfaced") is answered by
   * `recordCheckin`'s own response shape, which already carries the
   * checkout baseline, the new checkin report, and the computed delta in
   * one payload — no separate round-trip needed to show the comparison
   * right after submission.
   */
  app.post<{ Params: { orderLineId: string }; Body: unknown }>(
    "/order-lines/:orderLineId/condition-reports/checkin",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as {
        inventoryUnitId?: unknown;
        conditionGrade?: unknown;
        notes?: unknown;
      };
      if (typeof body.inventoryUnitId !== "string" || body.inventoryUnitId.length === 0) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "inventoryUnitId is required.");
      }
      if (typeof body.conditionGrade !== "string" || body.conditionGrade.length === 0) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "conditionGrade is required.");
      }

      const { conditionReports } = await getServices();
      try {
        const result = conditionReports.recordCheckin(request.auth!.tenant, request.auth!.role, {
          orderLineId: request.params.orderLineId,
          inventoryUnitId: body.inventoryUnitId,
          conditionGrade: body.conditionGrade,
          notes: typeof body.notes === "string" ? body.notes : null,
          createdBy: request.auth!.identity.userId,
          createdAt: new Date().toISOString(),
        });
        return reply.code(201).send(result);
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof MissingCheckoutBaselineError) {
          return sendProblem(
            request,
            reply,
            409,
            problemType("conflict"),
            "Conflict",
            "A CHECKOUT condition report is required before a CHECKIN can be recorded for this order line.",
          );
        }
        throw error;
      }
    },
  );

  /**
   * `docs/cards/D117.md` acceptance criterion ("unit returns to
   * availability") — `FulfillmentEventService.recordReturn` (D070/D071)
   * already drives the linked reservation to `RETURNED`, which
   * `ReservationRepository`'s `blockingStatePredicate` (`docs/design/03`)
   * excludes from every blocking-availability query, so the unit is free
   * to be reserved again the instant this call succeeds — nothing further
   * to do here beyond exposing the existing service method as HTTP.
   */
  app.post<{ Params: { orderLineId: string }; Body: unknown }>(
    "/order-lines/:orderLineId/return",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as { note?: unknown; occurredAt?: unknown };
      const note = typeof body.note === "string" ? body.note : "";
      const occurredAt = typeof body.occurredAt === "string" ? body.occurredAt : new Date().toISOString();

      const { fulfillmentEvents } = await getServices();
      try {
        const id = fulfillmentEvents.recordReturn(request.auth!.tenant, request.auth!.role, {
          orderLineId: request.params.orderLineId,
          occurredAt,
          actorUserId: request.auth!.identity.userId,
          note,
        });
        return reply.code(201).send({ id });
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof OrderLineNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order line with that id.");
        }
        if (error instanceof MissingFulfillmentNoteError) {
          return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", error.message);
        }
        if (error instanceof IllegalReservationTransitionError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", error.message);
        }
        throw error;
      }
    },
  );

  /**
   * `docs/cards/D117.md` — the check-in dashboard's read model
   * (`ConditionReportService.getComparison`): whatever CHECKOUT/CHECKIN
   * reports exist so far, each with its confirmed media (this card's
   * security check — "media integrity hash verified on display" — is
   * answered by serving each item's `sha256` straight from
   * `condition_media`, the row `ConditionMediaConfirmService` only ever
   * writes after independently recomputing and verifying that hash against
   * the uploaded bytes, D074 — never a value trusted from a request at
   * read time), plus the grade delta once both halves are on file. Gated
   * on `bookings:view`, not `:manage` — this is a read, open to every
   * merchant role including `READ_ONLY`.
   */
  app.get<{ Params: { orderLineId: string } }>(
    "/order-lines/:orderLineId/condition-reports",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { conditionReports } = await getServices();
      try {
        const comparison = conditionReports.getComparison(
          request.auth!.tenant,
          request.auth!.role,
          request.params.orderLineId,
        );
        return reply.code(200).send(comparison);
      } catch (error) {
        // No `ForbiddenActionError` branch here: `bookings:view` (this route's
        // gate, inside `getComparison`) is granted to every merchant role,
        // including `READ_ONLY` — there is no role this can reject.
        if (error instanceof OrderLineNotFoundError) {
          return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No order line with that id.");
        }
        throw error;
      }
    },
  );
}
