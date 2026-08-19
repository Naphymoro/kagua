import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import "./globals.css";
import "./futuristic.css";

export const metadata: Metadata = { title: "Kagua - Journal Intelligence", description: "Evidence-grounded journal selection for researchers" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return <html lang="en"><body><nav className="appTabs" aria-label="Kagua sections"><Link href="/" className="appTabsBrand"><span className="appTabsBrandMark">K</span><span className="appTabsBrandText"><strong>Kagua</strong><small>Publication intelligence</small></span></Link><div className="appTabsLinks"><Link href="/">Journal Hunter</Link><Link href="/registry">DHET List</Link><Link href="/manual">Manual</Link></div><div className="authNav">{session?.user?.email ? <><span className="chip">{session.user.email}</span><form action={async()=>{"use server";await signOut({redirectTo:"/sign-in"})}}><button className="textButton" type="submit">Sign out</button></form></> : <Link className="textButton" href="/sign-in">Sign in</Link>}</div></nav>{children}<footer className="siteFooter"><p>Developed and maintained by <strong>Prof. Cecil Ouma</strong>, Academic and Research Manager, AIMS Research and Innovation Centre</p></footer></body></html>;
}
