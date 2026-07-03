/** Extract the token from an `Authorization: Bearer <token>` header, else null. */
export function bearerTokenFromHeader(value: string | null): string | null {
  const match = value?.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}
