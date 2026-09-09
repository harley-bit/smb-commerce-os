import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  assertCan,
  DepositHoldAlreadyResolvedError,
  ForbiddenActionError,
  IllegalDamageClaimTransitionError,
  type DepositHoldProvider,
} from "@smb-os/domain";
import {
  DamageClaimRepository,
  DamageClaimService,
  DepositAuthorizationRepository,
  DepositAuthorizationService,
  OrderRepository,
  PaymentRepository,
  runSqliteMigrations,
  type DamageClaim,
  type Connection,
} from "@smb-os/db";
import { problemType, sendProblem } from "../problemDetails.js";

interface DamageClaimRouteServices {
  damageClaims: DamageClaimService;
  deposits: DepositAuthorizationRepository;
  depositService: DepositAuthorizationService;
}

/** Lazily migrates `connection` on first use — same pattern as `./fulfillment.ts`/`./connect.ts`. */
function createServiceFactory(
  connection: Connection,
  depositHoldProvider: DepositHoldProvider,
): () => Promise<DamageClaimRouteServices> {
  let ready: Promise<DamageClaimRouteServices> | null = null;
  return () => {
    ready ??= runSqliteMigrations(connection).then(() => {
      const deposits = new DepositAuthorizationRepository(connection);
      return {
        damageClaims: new DamageClaimService(new DamageClaimRepository(connection)),
        deposits,
        depositService: new DepositAuthorizationService(
          new OrderRepository(connection),
          new PaymentRepository(connection),
          deposits,
          depositHoldProvider,
        ),
      };
    });
    return ready;
  };
}

/**
 * `docs/cards/D118.md`'s security check ("capture requires explicit
 * confirmation — one attempt only") is enforced at two independent layers,
 * neither of which trusts the UI: `DepositHoldProvider.captureManualCaptureHold`
 * (the provider layer, D095) rejects a second attempt on an already-resolved
 * intent with `DepositHoldAlreadyResolvedError`, mapped below to `409
 * Conflict`; the *UI's* contribution (`DamageClaimView.tsx`) is a
 * confirmation step the operator must explicitly accept before this route
 * is ever called, plus disabling the capture control immediately on the
 * first click so a second click physically cannot fire before the first
 * request resolves.
 */
function requirePaymentsRefund(request: FastifyRequest, reply: FastifyReply): boolean {
  try {
    assertCan({ role: request.auth!.role }, "payments:refund", "damage-claim-capture");
    return true;
  } catch (error) {
    if (error instanceof ForbiddenActionError) {
      sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
      return false;
    }
    throw error;
  }
}

function sendClaimNotFound(request: FastifyRequest, reply: FastifyReply) {
  return sendProblem(request, reply, 404, problemType("not-found"), "Not Found", "No damage claim with that id.");
}

/**
 * `docs/cards/D118.md` — Damage claim UI's API support: file, review
 * (list), capture, or waive a rental damage claim.
 *
 * This card's acceptance criterion ("capture bounded by authorized amount
 * in the UI") is enforced here as the server-side half of that bound: the
 * capture route reads the order line's own `DepositAuthorizationRepository`
 * row (`findByOrderLineId`, added this card) and rejects any requested
 * `amountMinor` above that hold's own `amountMinor` with a `400` before the
 * provider is ever called — the same bound `DamageClaimView.tsx` mirrors as
 * a client-side `max` on the capture input, so a merchant sees the ceiling
 * before submitting, not just after a rejection.
 */
