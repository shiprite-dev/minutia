import { CreateClient } from "./CreateClient";

export const metadata = {
  title: "Minutia Retro, the retro where action items don't die",
  description:
    "A free, instant, multiplayer retrospective board. Run it, export it, no signup.",
};

export default function RetroCreatePage() {
  return <CreateClient />;
}
