import { Suspense } from "react";
import { CompanionAuthorizeClient } from "./companion-authorize-client";

export const metadata = { title: "Authorize Mac app" };

export default function CompanionAuthorizePage() {
  return (
    <Suspense>
      <CompanionAuthorizeClient />
    </Suspense>
  );
}
