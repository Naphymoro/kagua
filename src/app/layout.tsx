import type { Metadata } from "next";
import Link from "next/link";
import { auth, signOut } from "@/auth";
import "./globals.css";
// futuristic.css retired: it stacked three successive :root redefinitions on
// top of globals.css (each one overriding the last), which is what produced
// the mismatched borders/colors and inconsistent type. Its styles are now
// consolidated into globals.css as a single design system. The file is kept
// in the repo for reference but is no longer imported.

export const metadata: Metadata = { title: "Kagua - Journal Intelligence", description: "Evidence-grounded journal selection for researchers" };

// Applies the saved theme before paint, on every route (not just the
// Journal Hunter page). Previously only src/app/page.tsx toggled
// data-theme, so a direct visit or hard reload of /registry or /manual
// always rendered light regardless of the user's chosen theme. This runs
// synchronously and blocks rendering by design, matching the standard
// no-flash theme-init pattern.
const themeInitScript = `(function(){try{var t=localStorage.getItem("kagua.theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head><body><nav className="appTabs" aria-label="Kagua sections"><Link href="/" className="appTabsBrand"><span className="appTabsBrandMark">K</span><span className="appTabsBrandText"><strong>Kagua</strong><small>Publication intelligence</small></span></Link><div className="appTabsLinks"><Link href="/" className="appTabsHome" aria-label="Home">Home</Link><Link href="/">Journal Hunter</Link><Link href="/registry">DHET List</Link><Link href="/manual">Manual</Link></div><div className="authNav">{session?.user?.email ? <><span className="chip">{session.user.email}</span><form action={async()=>{"use server";await signOut({redirectTo:"/sign-in"})}}><button className="textButton" type="submit">Sign out</button></form></> : <Link className="textButton" href="/sign-in">Sign in</Link>}</div></nav>{children}<footer className="siteFooter"><p>Developed and maintained by <strong>Prof. Cecil Ouma</strong>, Academic and Research Manager, AIMS Research and Innovation Centre</p></footer></body></html>;
}
