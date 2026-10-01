import { resolveStaffAuthSession } from "../../lib/server/auth-session";
import { RootAuthClient } from "./_components/root-auth-client.tsx";

export default async function Home() {
  const initialAuth = await resolveStaffAuthSession();

  return <RootAuthClient initialAuth={initialAuth} />;
}
