import type { Metadata } from "next";
import { Container, Button } from "@/components/GravityUI/GravityUI";
import { AdminGenerationQuotas } from "@/components/AdminGenerationQuotas/AdminGenerationQuotas";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const metadata:Metadata={title:"Generation limits",robots:{index:false,follow:false,nocache:true},referrer:"no-referrer"};
export default async function GenerationLimitsPage(){
 const principal=await getCurrentPrincipal();
 return <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
  <h1>Generation limits</h1>
  {principal&&isAdminUser(principal)?<AdminGenerationQuotas/>:<><p>Admin sign-in is required to view or grant additional attempts.</p><Button href={withBasePath('/login')}>Login</Button></>}
 </Container>;
}
