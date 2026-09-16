import Dashboard from "@/components/dashboard";
import { demoProvider } from "@/providers/demo";
export default async function Home() {
  return <Dashboard snapshot={await demoProvider.getSnapshot()} />;
}
