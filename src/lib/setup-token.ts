import type { NextRequest } from "next/server";

const SETUP_TOKEN_HEADER = "x-minutia-setup-token";

export function isSetupTokenRequired() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.MINUTIA_SETUP_TOKEN);
}

export function requireSetupToken(request: NextRequest) {
  const expected = process.env.MINUTIA_SETUP_TOKEN;
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return {
        authorized: false as const,
        status: 503,
        error: "MINUTIA_SETUP_TOKEN is required before setup can be completed",
      };
    }

    return { authorized: true as const };
  }

  if (request.headers.get(SETUP_TOKEN_HEADER) !== expected) {
    return {
      authorized: false as const,
      status: 403,
      error: "Invalid setup token",
    };
  }

  return { authorized: true as const };
}
