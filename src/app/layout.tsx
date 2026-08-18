import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata={title:"Kagua — Journal Intelligence",description:"Evidence-grounded journal selection for researchers"};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
