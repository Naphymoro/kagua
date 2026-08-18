import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
export const metadata: Metadata={title:"Kagua — Journal Intelligence",description:"Evidence-grounded journal selection for researchers"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><nav className="appTabs" aria-label="Kagua sections"><Link href="/">Journal Hunter</Link><Link href="/registry">Journal Registry</Link></nav>{children}</body></html>}
