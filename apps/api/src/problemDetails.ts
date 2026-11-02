import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * RFC 9457 "Problem Details for HTTP APIs" response body, per
 * `docs/design/06`'s conventions table.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
}

const PROBLEM_TYPE_BASE = "https://smb-commerce-os.dev/problems";

export function problemType(slug: string): string {
  return `${PROBLEM_TYPE_BASE}/${slug}`;
}

/**
 * Builds a problem-details body for a request, using its (already
 * assigned) request id as the `instance` so a client and an operator
 * can correlate a specific failed call — without exposing a stack
 * trace or any other internal detail (this card's security check).
 */
export function toProblemDetails(request: FastifyRequest, status: number, type: string, title: string, detail?: string): ProblemDetails {
  return {
    type,
    title,
    status,
    ...(detail ? { detail } : {}),
    instance: `urn:request:${request.id}`,
  };
}

export function sendProblem(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  type: string,
  title: string,
  detail?: string,
): FastifyReply {
  return reply
    .code(status)
    .type("application/problem+json")
    .send(toProblemDetails(request, status, type, title, detail));
}
