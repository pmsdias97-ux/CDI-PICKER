import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Fonte principal da app: Inter (auto-hospedada, consistente em todos os dispositivos).
const appSans = Inter({
  variable: "--font-app",
  subsets: ["latin"],
});

export const metadata = {
  title: "CDI PICKER",
  description: "O jogo de portefólios da nossa comunidade. Escolhe 8 ações, submete o teu portefólio e compete pelo melhor retorno.",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${appSans.variable} h-full antialiased`}
    >
      {/* suppressHydrationWarning: extensões (ex.: Grammarly) injetam atributos
          no <body> antes da hidratação, causando um mismatch benigno. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
