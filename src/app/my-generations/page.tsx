import type {Metadata} from "next";
import {Container,Flex,Text} from "@/components/GravityUI/GravityUI";
import {MyGenerations} from "@/components/MyGenerations/MyGenerations";
import {withBasePath} from "@/lib/base-path";

export const dynamic="force-dynamic";
export const metadata:Metadata={title:"My generations",robots:{index:false,follow:false,noarchive:true},referrer:"no-referrer"};
export default function MyGenerationsPage(){
  return <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
    <Flex direction="column" gap={3} className="page-section-header">
      <Text variant="display-2" as="h1">My generations</Text>
      <Text variant="body-2" color="secondary">Tasks saved in this browser, without signing in. Accepted tasks and private results you open are remembered here.</Text>
      <p>Results are available for 24 hours after acceptance. Download your ZIP before it expires. Clearing browser data removes this list; it does not cancel tasks or reset limits.</p>
      <p>The latest 50 entries are kept here for up to seven days after their results expire. Older links can be added by opening an available private result.</p>
    </Flex>
    <section className="page-section"><MyGenerations/></section>
    <p><a href={withBasePath("/generate")}>Generate a pet</a></p>
  </Container>;
}