export function registerDamageClaimRoutes(
  app: FastifyInstance,
  connection: Connection,
  depositHoldProvider: DepositHoldProvider,
): void {
  const getServices = createServiceFactory(connection, depositHoldProvider);

  app.post<{ Params: { orderLineId: string }; Body: unknown }>(
    "/order-lines/:orderLineId/damage-claims",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as { amountMinor?: unknown; filedAt?: unknown };
      if (typeof body.amountMinor !== "number" || body.amountMinor <= 0) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "amountMinor (positive number) is required.");
      }

      const { damageClaims } = await getServices();
      try {
        const id = damageClaims.fileClaim(request.auth!.tenant, request.auth!.role, {
          orderLineId: request.params.orderLineId,
          amountMinor: body.amountMinor,
          filedAt: typeof body.filedAt === "string" ? body.filedAt : new Date().toISOString(),
        });
        return reply.code(201).send({ id });
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        throw error;
      }
    },
  );

  /** Read-only "review" surface — gated on `bookings:view` inside `listByOrderLine`, open to every merchant role. */
  app.get<{ Params: { orderLineId: string } }>(
    "/order-lines/:orderLineId/damage-claims",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { damageClaims } = await getServices();
      const claims: DamageClaim[] = damageClaims.listByOrderLine(
        request.auth!.tenant,
        request.auth!.role,
        request.params.orderLineId,
      );
      return reply.code(200).send(claims);
    },
  );

  /**
   * `docs/cards/D118.md`'s acceptance criterion ("capture bounded by
   * authorized amount in the UI") needs the authorized amount itself before
   * a capture is ever attempted — this read exposes exactly that (and
   * nothing about the underlying payment/provider), gated on `bookings:view`
   * like the claims list above, open to every merchant role.
   */
  app.get<{ Params: { orderLineId: string } }>(
    "/order-lines/:orderLineId/deposit-authorization",
    { preHandler: app.authenticate },
    async (request, reply) => {
      assertCan({ role: request.auth!.role }, "bookings:view");
      const { deposits } = await getServices();
      const deposit = deposits.findByOrderLineId(request.auth!.tenant, request.params.orderLineId);
      if (!deposit) {
        return reply.code(200).send(null);
      }
      return reply.code(200).send({
        id: deposit.id,
        amountMinor: deposit.amountMinor,
        currency: deposit.currency,
        state: deposit.state,
        capturedMinor: deposit.capturedMinor,
      });
    },
  );

  app.post<{ Params: { claimId: string }; Body: unknown }>(
    "/damage-claims/:claimId/notify",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { damageClaims } = await getServices();
      const claim = damageClaims.findById(request.auth!.tenant, request.auth!.role, request.params.claimId);
      if (!claim) {
        return sendClaimNotFound(request, reply);
      }
      try {
        damageClaims.notifyCustomer(request.auth!.tenant, request.auth!.role, claim.id);
        return reply.code(200).send({ id: claim.id, state: "CUSTOMER_NOTIFIED" });
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof IllegalDamageClaimTransitionError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", error.message);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { claimId: string }; Body: unknown }>(
    "/damage-claims/:claimId/capture",
    { preHandler: app.authenticate },
    async (request, reply) => {
      if (!requirePaymentsRefund(request, reply)) {
        return reply;
      }

      const body = (request.body ?? {}) as {
        amountMinor?: unknown;
        idempotencyKey?: unknown;
        capturedAt?: unknown;
        resolutionNote?: unknown;
      };
      if (typeof body.amountMinor !== "number" || body.amountMinor <= 0) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "amountMinor (positive number) is required.");
      }
      if (typeof body.idempotencyKey !== "string" || body.idempotencyKey.length === 0) {
        return sendProblem(request, reply, 400, problemType("bad-request"), "Bad Request", "idempotencyKey is required.");
      }

      const { damageClaims, deposits, depositService } = await getServices();
      const ctx = request.auth!.tenant;
      const claim = damageClaims.findById(ctx, request.auth!.role, request.params.claimId);
      if (!claim) {
        return sendClaimNotFound(request, reply);
      }

      const deposit = deposits.findByOrderLineId(ctx, claim.orderLineId);
      if (!deposit) {
        return sendProblem(
          request,
          reply,
          409,
          problemType("conflict"),
          "Conflict",
          "No deposit hold is on file for this order line.",
        );
      }

      // This card's acceptance criterion, enforced server-side: a capture
      // can never exceed the deposit hold's own authorized amount, whatever
      // the UI submits.
      if (body.amountMinor > deposit.amountMinor) {
        return sendProblem(
          request,
          reply,
          400,
          problemType("bad-request"),
          "Bad Request",
          `Capture amount (${body.amountMinor}) cannot exceed the authorized deposit amount (${deposit.amountMinor}).`,
        );
      }

      const capturedAt = typeof body.capturedAt === "string" ? body.capturedAt : new Date().toISOString();
      const resolutionNote = typeof body.resolutionNote === "string" ? body.resolutionNote : null;

      try {
        const result = await depositService.captureHold(ctx, {
          depositAuthorizationId: deposit.id,
          amountMinor: body.amountMinor,
          idempotencyKey: body.idempotencyKey,
          capturedAt,
        });
        damageClaims.resolveCaptured(ctx, request.auth!.role, claim.id, capturedAt, resolutionNote);
        return reply.code(200).send({
          claimId: claim.id,
          depositAuthorizationId: deposit.id,
          state: result.state,
          capturedMinor: result.capturedMinor,
          releasedRemainderMinor: result.releasedRemainderMinor,
        });
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof DepositHoldAlreadyResolvedError) {
          return sendProblem(
            request,
            reply,
            409,
            problemType("conflict"),
            "Conflict",
            "This deposit hold has already been resolved — one capture attempt only.",
          );
        }
        if (error instanceof IllegalDamageClaimTransitionError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", error.message);
        }
        throw error;
      }
    },
  );

  app.post<{ Params: { claimId: string }; Body: unknown }>(
    "/damage-claims/:claimId/waive",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const body = (request.body ?? {}) as { resolvedAt?: unknown; resolutionNote?: unknown };
      const { damageClaims } = await getServices();
      const claim = damageClaims.findById(request.auth!.tenant, request.auth!.role, request.params.claimId);
      if (!claim) {
        return sendClaimNotFound(request, reply);
      }

      try {
        const resolvedAt = typeof body.resolvedAt === "string" ? body.resolvedAt : new Date().toISOString();
        const resolutionNote = typeof body.resolutionNote === "string" ? body.resolutionNote : null;
        damageClaims.resolveWaived(request.auth!.tenant, request.auth!.role, claim.id, resolvedAt, resolutionNote);
        return reply.code(200).send({ id: claim.id, state: "RESOLVED_WAIVED" });
      } catch (error) {
        if (error instanceof ForbiddenActionError) {
          return sendProblem(request, reply, 403, problemType("forbidden"), "Forbidden", error.message);
        }
        if (error instanceof IllegalDamageClaimTransitionError) {
          return sendProblem(request, reply, 409, problemType("conflict"), "Conflict", error.message);
        }
        throw error;
      }
    },
  );
}
